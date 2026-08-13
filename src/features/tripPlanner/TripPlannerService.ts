import { MapCoordinates, UserEVProfile } from '../../types/ev';
import { RangeCalculator } from '../../utils/RangeCalculator';
import { ChargingStation, getDistanceKm } from '../../utils/StationGenerator';
import { ChargeStop, SmartTripPlan, TripLeg } from './types';

const AVG_SPEED_KMH = 90; // Reference cruising speed used across the app's range math
const MAX_STOPS = 4; // Safety cap so an unreachable trip can't loop forever
const DEFAULT_MAX_CHARGE_SOC = 80; // Fallback charge-limit preference if none is supplied
const CHARGE_TIME_BUFFER_SOC = 5; // Small safety margin added on top of the bare minimum needed

export interface RouteFetcher {
  (from: MapCoordinates, to: MapCoordinates): Promise<{ coordinates: MapCoordinates[]; distanceKm: number } | null>;
}

export interface StationFetcher {
  (center: MapCoordinates, maxRadiusKm: number): Promise<ChargingStation[]>;
}

export interface PlanSmartTripInput {
  origin: MapCoordinates;
  destination: MapCoordinates;
  vehicle: UserEVProfile;
  currentSoC: number;
  targetReserveSoC: number;
  /** Driver's preferred charge limit (%) at stops — a battery-health habit. Defaults to 80% if omitted. The planner still charges past it when the remaining trip genuinely requires more. */
  preferredMaxChargeSoC?: number;
  airConActive: boolean;
  fetchRoute: RouteFetcher;
  fetchStations: StationFetcher;
}

export class TripPlannerService {
  /**
   * Estimates charging time using a simplified two-stage curve: full rated power up to 80% SoC,
   * then a tapered rate above that (real DC fast chargers slow down sharply near-full to protect
   * the battery). AC (onboard-charger-limited) sessions are treated as roughly linear throughout.
   *
   * Actual charge speed is capped at `vehicleMaxChargeKW` — a 250kW station can't charge a car
   * any faster than that car's own onboard charger / DC inverter allows.
   */
  public static estimateChargeTimeMinutes(
    batteryCapacityKWh: number,
    stationPowerKW: number,
    stationType: 'AC' | 'DC',
    fromSoC: number,
    toSoC: number,
    vehicleMaxChargeKW: number = Infinity
  ): number {
    const chargeSpeedKW = Math.min(stationPowerKW, vehicleMaxChargeKW > 0 ? vehicleMaxChargeKW : stationPowerKW);
    if (toSoC <= fromSoC || chargeSpeedKW <= 0 || batteryCapacityKWh <= 0) return 0;

    const CHARGING_EFFICIENCY = 0.9; // ~10% lost as heat/conversion loss
    const effectivePowerKW = chargeSpeedKW * CHARGING_EFFICIENCY;

    if (stationType === 'AC') {
      const energyKWh = ((toSoC - fromSoC) / 100) * batteryCapacityKWh;
      return (energyKWh / effectivePowerKW) * 60;
    }

    // DC fast charging taper curve
    const TAPER_THRESHOLD_SOC = 80;
    const TAPER_POWER_FACTOR = 0.4;

    let minutes = 0;

    const fullPowerEnd = Math.min(toSoC, TAPER_THRESHOLD_SOC);
    if (fullPowerEnd > fromSoC) {
      const energyKWh = ((fullPowerEnd - fromSoC) / 100) * batteryCapacityKWh;
      minutes += (energyKWh / effectivePowerKW) * 60;
    }

    const taperStart = Math.max(fromSoC, TAPER_THRESHOLD_SOC);
    if (toSoC > taperStart) {
      const energyKWh = ((toSoC - taperStart) / 100) * batteryCapacityKWh;
      minutes += (energyKWh / (effectivePowerKW * TAPER_POWER_FACTOR)) * 60;
    }

    return minutes;
  }

  /**
   * Plans a full origin -> destination trip, inserting charging stops as needed.
   *
   * Strategy per hop: from the current simulated position, look at every charger reachable
   * within the vehicle's safe range — any station in range is a candidate, regardless of its
   * reported live status. Score each by how much closer to the destination it gets you
   * (straight-line-ish road distance), with a soft penalty for slower AC chargers, then pick
   * the best. The driver's preferred charge limit is a hard cap at every stop; the planner only
   * charges past it as a last resort, when capping there would otherwise strand the trip (no
   * further charger and not the destination reachable afterwards) — never merely to finish in
   * fewer total stops. Charge time is estimated at whichever is slower: the station's rated
   * power or the vehicle's own max charge speed.
   *
   * If a charging stop was needed, also attempts one alternative route (see `planCore` /
   * `.alternative` on the result) by forcing a different first station. If the primary pick
   * isn't reported "available" (occupied/under maintenance/unknown), the alternative search is
   * biased toward a station that is — a realistic backup plan is "somewhere else that's
   * actually open," not just "the next-closest option regardless of status." (Status still
   * never affects the *primary* pick or reachability itself — see the note in `planCore` on why
   * that data is too unreliable to gate on.)
   */
  public static async planSmartTrip(input: PlanSmartTripInput): Promise<SmartTripPlan> {
    const primary = await this.planCore(input, new Set());

    // If the trip needed a charging stop, look for a genuinely different route by forcing a
    // different choice at the first stop — the highest-leverage decision point, and the one a
    // driver is most likely to want a second opinion on (e.g. a different network/brand, or one
    // that's actually reported available). Only attach it if it's actually reachable and
    // actually different from the primary.
    if (primary.reachable && primary.stops.length > 0) {
      const primaryFirstStop = primary.stops[0];
      const avoidFirstChoice = new Set([primaryFirstStop.station.id]);
      const preferAvailableFirstStop = primaryFirstStop.station.status !== 'AVAILABLE';

      const alt = await this.planCore(input, avoidFirstChoice, { preferAvailableFirstStop });
      if (alt.reachable && alt.stops[0]?.station.id !== primaryFirstStop.station.id) {
        primary.alternative = alt;
      }
    }

    return primary;
  }

