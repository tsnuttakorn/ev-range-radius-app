import { MapCoordinates } from '../../types/ev';
import { ChargingStation } from '../../utils/StationGenerator';

/**
 * A single driven segment of a trip (origin -> stop, stop -> stop, or stop -> destination).
 */
export interface TripLeg {
  from: MapCoordinates;
  to: MapCoordinates;
  distanceKm: number;
  driveTimeMinutes: number;
  coordinates: MapCoordinates[];
}

/**
 * A planned charging stop along the route, with estimated arrival/departure
 * battery levels and how long charging will take at that station's power rating.
 */
export interface ChargeStop {
  station: ChargingStation;
  arrivalSoC: number;
  departureSoC: number;
  energyAddedKWh: number;
  chargeTimeMinutes: number;
  /** True when the planner had to charge past the driver's preferred limit because the remaining trip genuinely needed it. */
  exceededPreferredLimit: boolean;
}

/**
 * The full smart-routed trip: a sequence of drive legs interleaved with charging stops,
 * computed to get from origin to destination without the battery dropping below the
 * driver's configured reserve buffer.
 */
export interface SmartTripPlan {
  /** True if the destination is reachable within the stop-count budget. */
  reachable: boolean;
  /** True if the trip requires no charging stops at all (direct drive). */
  directRoute: boolean;
  legs: TripLeg[];
  stops: ChargeStop[];
  totalDistanceKm: number;
  totalDriveTimeMinutes: number;
  totalChargeTimeMinutes: number;
  totalTripTimeMinutes: number;
  finalArrivalSoC: number;
  /**
   * A second viable route, if one exists — computed by forcing a different choice of charging
   * station at the first stop. Only present when the trip actually needs a charging stop and a
   * genuinely different, still-reachable option was found. Never itself carries a further
   * `.alternative` (no recursive alternatives).
   */
  alternative?: SmartTripPlan;
}
