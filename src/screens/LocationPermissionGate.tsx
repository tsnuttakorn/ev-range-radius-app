import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image, AppState, Linking } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { getTheme, radius, spacing, typography, elevation } from '../theme/tokens';
import { useResolvedThemeMode } from '../theme/useResolvedThemeMode';

type GateStatus = 'checking' | 'undetermined' | 'requesting' | 'denied' | 'granted';

/**
 * Blocks entry into the app until location permission is actually granted — the map, range
 * circles, and trip planner are all built around "where the car currently is", so running
 * without it isn't a degraded mode worth silently falling into; every screen behind this one
 * assumes a permission decision has already been made.
 *
 * Skips itself (renders `children` immediately) once the OS reports 'granted', so this only
 * costs returning users a screen on the very first launch — or on any later launch where
 * permission still isn't granted, since that's the one case this is meant to keep blocking.
 * A previously-denied user isn't asked again via the OS prompt (the OS won't re-show it), so
 * that state links out to Settings instead and re-checks automatically when the app regains
 * foreground (e.g. coming back from having changed it there).
 */
export const LocationPermissionGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const themeMode = useResolvedThemeMode();
  const t = getTheme(themeMode);
  const [status, setStatus] = useState<GateStatus>('checking');

  const checkStatus = useCallback(async () => {
    try {
      const { status: current } = await Location.getForegroundPermissionsAsync();
      setStatus(current === 'granted' ? 'granted' : current === 'denied' ? 'denied' : 'undetermined');
    } catch {
      // Treat an unreadable permission state the same as "not yet decided" rather than getting
      // stuck on the loading spinner forever.
      setStatus('undetermined');
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Re-checks when the app returns to the foreground while sitting on the "denied" screen — the
  // most common way permission actually changes from here is the user backgrounding the app to
  // flip it on in Settings, then switching back; the OS gives no other signal for that.
  useEffect(() => {
    if (status !== 'denied') return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') checkStatus();
    });
    return () => subscription.remove();
  }, [status, checkStatus]);

  const handleRequest = async () => {
    setStatus('requesting');
    try {
      const { status: result } = await Location.requestForegroundPermissionsAsync();
      setStatus(result === 'granted' ? 'granted' : 'denied');
    } catch {
      setStatus('denied');
    }
  };

  if (status === 'granted') {
    return <>{children}</>;
  }

  const isChecking = status === 'checking';
  const isDenied = status === 'denied';
  const isRequesting = status === 'requesting';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: t.bg }]}>
      <View style={styles.content}>
        <Image source={require('../../assets/icon.png')} style={styles.icon} resizeMode="contain" />

        {isChecking ? (
          <ActivityIndicator size="large" color={t.brand} style={{ marginTop: spacing.xxl }} />
        ) : (
          <>
            <View style={[styles.badge, { backgroundColor: isDenied ? t.dangerDim : t.brandDim }]}>
              <FontAwesome name="map-marker" size={28} color={isDenied ? t.danger : t.brand} />
            </View>

            <Text style={[styles.title, { color: t.textPrimary }]}>
              {isDenied ? 'Location Access Needed' : 'Find Chargers Near You'}
            </Text>
            <Text style={[styles.description, { color: t.textSecondary }]}>
              {isDenied
                ? "Location was turned off for this app, and the map, range, and trip planner all depend on knowing where you're starting from. Enable it in Settings to continue."
                : "EV Range & Radius needs your location to show your car's position on the map and calculate what's within reach — including how far you can safely go and where to charge along a route."}
            </Text>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: t.brand }, isRequesting && styles.buttonDisabled]}
              onPress={isDenied ? () => Linking.openSettings() : handleRequest}
              disabled={isRequesting}
              activeOpacity={0.85}
            >
              {isRequesting ? (
                <ActivityIndicator size="small" color="#04120f" />
              ) : (
                <>
                  <FontAwesome name={isDenied ? 'external-link' : 'location-arrow'} size={14} color="#04120f" />
                  <Text style={styles.primaryButtonText}>{isDenied ? 'Open Settings' : 'Enable Location'}</Text>
                </>
              )}
            </TouchableOpacity>

            {isDenied && (
              <TouchableOpacity style={styles.secondaryButton} onPress={checkStatus} activeOpacity={0.7}>
                <Text style={[styles.secondaryButtonText, { color: t.textTertiary }]}>I've enabled it — check again</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  icon: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    marginBottom: spacing.xl,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.display,
    fontSize: 22,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  description: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    minWidth: 220,
    ...elevation(),
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: '#04120f',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
