import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserEVProfile, MapCoordinates, RangeCalculationResultWithTime, RecentSearchItem } from '../types/ev';
import { PRESET_VEHICLES } from '../constants/presetVehicles';
import { RangeCalculator } from '../utils/RangeCalculator';
import { TripPlannerService } from '../features/tripPlanner/TripPlannerService';

const REFERENCE_SPEED_KMH = 90; // Matches the reference cruising speed used across the app's range math
const MAX_RECENT_SEARCHES = 8;

// Convert a preset vehicle into a UserEVProfile
const getProfileFromPreset = (id: string): UserEVProfile => {
  const preset = PRESET_VEHICLES.find((v) => v.id === id) || PRESET_VEHICLES[0];
  return {
    id: preset.id,
    modelName: `${preset.brand} ${preset.model} (${preset.variant})`,
    batteryCapacityKWh: preset.batteryCapacityKWh,
    officialRangeKm: preset.officialRangeKm,
    ratingStandard: preset.ratingStandard,
    customEfficiencyFactor: 1.0,
    maxDcChargeKW: preset.maxDcChargeKW,
    maxAcChargeKW: preset.maxAcChargeKW,
  };
};

interface EVStoreState {
  activeVehicle: UserEVProfile;
  currentSoC: number;
  targetReserveSoC: number;
  /** Preferred charge limit (%) for trip-planning stops — a battery-health habit (e.g. "usually charge to 80%"). The planner will still charge past this if the remaining trip genuinely needs it. */
  preferredMaxChargeSoC: number;
  isAirConActive: boolean;
  userLocation: MapCoordinates;
  savedVehicles: UserEVProfile[];
  themeMode: 'dark' | 'light';
  /** Recently-selected search results (start/destination), most recent first — reused across both fields so a place picked as a destination once shows up when searching a start point later, and vice versa. */
  recentSearches: RecentSearchItem[];
}

interface EVStoreActions {
  setActiveVehicle: (vehicle: UserEVProfile) => void;
  setCurrentSoC: (soc: number) => void;
  setTargetReserveSoC: (reserve: number) => void;
  setPreferredMaxChargeSoC: (limit: number) => void;
  toggleAirCon: () => void;
  setUserLocation: (coords: MapCoordinates) => void;
  addCustomVehicle: (vehicle: UserEVProfile) => void;
  updateVehicle: (vehicle: UserEVProfile) => void;
  deleteVehicle: (id: string) => void;
  getCalculationResult: () => RangeCalculationResultWithTime;
  toggleThemeMode: () => void;
  addRecentSearch: (item: RecentSearchItem) => void;
  removeRecentSearch: (id: string) => void;
  clearRecentSearches: () => void;
}

export type EVStore = EVStoreState & EVStoreActions;

