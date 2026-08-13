import React, { useState, useRef } from 'react';
import { StyleSheet, View, StatusBar, TouchableOpacity, Text, Modal, ScrollView, Dimensions, useWindowDimensions } from 'react-native';
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
            <RangeControlPanel isWide={true} onMaximize={() => setSelectedStation(null)} />
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
          <SafeAreaView pointerEvents="box-none" style={styles.overlayContainer} edges={['bottom']}>
            <RangeControlPanel onMaximize={() => setSelectedStation(null)} />
          </SafeAreaView>
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
