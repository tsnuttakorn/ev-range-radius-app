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
      drivingMode: 'MIXED',
      airConActive: false,
    };

    const result = RangeCalculator.calculate(input);

    // Total Range = 455 * 1.0 = 455 km
    // Max Range (80%) = 455 * 0.8 = 364
    // Max Buffer Range (100% - 10% reserve = 90%) = 455 * 0.9 = 409.5
    // Net Usable SoC = 80 - 10 = 70%
    // Safe Range = 455 * 0.7 = 318.5
    // Usable kWh = 60 * 0.7 = 42
    // Efficiency = 60 / 455 = 0.1318... -> 0.132
    expect(result.safeRangeKm).toBe(318.5);
    expect(result.maxRangeKm).toBe(364);
    expect(result.maxBufferRangeKm).toBe(409.5);
    expect(result.usableBatteryKWh).toBe(42.0);
    expect(result.estimatedEfficiencyKWhPerKm).toBe(0.132);
  });

  test('applies air conditioning penalty correctly', () => {
    const input: RangeCalculationInput = {
      vehicle: mockTeslaProfile,
      currentSoC: 80,
      targetReserveSoC: 10,
      drivingMode: 'MIXED',
      airConActive: true,
    };

    const result = RangeCalculator.calculate(input);

    // Total Range = 455 * 1.0 * 0.95 = 432.25 km
    // Max Range (80%) = 432.25 * 0.8 = 345.8
    // Safe Range (70%) = 432.25 * 0.7 = 302.575 -> 302.6
    // Usable kWh = 60 * 0.7 = 42
    // Efficiency = 60 / 432.25 = 0.1388... -> 0.139
    expect(result.safeRangeKm).toBe(302.6);
    expect(result.maxRangeKm).toBe(345.8);
    expect(result.usableBatteryKWh).toBe(42.0);
    expect(result.estimatedEfficiencyKWhPerKm).toBe(0.139);
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
      drivingMode: 'MIXED',
      airConActive: false,
    };

    const result = RangeCalculator.calculate(input);

    // Total Range = 455 * (1.0 * 0.9) * 1.0 = 409.5 km
    // Safe Range (100% - 0% = 100%) = 409.5
    expect(result.safeRangeKm).toBe(409.5);
  });

  test('handles edge case where current SoC is less than target reserve SoC', () => {
    const input: RangeCalculationInput = {
      vehicle: mockBydProfile,
      currentSoC: 15,
      targetReserveSoC: 20,
      drivingMode: 'MIXED',
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
      drivingMode: 'MIXED',
      airConActive: true,
    };

    const result = RangeCalculator.calculate(input);

    expect(result.safeRangeKm).toBe(0);
    expect(result.maxRangeKm).toBe(0);
    expect(result.usableBatteryKWh).toBe(0);
  });

  test('maxBufferRangeKm scales with the reserve buffer, independent of current SoC', () => {
    // Total Range = 455 * 1.0 * 1.0 = 455 km
    const lowReserve = RangeCalculator.calculate({
      vehicle: mockTeslaProfile,
      currentSoC: 30, // deliberately low/irrelevant to maxBufferRangeKm
      targetReserveSoC: 10,
      drivingMode: 'MIXED',
      airConActive: false,
    });
    const highReserve = RangeCalculator.calculate({
      vehicle: mockTeslaProfile,
      currentSoC: 30, // same SoC as above — only the reserve buffer differs
      targetReserveSoC: 30,
      drivingMode: 'MIXED',
      airConActive: false,
    });

    // (100% - 10% reserve) * 455 = 409.5
    expect(lowReserve.maxBufferRangeKm).toBe(409.5);
    // (100% - 30% reserve) * 455 = 318.5
    expect(highReserve.maxBufferRangeKm).toBe(318.5);
    // A larger reserve buffer shrinks maxBufferRangeKm even though currentSoC didn't change —
    // this is the bug being fixed: previously maxRangeKm (shown as "Max Buffer Range" in the UI)
    // never responded to the reserve slider at all.
    expect(highReserve.maxBufferRangeKm).toBeLessThan(lowReserve.maxBufferRangeKm);
  });
});

describe('RangeCalculator driving mode', () => {
  const teslaProfile: UserEVProfile = {
    id: 'tesla-modely',
    modelName: 'Model Y RWD',
    batteryCapacityKWh: 60.0,
    officialRangeKm: 455,
    ratingStandard: 'WLTP',
    customEfficiencyFactor: 1.0,
    maxDcChargeKW: 170,
    maxAcChargeKW: 11,
  };

  const rangeFor = (drivingMode: RangeCalculationInput['drivingMode']) =>
    RangeCalculator.calculate({
      vehicle: teslaProfile,
      currentSoC: 100,
      targetReserveSoC: 0,
      drivingMode,
      airConActive: false,
    }).safeRangeKm;

  test('city range exceeds the WLTP rating, highway range falls short of it, mixed matches it exactly', () => {
    // WLTP factor is 1.0 (see RangeCalculator), so MIXED is the unmodified official range.
    expect(rangeFor('MIXED')).toBe(455);
    // CITY: 1.1x — regenerative braking / low speeds beat the official rating.
    expect(rangeFor('CITY')).toBe(500.5);
    // HIGHWAY: 0.8x — sustained high-speed drag costs more than the official rating assumes.
    expect(rangeFor('HIGHWAY')).toBe(364);
    expect(rangeFor('CITY')).toBeGreaterThan(rangeFor('MIXED'));
    expect(rangeFor('HIGHWAY')).toBeLessThan(rangeFor('MIXED'));
  });

  test('getAvgSpeedKmH orders city < mixed < highway', () => {
    expect(RangeCalculator.getAvgSpeedKmH('CITY')).toBeLessThan(RangeCalculator.getAvgSpeedKmH('MIXED'));
    expect(RangeCalculator.getAvgSpeedKmH('MIXED')).toBeLessThan(RangeCalculator.getAvgSpeedKmH('HIGHWAY'));
  });
});
