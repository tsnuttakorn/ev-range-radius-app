import { EVPresetModel } from '../types/ev';

/**
 * A mock database of popular electric vehicle models globally and in Thailand.
 * Includes specifications such as battery capacity, official range, measuring standards,
 * and real-world peak charging power (DC fast / AC onboard) used for charge-time estimates.
 */
export const PRESET_VEHICLES: EVPresetModel[] = [
  {
    id: 'byd-atto3-ext',
    brand: 'BYD',
    model: 'Atto 3',
    variant: 'Extended Range',
    batteryCapacityKWh: 60.48,
    officialRangeKm: 480,
    ratingStandard: 'NEDC',
    usableCapacityRatio: 0.95, // 95% of nominal capacity is usable
    maxDcChargeKW: 88, // Peak DC charging rate
    maxAcChargeKW: 11, // Upgraded 3-phase 11 kW onboard AC charger (2024+ spec)
  },
  {
    id: 'tesla-modely-rwd',
    brand: 'Tesla',
    model: 'Model Y',
    variant: 'RWD',
    batteryCapacityKWh: 60.0,
    officialRangeKm: 455,
    ratingStandard: 'WLTP',
    usableCapacityRatio: 0.95,
    maxDcChargeKW: 170, // Peak LFP DC charge rate
    maxAcChargeKW: 11, // Standard 3-phase 11 kW onboard AC
  },
  {
    id: 'neta-v-standard',
    brand: 'NETA',
    model: 'V',
    variant: 'Standard',
    batteryCapacityKWh: 38.5,
    officialRangeKm: 384,
    ratingStandard: 'NEDC',
    usableCapacityRatio: 0.94,
    maxDcChargeKW: 45, // Real-world peak DC charging rate
    maxAcChargeKW: 6.6, // Onboard AC speed
  },
  {
    id: 'mg-zsev-x',
    brand: 'MG',
    model: 'ZS EV',
    variant: 'X',
    batteryCapacityKWh: 50.3,
    officialRangeKm: 403,
    ratingStandard: 'NEDC',
    usableCapacityRatio: 0.95,
    maxDcChargeKW: 80, // Real-world peak DC rate
    maxAcChargeKW: 7, // Onboard AC charger speed
  },
  {
    id: 'hyundai-ioniq5-lr',
    brand: 'Hyundai',
    model: 'Ioniq 5',
    variant: 'Long Range',
    batteryCapacityKWh: 77.4, // Upgraded larger Long Range battery
    officialRangeKm: 507, // Updated WLTP range for 77.4 kWh battery
    ratingStandard: 'WLTP',
    usableCapacityRatio: 0.96,
    maxDcChargeKW: 233, // 800V E-GMP peak DC fast charging rate
    maxAcChargeKW: 11, // Onboard AC speed
  },
];
