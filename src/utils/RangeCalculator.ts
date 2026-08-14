import { RangeCalculationInput, RangeCalculationResult, MapCoordinates } from '../types/ev';

export class RangeCalculator {
  /**
   * Standard efficiency factors based on testing standards
   */
  private static readonly EFFICIENCY_FACTORS = {
    NEDC: 0.72,
    WLTP: 0.83,
    EPA: 0.92,
  };

  /**
   * Penalty multiplier for range when Air Conditioning is active
   */
  private static readonly AIR_CON_PENALTY = 0.93;

  /**
   * Helper to round a number to a specific decimal place (default 1)
   */
  private static round(value: number, decimals: number = 1): number {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  }

  /**
   * SoC-independent real-world range (flat-to-empty, 100% SoC) for a vehicle under given
   * conditions. Factored out so trip planning can convert distance <-> %SoC consumed
   * without depending on the driver's current battery level.
   */
  public static getEffectiveRangeKm(
    vehicle: RangeCalculationInput['vehicle'],
    airConActive: boolean
  ): number {
    let baseFactor = 1.0;
    if (vehicle.ratingStandard === 'CUSTOM') {
      baseFactor = vehicle.customEfficiencyFactor;
    } else {
      const standardFactor = this.EFFICIENCY_FACTORS[vehicle.ratingStandard] || 1.0;
      baseFactor = standardFactor * vehicle.customEfficiencyFactor;
    }
    const airConPenalty = airConActive ? this.AIR_CON_PENALTY : 1.0;
    return vehicle.officialRangeKm * baseFactor * airConPenalty;
  }

  /**
   * Calculates safe range, max range, usable battery energy, and estimated efficiency.
   *
   * @param input Input parameters including the vehicle profile and active drive parameters.
   * @returns The calculated RangeCalculationResult with rounded values.
   */
  public static calculate(input: RangeCalculationInput): RangeCalculationResult {
    const { vehicle, currentSoC, targetReserveSoC, airConActive } = input;

    // 1-3. Total Real-World Range (flat-to-empty, 100% SoC)
    const totalRealWorldRangeKm = this.getEffectiveRangeKm(vehicle, airConActive);

    // 4. Net Usable SoC %
    const netUsableSoC = Math.max(0, currentSoC - targetReserveSoC);

    // Edge case check for no real range or battery size
    if (totalRealWorldRangeKm <= 0 || vehicle.batteryCapacityKWh <= 0) {
      return {
        safeRangeKm: 0,
        maxRangeKm: 0,
        maxBufferRangeKm: 0,
        usableBatteryKWh: 0,
        estimatedEfficiencyKWhPerKm: 0,
      };
    }

    // 5. Safe Range (remaining km until target reserve SoC is reached)
    const safeRangeKm = totalRealWorldRangeKm * (netUsableSoC / 100);

    // 6. Max Range (theoretical maximum until completely flat) — deliberately ignores the reserve
    // buffer; it represents driving straight past it to 0% SoC, so it's the outer boundary the
    // map draws, not a "safe" figure.
    const maxRangeKm = totalRealWorldRangeKm * (Math.max(0, currentSoC) / 100);

    // 6b. Max Buffer Range: best-case range at a full charge while still respecting the reserve
    // buffer. Independent of current SoC (unlike safeRangeKm) — "the most I could plan a trip
    // for," not "what's reachable right now."
    const netUsableSoCAtFull = Math.max(0, 100 - targetReserveSoC);
    const maxBufferRangeKm = totalRealWorldRangeKm * (netUsableSoCAtFull / 100);

    // 7. Usable battery energy remaining
    const usableBatteryKWh = (netUsableSoC / 100) * vehicle.batteryCapacityKWh;

    // 8. Estimated Efficiency under current conditions (kWh / km)
    const estimatedEfficiencyKWhPerKm = vehicle.batteryCapacityKWh / totalRealWorldRangeKm;

    return {
      safeRangeKm: this.round(safeRangeKm),
      maxRangeKm: this.round(maxRangeKm),
      maxBufferRangeKm: this.round(maxBufferRangeKm),
      usableBatteryKWh: this.round(usableBatteryKWh),
      estimatedEfficiencyKWhPerKm: this.round(estimatedEfficiencyKWhPerKm, 3), // higher precision for efficiency
    };
  }

  /**
   * Offline fallback only — generates a set of coordinates forming an organic, *simulated*
   * road-distance polygon. Uses seed values from the latitude and longitude so the shape morphs
   * organically as the user moves their vehicle, but it is not derived from real road data.
   *
   * `EVMapAdapter` prefers a real road-network isochrone from `RouteService.fetchIsochronePolygon`
   * (OpenRouteService) and only drops down to this when no API key is configured or the request
   * fails, so the map always has something to draw.
   */
  public static generateRoadRangePolygon(
    center: MapCoordinates,
    radiusKm: number,
    pointsCount: number = 40
  ): MapCoordinates[] {
    if (radiusKm <= 0) return [];
    
    const points: MapCoordinates[] = [];
    const earthRadius = 6371; // km
    const latRad = (center.latitude * Math.PI) / 180;
    const lngRad = (center.longitude * Math.PI) / 180;

    // Use center coordinates to create a stable pseudo-random seed
    const seed = Math.sin(center.latitude) * Math.cos(center.longitude);

    for (let i = 0; i < pointsCount; i++) {
      const angle = (i * 360) / pointsCount;
      const angleRad = (angle * Math.PI) / 180;

      // Improved fallback formula:
      // Real-world road circuity factor (tortuosity) is typically around 1.15 to 1.30.
      // Therefore, the straight-line radial distance is roughly 77% to 87% of the driving range.
      // We simulate this with a base of 0.81 and a gentle variation to represent road networks organically
      // without extreme distortions.
      const baseRatio = 0.81;
      const wave = 0.04 * Math.sin(angleRad * 4 + seed * 2) + 0.02 * Math.cos(angleRad * 7);
      const actualRangeKm = radiusKm * (baseRatio + wave);

      // Calculate destination coordinate using bearing
      const distRatio = actualRangeKm / earthRadius;
      const destLatRad = Math.asin(
        Math.sin(latRad) * Math.cos(distRatio) +
          Math.cos(latRad) * Math.sin(distRatio) * Math.cos(angleRad)
      );
      const destLngRad =
        lngRad +
        Math.atan2(
          Math.sin(angleRad) * Math.sin(distRatio) * Math.cos(latRad),
          Math.cos(distRatio) - Math.sin(latRad) * Math.sin(destLatRad)
        );

      points.push({
        latitude: (destLatRad * 180) / Math.PI,
        longitude: (destLngRad * 180) / Math.PI,
      });
    }

    return points;
  }
}
