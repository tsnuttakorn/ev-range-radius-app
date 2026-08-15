import React, { useState, useRef } from 'react';
import { StyleSheet, View, StatusBar, TouchableOpacity, Text, Modal, ScrollView, Dimensions, useWindowDimensions } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EVMapAdapter, IMapRef } from '../components/EVMapAdapter';
import { RangeControlPanel } from '../components/RangeControlPanel';
import { LocationSearchField } from '../components/LocationSearchField';
import { TripItinerary } from '../components/TripItinerary';
import { VehicleSelectModal } from './VehicleSelectModal';
import { useShallow } from 'zustand/react/shallow';
import { useEVStore } from '../store/useEVStore';
import { ChargingStation } from '../utils/StationGenerator';
import { MapCoordinates } from '../types/ev';
import { SmartTripPlan } from '../features/tripPlanner/types';
import { getTheme, radius } from '../theme/tokens';
import { useResolvedThemeMode } from '../theme/useResolvedThemeMode';

const TypedStatusBar = StatusBar as any;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const HomeScreen: React.FC = () => {
  const { userLocation, setUserLocation, activeVehicle, getCalculationResult, themeMode: themePreference, toggleThemeMode } = useEVStore(
    useShallow((state) => ({
      userLocation: state.userLocation,
      setUserLocation: state.setUserLocation,
      activeVehicle: state.activeVehicle,
      getCalculationResult: state.getCalculationResult,
      themeMode: state.themeMode,
      toggleThemeMode: state.toggleThemeMode,
      // `getCalculationResult` is a stable function reference (a store action), so it doesn't by
      // itself make this component re-render when the values it reads change — these five aren't
      // otherwise used directly below, they're included purely so a slider drag, the AC toggle,
      // or a driving mode change forces a re-render here too, recomputing safeRangeKm/maxRangeKm
      // (below) so the map's range circles/isochrone actually update instead of going stale.
      currentSoC: state.currentSoC,
      targetReserveSoC: state.targetReserveSoC,
      preferredMaxChargeSoC: state.preferredMaxChargeSoC,
      isAirConActive: state.isAirConActive,
      drivingMode: state.drivingMode,
    }))
  );
  const themeMode = useResolvedThemeMode();
  const { safeRangeKm, maxRangeKm } = getCalculationResult();

  const [vehicleModalVisible, setVehicleModalVisible] = useState(false);
  const [selectedStation, setSelectedStation] = useState<ChargingStation | null>(null);
  const [destination, setDestination] = useState<MapCoordinates | null>(null);
  const [startQuery, setStartQuery] = useState(''); // empty = defaults to current location, shown via placeholder
  const [destQuery, setDestQuery] = useState('');
  const [tripPlan, setTripPlan] = useState<SmartTripPlan | null>(null);
  const [isPlanningTrip, setIsPlanningTrip] = useState(false);
  const [isTripItineraryMinimized, setIsTripItineraryMinimized] = useState(false);
  // On by default — the car pin follows the device's real GPS position continuously from app
  // start. Automatically turns itself off if the user manually overrides the position (dragging
  // the pin or picking a custom "FROM" start point), so it doesn't fight that mid-trip; the
  // "Current" action in the FROM row turns it back on.
  const [isLiveTracking, setIsLiveTracking] = useState(true);

  const mapRef = useRef<IMapRef>(null);

  const { width, height } = useWindowDimensions();
  // Keyed off the *shorter* side rather than requiring a landscape aspect ratio — an unfolded Z
  // Fold-style device is still portrait-shaped (width < height) but wide enough for the split
  // layout, same as a landscape tablet. A narrow phone rotated to landscape has a short side well
  // under 600 either way, so it correctly stays on the compact layout.
  const isWide = Math.min(width, height) >= 600;

  const t = getTheme(themeMode);
  const isLight = themeMode === 'light';

  const clearTrip = () => {
    setDestination(null);
    setDestQuery('');
    setStartQuery('');
    setTripPlan(null);
    setIsTripItineraryMinimized(false);
  };

  // Lets the backup-route card in the itinerary jump the map to that station's location so it
  // can be visually compared against the primary pick. Tapping the same toggle again ("Back to
  // trip") deselects it and pans back to the origin — the view the trip was already centered on.
  const handleCompareBackupStation = (station: ChargingStation | null) => {
    if (station) {
      setSelectedStation(station);
      mapRef.current?.panTo({ latitude: station.latitude, longitude: station.longitude });
    } else {
      setSelectedStation(null);
      mapRef.current?.panTo(userLocation);
    }
  };

  const tripBorderColor = !destination
    ? t.borderSubtle
    : !tripPlan || isPlanningTrip
    ? t.brand
    : !tripPlan.reachable
    ? t.danger
    : tripPlan.directRoute
    ? t.success
    : t.reserve;

  const renderTripCard = () => (
    <View style={[styles.tripCard, { backgroundColor: t.surface, borderColor: tripBorderColor }, isTripItineraryMinimized && { paddingBottom: 8 }]}>
      <View style={styles.destRow}>
        <View style={{ flex: 1 }}>
          <LocationSearchField
            theme={t}
            size="large"
            icon="flag-checkered"
            placeholder="Where do you want to go?"
            emptyHint="Search a place, or close this and tap a point on the map instead."
            value={destQuery}
            onChangeText={setDestQuery}
            onSelect={(item) => {
              const coords = { latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) };
              setDestination(coords);
              setDestQuery(item.display_name.split(',')[0]);
            }}
          />
        </View>
        {destination && (
          <TouchableOpacity
            onPress={clearTrip}
            style={[styles.clearIconButton, { backgroundColor: t.dangerDim }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <FontAwesome name="close" size={13} color={t.danger} />
          </TouchableOpacity>
        )}
      </View>

      {destination && (
        <>
          <View style={styles.startRow}>
            <Text style={[styles.startLabel, { color: t.textTertiary }]}>FROM</Text>
            <View style={{ flex: 1 }}>
              <LocationSearchField
                theme={t}
                size="compact"
                icon="circle"
                placeholder="Current Location"
                value={startQuery}
                onChangeText={setStartQuery}
                onSelect={(item) => {
                  const coords = { latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) };
                  setIsLiveTracking(false); // manual start point overrides live GPS tracking
                  setUserLocation(coords);
                  setStartQuery(item.display_name.split(',')[0]);
                  mapRef.current?.panTo(coords);
                }}
              />
            </View>
            {startQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setStartQuery('');
                  setIsLiveTracking(true); // resume following GPS after a manual start point
                  mapRef.current?.recenter();
                }}
                style={styles.useCurrentButton}
              >
                <FontAwesome name="location-arrow" size={10} color={t.brand} />
                <Text style={[styles.useCurrentText, { color: t.brand }]}>Current</Text>
              </TouchableOpacity>
            )}
          </View>

          {destination && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setIsTripItineraryMinimized(!isTripItineraryMinimized)}
              style={[styles.itineraryHeader, isTripItineraryMinimized && { paddingBottom: 2 }]}
            >
              <View style={styles.itineraryHeaderLeft}>
                <FontAwesome name="map-signs" size={12} color={t.brand} style={{ marginRight: 6 }} />
                <Text style={[styles.itineraryHeaderText, { color: t.textSecondary }]}>
                  {isTripItineraryMinimized ? 'Show Trip Itinerary' : 'Hide Trip Itinerary'}
                </Text>
              </View>
              <FontAwesome name={isTripItineraryMinimized ? 'chevron-down' : 'chevron-up'} size={12} color={t.textTertiary} />
            </TouchableOpacity>
          )}

          {destination && !isTripItineraryMinimized && (
            <>
              <View style={[styles.dividerLine, { backgroundColor: t.borderSubtle }]} />
              <ScrollView style={{ maxHeight: isWide ? height * 0.50 : SCREEN_HEIGHT * 0.45 }} showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">
                <TripItinerary
                  plan={tripPlan}
                  isCalculating={isPlanningTrip}
                  theme={t}
                  onCompareBackupStation={handleCompareBackupStation}
                  comparingStationId={selectedStation?.id ?? null}
                />
              </ScrollView>
            </>
          )}
        </>
      )}
    </View>
  );

  const renderHeaderActions = () => (
    <View style={styles.actionRow} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.vehicleButton, { backgroundColor: t.surface, borderColor: t.borderSubtle }]}
        onPress={() => setVehicleModalVisible(true)}
        activeOpacity={0.85}
      >
        <View style={[styles.vehicleIconWrap, { backgroundColor: t.brandDim }]}>
          <FontAwesome name="car" size={12} color={t.brand} />
        </View>
        <Text style={[styles.buttonText, { color: t.textPrimary }]} numberOfLines={1}>
          {activeVehicle.modelName}
        </Text>
        <FontAwesome name="angle-down" size={12} color={t.textTertiary} />
      </TouchableOpacity>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {/* Live GPS tracking runs continuously in the background from app start (see
            isLiveTracking below) — this button isn't a toggle for it, and doesn't re-fetch GPS
            itself (that's slower and can fail/hang). It just snaps the camera back to wherever
            the car pin already is — tracking keeps that accurate — and zooms in, for when the
            map has been panned/zoomed away from it. */}
        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: t.surface, borderColor: t.borderSubtle }]}
          onPress={() => mapRef.current?.panTo(userLocation)}
          activeOpacity={0.85}
        >
          <FontAwesome name="location-arrow" size={14} color={t.reserve} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: t.surface, borderColor: t.borderSubtle }]}
          onPress={toggleThemeMode}
          activeOpacity={0.85}
        >
          <FontAwesome
            name={themePreference === 'system' ? 'adjust' : isLight ? 'moon-o' : 'sun-o'}
            size={14}
            color={t.reserve}
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <TypedStatusBar barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'} />

      {/* Map layer in background */}
      <EVMapAdapter
        ref={mapRef}
        center={userLocation}
        safeRadiusKm={safeRangeKm}
        maxRadiusKm={maxRangeKm}
        onCenterChange={setUserLocation}
        selectedStation={selectedStation}
        onSelectStation={setSelectedStation}
        destination={destination}
        onSelectDestination={setDestination}
        comparingStationId={selectedStation?.id ?? null}
        isLiveTracking={isLiveTracking}
        onLiveTrackingInterrupted={() => setIsLiveTracking(false)}
        onTripPlanChange={({ plan, isCalculating }) => {
          setTripPlan(plan);
          setIsPlanningTrip(isCalculating);
        }}
      />

      {isWide ? (
        /* Wide split overlay layout for Foldables and Tablets (16:9 / 1:1) */
        <SafeAreaView pointerEvents="box-none" style={styles.wideOverlayContainer}>
          {/* Left Panel: Search & Trip Card */}
          <View style={styles.wideLeftColumn} pointerEvents="box-none">
            {renderHeaderActions()}
            {renderTripCard()}
          </View>

          {/* Right Panel: Car Info & Range Control Sliders */}
          <View style={styles.wideRightColumn} pointerEvents="box-none">
            <RangeControlPanel isWide={true} isPlanning={!!destination} onMaximize={() => setSelectedStation(null)} />
          </View>
        </SafeAreaView>
      ) : (
        /* Standard Vertical Layout for Mobile devices */
        <>
          {/* Floating Header Actions & Trip Card */}
          <SafeAreaView pointerEvents="box-none" style={styles.headerContainer} edges={['top']}>
            {renderHeaderActions()}
            {renderTripCard()}
          </SafeAreaView>

          {/* Floating Control Panel placed at the bottom */}
          <RangeControlPanel isPlanning={!!destination} onMaximize={() => setSelectedStation(null)} />
        </>
      )}

      {/* Vehicle Selection Modal */}
      <Modal
        visible={vehicleModalVisible}
        animationType="slide"
        onRequestClose={() => setVehicleModalVisible(false)}
      >
        <VehicleSelectModal onClose={() => setVehicleModalVisible(false)} />
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    zIndex: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  vehicleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 10,
    paddingRight: 14,
    maxWidth: '58%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  vehicleIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  tripCard: {
    borderRadius: radius.card,
    padding: 12,
    marginTop: 10,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 6,
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  clearIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  startLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    width: 32,
  },
  useCurrentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  useCurrentText: {
    fontSize: 10,
    fontWeight: '700',
  },
  itineraryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  itineraryHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itineraryHeaderText: {
    fontSize: 12,
    fontWeight: '700',
  },
  dividerLine: {
    height: 1,
    marginVertical: 10,
  },
  overlayContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  wideOverlayContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
  },
  wideLeftColumn: {
    width: 360,
    height: '100%',
  },
  wideRightColumn: {
    width: 360,
    height: '100%',
    justifyContent: 'flex-end',
  },
});
export default HomeScreen;
