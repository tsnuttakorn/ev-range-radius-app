import React, { useState, useRef } from 'react';
import { StyleSheet, View, StatusBar, TouchableOpacity, Text, Modal, ScrollView, Dimensions } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EVMapAdapter, IMapRef } from '../components/EVMapAdapter';
import { RangeControlPanel } from '../components/RangeControlPanel';
import { LocationSearchField } from '../components/LocationSearchField';
import { TripItinerary } from '../components/TripItinerary';
import { VehicleSelectModal } from './VehicleSelectModal';
import { useEVStore } from '../store/useEVStore';
import { ChargingStation } from '../utils/StationGenerator';
import { MapCoordinates } from '../types/ev';
import { SmartTripPlan } from '../features/tripPlanner/types';
import { getTheme, radius } from '../theme/tokens';

const TypedStatusBar = StatusBar as any;
const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const HomeScreen: React.FC = () => {
  const { userLocation, setUserLocation, activeVehicle, getCalculationResult, themeMode, toggleThemeMode } = useEVStore();
  const { safeRangeKm, maxRangeKm } = getCalculationResult();

  const [vehicleModalVisible, setVehicleModalVisible] = useState(false);
  const [selectedStation, setSelectedStation] = useState<ChargingStation | null>(null);
  const [destination, setDestination] = useState<MapCoordinates | null>(null);
  const [startQuery, setStartQuery] = useState(''); // empty = defaults to current location, shown via placeholder
  const [destQuery, setDestQuery] = useState('');
  const [tripPlan, setTripPlan] = useState<SmartTripPlan | null>(null);
  const [isPlanningTrip, setIsPlanningTrip] = useState(false);

  const mapRef = useRef<IMapRef>(null);

  const t = getTheme(themeMode);
  const isLight = themeMode === 'light';

  const clearTrip = () => {
    setDestination(null);
    setDestQuery('');
    setTripPlan(null);
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

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <TypedStatusBar barStyle={t.statusBarStyle} translucent backgroundColor="transparent" />

      {/* Decoupled Map Layer taking full screen */}
      <EVMapAdapter
        ref={mapRef}
        center={userLocation}
        safeRadiusKm={safeRangeKm}
        maxRadiusKm={maxRangeKm}
        onCenterChange={setUserLocation}
        selectedStation={selectedStation}
        onSelectStation={setSelectedStation}
        destination={destination}
        onSelectDestination={(coords) => {
          setDestination(coords);
          if (!coords) {
            setDestQuery('');
          } else {
            setDestQuery(`${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`);
          }
        }}
        onTripPlanChange={({ plan, isCalculating }) => {
          setTripPlan(plan);
          setIsPlanningTrip(isCalculating);
        }}
      />

      {/* Floating Header Actions */}
      <SafeAreaView pointerEvents="box-none" style={styles.headerContainer} edges={['top']}>
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
            <TouchableOpacity
              style={[styles.iconButton, { backgroundColor: t.surface, borderColor: t.borderSubtle }]}
              onPress={() => mapRef.current?.recenter()}
              activeOpacity={0.85}
            >
              <FontAwesome name="location-arrow" size={14} color={t.reserve} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.iconButton, { backgroundColor: t.surface, borderColor: t.borderSubtle }]}
              onPress={toggleThemeMode}
              activeOpacity={0.85}
            >
              <FontAwesome name={isLight ? 'moon-o' : 'sun-o'} size={14} color={t.reserve} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Trip planner — always visible, no mode toggle needed. Search a destination, or
            close the search screen and tap a point on the map instead. */}
        <View style={[styles.tripCard, { backgroundColor: t.surface, borderColor: tripBorderColor }]}>
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
                      setUserLocation(coords);
                      setStartQuery(item.display_name.split(',')[0]);
                      mapRef.current?.recenter();
                    }}
                  />
                </View>
                {startQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setStartQuery('');
                      mapRef.current?.recenter();
                    }}
                    style={styles.useCurrentButton}
                  >
                    <FontAwesome name="location-arrow" size={10} color={t.brand} />
                    <Text style={[styles.useCurrentText, { color: t.brand }]}>Current</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={[styles.dividerLine, { backgroundColor: t.borderSubtle }]} />

              <ScrollView style={{ maxHeight: SCREEN_HEIGHT * 0.70 }} showsVerticalScrollIndicator={true} keyboardShouldPersistTaps="handled">
                <TripItinerary plan={tripPlan} isCalculating={isPlanningTrip} theme={t} />
              </ScrollView>
            </>
          )}
        </View>
      </SafeAreaView>

      {/* Floating Control Panel placed at the bottom */}
      <SafeAreaView pointerEvents="box-none" style={styles.overlayContainer} edges={['bottom']}>
        <RangeControlPanel onMaximize={() => setSelectedStation(null)} />
      </SafeAreaView>

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
});
export default HomeScreen;
