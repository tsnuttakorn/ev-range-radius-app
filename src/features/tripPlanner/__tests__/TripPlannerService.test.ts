import { TripPlannerService } from '../TripPlannerService';
import { UserEVProfile, MapCoordinates } from '../../../types/ev';
import { ChargingStation } from '../../../utils/StationGenerator';

const vehicle: UserEVProfile = {
  id: 'test-ev',
  modelName: 'Test EV',
  batteryCapacityKWh: 60,
  officialRangeKm: 455, // WLTP-rated, matches preset Tesla Model Y RWD
  ratingStandard: 'WLTP',
  customEfficiencyFactor: 1.0,
  maxDcChargeKW: 170,
  maxAcChargeKW: 11,
};

const ORIGIN: MapCoordinates = { latitude: 13.7563, longitude: 100.5018 }; // Bangkok
const DESTINATION_NEAR: MapCoordinates = { latitude: 13.85, longitude: 100.6 }; // ~15km away
const DESTINATION_FAR: MapCoordinates = { latitude: 18.7883, longitude: 98.9853 }; // Chiang Mai, ~700km away

/** Straight-ish line route stub: distance scales with lat/lng delta, no real geometry needed for math tests. */
const straightDistanceKm = (a: MapCoordinates, b: MapCoordinates): number => {
  const dLat = a.latitude - b.latitude;
  const dLng = a.longitude - b.longitude;
  return Math.sqrt(dLat * dLat + dLng * dLng) * 111; // ~111km per degree
};

const makeFetchRoute = () => async (from: MapCoordinates, to: MapCoordinates) => ({
  coordinates: [from, to],
  distanceKm: straightDistanceKm(from, to),
});

const makeStation = (overrides: Partial<ChargingStation>): ChargingStation => ({
  id: overrides.id || 'station-1',
  name: overrides.name || 'Test Charger',
  latitude: overrides.latitude ?? 0,
  longitude: overrides.longitude ?? 0,
  type: overrides.type || 'DC',
  powerKW: overrides.powerKW ?? 120,
  status: overrides.status || 'AVAILABLE',
  distanceKm: overrides.distanceKm ?? 0,
  ...overrides,
});

describe('TripPlannerService.estimateChargeTimeMinutes', () => {
  it('returns 0 when no charging is needed', () => {
    expect(TripPlannerService.estimateChargeTimeMinutes(60, 120, 'DC', 50, 50)).toBe(0);
    expect(TripPlannerService.estimateChargeTimeMinutes(60, 120, 'DC', 60, 40)).toBe(0);
  });

  it('charges roughly linearly on AC power', () => {
    // 10 kWh needed at 22kW * 0.9 efficiency => ~30.3 min
    const minutes = TripPlannerService.estimateChargeTimeMinutes(60, 22, 'AC', 20, 36.67);
    expect(minutes).toBeGreaterThan(25);
    expect(minutes).toBeLessThan(35);
  });

  it('charges DC fast below the 80% taper threshold quicker than the same energy above it', () => {
    const belowTaper = TripPlannerService.estimateChargeTimeMinutes(60, 120, 'DC', 20, 30); // 10% below 80%
    const aboveTaper = TripPlannerService.estimateChargeTimeMinutes(60, 120, 'DC', 80, 90); // 10% above 80%
    expect(aboveTaper).toBeGreaterThan(belowTaper);
  });

  it('scales charge time down with higher station power', () => {
    const slow = TripPlannerService.estimateChargeTimeMinutes(60, 50, 'DC', 20, 60);
    const fast = TripPlannerService.estimateChargeTimeMinutes(60, 250, 'DC', 20, 60);
    expect(fast).toBeLessThan(slow);
  });

  it('caps the effective charge speed at the vehicle max, even at a much faster station', () => {
    // A 250kW station can't charge a 120kW-max car any faster than 120kW allows.
    const cappedByVehicle = TripPlannerService.estimateChargeTimeMinutes(60, 250, 'DC', 20, 60, 120);
    const uncapped = TripPlannerService.estimateChargeTimeMinutes(60, 250, 'DC', 20, 60);
    expect(cappedByVehicle).toBeGreaterThan(uncapped);

    // Matches charging at the vehicle's own max speed directly at that same station rating.
    const atVehicleMaxDirectly = TripPlannerService.estimateChargeTimeMinutes(60, 120, 'DC', 20, 60);
    expect(cappedByVehicle).toBeCloseTo(atVehicleMaxDirectly, 5);
  });

  it('is unaffected by vehicle max charge speed when the station is already the slower side', () => {
    // A 50kW station charging a 250kW-capable car is still bottlenecked by the station, not the car.
    const withHighVehicleCap = TripPlannerService.estimateChargeTimeMinutes(60, 50, 'DC', 20, 60, 250);
    const withoutCap = TripPlannerService.estimateChargeTimeMinutes(60, 50, 'DC', 20, 60);
    expect(withHighVehicleCap).toBeCloseTo(withoutCap, 5);
  });
});

