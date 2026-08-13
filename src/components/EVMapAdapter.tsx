import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Alert, Linking, Modal, Animated } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import MapView, { Marker, Polygon, Callout, Polyline, PROVIDER_DEFAULT, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { MapCoordinates } from '../types/ev';
import { RangeCalculator } from '../utils/RangeCalculator';
import { generateMockStations, ChargingStation, getDistanceKm, withinRadiusOf } from '../utils/StationGenerator';
import { getAllRealStations } from '../utils/StationService';
import { useEVStore } from '../store/useEVStore';
import { fetchRealRoute, fetchIsochronePolygon } from '../utils/RouteService';
import { getTheme, mapColors, radius, spacing } from '../theme/tokens';
import { useResolvedThemeMode } from '../theme/useResolvedThemeMode';
import { TripPlannerService } from '../features/tripPlanner/TripPlannerService';
import { SmartTripPlan } from '../features/tripPlanner/types';
import { buildGoogleMapsDirectionsUrl } from '../utils/NavigationService';

/**
 * Decoupled interface props to easily swap mapping SDK providers (e.g., Google Maps, Mapbox, OSM) in the future.
 */
export interface IMapProviderProps {
  /** The center point location of the user/EV */
  center: MapCoordinates;
  /** Safe reachable range in kilometers */
  safeRadiusKm: number;
  /** Maximum theoretical range in kilometers */
  maxRadiusKm: number;
  /** Optional callback when user changes map region or center */
  onCenterChange?: (coords: MapCoordinates) => void;
  selectedStation: ChargingStation | null;
  onSelectStation: (station: ChargingStation | null) => void;
  destination: MapCoordinates | null;
  /** Tapping the map always sets the destination — there's no separate "trip planning mode" to enable first. */
  onSelectDestination: (coords: MapCoordinates | null) => void;
  /** Fires whenever the smart multi-stop trip plan is (re)calculated for the current destination. */
  onTripPlanChange?: (state: { plan: SmartTripPlan | null; isCalculating: boolean }) => void;
}

export interface IMapRef {
  recenter: () => void;
}

// Wide enough to cover an entire country the size of Thailand (~1,650km at its longest) in one
// fetch, so the trip planner has visibility into chargers along the whole route, not just near
// wherever the vehicle currently sits.
const COUNTRY_SEARCH_RADIUS_KM = 1600;
// Raised now that stations are merged from two independent sources (Open Charge Map + OSM/Overpass).
const COUNTRY_MAX_RESULTS = 500;

interface StationMarkerProps {
  station: ChargingStation;
  isZoomedIn: boolean;
  onSelect: (station: ChargingStation) => void;
}

/**
 * A single charging station pin — a compact dot when zoomed out, a full badge with a status dot
 * when zoomed in.
 *
 * Perf-critical: with up to ~500 stations rendered at once, this is memoized and every prop is
 * kept referentially stable (station comes from a stable array, isZoomedIn is a primitive,
 * onSelect is the same function across renders) so re-renders of the parent map — e.g. from a
 * range slider being dragged — don't touch any of these.
 *
 * `tracksViewChanges` is the other half of that perf story, but it's a two-edged sword: leaving
 * it `true` forever means react-native-maps re-snapshots every custom marker view to a native
 * bitmap on every render pass (the classic cause of map lag past a handful of markers) — but
 * setting it `false` from the very first render risks the opposite bug, where the native
 * snapshot gets taken before the custom child view has actually finished laying out, leaving a
 * permanently blank/invisible marker. So it starts `true`, then flips to `false` shortly after
 * mount (and again after anything that changes what the marker actually looks like) — enough
 * time for at least one real snapshot to land before tracking stops.
 */
const StationMarker = React.memo<StationMarkerProps>(({ station, isZoomedIn, onSelect }) => {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    setTracksViewChanges(true);
    const timeout = setTimeout(() => setTracksViewChanges(false), 300);
    return () => clearTimeout(timeout);
  }, [isZoomedIn, station.type, station.status]);

  return (
  <Marker
    coordinate={{ latitude: station.latitude, longitude: station.longitude }}
    onPress={() => onSelect(station)}
    tracksViewChanges={tracksViewChanges}
  >
    {isZoomedIn ? (
      <View style={[styles.stationMarker, station.type === 'DC' ? styles.markerDC : styles.markerAC]}>
        <FontAwesome
          name={station.type === 'DC' ? 'bolt' : 'plug'}
          size={12}
          color={station.type === 'DC' ? mapColors.chargerDC : mapColors.chargerAC}
        />
        <View
          style={[
            styles.statusDot,
            station.status === 'AVAILABLE' && styles.statusAvailable,
            station.status === 'OCCUPIED' && styles.statusOccupied,
            station.status === 'MAINTENANCE' && styles.statusMaintenance,
          ]}
        />
      </View>
    ) : (
      <View style={[styles.stationDotMarker, station.type === 'DC' ? styles.markerDC : styles.markerAC]}>
        <FontAwesome
          name={station.type === 'DC' ? 'bolt' : 'plug'}
          size={8}
          color={station.type === 'DC' ? mapColors.chargerDC : mapColors.chargerAC}
        />
        <Text style={styles.dotSlotsText}>{station.slots}</Text>
      </View>
    )}

    <Callout tooltip>
      <View style={styles.calloutContainer}>
        <Text style={styles.calloutTitle}>{station.name}</Text>
        <View style={styles.calloutBadgeRow}>
          <View style={[styles.calloutBadge, station.type === 'DC' ? styles.badgeDC : styles.badgeAC]}>
            <Text style={styles.calloutBadgeText}>
              {station.type === 'DC' ? '⚡ DC Fast' : '🔌 AC Charge'}
            </Text>
          </View>
          <View
            style={[
              styles.calloutBadge,
              station.status === 'AVAILABLE' && styles.badgeAvailable,
              station.status === 'OCCUPIED' && styles.badgeOccupied,
              station.status === 'MAINTENANCE' && styles.badgeMaintenance,
            ]}
          >
            <Text style={styles.calloutBadgeText}>{station.status}</Text>
          </View>
        </View>
        <Text style={styles.calloutDetails}>Capacity: {station.powerKW} kW</Text>
        {station.slots && <Text style={styles.calloutDetails}>Slots: {station.slots}</Text>}
        <Text style={styles.calloutDetails}>Distance: {station.distanceKm.toFixed(1)} km away</Text>
        {station.operator && <Text style={styles.calloutSubDetails}>Network: {station.operator}</Text>}
        {station.address && <Text style={styles.calloutSubDetails}>Address: {station.address}</Text>}
        {station.phone && <Text style={styles.calloutSubDetails}>Tel: {station.phone}</Text>}
      </View>
    </Callout>
  </Marker>
  );
});
StationMarker.displayName = 'StationMarker';

