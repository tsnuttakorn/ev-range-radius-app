import React from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { SmartTripPlan } from '../features/tripPlanner/types';
import { Theme, radius } from '../theme/tokens';
import { buildGoogleMapsDirectionsUrl } from '../utils/NavigationService';
import { formatMinutes } from '../utils/formatMinutes';

interface TripItineraryProps {
  plan: SmartTripPlan | null;
  isCalculating: boolean;
  theme: Theme;
}

/**
 * Replaces the old single-line "requires charging" alert with a real itinerary:
 * every charging stop the smart planner picked, the estimated arrival/departure
 * battery level, how long each charge takes, and the drive segments between them.
 */
export const TripItinerary: React.FC<TripItineraryProps> = ({ plan, isCalculating, theme: t }) => {
  if (isCalculating) {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={t.brand} />
        <Text style={[styles.statusText, { color: t.textSecondary }]}>
          Calculating the smartest route…
        </Text>
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.statusRow}>
        <FontAwesome name="map-o" size={12} color={t.textTertiary} />
        <Text style={[styles.statusText, { color: t.textSecondary }]}>
          Search above or tap the map to set a route.
        </Text>
      </View>
    );
  }

  if (!plan.reachable) {
    return (
      <View style={styles.statusRow}>
        <FontAwesome name="exclamation-triangle" size={12} color={t.danger} />
        <Text style={[styles.statusText, { color: t.danger }]}>
          Destination is out of reach — no viable charging route found within {plan.stops.length}+ stops.
        </Text>
      </View>
    );
  }

  const handleStartNavigation = () => {
    if (plan.legs.length === 0) return;
    const origin = plan.legs[0].from;
    const destination = plan.legs[plan.legs.length - 1].to;
    const waypoints = plan.stops.map((stop) => ({
      latitude: stop.station.latitude,
      longitude: stop.station.longitude,
    }));
    const url = buildGoogleMapsDirectionsUrl(destination, { origin, waypoints });
    Linking.openURL(url).catch((err) =>
      Alert.alert('Error', 'Cannot open Google Maps: ' + err.message)
    );
  };

  if (plan.directRoute) {
    return (
      <View>
        <View style={styles.statusRow}>
          <FontAwesome name="check-circle" size={12} color={t.success} />
          <Text style={[styles.statusText, { color: t.success }]}>
            Route safe · {plan.totalDistanceKm.toFixed(0)} km · ~{formatMinutes(plan.totalDriveTimeMinutes)} direct, no charging needed
          </Text>
        </View>
        <NavigateButton theme={t} onPress={handleStartNavigation} />
      </View>
    );
  }

  return (
    <View>
      {/* Trip summary */}
      <View style={styles.summaryRow}>
        <FontAwesome name="bolt" size={12} color={t.reserve} />
        <Text style={[styles.summaryText, { color: t.textPrimary }]}>
          {plan.stops.length} charging stop{plan.stops.length > 1 ? 's' : ''} · {plan.totalDistanceKm.toFixed(0)} km total
        </Text>
      </View>
      <Text style={[styles.summarySubText, { color: t.textTertiary }]}>
        ~{formatMinutes(plan.totalDriveTimeMinutes)} driving + {formatMinutes(plan.totalChargeTimeMinutes)} charging ·{' '}
        {formatMinutes(plan.totalTripTimeMinutes)} total · arrive at {plan.finalArrivalSoC}%
      </Text>

      {/* Timeline: leg -> stop -> leg -> stop -> ... -> final leg */}
      <View style={styles.timeline}>
        {plan.legs.map((leg, index) => {
          const stop = plan.stops[index]; // undefined for the final leg to destination
          return (
            <View key={index}>
              <View style={styles.legRow}>
                <View style={[styles.legLine, { backgroundColor: t.borderSubtle }]} />
                <FontAwesome name="road" size={10} color={t.textTertiary} style={styles.legIcon} />
                <Text style={[styles.legText, { color: t.textTertiary }]}>
                  Drive {leg.distanceKm.toFixed(0)} km · ~{formatMinutes(leg.driveTimeMinutes)}
                </Text>
              </View>

              {stop && (
                <View style={[styles.stopCard, { backgroundColor: t.surfaceSunken, borderColor: t.borderSubtle }]}>
                  <View style={styles.stopRow}>
                    <View style={[styles.stopBadge, { backgroundColor: t.brand }]}>
                      <Text style={styles.stopBadgeText}>{index + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.stopName, { color: t.textPrimary }]} numberOfLines={1}>
                        {stop.station.name}
                      </Text>
                      <Text style={[styles.stopMeta, { color: t.textTertiary }]}>
                        {stop.station.powerKW} kW {stop.station.type} · {stop.arrivalSoC}% → {stop.departureSoC}% (+{stop.energyAddedKWh} kWh)
                      </Text>
                    </View>
                    <View style={[styles.chargeTimePill, { backgroundColor: t.reserveDim }]}>
                      <FontAwesome name="clock-o" size={10} color={t.reserve} />
                      <Text style={[styles.chargeTimeText, { color: t.reserve }]}>
                        {formatMinutes(stop.chargeTimeMinutes)}
                      </Text>
                    </View>
                  </View>
                  {stop.station.status !== 'AVAILABLE' && (
                    <View style={styles.exceedNote}>
                      <FontAwesome name="exclamation-triangle" size={10} color={t.danger} />
                      <Text style={[styles.exceedNoteText, { color: t.danger }]}>
                        Reported {stop.station.status.toLowerCase()} — may not be usable when you arrive
                        {index === 0 && plan.alternative ? '; see the backup route below' : ''}
                      </Text>
                    </View>
                  )}
                  {stop.exceededPreferredLimit && (
                    <View style={styles.exceedNote}>
                      <FontAwesome name="info-circle" size={10} color={t.textTertiary} />
                      <Text style={[styles.exceedNoteText, { color: t.textTertiary }]}>
                        Charged past your preferred limit — needed to safely reach the next leg
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.legRow}>
          <FontAwesome name="flag-checkered" size={11} color={t.success} style={styles.legIcon} />
          <Text style={[styles.legText, { color: t.success, fontWeight: '700' }]}>
            Arrive with ~{plan.finalArrivalSoC}% battery remaining
          </Text>
        </View>
      </View>

      {plan.alternative && (
        <AlternativeRouteCard
          plan={plan.alternative}
          theme={t}
          isBackupForAvailability={plan.stops[0]?.station.status !== 'AVAILABLE'}
          primaryStationName={plan.stops[0]?.station.name}
        />
      )}

      <NavigateButton theme={t} onPress={handleStartNavigation} />
    </View>
  );
};

/**
 * A compact, informational summary of the second route the planner found — via a different
 * first charging stop — shown alongside the main itinerary when one exists. Not swappable/
 * selectable by design (that would need the map and itinerary to share "which plan is active"
 * state); this is a quick "here's another option" comparison, not a full second flow.
 *
 * Reframed as an explicit backup ("in case X is occupied") when the primary pick isn't reported
 * available — that's a real, actionable reason to have a plan B, not just a generic alternative.
 */
const AlternativeRouteCard: React.FC<{
  plan: SmartTripPlan;
  theme: Theme;
  isBackupForAvailability: boolean;
  primaryStationName?: string;
}> = ({ plan, theme: t, isBackupForAvailability, primaryStationName }) => (
  <View
    style={[
      styles.altCard,
      { backgroundColor: t.surfaceSunken, borderColor: isBackupForAvailability ? t.danger : t.borderSubtle },
    ]}
  >
    <View style={styles.altHeaderRow}>
      <FontAwesome name={isBackupForAvailability ? 'exclamation-circle' : 'random'} size={11} color={isBackupForAvailability ? t.danger : t.textTertiary} />
      <Text style={[styles.altHeaderText, { color: isBackupForAvailability ? t.danger : t.textTertiary }]}>
        {isBackupForAvailability ? 'BACKUP ROUTE' : 'ALTERNATIVE ROUTE'}
      </Text>
    </View>
    {isBackupForAvailability && (
      <Text style={[styles.altReasonText, { color: t.textSecondary }]}>
        In case {primaryStationName || 'the primary stop'} is occupied when you arrive
      </Text>
    )}
    {plan.directRoute ? (
      <Text style={[styles.altSummaryText, { color: t.textPrimary }]}>
        Direct · {plan.totalDistanceKm.toFixed(0)} km · ~{formatMinutes(plan.totalDriveTimeMinutes)}
      </Text>
    ) : (
      <Text style={[styles.altSummaryText, { color: t.textPrimary }]}>
        Via {plan.stops[0]?.station.name} · {plan.stops.length} stop{plan.stops.length > 1 ? 's' : ''} ·{' '}
        {plan.totalDistanceKm.toFixed(0)} km · ~{formatMinutes(plan.totalTripTimeMinutes)} total
      </Text>
    )}
    <Text style={[styles.altHintText, { color: t.textTertiary }]}>
      Shown as a dashed line on the map for comparison
    </Text>
  </View>
);

const NavigateButton: React.FC<{ theme: Theme; onPress: () => void }> = ({ theme: t, onPress }) => (
  <TouchableOpacity style={[styles.navButton, { backgroundColor: t.brand }]} onPress={onPress} activeOpacity={0.9}>
    <FontAwesome name="location-arrow" size={13} color="#ffffff" />
    <Text style={styles.navButtonText}>Start Navigation</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
  },
  summarySubText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
    marginLeft: 20,
  },
  timeline: {
    marginTop: 12,
  },
  legRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  legLine: {
    position: 'absolute',
    left: 12,
    top: -6,
    bottom: -6,
    width: 1,
  },
  legIcon: {
    width: 24,
    textAlign: 'center',
  },
  legText: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 4,
  },
  stopCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    marginLeft: 2,
    marginBottom: 4,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exceedNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148, 163, 184, 0.25)',
    gap: 6,
  },
  exceedNoteText: {
    fontSize: 10,
    fontWeight: '500',
    flex: 1,
    lineHeight: 14,
  },
  stopBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stopBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  stopName: {
    fontSize: 12,
    fontWeight: '700',
  },
  stopMeta: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  chargeTimePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginLeft: 8,
  },
  chargeTimeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  altCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: 10,
    marginTop: 12,
  },
  altHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  altHeaderText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  altReasonText: {
    fontSize: 10,
    fontWeight: '500',
    marginBottom: 4,
  },
  altSummaryText: {
    fontSize: 12,
    fontWeight: '600',
  },
  altHintText: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 3,
  },
  navButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginTop: 12,
  },
  navButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