  /**
   * The core hop-by-hop planning loop, factored out so `planSmartTrip` can call it twice — once
   * normally, once with the first stop's station pre-excluded — to surface an alternative route.
   */
  private static async planCore(
    input: PlanSmartTripInput,
    preExcludedStationIds: Set<string>,
    options: { preferAvailableFirstStop?: boolean } = {}
  ): Promise<SmartTripPlan> {
    const { origin, destination, vehicle, currentSoC, targetReserveSoC, airConActive, fetchRoute, fetchStations } = input;
    const preferredMaxChargeSoC =
      input.preferredMaxChargeSoC && input.preferredMaxChargeSoC > 0
        ? Math.min(100, input.preferredMaxChargeSoC)
        : DEFAULT_MAX_CHARGE_SOC;

    const effectiveRangeKm = RangeCalculator.getEffectiveRangeKm(vehicle, airConActive);
    const socForDistance = (distanceKm: number) =>
      effectiveRangeKm > 0 ? (distanceKm / effectiveRangeKm) * 100 : Infinity;

    const legs: TripLeg[] = [];
    const stops: ChargeStop[] = [];
    const visitedStationIds = new Set<string>(preExcludedStationIds);

    let position = origin;
    let soc = currentSoC;

    for (let hop = 0; hop < MAX_STOPS; hop++) {
      const directRoute = await this.fetchRouteOrFallback(fetchRoute, position, destination);

      const safeRangeNow = Math.max(0, ((soc - targetReserveSoC) / 100) * effectiveRangeKm);

      if (directRoute.distanceKm <= safeRangeNow) {
        // Final leg — destination is directly reachable from here.
        legs.push({
          from: position,
          to: destination,
          distanceKm: directRoute.distanceKm,
          driveTimeMinutes: (directRoute.distanceKm / AVG_SPEED_KMH) * 60,
          coordinates: directRoute.coordinates,
        });
        soc = Math.max(0, soc - socForDistance(directRoute.distanceKm));
        return this.buildResult(legs, stops, true, soc);
      }

      // Need a charging stop: search around the current simulated position.
      const maxReachableKm = Math.max(0, (soc / 100) * effectiveRangeKm);
      const candidates = await fetchStations(position, maxReachableKm);
      const reachable = candidates.filter(
        (s) => s.distanceKm <= safeRangeNow && !visitedStationIds.has(s.id)
      );

      if (reachable.length === 0) {
        return this.buildResult(legs, stops, false, soc);
      }

      // Live "status" (available/occupied/maintenance) isn't factored into the *primary* pick or
      // reachability — it's self-reported and frequently stale, and excluding or heavily
      // penalizing stations on it was causing viable routes to come back as falsely unreachable.
      // The one exception: when explicitly asked to bias toward availability (used for the
      // alternative/backup route, at the first stop only — see planSmartTrip), a non-available
      // station gets a heavy but not disqualifying penalty, so an available option wins if one
      // is reachable, while still falling back to the best station overall if not.
      const biasTowardAvailability = !!options.preferAvailableFirstStop && hop === 0;

      let best: ChargingStation | null = null;
      let bestScore = Infinity;
      for (const station of reachable) {
        const distToDest = getDistanceKm(station, destination);
        let score = distToDest;
        if (station.type !== 'DC') score += 30; // prefer fast chargers to keep the trip quick
        if (biasTowardAvailability && station.status !== 'AVAILABLE') score += 150;
        if (score < bestScore) {
          bestScore = score;
          best = station;
        }
      }
      if (!best) {
        return this.buildResult(legs, stops, false, soc);
      }

      const stationCoords: MapCoordinates = { latitude: best.latitude, longitude: best.longitude };
      const legRoute = await this.fetchRouteOrFallback(fetchRoute, position, stationCoords);

      const arrivalSoC = Math.max(0, soc - socForDistance(legRoute.distanceKm));

      // Decide how much to charge. The preferred limit is a hard cap by default — charge to it
      // and stop, full stop. The *only* reason to ever charge past it is if capping here would
      // strand the trip: neither the destination nor any further charger would be reachable
      // afterwards. In that one exceptional case, charge just enough (up to 100%) to reach
      // whichever of those is closer, so the trip can still continue.
      const safeRangeAtPreferredLimit = Math.max(0, ((preferredMaxChargeSoC - targetReserveSoC) / 100) * effectiveRangeKm);
      const remainingDirect = await this.fetchRouteOrFallback(fetchRoute, stationCoords, destination);
      const reachesDestinationAtPreferredLimit = remainingDirect.distanceKm <= safeRangeAtPreferredLimit;

      let departureSoC = preferredMaxChargeSoC;
      let exceededPreferredLimit = false;

      if (!reachesDestinationAtPreferredLimit) {
        const maxLookaheadKm = Math.max(0, (100 / 100) * effectiveRangeKm);
        const furtherCandidates = await fetchStations(stationCoords, maxLookaheadKm);
        const anotherStationReachableAtPreferredLimit = furtherCandidates.some(
          (s) => s.id !== best!.id && !visitedStationIds.has(s.id) && s.distanceKm <= safeRangeAtPreferredLimit
        );

        if (!anotherStationReachableAtPreferredLimit) {
          // Genuine last resort: capping at the preferred limit would strand the trip here.
          const socNeededForRemaining = socForDistance(remainingDirect.distanceKm) + targetReserveSoC;
          departureSoC = Math.min(100, Math.max(socNeededForRemaining + CHARGE_TIME_BUFFER_SOC, preferredMaxChargeSoC));
          exceededPreferredLimit = departureSoC > preferredMaxChargeSoC + 0.5;
        }
      }
      departureSoC = Math.max(departureSoC, Math.min(100, arrivalSoC + 1));

      const vehicleMaxChargeKW = best.type === 'DC' ? vehicle.maxDcChargeKW : vehicle.maxAcChargeKW;
      const chargeTimeMinutes = this.estimateChargeTimeMinutes(
        vehicle.batteryCapacityKWh,
        best.powerKW,
        best.type,
        arrivalSoC,
        departureSoC,
        vehicleMaxChargeKW
      );
      const energyAddedKWh = ((departureSoC - arrivalSoC) / 100) * vehicle.batteryCapacityKWh;

      legs.push({
        from: position,
        to: stationCoords,
        distanceKm: legRoute.distanceKm,
        driveTimeMinutes: (legRoute.distanceKm / AVG_SPEED_KMH) * 60,
        coordinates: legRoute.coordinates,
      });
      stops.push({
        station: best,
        arrivalSoC: this.round(arrivalSoC),
        departureSoC: this.round(departureSoC),
        energyAddedKWh: this.round(energyAddedKWh),
        chargeTimeMinutes: this.round(chargeTimeMinutes),
        exceededPreferredLimit,
      });

      visitedStationIds.add(best.id);
      position = stationCoords;
      soc = departureSoC;
    }

    // Exceeded the stop budget without reaching the destination.
    return this.buildResult(legs, stops, false, soc);
  }