export const EVMapAdapter = forwardRef<IMapRef, IMapProviderProps>(({
  center,
  safeRadiusKm,
  maxRadiusKm,
  onCenterChange,
  selectedStation,
  onSelectStation,
  destination,
  onSelectDestination,
  onTripPlanChange,
}, ref) => {
  const mapRef = useRef<MapView>(null);
  const { activeVehicle, currentSoC, targetReserveSoC, preferredMaxChargeSoC, isAirConActive } = useEVStore();
  const themeMode = useResolvedThemeMode();

  useImperativeHandle(ref, () => ({
    recenter: handleLocateAndRecenter,
  }));

  // Track the visible map region — drives both the zoomed-in/out marker style and clustering grid size
  const [region, setRegion] = useState<Region>({
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta: 0.2,
    longitudeDelta: 0.2,
  });

  // Broad, country-wide station list (fetched once, independent of the visible radius) that the
  // trip planner searches locally at every simulated hop — so a sparse result near one waypoint
  // doesn't wrongly strand a route that has plenty of chargers further along, just outside it.
  const [countryStations, setCountryStations] = useState<ChargingStation[]>([]);
  const [countryStationsLoaded, setCountryStationsLoaded] = useState(false);

  // The full smart multi-stop trip plan (drive legs + charging stops) for the active destination
  const [tripPlan, setTripPlan] = useState<SmartTripPlan | null>(null);

  // Fetch the broad, country-wide station list once per general area (not per hop), merged from
  // Open Charge Map + OpenStreetMap/Overpass for wider real-world coverage than either alone.
  // Falls back to mock stations if both real sources are unavailable — spread within the
  // vehicle's actual range (not the artificial country-wide search radius) so they land
  // somewhere visible near the user instead of off-screen hundreds of km away.
  useEffect(() => {
    let cancelled = false;
    const mockFallbackRadiusKm = Math.max(maxRadiusKm, 20);
    const mockFallback = generateMockStations(center, mockFallbackRadiusKm);

    const loadCountryStations = async () => {
      setCountryStationsLoaded(false);
      try {
        const fetched = await getAllRealStations(center, COUNTRY_SEARCH_RADIUS_KM, mockFallback, COUNTRY_MAX_RESULTS);
        if (cancelled) return;
        setCountryStations(fetched);
      } catch (error) {
        // Belt-and-suspenders: getAllRealStations already falls back to mock data internally on
        // fetch failures, but if anything unexpected still throws, never leave the map with no
        // stations at all and no way to recover until `center` changes again.
        console.warn('[EVMapAdapter] Station fetch failed unexpectedly, using mock stations:', error);
        if (cancelled) return;
        setCountryStations(mockFallback);
      } finally {
        if (!cancelled) setCountryStationsLoaded(true);
      }
    };
    loadCountryStations();
    return () => {
      cancelled = true;
    };
  }, [center.latitude, center.longitude, maxRadiusKm]);

  useEffect(() => {
    let cancelled = false;

    const planTrip = async () => {
      if (!destination) {
        setTripPlan(null);
        if (onTripPlanChange) onTripPlanChange({ plan: null, isCalculating: false });
        return;
      }
      // Wait for the country-wide list so the planner isn't judging reachability off an
      // incomplete/empty station set.
      if (!countryStationsLoaded) {
        if (onTripPlanChange) onTripPlanChange({ plan: null, isCalculating: true });
        return;
      }

      if (onTripPlanChange) onTripPlanChange({ plan: null, isCalculating: true });

      const plan = await TripPlannerService.planSmartTrip({
        origin: center,
        destination,
        vehicle: activeVehicle,
        currentSoC,
        targetReserveSoC,
        preferredMaxChargeSoC,
        airConActive: isAirConActive,
        fetchRoute: fetchRealRoute,
        // Search the already-fetched country-wide list locally instead of re-querying the
        // network at every hop — a single broad fetch, reused for every leg of the route.
        fetchStations: async (searchCenter, radiusKm) => withinRadiusOf(countryStations, searchCenter, radiusKm),
      });

      if (cancelled) return;
      setTripPlan(plan);
      if (onTripPlanChange) onTripPlanChange({ plan, isCalculating: false });
    };

    planTrip();
    return () => {
      cancelled = true;
    };
  }, [destination, center.latitude, center.longitude, activeVehicle, currentSoC, targetReserveSoC, preferredMaxChargeSoC, isAirConActive, countryStationsLoaded, countryStations]);

  // Theme support
  const t = getTheme(themeMode);
  const cardBg = t.bg;
  const cardBorder = t.border;
  const textColor = t.textPrimary;
  const subTextColor = t.textSecondary;
  const labelColor = t.textTertiary;

  // Animation values for smooth entry/exit of the station details card
  const cardAnim = useRef(new Animated.Value(0)).current;
  const [renderedStation, setRenderedStation] = useState<ChargingStation | null>(null);

  useEffect(() => {
    if (selectedStation) {
      setRenderedStation(selectedStation);
      Animated.spring(cardAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 18,
        stiffness: 140,
      }).start();
    } else {
      Animated.timing(cardAnim, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start(() => {
        setRenderedStation(null);
      });
    }
  }, [selectedStation]);

  // Coordinates for the safe & max range polygons. Sourced from a real road-network isochrone
  // (OpenRouteService) whenever an API key is configured, so the shape reflects actual reachable
  // roads instead of a straight-line radius. Falls back to the offline simulated polygon if no
  // key is set or the request fails, so the map always has *something* to draw.
  const [safeRangePolygonCoords, setSafeRangePolygonCoords] = useState<MapCoordinates[]>([]);
  const [maxRangePolygonCoords, setMaxRangePolygonCoords] = useState<MapCoordinates[]>([]);

  useEffect(() => {
    let cancelled = false;

    // Debounced so dragging a range slider — which re-renders this component on every tick —
    // doesn't fire an isochrone request per frame.
    const timer = setTimeout(async () => {
      const [safeIsochrone, maxIsochrone] = await Promise.all([
        fetchIsochronePolygon(center, safeRadiusKm),
        fetchIsochronePolygon(center, maxRadiusKm),
      ]);
      if (cancelled) return;

      setSafeRangePolygonCoords(safeIsochrone ?? RangeCalculator.generateRoadRangePolygon(center, safeRadiusKm));
      setMaxRangePolygonCoords(maxIsochrone ?? RangeCalculator.generateRoadRangePolygon(center, maxRadiusKm));
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [center.latitude, center.longitude, safeRadiusKm, maxRadiusKm]);

  const isZoomedIn = region.latitudeDelta < 0.12;

  // Fetches current GPS location to update center pin, or re-centers on existing pin coordinates
  const handleLocateAndRecenter = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      
      // Fallback: If GPS permission denied, simply re-center on the current active pin location
      if (status !== 'granted') {
        if (mapRef.current) {
          mapRef.current.animateToRegion({
            latitude: center.latitude,
            longitude: center.longitude,
            latitudeDelta: 0.15,
            longitudeDelta: 0.15,
          }, 1000);
        }
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const coords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      if (onCenterChange) {
        onCenterChange(coords);
      }

      if (mapRef.current) {
        mapRef.current.animateToRegion({
          ...coords,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }, 1000);
      }
    } catch (error) {
      // If GPS fetch fails, fallback to simple re-center on existing pin
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: 0.15,
          longitudeDelta: 0.15,
        }, 1000);
      }
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_DEFAULT}
        initialRegion={{
          latitude: center.latitude,
          longitude: center.longitude,
          latitudeDelta: 0.2,
          longitudeDelta: 0.2,
        }}
        onRegionChangeComplete={(nextRegion) => {
          setRegion(nextRegion);
        }}
        onPress={(e) => onSelectDestination(e.nativeEvent.coordinate)}
      >
        {/* User EV Current Location Marker */}
        <Marker
          draggable
          coordinate={{
            latitude: center.latitude,
            longitude: center.longitude,
          }}
          title="Your EV Location"
          description="Drag pin to recalculate range from a new location"
          onDragEnd={(e) => {
            if (onCenterChange) {
              onCenterChange(e.nativeEvent.coordinate);
            }
          }}
        />

        {/* Outer Polygon: Max Range (0% SoC reserve) */}
        {maxRangePolygonCoords.length > 0 && (
          <Polygon
            coordinates={maxRangePolygonCoords}
            strokeColor={t.reserve} // Amber — theoretical max buffer
            strokeWidth={2}
            fillColor="rgba(245, 158, 11, 0.06)" // Light tint for outer bounds
            lineDashPattern={[6, 6]} // Dashed border line
          />
        )}

        {/* Inner Polygon: Safe Range (Target Reserve SoC) */}
        {safeRangePolygonCoords.length > 0 && (
          <Polygon
            coordinates={safeRangePolygonCoords}
            strokeColor={t.brand} // Teal — safely reachable
            strokeWidth={3}
            fillColor="rgba(45, 212, 191, 0.16)" // Tint fill
          />
        )}

        {/* All EV Charging Stations in the country */}
        {countryStations.map((station) => (
          <StationMarker key={station.id} station={station} isZoomedIn={isZoomedIn} onSelect={onSelectStation} />
        ))}

        {/* Alternative route (if one was found) — drawn muted/thin and underneath the primary route */}
        {destination && tripPlan?.alternative && tripPlan.alternative.legs.map((leg, index) => (
          <Polyline
            key={`alt-leg-${index}`}
            coordinates={leg.coordinates}
            strokeColor={t.textTertiary}
            strokeWidth={3}
            lineDashPattern={[4, 6]}
            zIndex={1}
          />
        ))}

        {/* Draw Smart Trip Routing Polylines — one segment per drive leg, numbered stops in between */}
        {destination && tripPlan && tripPlan.legs.map((leg, index) => {
          const isFinalLeg = index === tripPlan.legs.length - 1;
          const isSafeSegment = tripPlan.reachable && isFinalLeg;
          return (
            <Polyline
              key={`leg-${index}`}
              coordinates={leg.coordinates}
              strokeColor={tripPlan.reachable ? (isSafeSegment ? t.success : t.brand) : t.danger}
              strokeWidth={5}
              lineDashPattern={tripPlan.reachable ? undefined : [6, 6]}
              zIndex={2}
            />
          );
        })}

        {/* Total route failure (no OSRM route found at all) — fall back to a straight indicator line */}
        {destination && tripPlan && !tripPlan.reachable && tripPlan.legs.length === 0 && (
          <Polyline
            coordinates={[center, destination]}
            strokeColor={t.danger}
            strokeWidth={5}
            lineDashPattern={[6, 6]}
          />
        )}

        {/* Numbered Charging Stop Markers along the smart route */}
        {tripPlan?.stops.map((stop, index) => (
          <Marker
            key={`stop-${stop.station.id}`}
            coordinate={{ latitude: stop.station.latitude, longitude: stop.station.longitude }}
            anchor={{ x: 0.5, y: 1.4 }}
            zIndex={50}
          >
            <View style={[styles.stopBadge, { borderColor: t.bg }]}>
              <Text style={styles.stopBadgeText}>{index + 1}</Text>
            </View>
            <Callout tooltip>
              <View style={styles.calloutContainer}>
                <Text style={styles.calloutTitle}>Stop {index + 1} · {stop.station.name}</Text>
                <View style={styles.calloutBadgeRow}>
                  <View style={[styles.calloutBadge, stop.station.type === 'DC' ? styles.badgeDC : styles.badgeAC]}>
                    <Text style={styles.calloutBadgeText}>{stop.station.powerKW} kW {stop.station.type}</Text>
                  </View>
                </View>
                <Text style={styles.calloutDetails}>
                  Charge {stop.arrivalSoC}% → {stop.departureSoC}% (+{stop.energyAddedKWh} kWh)
                </Text>
                <Text style={styles.calloutDetails}>
                  ~{Math.round(stop.chargeTimeMinutes)} min charging stop
                </Text>
              </View>
            </Callout>
          </Marker>
        ))}

        {/* Destination Marker */}
        {destination && (
          <Marker
            coordinate={destination}
            title="Destination"
            description={
              !tripPlan || tripPlan.directRoute
                ? 'Reachable directly'
                : tripPlan.reachable
                ? `${tripPlan.stops.length} charging stop${tripPlan.stops.length > 1 ? 's' : ''} required`
                : 'Out of range — no viable charging route found'
            }
          >
            <View style={styles.destinationMarker}>
              <FontAwesome name="flag" size={12} color="#ffffff" />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Floating Station Detail Card (Smooth Slide-up & Fade-in animated) */}
      {renderedStation && (
        <Animated.View
          style={[
            styles.detailCard,
            {
              opacity: cardAnim,
              backgroundColor: cardBg,
              borderColor: cardBorder,
              transform: [
                {
                  translateY: cardAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [60, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.detailCardHeader}>
            <Text style={[styles.detailCardTitle, { color: textColor }]}>{renderedStation.name}</Text>
            <TouchableOpacity onPress={() => onSelectStation(null)} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.detailBadgeRow}>
            <View style={[styles.detailBadge, renderedStation.type === 'DC' ? styles.badgeDC : styles.badgeAC]}>
              <Text style={styles.detailBadgeText}>
                <FontAwesome name={renderedStation.type === 'DC' ? 'bolt' : 'plug'} size={10} color="#fff" />{' '}
                {renderedStation.type === 'DC' ? 'DC Fast' : 'AC Charge'}
              </Text>
            </View>
            <Text style={[styles.detailPower, { color: textColor }]}>{renderedStation.powerKW} kW</Text>
            {renderedStation.slots && (
              <Text style={[styles.detailDistance, { color: subTextColor }]}>
                <FontAwesome name="cube" size={10} color={subTextColor} /> {renderedStation.slots} {renderedStation.slots > 1 ? 'slots' : 'slot'}
              </Text>
            )}
            <Text style={[styles.detailDistance, { color: subTextColor }]}>
              <FontAwesome name="map-marker" size={10} color={subTextColor} /> {renderedStation.distanceKm.toFixed(1)} km
            </Text>
          </View>

          {renderedStation.operator && (
            <Text style={[styles.detailInfoText, { color: subTextColor }]}>
              <FontAwesome name="building-o" size={11} color={labelColor} /> <Text style={[styles.infoLabel, { color: labelColor }]}>Network: </Text>{renderedStation.operator}
            </Text>
          )}

          {renderedStation.address && (
            <Text style={[styles.detailInfoText, { color: subTextColor }]} numberOfLines={3}>
              <FontAwesome name="map-o" size={11} color={labelColor} /> <Text style={[styles.infoLabel, { color: labelColor }]}>Address: </Text>{renderedStation.address}
            </Text>
          )}

          {renderedStation.phone && (
            <Text style={[styles.detailInfoText, { color: subTextColor }]}>
              <FontAwesome name="phone" size={11} color={labelColor} /> <Text style={[styles.infoLabel, { color: labelColor }]}>Tel: </Text>{renderedStation.phone}
            </Text>
          )}

          <TouchableOpacity
            style={styles.directionsButton}
            onPress={() => {
              const url = buildGoogleMapsDirectionsUrl({
                latitude: renderedStation.latitude,
                longitude: renderedStation.longitude,
              });
              Linking.openURL(url).catch((err) =>
                Alert.alert('Error', 'Cannot open Google Maps: ' + err.message)
              );
            }}
          >
            <Text style={styles.directionsButtonText}>
              <FontAwesome name="location-arrow" size={12} color="#fff" />  Get Directions in Google Maps
            </Text>
          </TouchableOpacity>
        </Animated.View>
      )}


    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  floatingControls: {
    position: 'absolute',
    top: 120, // Relocated below header buttons on the top right
    right: 16,
    flexDirection: 'column',
    gap: 8,
    alignItems: 'flex-end',
  },
  floatingButton: {
    backgroundColor: mapColors.surfaceRaised,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonText: {
    color: mapColors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
  },
  stationMarker: {
    padding: 6,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: '#ffffff', // Fixed white ring — a map-marker convention independent of theme
    backgroundColor: mapColors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  stationDotMarker: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    backgroundColor: mapColors.surfaceRaised,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  dotSlotsText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: mapColors.textPrimary,
    marginLeft: 2,
  },
  markerDC: {
    borderColor: mapColors.chargerDC,
  },
  markerAC: {
    borderColor: mapColors.chargerAC,
  },
  markerEmoji: {
    fontSize: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 4,
  },
  innerStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusAvailable: {
    backgroundColor: mapColors.statusAvailable,
  },
  statusOccupied: {
    backgroundColor: mapColors.statusOccupied,
  },
  statusMaintenance: {
    backgroundColor: mapColors.statusMaintenance,
  },
  calloutContainer: {
    backgroundColor: mapColors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    width: 200,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  calloutTitle: {
    color: mapColors.textPrimary,
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 6,
  },
  calloutBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  calloutBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.xs,
  },
  calloutBadgeText: {
    color: mapColors.textPrimary,
    fontSize: 9,
    fontWeight: '700',
  },
  badgeDC: {
    backgroundColor: mapColors.chargerDC,
  },
  badgeAC: {
    backgroundColor: mapColors.chargerAC,
  },
  badgeAvailable: {
    backgroundColor: mapColors.statusAvailable,
  },
  badgeOccupied: {
    backgroundColor: mapColors.statusOccupied,
  },
  badgeMaintenance: {
    backgroundColor: mapColors.statusMaintenance,
  },
  calloutDetails: {
    color: mapColors.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
  calloutSubDetails: {
    color: mapColors.textTertiary,
    fontSize: 9,
    marginTop: 3,
  },
  detailCard: {
    position: 'absolute',
    bottom: 320, // Raised slightly to clear the floating car panel margins
    alignSelf: 'center',
    width: '90%',
    maxWidth: 450,
    backgroundColor: mapColors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: mapColors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 20,
  },
  detailCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  detailCardTitle: {
    color: mapColors.textPrimary,
    fontWeight: '700',
    fontSize: 15,
    flex: 1,
    marginRight: 8,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    color: mapColors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
  },
  detailBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  detailBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.xs,
  },
  detailBadgeText: {
    color: mapColors.textPrimary,
    fontSize: 10,
    fontWeight: '700',
  },
  detailPower: {
    color: mapColors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  detailDistance: {
    color: mapColors.textSecondary,
    fontSize: 11,
  },
  detailInfoText: {
    color: mapColors.textSecondary,
    fontSize: 11,
    marginTop: 4,
    lineHeight: 15,
  },
  infoLabel: {
    color: mapColors.textTertiary,
    fontWeight: '600',
  },
  directionsButton: {
    backgroundColor: mapColors.statusAvailable,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  directionsButtonText: {
    color: mapColors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  stopBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: mapColors.chargerAC,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  stopBadgeText: {
    color: mapColors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
  },
  destinationMarker: {
    backgroundColor: mapColors.statusOccupied,
    padding: 6,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  recenterButton: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 15,
  },
});