describe('TripPlannerService.planSmartTrip', () => {
  it('plans a direct route with no charging stops when destination is within safe range', async () => {
    const plan = await TripPlannerService.planSmartTrip({
      origin: ORIGIN,
      destination: DESTINATION_NEAR,
      vehicle,
      currentSoC: 80,
      targetReserveSoC: 20,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async () => [],
    });

    expect(plan.reachable).toBe(true);
    expect(plan.directRoute).toBe(true);
    expect(plan.stops).toHaveLength(0);
    expect(plan.legs).toHaveLength(1);
    expect(plan.totalDistanceKm).toBeGreaterThan(0);
    expect(plan.finalArrivalSoC).toBeLessThan(80);
    expect(plan.finalArrivalSoC).toBeGreaterThanOrEqual(20);
    expect(plan.alternative).toBeUndefined(); // no charging stop needed, nothing to offer an alternative for
  });

  it('marks the trip unreachable when no charger is available anywhere along the way', async () => {
    const plan = await TripPlannerService.planSmartTrip({
      origin: ORIGIN,
      destination: DESTINATION_FAR,
      vehicle,
      currentSoC: 60,
      targetReserveSoC: 20,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async () => [], // no chargers exist anywhere
    });

    expect(plan.reachable).toBe(false);
    expect(plan.stops).toHaveLength(0);
  });

  it('inserts a charging stop and computes a sensible charge window for a long trip', async () => {
    // Synthetic straight-north path: effective range at 90% SoC / 15% reserve is ~284km,
    // so a 400km trip needs exactly one stop if the charger sits partway along the route.
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 400 / 111, longitude: 0 }; // ~400km north
    const midStation = makeStation({
      id: 'midpoint-dc',
      name: 'Midpoint DC Fast Charger',
      latitude: 200 / 111, // ~200km north — well within the first safe-range hop
      longitude: 0,
      type: 'DC',
      powerKW: 150,
      status: 'AVAILABLE',
    });

    const fetchRoute = makeFetchRoute();
    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      airConActive: false,
      fetchRoute,
      fetchStations: async (center) => {
        midStation.distanceKm = straightDistanceKm(center, midStation);
        return [midStation];
      },
    });

    expect(plan.reachable).toBe(true);
    expect(plan.stops.length).toBeGreaterThanOrEqual(1);

    const firstStop = plan.stops[0];
    expect(firstStop.departureSoC).toBeGreaterThan(firstStop.arrivalSoC);
    expect(firstStop.chargeTimeMinutes).toBeGreaterThan(0);
    expect(firstStop.energyAddedKWh).toBeCloseTo(
      ((firstStop.departureSoC - firstStop.arrivalSoC) / 100) * vehicle.batteryCapacityKWh,
      1
    );
    // Never plans to charge above 100% or leave a stop with less charge than arrival.
    expect(firstStop.departureSoC).toBeLessThanOrEqual(100);
    expect(plan.finalArrivalSoC).toBeGreaterThanOrEqual(0);
  });

  it('charges to the preferred limit when that alone is enough to finish the trip', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 400 / 111, longitude: 0 };
    const midStation = makeStation({
      id: 'midpoint-dc',
      latitude: 200 / 111,
      longitude: 0,
      type: 'DC',
      powerKW: 150,
    });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      preferredMaxChargeSoC: 90, // comfortably above what the remaining ~200km leg needs
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async (center) => {
        midStation.distanceKm = straightDistanceKm(center, midStation);
        return [midStation];
      },
    });

    expect(plan.stops[0].departureSoC).toBeCloseTo(90, 0);
    expect(plan.stops[0].exceededPreferredLimit).toBe(false);
  });

  it('charges past the preferred limit when the remaining leg genuinely requires it', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 400 / 111, longitude: 0 };
    const midStation = makeStation({
      id: 'midpoint-dc',
      latitude: 200 / 111,
      longitude: 0,
      type: 'DC',
      powerKW: 150,
    });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      preferredMaxChargeSoC: 60, // below the ~73% the remaining ~200km leg actually needs
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async (center) => {
        midStation.distanceKm = straightDistanceKm(center, midStation);
        return [midStation];
      },
    });

    expect(plan.reachable).toBe(true);
    expect(plan.stops[0].departureSoC).toBeGreaterThan(60);
    expect(plan.stops[0].exceededPreferredLimit).toBe(true);
  });

  it('caps every reachable stop strictly at the preferred limit — never charges to 100% just because more distance remains', async () => {
    // Regression test: destination is far enough that neither station alone gets you there,
    // but a *second* station further down the route is still reachable at the preferred limit
    // from the first one. The planner must not treat "can't finish from here" as license to
    // exceed the limit — it should only do that when no further charger is reachable at all.
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 900 / 111, longitude: 0 };
    const firstStation = makeStation({
      id: 'first-stop-dc',
      latitude: 200 / 111, // 200km mark — reachable from origin
      longitude: 0,
      type: 'DC',
      powerKW: 150,
    });
    const secondStation = makeStation({
      id: 'second-stop-dc',
      latitude: 350 / 111, // 350km mark — 150km past the first stop, within a 60%-charge hop
      longitude: 0,
      type: 'DC',
      powerKW: 150,
    });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      preferredMaxChargeSoC: 60,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async (center) => {
        firstStation.distanceKm = straightDistanceKm(center, firstStation);
        secondStation.distanceKm = straightDistanceKm(center, secondStation);
        return [firstStation, secondStation];
      },
    });

    expect(plan.stops.length).toBeGreaterThanOrEqual(1);
    expect(plan.stops[0].station.id).toBe('first-stop-dc');
    expect(plan.stops[0].departureSoC).toBeCloseTo(60, 0);
    expect(plan.stops[0].exceededPreferredLimit).toBe(false);
  });

  it('exceeds the preferred limit only as a genuine last resort — no further charger reachable at that limit', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 900 / 111, longitude: 0 };
    const onlyStation = makeStation({
      id: 'only-stop-dc',
      latitude: 200 / 111,
      longitude: 0,
      type: 'DC',
      powerKW: 150,
    });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      preferredMaxChargeSoC: 60,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      // No other charger exists anywhere on this route — capping at 60% here would strand
      // the trip permanently, so charging past the limit is the only way to make any progress.
      fetchStations: async (center) => {
        onlyStation.distanceKm = straightDistanceKm(center, onlyStation);
        return [onlyStation];
      },
    });

    expect(plan.stops[0].departureSoC).toBeGreaterThan(60);
    expect(plan.stops[0].exceededPreferredLimit).toBe(true);
  });

  it('estimates a stop\'s charge time using the vehicle\'s own max charge speed, not just the station rating', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 400 / 111, longitude: 0 };
    const fastStation = makeStation({
      id: 'ultra-fast-dc',
      latitude: 200 / 111,
      longitude: 0,
      type: 'DC',
      powerKW: 300, // far above this test vehicle's 170kW max
    });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async (center) => {
        fastStation.distanceKm = straightDistanceKm(center, fastStation);
        return [fastStation];
      },
    });

    const stop = plan.stops[0];
    const cappedAtVehicleMax = TripPlannerService.estimateChargeTimeMinutes(
      vehicle.batteryCapacityKWh,
      fastStation.powerKW,
      'DC',
      stop.arrivalSoC,
      stop.departureSoC,
      vehicle.maxDcChargeKW
    );
    expect(stop.chargeTimeMinutes).toBeCloseTo(cappedAtVehicleMax, 1);
  });

  it('picks whichever reachable DC charger is closest to the destination regardless of reported live status', async () => {
    // Live status (occupied/maintenance) is self-reported and often stale, so it should never
    // exclude or outweigh a station that's otherwise the better routing choice.
    const occupiedButCloser = makeStation({
      id: 'occupied-close',
      name: 'Occupied Charger',
      latitude: 13.8,
      longitude: 100.55,
      type: 'DC',
      powerKW: 150,
      status: 'OCCUPIED',
    });
    const availableFurther = makeStation({
      id: 'available-further',
      name: 'Available Charger',
      latitude: 13.78,
      longitude: 100.53,
      type: 'DC',
      powerKW: 150,
      status: 'AVAILABLE',
    });

    const fetchRoute = makeFetchRoute();
    const plan = await TripPlannerService.planSmartTrip({
      origin: ORIGIN,
      destination: DESTINATION_FAR,
      vehicle,
      currentSoC: 50,
      targetReserveSoC: 15,
      airConActive: false,
      fetchRoute,
      fetchStations: async (center) => {
        occupiedButCloser.distanceKm = straightDistanceKm(center, occupiedButCloser);
        availableFurther.distanceKm = straightDistanceKm(center, availableFurther);
        return [occupiedButCloser, availableFurther];
      },
    });

    expect(plan.stops[0]?.station.id).toBe('occupied-close');
  });
});

