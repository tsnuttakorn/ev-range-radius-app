import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserEVProfile, MapCoordinates, RangeCalculationResultWithTime, RecentSearchItem, DrivingMode } from '../types/ev';
import { PRESET_VEHICLES } from '../constants/presetVehicles';
import { RangeCalculator } from '../utils/RangeCalculator';
import { TripPlannerService } from '../features/tripPlanner/TripPlannerService';

const MAX_RECENT_SEARCHES = 8;
const PERSIST_DEBOUNCE_MS = 500;

/**
 * `persist`'s internal subscriber fires on *every* `set()` call to the store, not just ones that
 * touch a persisted field — so dragging a slider (which calls `set()` on every step, including
 * `currentSoC`, which isn't even in `partialize` below) was re-serializing the persisted slice and
 * hitting the AsyncStorage native bridge dozens of times a second. That per-tick I/O is what was
 * actually stuttering the drag gesture, not the slider's own rendering. Debouncing the write here
 * — rather than throttling the app state updates themselves — keeps every drag tick fast/in-memory
 * and only touches storage once things settle, with no change to how live the UI feels.
 */
const debouncedAsyncStorage = {
  getItem: AsyncStorage.getItem,
  removeItem: AsyncStorage.removeItem,
  setItem: (() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let pending: { name: string; value: string } | null = null;
    return (name: string, value: string) => {
      pending = { name, value };
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (pending) AsyncStorage.setItem(pending.name, pending.value);
        pending = null;
        timeout = null;
      }, PERSIST_DEBOUNCE_MS);
      return Promise.resolve();
    };
  })(),
};

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
  /** City/Mixed/Highway usage profile — feeds directly into the range formula (see `DrivingMode`). */
  drivingMode: DrivingMode;
  userLocation: MapCoordinates;
  savedVehicles: UserEVProfile[];
  /** 'system' dynamically follows the OS light/dark setting; 'light'/'dark' pin it explicitly. */
  themeMode: 'dark' | 'light' | 'system';
  /** Recently-selected search results (start/destination), most recent first — reused across both fields so a place picked as a destination once shows up when searching a start point later, and vice versa. */
  recentSearches: RecentSearchItem[];
}

interface EVStoreActions {
  setActiveVehicle: (vehicle: UserEVProfile) => void;
  setCurrentSoC: (soc: number) => void;
  setTargetReserveSoC: (reserve: number) => void;
  setPreferredMaxChargeSoC: (limit: number) => void;
  toggleAirCon: () => void;
  setDrivingMode: (mode: DrivingMode) => void;
  setUserLocation: (coords: MapCoordinates) => void;
  addCustomVehicle: (vehicle: UserEVProfile) => void;
  updateVehicle: (vehicle: UserEVProfile) => void;
  deleteVehicle: (id: string) => void;
  getCalculationResult: () => RangeCalculationResultWithTime;
  /** Cycles the theme preference: system -> light -> dark -> system. */
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
      drivingMode: 'MIXED',
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
      themeMode: 'system',
      recentSearches: [],

      // --- Actions ---
      setActiveVehicle: (vehicle) => set({ activeVehicle: vehicle }),
      setCurrentSoC: (soc) => set({ currentSoC: Math.max(0, Math.min(100, soc)) }),
      setTargetReserveSoC: (reserve) => set({ targetReserveSoC: Math.max(0, Math.min(100, reserve)) }),
      setPreferredMaxChargeSoC: (limit) => set({ preferredMaxChargeSoC: Math.max(20, Math.min(100, limit)) }),
      toggleAirCon: () => set((state) => ({ isAirConActive: !state.isAirConActive })),
      setDrivingMode: (mode) => set({ drivingMode: mode }),
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
      toggleThemeMode: () =>
        set((state) => ({
          themeMode:
            state.themeMode === 'system' ? 'light' : state.themeMode === 'light' ? 'dark' : 'system',
        })),
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
        const { activeVehicle, currentSoC, targetReserveSoC, preferredMaxChargeSoC, isAirConActive, drivingMode } =
          get();
        const result = RangeCalculator.calculate({
          vehicle: activeVehicle,
          currentSoC,
          targetReserveSoC,
          airConActive: isAirConActive,
          drivingMode,
        });

        // Rough time budget: how long to drive the safe range, plus how long to charge back up
        // afterward. Charging assumes a representative DC fast charger at the vehicle's own max
        // speed (best case) recharging from the reserve level to the preferred charge limit —
        // there's no actual trip/charger chosen yet, so this is deliberately an estimate. Drive
        // time uses the driving mode's own reference speed (city driving covers the same range
        // more slowly than highway driving does, independent of the range figure itself).
        const avgSpeedKmH = RangeCalculator.getAvgSpeedKmH(drivingMode);
        const estimatedDriveTimeMinutes = (result.safeRangeKm / avgSpeedKmH) * 60;
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
      storage: createJSONStorage(() => debouncedAsyncStorage),
      // Persist activeVehicle, savedVehicles, targetReserveSoC, preferredMaxChargeSoC, themeMode, drivingMode, and recentSearches
      partialize: (state) => ({
        activeVehicle: state.activeVehicle,
        savedVehicles: state.savedVehicles,
        targetReserveSoC: state.targetReserveSoC,
        preferredMaxChargeSoC: state.preferredMaxChargeSoC,
        themeMode: state.themeMode,
        drivingMode: state.drivingMode,
        recentSearches: state.recentSearches,
      }),
    }
  )
);