  /**
   * Fetches a real road route, retrying once on failure before giving up. If the routing
   * service is still unavailable (the public OSRM demo server used by default has no uptime
   * guarantee and can rate-limit), falls back to a straight-line estimate — using the same
   * road-circuity factor as the rest of the app — rather than declaring the whole trip
   * unreachable over what's usually just a transient network hiccup.
   */
  private static async fetchRouteOrFallback(
    fetchRoute: RouteFetcher,
    from: MapCoordinates,
    to: MapCoordinates
  ): Promise<{ coordinates: MapCoordinates[]; distanceKm: number }> {
    const route = (await fetchRoute(from, to)) ?? (await fetchRoute(from, to));
    if (route) return route;
    return { coordinates: [from, to], distanceKm: getDistanceKm(from, to) };
  }

  private static buildResult(
    legs: TripLeg[],
    stops: ChargeStop[],
    reachable: boolean,
    finalArrivalSoC: number
  ): SmartTripPlan {
    const totalDistanceKm = legs.reduce((sum, l) => sum + l.distanceKm, 0);
    const totalDriveTimeMinutes = legs.reduce((sum, l) => sum + l.driveTimeMinutes, 0);
    const totalChargeTimeMinutes = stops.reduce((sum, s) => sum + s.chargeTimeMinutes, 0);

    return {
      reachable,
      directRoute: reachable && stops.length === 0,
      legs,
      stops,
      totalDistanceKm: this.round(totalDistanceKm),
      totalDriveTimeMinutes: this.round(totalDriveTimeMinutes),
      totalChargeTimeMinutes: this.round(totalChargeTimeMinutes),
      totalTripTimeMinutes: this.round(totalDriveTimeMinutes + totalChargeTimeMinutes),
      finalArrivalSoC: this.round(finalArrivalSoC),
    };
  }

  private static round(value: number, decimals: number = 1): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
}