describe('TripPlannerService.planSmartTrip alternative routes', () => {
  it('finds an alternative route via a different first charging station when a genuinely different option exists', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 300 / 111, longitude: 0 };
    // Directly on the path — the better-scored (primary) choice.
    const stationA = makeStation({ id: 'station-a', name: 'Station A', latitude: 150 / 111, longitude: 0, type: 'DC', powerKW: 150 });
    // Slightly off-path and a bit further from the destination — the worse-scored, but still
    // individually viable, alternative choice.
    const stationB = makeStation({ id: 'station-b', name: 'Station B', latitude: 145 / 111, longitude: 0.05, type: 'DC', powerKW: 150 });

    const fetchRoute = makeFetchRoute();
    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      airConActive: false,
      fetchRoute,
      fetchStations: async (center) => {
        stationA.distanceKm = straightDistanceKm(center, stationA);
        stationB.distanceKm = straightDistanceKm(center, stationB);
        return [stationA, stationB];
      },
    });

    expect(plan.reachable).toBe(true);
    expect(plan.stops).toHaveLength(1);
    expect(plan.stops[0].station.id).toBe('station-a');

    expect(plan.alternative).toBeDefined();
    expect(plan.alternative!.reachable).toBe(true);
    expect(plan.alternative!.stops[0]?.station.id).toBe('station-b');
    expect(plan.alternative!.stops[0]?.station.id).not.toBe(plan.stops[0].station.id);
    // The alternative doesn't itself carry a further nested alternative.
    expect(plan.alternative!.alternative).toBeUndefined();
  });

  it('does not attach an alternative when no other viable station exists', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 300 / 111, longitude: 0 };
    const onlyStation = makeStation({ id: 'only-station', latitude: 150 / 111, longitude: 0, type: 'DC', powerKW: 150 });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async (center) => {
        onlyStation.distanceKm = straightDistanceKm(center, onlyStation);
        return [onlyStation];
      },
    });

    expect(plan.reachable).toBe(true);
    expect(plan.stops).toHaveLength(1);
    expect(plan.alternative).toBeUndefined();
  });

  it('biases the alternative toward an available station when the primary pick is occupied, even if a closer occupied option exists', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 300 / 111, longitude: 0 };
    // Closest to the destination — wins the primary pick regardless of status (unchanged
    // behavior) — but it's occupied.
    const closestOccupied = makeStation({
      id: 'closest-occupied',
      latitude: 270 / 111,
      longitude: 0,
      type: 'DC',
      status: 'OCCUPIED',
    });
    // Second-closest — would normally be the natural "next best" alternative by distance alone —
    // also occupied.
    const secondOccupied = makeStation({
      id: 'second-occupied',
      latitude: 260 / 111,
      longitude: 0,
      type: 'DC',
      status: 'OCCUPIED',
    });
    // Further away, but actually available — should win the alternative once availability is
    // biased for, despite scoring worse on distance alone.
    const fartherAvailable = makeStation({
      id: 'farther-available',
      latitude: 200 / 111,
      longitude: 0,
      type: 'DC',
      status: 'AVAILABLE',
    });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async (center) => {
        closestOccupied.distanceKm = straightDistanceKm(center, closestOccupied);
        secondOccupied.distanceKm = straightDistanceKm(center, secondOccupied);
        fartherAvailable.distanceKm = straightDistanceKm(center, fartherAvailable);
        return [closestOccupied, secondOccupied, fartherAvailable];
      },
    });

    expect(plan.stops[0].station.id).toBe('closest-occupied');
    expect(plan.alternative).toBeDefined();
    expect(plan.alternative!.stops[0]?.station.id).toBe('farther-available');
  });

  it('does not bias the alternative toward availability when the primary pick is already available', async () => {
    const origin: MapCoordinates = { latitude: 0, longitude: 0 };
    const destination: MapCoordinates = { latitude: 300 / 111, longitude: 0 };
    const closestAvailable = makeStation({
      id: 'closest-available',
      latitude: 270 / 111,
      longitude: 0,
      type: 'DC',
      status: 'AVAILABLE',
    });
    const secondOccupied = makeStation({
      id: 'second-occupied',
      latitude: 260 / 111,
      longitude: 0,
      type: 'DC',
      status: 'OCCUPIED',
    });
    const fartherAvailable = makeStation({
      id: 'farther-available',
      latitude: 200 / 111,
      longitude: 0,
      type: 'DC',
      status: 'AVAILABLE',
    });

    const plan = await TripPlannerService.planSmartTrip({
      origin,
      destination,
      vehicle,
      currentSoC: 90,
      targetReserveSoC: 15,
      airConActive: false,
      fetchRoute: makeFetchRoute(),
      fetchStations: async (center) => {
        closestAvailable.distanceKm = straightDistanceKm(center, closestAvailable);
        secondOccupied.distanceKm = straightDistanceKm(center, secondOccupied);
        fartherAvailable.distanceKm = straightDistanceKm(center, fartherAvailable);
        return [closestAvailable, secondOccupied, fartherAvailable];
      },
    });

    expect(plan.stops[0].station.id).toBe('closest-available');
    // Primary was already available, so the alternative just picks the next-closest by
    // distance — regardless of its status — same as general alternative behavior.
    expect(plan.alternative!.stops[0]?.station.id).toBe('second-occupied');
  });
});
