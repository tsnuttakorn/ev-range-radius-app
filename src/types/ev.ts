/**
 * Standard for measuring EV range.
 * Different standards have different real-world accuracy levels:
 * - NEDC: New European Driving Cycle (Highly optimistic, usually requires ~30% discount)
 * - WLTP: Worldwide Harmonised Light Vehicles Test Procedure (More realistic, requires ~10-15% discount)
 * - EPA: Environmental Protection Agency (Most realistic/conservative standard)
 * - CUSTOM: User-defined or dynamic calculation standard
 */
export type RatingStandard = 'NEDC' | 'WLTP' | 'EPA' | 'CUSTOM';

/**
 * Pre-defined EV specifications stored in the database.
 */
export interface EVPresetModel {
  /** Unique identifier for the preset vehicle model */
  id: string;
  /** Brand/Manufacturer (e.g., "Tesla", "BYD") */
  brand: string;
  /** Vehicle model name (e.g., "Model Y", "Atto 3") */
  model: string;
  /** Specific variant/trim (e.g., "RWD", "Extended Range") */
  variant: string;
  /** Total battery capacity in Kilowatt-hours (kWh) */
  batteryCapacityKWh: number;
  /** Official range in kilometers as advertised by the manufacturer */
  officialRangeKm: number;
  /** Testing standard used for officialRangeKm */
  ratingStandard: RatingStandard;
  /** Ratio of usable battery capacity compared to nominal (default usually 0.90 - 0.95) */
  usableCapacityRatio: number;
  /** Vehicle's maximum DC fast-charging power in kW — actual charge speed is capped by this even at a faster station */
  maxDcChargeKW: number;
  /** Vehicle's maximum AC (onboard charger) power in kW */
  maxAcChargeKW: number;
}

/**
 * Active profile of the user's EV, which can start from a preset or be custom-configured.
 */
export interface UserEVProfile {
  /** Unique profile identifier */
  id: string;
  /** Custom name or model name of the vehicle */
  modelName: string;
  /** Configured battery capacity in kWh */
  batteryCapacityKWh: number;
  /** Configured official range in kilometers */
  officialRangeKm: number;
  /** Configured rating standard */
  ratingStandard: RatingStandard;
  /** User-adjustable efficiency multiplier (default is 1.0, lower means more aggressive driving/faster battery drain) */
  customEfficiencyFactor: number;
  /** Vehicle's maximum DC fast-charging power in kW — actual charge speed is capped by this even at a faster station */
  maxDcChargeKW: number;
  /** Vehicle's maximum AC (onboard charger) power in kW */
  maxAcChargeKW: number;
}

/**
 * Parameters requested for calculating real-world range.
 */
export interface RangeCalculationInput {
  /** Active EV profile of the user */
  vehicle: UserEVProfile;
  /** Current State of Charge as percentage (0 - 100) */
  currentSoC: number;
  /** Target reserve State of Charge to retain at destination as percentage (typically 10 - 20) */
  targetReserveSoC: number;
  /** Planned or average speed in km/h */
  avgSpeedKmH: number;
  /** Indicates whether the air conditioning system is active (affects energy consumption rate) */
  airConActive: boolean;
}

/**
 * Calculated outputs representing the real-world range and efficiency.
 */
export interface RangeCalculationResult {
  /** Calculated real-world safe range in km (stopping at target reserve SoC) */
  safeRangeKm: number;
  /** Maximum theoretical range in km until the battery is completely flat (0% SoC) — independent
   * of the reserve buffer by design, since it represents going all the way past it to empty. Used
   * for the map's outer boundary polygon. */
  maxRangeKm: number;
  /** Best-case range in km at a full charge while still respecting the reserve buffer —
   * (100% - targetReserveSoC) of the vehicle's total range. Unlike `maxRangeKm`, this *does*
   * scale with the reserve buffer setting; unlike `safeRangeKm`, it's independent of the current
   * battery level — a "what's the most I could plan for" figure rather than "what can I do right
   * now." */
  maxBufferRangeKm: number;
  /** Calculated usable battery energy remaining in kWh (taking reserve into account) */
  usableBatteryKWh: number;
  /** Estimated efficiency rate under inputs in kWh per kilometer (kWh/km) */
  estimatedEfficiencyKWhPerKm: number;
}

/**
 * `RangeCalculationResult` plus a rough time budget for driving the safe range and recharging
 * back afterward — an at-a-glance estimate shown on the main panel, independent of any actual
 * planned trip/destination. Charging time assumes a representative DC fast charger running at
 * the vehicle's own max charge speed (a best-case "roughly" figure, since no real charger has
 * been chosen yet).
 */
export interface RangeCalculationResultWithTime extends RangeCalculationResult {
  /** Estimated minutes to drive the full safe range at the reference cruising speed */
  estimatedDriveTimeMinutes: number;
  /** Estimated minutes to recharge from the reserve level back up to the preferred charge limit */
  estimatedChargeTimeMinutes: number;
  /** Drive + charge time combined — a rough total time budget */
  estimatedTotalTravelTimeMinutes: number;
}

/**
 * A previously-selected place from location search, kept so the driver can quickly reuse it
 * instead of retyping. Mirrors the Nominatim result shape (`lat`/`lon` as strings, `display_name`)
 * so it can be fed straight back through the same selection path as a fresh search result.
 */
export interface RecentSearchItem {
  /** Stable identity for dedup — Nominatim's place_id when available, else derived from coordinates */
  id: string;
  display_name: string;
  lat: string;
  lon: string;
}

/**
 * Standard map coordinates for GPS placement.
 */
export interface MapCoordinates {
  /** Latitude coordinate */
  latitude: number;
  /** Longitude coordinate */
  longitude: number;
}

/**
 * Visual circles overlay settings for a mapping component representing calculated ranges.
 */
export interface GeoCircleOverlay {
  /** Center point coordinates */
  center: MapCoordinates;
  /** Safe range radius in meters (calculated from safeRangeKm) */
  safeRadiusMeters: number;
  /** Maximum range radius in meters (calculated from maxRangeKm) */
  maxRadiusMeters: number;
  /** Colors config for visualization overlays */
  colors: {
    /** Stroke color of the safe area boundary */
    safeStroke: string;
    /** Fill color of the safe area */
    safeFill: string;
    /** Stroke color of the maximum range boundary */
    maxStroke: string;
    /** Fill color of the maximum range */
    maxFill: string;
  };
}
