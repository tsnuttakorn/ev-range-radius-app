import { RangeCalculator } from '../RangeCalculator';
import { UserEVProfile, RangeCalculationInput } from '../../types/ev';

describe('RangeCalculator', () => {
  const mockBydProfile: UserEVProfile = {
    id: 'byd-atto3',
    modelName: 'Atto 3',
    batteryCapacityKWh: 60.48,
    officialRangeKm: 480,
    ratingStandard: 'NEDC',
    customEfficiencyFactor: 1.0,
    maxDcChargeKW: 88,
    maxAcChargeKW: 7,
  };

  const mockTeslaProfile: UserEVProfile = {
    id: 'tesla-modely',
    modelName: 'Model Y RWD',
    batteryCapacityKWh: 60.0,
    officialRangeKm: 455,
    ratingStandard: 'WLTP',
    customEfficiencyFactor: 1.0,
    maxDcChargeKW: 170,
    maxAcChargeKW: 11,
  };

  test('calculates range accurately under normal conditions (WLTP, No AirCon)', () => {
    const input: RangeCalculationInput = {
      vehicle: mockTeslaProfile,
      currentSoC: 80,
      targetReserveSoC: 10,
      avgSpeedKmH: 90,
      airConActive: false,
    };

    const result = RangeCalculator.calculate(input);

    // Total Range = 455 * 0.83 * 1.0 = 377.65 km
    // Max Range (80%) = 377.65 * 0.8 = 302.12 -> 302.1
    // Net Usable SoC = 80 - 10 = 70%
    // Safe Range = 377.65 * 0.7 = 264.355 -> 264.4
    // Usable kWh = 60 * 0.7 = 42
    // Efficiency = 60 / 377.65 = 0.1588... -> 0.159
    expect(result.safeRangeKm).toBe(264.4);
    expect(result.maxRangeKm).toBe(302.1);
    expect(result.usableBatteryKWh).toBe(42.0);
    expect(result.estimatedEfficiencyKWhPerKm).toBe(0.159);
  });

  test('applies air conditioning penalty correctly', () => {
    const input: RangeCalculationInput = {
      vehicle: mockTeslaProfile,
      currentSoC: 80,
      targetReserveSoC: 10,
      avgSpeedKmH: 90,
      airConActive: true,
    };

    const result = RangeCalculator.calculate(input);

    // Total Range = 455 * 0.83 * 0.93 = 351.2145 km
    // Max Range (80%) = 351.2145 * 0.8 = 280.97 -> 281.0
    // Safe Range (70%) = 351.2145 * 0.7 = 245.85 -> 245.9
    // Usable kWh = 60 * 0.7 = 42
    // Efficiency = 60 / 351.2145 = 0.1708... -> 0.171
    expect(result.safeRangeKm).toBe(245.9);
    expect(result.maxRangeKm).toBe(281.0);
    expect(result.usableBatteryKWh).toBe(42.0);
    expect(result.estimatedEfficiencyKWhPerKm).toBe(0.171);
  });

  test('applies custom efficiency factors correctly', () => {
    const customProfile: UserEVProfile = {
      ...mockTeslaProfile,
      customEfficiencyFactor: 0.9, // 10% less efficient (e.g. sporty driving)
    };

    const input: RangeCalculationInput = {
      vehicle: customProfile,
      currentSoC: 100,
      targetReserveSoC: 0,
      avgSpeedKmH: 100,
      airConActive: false,
    };

    const result = RangeCalculator.calculate(input);

    // Total Range = 455 * (0.83 * 0.9) * 1.0 = 339.885 km
    // Safe Range (100% - 0% = 100%) = 339.9
    expect(result.safeRangeKm).toBe(339.9);
  });

  test('handles edge case where current SoC is less than target reserve SoC', () => {
    const input: RangeCalculationInput = {
      vehicle: mockBydProfile,
      currentSoC: 15,
      targetReserveSoC: 20,
      avgSpeedKmH: 80,
      airConActive: false,
    };

    const result = RangeCalculator.calculate(input);

    // Net Usable SoC = Max(0, 15 - 20) = 0
    expect(result.safeRangeKm).toBe(0);
    expect(result.usableBatteryKWh).toBe(0);
    expect(result.maxRangeKm).toBeGreaterThan(0); // Max range still calculated from current SoC
  });

  test('handles complete zero SoC edge cases', () => {
    const input: RangeCalculationInput = {
      vehicle: mockBydProfile,
      currentSoC: 0,
      targetReserveSoC: 10,
      avgSpeedKmH: 80,
      airConActive: true,
    };

    const result = RangeCalculator.calculate(input);

    expect(result.safeRangeKm).toBe(0);
    expect(result.maxRangeKm).toBe(0);
    expect(result.usableBatteryKWh).toBe(0);
  });
});
