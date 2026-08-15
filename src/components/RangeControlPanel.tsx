import React, { useState } from 'react';
import { StyleSheet, View, Text, Switch, TouchableOpacity } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { CustomSlider as Slider } from './CustomSlider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useEVStore } from '../store/useEVStore';
import { getTheme, radius, spacing } from '../theme/tokens';
import { useResolvedThemeMode } from '../theme/useResolvedThemeMode';
import { formatMinutes } from '../utils/formatMinutes';
import { PRESET_VEHICLES } from '../constants/presetVehicles';
import { DrivingMode } from '../types/ev';

const DRIVING_MODES: { mode: DrivingMode; label: string; icon: React.ComponentProps<typeof FontAwesome>['name'] }[] = [
  { mode: 'CITY', label: 'City', icon: 'building-o' },
  { mode: 'MIXED', label: 'Mixed', icon: 'road' },
  { mode: 'HIGHWAY', label: 'Highway', icon: 'tachometer' },
];

export interface IRangeControlPanelProps {
  onMaximize?: () => void;
  isWide?: boolean;
  isPlanning?: boolean;
}

export const RangeControlPanel: React.FC<IRangeControlPanelProps> = ({ onMaximize, isWide = false, isPlanning = false }) => {
  // Selected via `useShallow` rather than a bare `useEVStore()` — a bare call subscribes to the
  // *entire* store, so every field this panel doesn't even read (recentSearches, userLocation
  // ticking during live GPS tracking, ...) would still force a re-render here on every change,
  // including every intermediate tick while dragging one of these very sliders.
  const {
    activeVehicle,
    currentSoC,
    targetReserveSoC,
    preferredMaxChargeSoC,
    isAirConActive,
    drivingMode,
    setCurrentSoC,
    setTargetReserveSoC,
    setPreferredMaxChargeSoC,
    toggleAirCon,
    setDrivingMode,
    getCalculationResult,
  } = useEVStore(
    useShallow((state) => ({
      activeVehicle: state.activeVehicle,
      currentSoC: state.currentSoC,
      targetReserveSoC: state.targetReserveSoC,
      preferredMaxChargeSoC: state.preferredMaxChargeSoC,
      isAirConActive: state.isAirConActive,
      drivingMode: state.drivingMode,
      setCurrentSoC: state.setCurrentSoC,
      setTargetReserveSoC: state.setTargetReserveSoC,
      setPreferredMaxChargeSoC: state.setPreferredMaxChargeSoC,
      toggleAirCon: state.toggleAirCon,
      setDrivingMode: state.setDrivingMode,
      getCalculationResult: state.getCalculationResult,
    }))
  );
  const themeMode = useResolvedThemeMode();
  const insets = useSafeAreaInsets();

  const {
    safeRangeKm,
    maxBufferRangeKm,
    usableBatteryKWh,
    estimatedDriveTimeMinutes,
    estimatedChargeTimeMinutes,
    estimatedTotalTravelTimeMinutes,
  } = getCalculationResult();

  const [localSoC, setLocalSoC] = useState(currentSoC);
  const [localReserve, setLocalReserve] = useState(targetReserveSoC);
  const [localLimit, setLocalLimit] = useState(preferredMaxChargeSoC);

  React.useEffect(() => {
    setLocalSoC(currentSoC);
  }, [currentSoC]);

  React.useEffect(() => {
    setLocalReserve(targetReserveSoC);
  }, [targetReserveSoC]);

  React.useEffect(() => {
    setLocalLimit(preferredMaxChargeSoC);
  }, [preferredMaxChargeSoC]);

  const presetInfo = PRESET_VEHICLES.find((pv) => pv.id === activeVehicle.id);
  const maxDc = activeVehicle.maxDcChargeKW ?? presetInfo?.maxDcChargeKW ?? 50;
  const maxAc = activeVehicle.maxAcChargeKW ?? presetInfo?.maxAcChargeKW ?? 7;

  // Starts minimized (compact summary only) so the panel doesn't cover the map by default —
  // the sliders are one tap away, not permanently in view. Wide layout starts expanded (there's
  // room for it alongside the map), but stays user-minimizable just like the compact layout.
  // We automatically minimize it when planning a trip to keep the UI clear.
  const [minimized, setMinimized] = useState(!isWide || isPlanning);

  // Reset to each layout's default expand state when switching between compact and wide —
  // e.g. rotating a foldable — or when trip planning status changes.
  React.useEffect(() => {
    if (isPlanning) {
      setMinimized(true);
    } else {
      setMinimized(!isWide);
    }
  }, [isWide, isPlanning]);

  const t = getTheme(themeMode);

  const toggleMinimized = () => {
    const next = !minimized;
    if (!next && onMaximize) {
      onMaximize();
    }
    setMinimized(next);
  };

  return (
    <View
      style={[
        styles.container,
        !isWide && styles.absoluteBottom,
        !isWide && { marginBottom: Math.max(spacing.md, insets.bottom) },
        { backgroundColor: t.bg, borderColor: t.border }
      ]}
      // The map behind this panel is a native react-native-maps MapView, which on Android
      // renders via a SurfaceView that intercepts touches ahead of JS siblings regardless of
      // z-order/zIndex. Forcing this overlay onto its own hardware layer restores correct
      // touch routing so the sliders receive gestures instead of the map underneath them.
      renderToHardwareTextureAndroid
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPressIn={() => {
          if (onMaximize) {
            onMaximize();
          }
        }}
        onPress={toggleMinimized}
        style={[styles.summaryCard, { backgroundColor: t.surface, borderColor: t.borderSubtle }]}
      >
        <View style={styles.headerRow}>
          <View style={[styles.vehiclePill, { backgroundColor: t.surfaceRaised }]}>
            <FontAwesome name="car" size={11} color={t.brand} />
            <Text style={[styles.vehiclePillText, { color: t.textSecondary }]} numberOfLines={1}>
              {activeVehicle.modelName}
            </Text>
          </View>
          <FontAwesome name={minimized ? 'chevron-up' : 'chevron-down'} size={12} color={t.textTertiary} />
        </View>

        {!minimized && (
          <View style={styles.chargeSpeedRow}>
            <FontAwesome name="bolt" size={11} color={t.reserve} />
            <Text style={[styles.chargeSpeedText, { color: t.textSecondary }]}>
              Charging: Up to {maxDc} kW DC · {maxAc} kW AC
            </Text>
          </View>
        )}

        <View style={styles.mainMetricContainer}>
          <Text style={[styles.metricLabel, { color: t.brand }]}>SAFE RANGE</Text>
          <View style={styles.metricValueRow}>
            <Text style={[styles.metricValue, { color: t.textPrimary }]}>{safeRangeKm}</Text>
            <Text style={[styles.metricUnit, { color: t.textTertiary }]}>km</Text>
          </View>
        </View>

        {!minimized && (
          <>
            <View style={[styles.divider, { backgroundColor: t.borderSubtle }]} />

            <View style={styles.subMetricsContainer}>
              <View style={styles.subMetricCol}>
                <Text style={[styles.subMetricLabel, { color: t.textTertiary }]}>Usable Energy</Text>
                <Text style={[styles.subMetricValue, { color: t.textPrimary }]}>
                  {usableBatteryKWh} <Text style={[styles.subMetricUnit, { color: t.textTertiary }]}>kWh</Text>
                </Text>
              </View>
              <View style={[styles.subMetricDivider, { backgroundColor: t.borderSubtle }]} />
              <View style={styles.subMetricCol}>
                <Text style={[styles.subMetricLabel, { color: t.textTertiary }]}>Max Buffer Range</Text>
                <Text style={[styles.subMetricValue, { color: t.textPrimary }]}>
                  {maxBufferRangeKm} <Text style={[styles.subMetricUnit, { color: t.textTertiary }]}>km</Text>
                </Text>
              </View>
            </View>

            {/* Rough time budget: driving the safe range + recharging back up afterward — one
                compact line rather than a second full metric row. */}
            <View style={styles.timeBudgetRow}>
              <FontAwesome name="clock-o" size={11} color={t.textTertiary} />
              <Text style={[styles.timeBudgetText, { color: t.textSecondary }]}>
                ~{formatMinutes(estimatedTotalTravelTimeMinutes)} total ·{' '}
                {formatMinutes(estimatedDriveTimeMinutes)} drive + {formatMinutes(estimatedChargeTimeMinutes)} charge to{' '}
                {preferredMaxChargeSoC}%
              </Text>
            </View>

            <View style={styles.footerInfoRow}>
              <FontAwesome name="info-circle" size={10} color={t.textTertiary} />
              <Text style={[styles.footerInfoText, { color: t.textTertiary }]}>
                Range boundaries are simulated offline
              </Text>
            </View>
          </>
        )}
      </TouchableOpacity>

      {/* 2. Sliders and Control Section — the panel itself never moves in either layout, so
          minimizing just skips rendering this block entirely, leaving the car + range summary
          above always visible in place. */}
      {!minimized && (
      <View style={styles.controlSection}>
        {/* Driving Mode — feeds directly into the range formula (RangeCalculator.DrivingMode):
            city driving beats the official rating (regen braking, low speeds), highway driving
            falls short of it (sustained aero drag), mixed matches it. Placed above the sliders
            since it changes what "100%" of range even means, before the SoC-based figures below. */}
        <View style={styles.sliderContainer}>
          <View style={[styles.sliderHeader, styles.modeHeader]}>
            <View style={styles.sliderLabelRow}>
              <View style={[styles.iconChip, { backgroundColor: t.brandDim }]}>
                <FontAwesome name="map-signs" size={12} color={t.brand} />
              </View>
              <Text style={[styles.sliderLabel, { color: t.textPrimary }]}>Driving Mode</Text>
            </View>
          </View>
          <View style={[styles.modeRow, { backgroundColor: t.surfaceRaised, borderColor: t.borderSubtle }]}>
            {DRIVING_MODES.map(({ mode, label, icon }) => {
              const active = drivingMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  activeOpacity={0.8}
                  onPress={() => setDrivingMode(mode)}
                  style={[styles.modeSegment, active && { backgroundColor: t.brandDim }]}
                >
                  <FontAwesome name={icon} size={12} color={active ? t.brand : t.textTertiary} />
                  <Text style={[styles.modeSegmentText, { color: active ? t.brand : t.textTertiary }]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Current SoC Slider */}
        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <View style={styles.sliderLabelRow}>
              <View style={[styles.iconChip, { backgroundColor: t.brandDim }]}>
                <FontAwesome name="battery-3" size={12} color={t.brand} />
              </View>
              <Text style={[styles.sliderLabel, { color: t.textPrimary }]}>Battery SoC</Text>
            </View>
            <Text style={[styles.badge, { backgroundColor: t.brandDim, color: t.brand }]}>{localSoC}%</Text>
          </View>
          <View style={styles.sliderTrackWrapper}>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={localSoC}
              onValueChange={setLocalSoC}
              onSlidingComplete={setCurrentSoC}
              minimumTrackTintColor={t.brand}
              maximumTrackTintColor={t.surfaceRaised}
              thumbTintColor={t.brand}
            />
          </View>
        </View>

        {/* Target Reserve SoC Slider */}
        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <View style={styles.sliderLabelRow}>
              <View style={[styles.iconChip, { backgroundColor: t.reserveDim }]}>
                <FontAwesome name="shield" size={12} color={t.reserve} />
              </View>
              <Text style={[styles.sliderLabel, { color: t.textPrimary }]}>Reserve Buffer</Text>
            </View>
            <Text style={[styles.badge, { backgroundColor: t.reserveDim, color: t.reserve }]}>{localReserve}%</Text>
          </View>
          <View style={styles.sliderTrackWrapper}>
            <Slider
              style={styles.slider}
              minimumValue={0}
              maximumValue={50}
              step={1}
              value={localReserve}
              onValueChange={setLocalReserve}
              onSlidingComplete={setTargetReserveSoC}
              minimumTrackTintColor={t.reserve}
              maximumTrackTintColor={t.surfaceRaised}
              thumbTintColor={t.reserve}
            />
          </View>
        </View>

        {/* Preferred Charge Limit Slider — used by the trip planner at charging stops */}
        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <View style={styles.sliderLabelRow}>
              <View style={[styles.iconChip, { backgroundColor: t.successDim }]}>
                <FontAwesome name="plug" size={12} color={t.success} />
              </View>
              <Text style={[styles.sliderLabel, { color: t.textPrimary }]}>Charge Limit</Text>
            </View>
            <Text style={[styles.badge, { backgroundColor: t.successDim, color: t.success }]}>{localLimit}%</Text>
          </View>
          <View style={styles.sliderTrackWrapper}>
            <Slider
              style={styles.slider}
              minimumValue={50}
              maximumValue={100}
              step={5}
              value={localLimit}
              onValueChange={setLocalLimit}
              onSlidingComplete={setPreferredMaxChargeSoC}
              minimumTrackTintColor={t.success}
              maximumTrackTintColor={t.surfaceRaised}
              thumbTintColor={t.success}
            />
          </View>
        </View>

        {/* Air Conditioning Toggle */}
        <View style={[styles.toggleRow, { backgroundColor: t.surface, borderColor: t.borderSubtle }]}>
          <View style={[styles.iconChip, { backgroundColor: t.successDim }]}>
            <FontAwesome name="snowflake-o" size={12} color={t.success} />
          </View>
          <Text style={[styles.toggleLabel, { color: t.textPrimary, flex: 1, marginLeft: 10 }]}>Climate Control</Text>
          <Switch
            value={isAirConActive}
            onValueChange={toggleAirCon}
            trackColor={{ false: t.surfaceRaised, true: t.success }}
            thumbColor={'#ffffff'}
          />
        </View>
      </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.panel,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 10,
  },
  absoluteBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 99,
  },
  summaryCard: {
    borderRadius: radius.card,
    padding: 14,
    borderWidth: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  vehiclePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    maxWidth: '85%',
  },
  vehiclePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  mainMetricContainer: {
    marginVertical: 2,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  metricValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  metricValue: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
  },
  metricUnit: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 6,
    marginBottom: 6,
  },
  divider: {
    height: 1,
    marginVertical: 10,
  },
  subMetricsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  subMetricCol: {
    flex: 1,
  },
  subMetricDivider: {
    width: 1,
    height: 28,
    marginHorizontal: 16,
  },
  subMetricLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  subMetricValue: {
    fontSize: 17,
    fontWeight: '700',
  },
  subMetricUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  timeBudgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  timeBudgetText: {
    fontSize: 10,
    fontWeight: '500',
    flex: 1,
  },
  controlSection: {
    marginTop: 14,
    // No horizontal padding here, deliberately — this sits directly on the container's own
    // `padding: 14` (see `container` above), same as `summaryCard` does, so slider/toggle content
    // lines up with the vehicle pill and SAFE RANGE card edges above it rather than being inset
    // a few extra px further in.
  },
  sliderContainer: {
    marginBottom: 10,
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconChip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sliderLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
  },
  slider: {
    width: '100%',
    height: 30,
  },
  sliderTrackWrapper: {
    // Padding lives here, outside CustomSlider itself, deliberately — not on `slider` above.
    // CustomSlider's own PanResponder measures touch position as locationX / its own layout
    // width (from onLayout on its root view, i.e. including any of its own padding); padding it
    // internally would leave the visual track narrower than that divisor, throwing off tap/drag
    // accuracy right at the edges. Padding this wrapper instead just gives the thumb (its battery
    // icon extends a few px past the 0%/100% ends) clearance from the card edge, with no effect
    // on CustomSlider's internal touch math.
    paddingHorizontal: 5,
  },
  modeHeader: {
    // Driving Mode has no badge on the right (unlike the SoC sliders), so its label row reads
    // more like a section heading than a value readout — a bit more air before the segmented
    // control below it than the standard 4px sliderHeader gap reads better here.
    marginBottom: 10,
  },
  modeRow: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 3,
    gap: 3,
  },
  modeSegment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
  },
  modeSegmentText: {
    fontSize: 11,
    fontWeight: '700',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    padding: 10,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  chargeSpeedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  chargeSpeedText: {
    fontSize: 11,
    fontWeight: '600',
  },
  footerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    opacity: 0.75,
  },
  footerInfoText: {
    fontSize: 9.5,
    fontWeight: '600',
  },
});
