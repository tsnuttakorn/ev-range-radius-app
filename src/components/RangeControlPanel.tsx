import React, { useState } from 'react';
import { StyleSheet, View, Text, Switch, TouchableOpacity } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import SliderImport from '@react-native-community/slider';
import { useEVStore } from '../store/useEVStore';
import { getTheme, radius, spacing } from '../theme/tokens';
import { useResolvedThemeMode } from '../theme/useResolvedThemeMode';
import { formatMinutes } from '../utils/formatMinutes';
import { PRESET_VEHICLES } from '../constants/presetVehicles';

const Slider = SliderImport as any;

export interface IRangeControlPanelProps {
  onMaximize?: () => void;
  isWide?: boolean;
}

export const RangeControlPanel: React.FC<IRangeControlPanelProps> = ({ onMaximize, isWide = false }) => {
  const {
    activeVehicle,
    currentSoC,
    targetReserveSoC,
    preferredMaxChargeSoC,
    isAirConActive,
    setCurrentSoC,
    setTargetReserveSoC,
    setPreferredMaxChargeSoC,
    toggleAirCon,
    getCalculationResult,
  } = useEVStore();
  const themeMode = useResolvedThemeMode();

  const {
    safeRangeKm,
    maxRangeKm,
    usableBatteryKWh,
    estimatedDriveTimeMinutes,
    estimatedChargeTimeMinutes,
    estimatedTotalTravelTimeMinutes,
  } = getCalculationResult();

  const presetInfo = PRESET_VEHICLES.find((pv) => pv.id === activeVehicle.id);
  const maxDc = activeVehicle.maxDcChargeKW ?? presetInfo?.maxDcChargeKW ?? 50;
  const maxAc = activeVehicle.maxAcChargeKW ?? presetInfo?.maxAcChargeKW ?? 7;

  // Starts minimized (compact summary only) so the panel doesn't cover the map by default —
  // the sliders are one tap away, not permanently in view. Wide layout starts expanded (there's
  // room for it alongside the map), but stays user-minimizable just like the compact layout.
  // Minimizing never moves the panel itself in either layout — no map sits underneath to reveal
  // by sliding it away — it just hides the sliders/climate-toggle block in place, leaving the
  // car name + range summary always visible.
  const [minimized, setMinimized] = useState(!isWide);

  // Reset to each layout's default expand state when switching between compact and wide —
  // e.g. rotating a foldable — rather than carrying over a minimized/expanded state that may
  // no longer fit the new layout.
  React.useEffect(() => {
    setMinimized(!isWide);
  }, [isWide]);

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
      onTouchStart={() => {
        if (onMaximize) {
          onMaximize();
        }
      }}
      style={[styles.container, { backgroundColor: t.bg, borderColor: t.border }]}
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

        <View style={styles.chargeSpeedRow}>
          <FontAwesome name="bolt" size={11} color={t.reserve} />
          <Text style={[styles.chargeSpeedText, { color: t.textSecondary }]}>
            Charging: Up to {maxDc} kW DC · {maxAc} kW AC
          </Text>
        </View>

        <View style={styles.mainMetricContainer}>
          <Text style={[styles.metricLabel, { color: t.brand }]}>SAFE RANGE</Text>
          <View style={styles.metricValueRow}>
            <Text style={[styles.metricValue, { color: t.textPrimary }]}>{safeRangeKm}</Text>
            <Text style={[styles.metricUnit, { color: t.textTertiary }]}>km</Text>
          </View>
        </View>

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
              {maxRangeKm} <Text style={[styles.subMetricUnit, { color: t.textTertiary }]}>km</Text>
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
      </TouchableOpacity>

      {/* 2. Sliders and Control Section — the panel itself never moves in either layout, so
          minimizing just skips rendering this block entirely, leaving the car + range summary
          above always visible in place. */}
      {!minimized && (
      <View style={styles.controlSection}>
        {/* Current SoC Slider */}
        <View style={styles.sliderContainer}>
          <View style={styles.sliderHeader}>
            <View style={styles.sliderLabelRow}>
              <View style={[styles.iconChip, { backgroundColor: t.brandDim }]}>
                <FontAwesome name="battery-3" size={12} color={t.brand} />
              </View>
              <Text style={[styles.sliderLabel, { color: t.textPrimary }]}>Battery SoC</Text>
            </View>
            <Text style={[styles.badge, { backgroundColor: t.brandDim, color: t.brand }]}>{currentSoC}%</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={currentSoC}
            onValueChange={setCurrentSoC}
            minimumTrackTintColor={t.brand}
            maximumTrackTintColor={t.surfaceRaised}
            thumbTintColor={t.brand}
          />
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
            <Text style={[styles.badge, { backgroundColor: t.reserveDim, color: t.reserve }]}>{targetReserveSoC}%</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={50}
            step={1}
            value={targetReserveSoC}
            onValueChange={setTargetReserveSoC}
            minimumTrackTintColor={t.reserve}
            maximumTrackTintColor={t.surfaceRaised}
            thumbTintColor={t.reserve}
          />
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
            <Text style={[styles.badge, { backgroundColor: t.successDim, color: t.success }]}>{preferredMaxChargeSoC}%</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={50}
            maximumValue={100}
            step={5}
            value={preferredMaxChargeSoC}
            onValueChange={setPreferredMaxChargeSoC}
            minimumTrackTintColor={t.success}
            maximumTrackTintColor={t.surfaceRaised}
            thumbTintColor={t.success}
          />
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
    paddingHorizontal: 4,
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
  fallbackBadge: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.75,
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