export const useEVStore = create<EVStore>()(
  persist(
    (set, get) => ({
      // --- Default State ---
      activeVehicle: getProfileFromPreset('tesla-modely-rwd'),
      currentSoC: 80,
      targetReserveSoC: 20,
      preferredMaxChargeSoC: 80,
      isAirConActive: true,
      userLocation: {
        latitude: 13.7563,
        longitude: 100.5018, // Bangkok
      },
      savedVehicles: PRESET_VEHICLES.map((v) => ({
        id: v.id,
        modelName: `${v.brand} ${v.model} (${v.variant})`,
        batteryCapacityKWh: v.batteryCapacityKWh,
        officialRangeKm: v.officialRangeKm,
        ratingStandard: v.ratingStandard,
        customEfficiencyFactor: 1.0,
        maxDcChargeKW: v.maxDcChargeKW,
        maxAcChargeKW: v.maxAcChargeKW,
      })),
      themeMode: 'dark',
      recentSearches: [],

      // --- Actions ---
      setActiveVehicle: (vehicle) => set({ activeVehicle: vehicle }),
      setCurrentSoC: (soc) => set({ currentSoC: Math.max(0, Math.min(100, soc)) }),
      setTargetReserveSoC: (reserve) => set({ targetReserveSoC: Math.max(0, Math.min(100, reserve)) }),
      setPreferredMaxChargeSoC: (limit) => set({ preferredMaxChargeSoC: Math.max(20, Math.min(100, limit)) }),
      toggleAirCon: () => set((state) => ({ isAirConActive: !state.isAirConActive })),
      setUserLocation: (coords) => set({ userLocation: coords }),
      addCustomVehicle: (vehicle) =>
        set((state) => ({
          savedVehicles: [...state.savedVehicles, vehicle],
        })),
      updateVehicle: (vehicle) =>
        set((state) => ({
          savedVehicles: state.savedVehicles.map((v) => (v.id === vehicle.id ? vehicle : v)),
          // Keep the active vehicle's specs in sync if it's the one being edited.
          activeVehicle: state.activeVehicle.id === vehicle.id ? vehicle : state.activeVehicle,
        })),
      deleteVehicle: (id) =>
        set((state) => {
          const savedVehicles = state.savedVehicles.filter((v) => v.id !== id);
          // Never leave zero vehicles or an active vehicle pointing at a deleted one.
          const activeVehicle =
            state.activeVehicle.id === id ? savedVehicles[0] ?? state.activeVehicle : state.activeVehicle;
          return { savedVehicles: savedVehicles.length > 0 ? savedVehicles : state.savedVehicles, activeVehicle };
        }),
      toggleThemeMode: () => set((state) => ({ themeMode: state.themeMode === 'dark' ? 'light' : 'dark' })),
      addRecentSearch: (item) =>
        set((state) => {
          // Move to front if already present rather than allowing duplicates.
          const withoutDuplicate = state.recentSearches.filter((r) => r.id !== item.id);
          return { recentSearches: [item, ...withoutDuplicate].slice(0, MAX_RECENT_SEARCHES) };
        }),
      removeRecentSearch: (id) =>
        set((state) => ({ recentSearches: state.recentSearches.filter((r) => r.id !== id) })),
      clearRecentSearches: () => set({ recentSearches: [] }),

      // --- Computed Selector ---
      getCalculationResult: () => {
        const { activeVehicle, currentSoC, targetReserveSoC, preferredMaxChargeSoC, isAirConActive } = get();
        const result = RangeCalculator.calculate({
          vehicle: activeVehicle,
          currentSoC,
          targetReserveSoC,
          avgSpeedKmH: REFERENCE_SPEED_KMH,
          airConActive: isAirConActive,
        });

        // Rough time budget: how long to drive the safe range, plus how long to charge back up
        // afterward. Charging assumes a representative DC fast charger at the vehicle's own max
        // speed (best case) recharging from the reserve level to the preferred charge limit —
        // there's no actual trip/charger chosen yet, so this is deliberately an estimate.
        const estimatedDriveTimeMinutes = (result.safeRangeKm / REFERENCE_SPEED_KMH) * 60;
        const estimatedChargeTimeMinutes = TripPlannerService.estimateChargeTimeMinutes(
          activeVehicle.batteryCapacityKWh,
          activeVehicle.maxDcChargeKW,
          'DC',
          targetReserveSoC,
          preferredMaxChargeSoC,
          activeVehicle.maxDcChargeKW
        );

        return {
          ...result,
          estimatedDriveTimeMinutes: Math.round(estimatedDriveTimeMinutes),
          estimatedChargeTimeMinutes: Math.round(estimatedChargeTimeMinutes),
          estimatedTotalTravelTimeMinutes: Math.round(estimatedDriveTimeMinutes + estimatedChargeTimeMinutes),
        };
      },
    }),
    {
      name: 'ev-range-store',
      storage: createJSONStorage(() => AsyncStorage),
      // Persist activeVehicle, savedVehicles, targetReserveSoC, preferredMaxChargeSoC, themeMode, and recentSearches
      partialize: (state) => ({
        activeVehicle: state.activeVehicle,
        savedVehicles: state.savedVehicles,
        targetReserveSoC: state.targetReserveSoC,
        preferredMaxChargeSoC: state.preferredMaxChargeSoC,
        themeMode: state.themeMode,
        recentSearches: state.recentSearches,
      }),
    }
  )
);
