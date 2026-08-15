import { MapCoordinates, UserEVProfile, DrivingMode } from '../../types/ev';
import { RangeCalculator } from '../../utils/RangeCalculator';
import { ChargingStation, getDistanceKm, isTeslaVehicle } from '../../utils/StationGenerator';
import { ChargeStop, SmartTripPlan, TripLeg } from './types';

const MAX_STOPS = 15; // Safety cap so an unreachable trip can't loop forever
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
  /** City/Mixed/Highway usage profile — feeds into the same range formula RangeControlPanel uses (see RangeCalculator). Defaults to 'MIXED' if omitted, matching `RangeCalculator.getEffectiveRangeKm`'s own default. */
  drivingMode?: DrivingMode;
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
   * reported live status. DC fast chargers are strictly preferred over AC: if any DC charger is
   * reachable, AC options are dropped from consideration entirely for that hop; AC is only ever
   * picked when no DC charger is reachable before the battery would hit the reserve buffer.
   * Within whichever pool is being considered, stations are scored by how much closer to the
   * destination they get you (straight-line-ish road distance) and the best one is picked. The
   * driver's preferred charge limit is a hard cap at every stop; the planner only
   * charges past it as a last resort, when capping there would otherwise strand the trip (no
   * further charger and not the destination reachable afterwards) — never merely to finish in
   * fewer total stops. Charge time is estimated at whichever is slower: the station's rated
   * power or the vehicle's own max charge speed.
   *
   * If a charging stop was needed, also attempts one alternative route (see `planCore` /
   * `.alternative` on the result) by forcing a different first station. Unlike the primary pick
   * — which is scored by how much closer to the destination a station gets you — the backup
   * station is deliberately scored differently: it must be the physically *nearest* reachable
   * charger to where the driver actually is, and it must not require backtracking (a station
   * further from the destination than the driver's current position already is gets excluded,
   * not just penalized). A backup plan the driver has to turn around and drive back toward isn't
   * actually useful. If the primary pick isn't reported "available" (occupied/under
   * maintenance/unknown), the search is additionally biased toward a station that is — a
   * realistic backup plan is "somewhere else nearby that's actually open." (Status still never
   * affects the *primary* pick or reachability itself — see the note in `planCore` on why that
   * data is too unreliable to gate on.)
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

      const alt = await this.planCore(input, avoidFirstChoice, {
        preferAvailableFirstStop,
        preferNearestNoBacktrack: true,
        primaryStation: primaryFirstStop.station,
      });
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
  private static findClosestCoordinateIndex(
    coordinates: MapCoordinates[],
    position: MapCoordinates
  ): number {
    let closestIdx = 0;
    let minDistance = Infinity;
    for (let i = 0; i < coordinates.length; i++) {
      const dist = getDistanceKm(coordinates[i], position);
      if (dist < minDistance) {
        minDistance = dist;
        closestIdx = i;
      }
    }
    return closestIdx;
  }

  private static getDistanceAlongCoords(
    coordinates: MapCoordinates[],
    fromIdx: number,
    toIdx: number
  ): number {
    let dist = 0;
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    for (let i = start; i < end; i++) {
      dist += getDistanceKm(coordinates[i], coordinates[i + 1]);
    }
    return dist;
  }

  /**
   * The core hop-by-hop planning loop, factored out so `planSmartTrip` can call it twice — once
   * normally, once with the first stop's station pre-excluded — to surface an alternative route.
   */
  /**
   * The core hop-by-hop planning loop, factored out so `planSmartTrip` can call it twice — once
   * normally, once with the first stop's station pre-excluded — to surface an alternative route.
   */
  private static async planCore(
    input: PlanSmartTripInput,
    preExcludedStationIds: Set<string>,
    options: { preferAvailableFirstStop?: boolean; preferNearestNoBacktrack?: boolean; primaryStation?: ChargingStation } = {}
  ): Promise<SmartTripPlan> {
    const { origin, destination, vehicle, currentSoC, targetReserveSoC, airConActive, fetchRoute, fetchStations } = input;
    const drivingMode = input.drivingMode ?? 'MIXED';
    const preferredMaxChargeSoC =
      input.preferredMaxChargeSoC && input.preferredMaxChargeSoC > 0
        ? Math.min(100, input.preferredMaxChargeSoC)
        : DEFAULT_MAX_CHARGE_SOC;

    const effectiveRangeKm = RangeCalculator.getEffectiveRangeKm(vehicle, airConActive, drivingMode);
    const avgSpeedKmH = RangeCalculator.getAvgSpeedKmH(drivingMode);
    const socForDistance = (distanceKm: number) =>
      effectiveRangeKm > 0 ? (distanceKm / effectiveRangeKm) * 100 : Infinity;

    // A non-Tesla EV physically cannot plug into a Tesla-only Supercharger — exclude those
    // candidates entirely for anyone else, rather than letting the planner route someone to a
    // stop they can't actually use (see `ChargingStation.isTeslaOnly` / `inferIsTeslaOnly`).
    const vehicleIsTesla = isTeslaVehicle(vehicle.modelName);
    const isPluggableByVehicle = (s: ChargingStation) => !s.isTeslaOnly || vehicleIsTesla;

    console.log(`[TripPlanner Debug] ===== Starting trip planning pass =====`);
    console.log(`[TripPlanner Debug] Origin: ${JSON.stringify(origin)}`);
    console.log(`[TripPlanner Debug] Destination: ${JSON.stringify(destination)}`);
    console.log(`[TripPlanner Debug] Vehicle battery: ${vehicle.batteryCapacityKWh} kWh, SoC: ${currentSoC}%, Reserve: ${targetReserveSoC}%`);
    console.log(`[TripPlanner Debug] Driving Mode: ${drivingMode}, Effective Range: ${effectiveRangeKm.toFixed(1)} km`);

    // 1. Fetch the complete route from origin to destination first (Google Maps / OSRM shape)
    const mainRoute = await this.fetchRouteOrFallback(fetchRoute, origin, destination);
    const mainCoords = mainRoute.coordinates;
    console.log(`[TripPlanner Debug] Main route distance: ${mainRoute.distanceKm.toFixed(1)} km, Coordinates count: ${mainCoords.length}`);

    const legs: TripLeg[] = [];
    const stops: ChargeStop[] = [];
    const visitedStationIds = new Set<string>(preExcludedStationIds);

    let position = origin;
    let soc = currentSoC;
    let currentIdx = 0;

    for (let hop = 0; hop < MAX_STOPS; hop++) {
      currentIdx = this.findClosestCoordinateIndex(mainCoords, position);
      const remainingDistance = this.getDistanceAlongCoords(mainCoords, currentIdx, mainCoords.length - 1);
      const safeRangeNow = Math.max(0, ((soc - targetReserveSoC) / 100) * effectiveRangeKm);

      console.log(`\n[TripPlanner Debug] --- Hop ${hop} ---`);
      console.log(`[TripPlanner Debug] Position Index: ${currentIdx}/${mainCoords.length - 1}, Remaining Distance: ${remainingDistance.toFixed(1)} km`);
      console.log(`[TripPlanner Debug] Current SoC: ${soc.toFixed(1)}%, Safe range with reserve: ${safeRangeNow.toFixed(1)} km`);

      if (remainingDistance <= safeRangeNow) {
        console.log(`[TripPlanner Debug] Destination is directly reachable! Creating final leg.`);
        legs.push({
          from: position,
          to: destination,
          distanceKm: remainingDistance,
          driveTimeMinutes: (remainingDistance / avgSpeedKmH) * 60,
          coordinates: mainCoords.slice(currentIdx),
        });
        soc = Math.max(0, soc - socForDistance(remainingDistance));
        return this.buildResult(legs, stops, true, soc);
      }

      // Need a charging stop: trace along the main route to find where the search center should be.
      // We place the search center at 85% of the safe range to guarantee any detours remain reachable.
      const searchTargetDistance = safeRangeNow * 0.85;
      let targetSearchIdx = currentIdx;
      let accumulatedDist = 0;
      for (let i = currentIdx; i < mainCoords.length - 1; i++) {
        const segDist = getDistanceKm(mainCoords[i], mainCoords[i + 1]);
        if (accumulatedDist + segDist > searchTargetDistance) {
          targetSearchIdx = i;
          break;
        }
        accumulatedDist += segDist;
        targetSearchIdx = i + 1;
      }

      const targetSearchCenter = mainCoords[targetSearchIdx];
      console.log(`[TripPlanner Debug] Search Center set at: index=${targetSearchIdx}/${mainCoords.length - 1}, distance=${accumulatedDist.toFixed(1)} km, coordinates=${JSON.stringify(targetSearchCenter)}`);

      // Query stations around the target search center with a 50km radius
      const candidates = await fetchStations(targetSearchCenter, 50);
      console.log(`[TripPlanner Debug] Found ${candidates.length} candidates near search center`);

      const reachable = candidates.filter((s) => {
        const sIdx = this.findClosestCoordinateIndex(mainCoords, s);
        const routeLegDistance = this.getDistanceAlongCoords(mainCoords, currentIdx, sIdx);
        const stationDetourDistance = getDistanceKm(mainCoords[sIdx], s);
        const distToStation = routeLegDistance + stationDetourDistance;
        const isReachable = distToStation <= safeRangeNow;
        const isVisited = visitedStationIds.has(s.id);
        const isPluggable = isPluggableByVehicle(s);

        console.log(`  - [Candidate] ${s.name} (${s.id}) at ${distToStation.toFixed(1)} km (route: ${routeLegDistance.toFixed(1)} km, detour: ${stationDetourDistance.toFixed(1)} km), Reachable: ${isReachable}, Visited: ${isVisited}, Pluggable: ${isPluggable}`);

        return isReachable && !isVisited && isPluggable;
      });

      console.log(`[TripPlanner Debug] Reachable & unvisited candidates count: ${reachable.length}`);

      if (reachable.length === 0) {
        console.warn(`[TripPlanner Debug] FAILED: No reachable charging stations found within safe battery range (${safeRangeNow.toFixed(1)} km) at hop ${hop}`);
        return this.buildResult(legs, stops, false, soc);
      }

      const biasTowardAvailability = !!options.preferAvailableFirstStop && hop === 0;
      const reachableDC = reachable.filter((s) => s.type === 'DC');
      let candidatePool = reachableDC.length > 0 ? reachableDC : reachable;

      // Prefer a real, database-sourced station over a simulated placeholder whenever a real one
      // is also reachable — a simulated station's coordinates are a synthetic bearing/distance
      // offset with no ground-truth data behind them, so sending a driver's turn-by-turn
      // navigation there can fail outright ("Can't seem to find a way there") even though it was
      // fine as a stand-in for keeping trip planning itself from failing. Only actually used when
      // it's the only option, same "last resort" pattern as the DC-over-AC preference above.
      const realCandidates = candidatePool.filter((s) => !s.isSimulated);
      if (realCandidates.length > 0) candidatePool = realCandidates;

      const preferNearestNoBacktrack = !!options.preferNearestNoBacktrack && hop === 0;
      if (preferNearestNoBacktrack) {
        const noBacktrack = candidatePool.filter((s) => {
          if (options.primaryStation) {
            const distToPrimary = getDistanceKm(s, options.primaryStation);
            if (distToPrimary <= 10) return true;
          }
          const distToDest = getDistanceKm(s, destination);
          const currentDistToDest = getDistanceKm(position, destination);
          return distToDest < currentDistToDest;
        });
        if (noBacktrack.length > 0) candidatePool = noBacktrack;
      }

      let best: ChargingStation | null = null;
      let bestScore = Infinity;
      for (const station of candidatePool) {
        let score = getDistanceKm(station, destination);
        
        if (preferNearestNoBacktrack && options.primaryStation) {
          const distToPrimary = getDistanceKm(station, options.primaryStation);
          if (distToPrimary <= 10) {
            score = getDistanceKm(position, station);
          }
        }

        if (biasTowardAvailability && station.status !== 'AVAILABLE') score += 150;
        if (score < bestScore) {
          bestScore = score;
          best = station;
        }
      }

      if (!best) {
        console.warn(`[TripPlanner Debug] FAILED: No candidate station selected at hop ${hop}`);
        return this.buildResult(legs, stops, false, soc);
      }

      const stationCoords: MapCoordinates = { latitude: best.latitude, longitude: best.longitude };
      
      const bestIdxOnRoute = this.findClosestCoordinateIndex(mainCoords, stationCoords);
      const routeLegDistance = this.getDistanceAlongCoords(mainCoords, currentIdx, bestIdxOnRoute);
      const stationDetourDistance = getDistanceKm(mainCoords[bestIdxOnRoute], stationCoords);
      const totalLegDistance = routeLegDistance + stationDetourDistance;

      const legCoordinates = [
        ...mainCoords.slice(currentIdx, Math.max(currentIdx + 1, bestIdxOnRoute + 1)),
        stationCoords,
      ];

      const arrivalSoC = Math.max(0, soc - socForDistance(totalLegDistance));

      const safeRangeAtPreferredLimit = Math.max(0, ((preferredMaxChargeSoC - targetReserveSoC) / 100) * effectiveRangeKm);
      const remainingDistanceAtStation = this.getDistanceAlongCoords(mainCoords, bestIdxOnRoute, mainCoords.length - 1);
      const reachesDestinationAtPreferredLimit = remainingDistanceAtStation <= safeRangeAtPreferredLimit;

      let departureSoC = preferredMaxChargeSoC;
      let exceededPreferredLimit = false;

      if (!reachesDestinationAtPreferredLimit) {
        const nextSearchIdx = this.findClosestCoordinateIndex(mainCoords, stationCoords);
        const lookaheadTargetDistance = safeRangeAtPreferredLimit * 0.85;
        let lookaheadAccum = 0;
        let targetLookaheadIdx = nextSearchIdx;
        for (let i = nextSearchIdx; i < mainCoords.length - 1; i++) {
          const segDist = getDistanceKm(mainCoords[i], mainCoords[i + 1]);
          if (lookaheadAccum + segDist > lookaheadTargetDistance) {
            targetLookaheadIdx = i;
            break;
          }
          lookaheadAccum += segDist;
          targetLookaheadIdx = i + 1;
        }
        const targetLookaheadCenter = mainCoords[targetLookaheadIdx];
        const furtherCandidates = await fetchStations(targetLookaheadCenter, 50);
        
        const anotherStationReachableAtPreferredLimit = furtherCandidates.some(
          (s) => s.id !== best!.id && !visitedStationIds.has(s.id) && isPluggableByVehicle(s) && (this.getDistanceAlongCoords(mainCoords, bestIdxOnRoute, this.findClosestCoordinateIndex(mainCoords, s)) + getDistanceKm(mainCoords[this.findClosestCoordinateIndex(mainCoords, s)], s)) <= safeRangeAtPreferredLimit
        );

        if (!anotherStationReachableAtPreferredLimit) {
          const socNeededForRemaining = socForDistance(remainingDistanceAtStation) + targetReserveSoC;
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

      console.log(`[TripPlanner Debug] Hop ${hop} SUCCESS: Chose ${best.name} (${best.id})`);
      console.log(`  - Leg distance: ${totalLegDistance.toFixed(1)} km, Drive time: ${((totalLegDistance / avgSpeedKmH) * 60).toFixed(0)} mins`);
      console.log(`  - Arrival SoC: ${arrivalSoC.toFixed(1)}%, Departure SoC: ${departureSoC.toFixed(1)}%, Charge time: ${chargeTimeMinutes.toFixed(0)} mins`);

      legs.push({
        from: position,
        to: stationCoords,
        distanceKm: totalLegDistance,
        driveTimeMinutes: (totalLegDistance / avgSpeedKmH) * 60,
        coordinates: legCoordinates,
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

    console.warn(`[TripPlanner Debug] FAILED: Exceeded maximum stop limit (${MAX_STOPS}) before reaching destination.`);
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

  private static getPointAlongRoute(
    coordinates: MapCoordinates[],
    targetDistanceKm: number
  ): MapCoordinates {
    if (coordinates.length === 0) return { latitude: 0, longitude: 0 };
    if (coordinates.length === 1 || targetDistanceKm <= 0) return coordinates[0];

    let accumulatedDistance = 0;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const p1 = coordinates[i];
      const p2 = coordinates[i + 1];
      const segmentDistance = getDistanceKm(p1, p2);
      
      if (accumulatedDistance + segmentDistance >= targetDistanceKm) {
        const ratio = (targetDistanceKm - accumulatedDistance) / segmentDistance;
        return {
          latitude: p1.latitude + (p2.latitude - p1.latitude) * ratio,
          longitude: p1.longitude + (p2.longitude - p1.longitude) * ratio,
        };
      }
      accumulatedDistance += segmentDistance;
    }
    return coordinates[coordinates.length - 1];
  }

  private static round(value: number, decimals: number = 1): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }
}
