import { MapCoordinates } from '../types/ev';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChargingStation, getDistanceKm, generateMockStations, samplePointsAlongRoute } from './StationGenerator';

// Register for a free key at https://openchargemap.org
// If empty, the service will fall back to using generateMockStations automatically so the app still works.
export const OPEN_CHARGE_MAP_API_KEY = process.env.EXPO_PUBLIC_OCM_API_KEY || '';

const DEFAULT_FETCH_TIMEOUT_MS = 4000;

/**
 * Loads persistent offline cached stations from AsyncStorage.
 */
export async function loadOfflineStations(): Promise<ChargingStation[]> {
  try {
    const cached = await AsyncStorage.getItem('OFFLINE_STATIONS_CACHE');
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn('[StationService] Failed to load offline stations:', e);
  }
  return [];
}

/**
 * Saves and merges new stations into the persistent offline cache in AsyncStorage.
 */
export async function saveOfflineStations(newStations: ChargingStation[]): Promise<void> {
  if (newStations.length === 0) return;
  try {
    const existing = await loadOfflineStations();
    const mergedMap = new Map<string, ChargingStation>();
    for (const s of existing) {
      mergedMap.set(s.id, s);
    }
    for (const s of newStations) {
      mergedMap.set(s.id, s);
    }
    const merged = Array.from(mergedMap.values());
    await AsyncStorage.setItem('OFFLINE_STATIONS_CACHE', JSON.stringify(merged));
  } catch (e) {
    console.warn('[StationService] Failed to save offline stations:', e);
  }
}

/**
 * Loads the list of centers that have already been queried from OCM/Google/OSM.
 */
export async function loadOfflineQueriedRegions(): Promise<MapCoordinates[]> {
  try {
    const cached = await AsyncStorage.getItem('OFFLINE_QUERIED_REGIONS_CACHE');
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn('[StationService] Failed to load offline queried regions:', e);
  }
  return [];
}

/**
 * Saves a new center into the list of queried regions.
 */
export async function saveOfflineQueriedRegion(center: MapCoordinates): Promise<void> {
  try {
    const existing = await loadOfflineQueriedRegions();
    // Prevent adding very close duplicates (within 5km)
    const isDuplicate = existing.some((c) => getDistanceKm(c, center) < 5);
    if (!isDuplicate) {
      existing.push(center);
      await AsyncStorage.setItem('OFFLINE_QUERIED_REGIONS_CACHE', JSON.stringify(existing));
    }
  } catch (e) {
    console.warn('[StationService] Failed to save offline queried region:', e);
  }
}

/**
 * `fetch` with a hard timeout. Plain `fetch()` has no timeout of its own — on a slow, flaky, or
 * filtering network (a public API domain like `overpass-api.de` is more likely to be blocked by
 * a corporate/carrier firewall than a well-known one), the request can hang indefinitely. Since
 * the station sources are combined with `Promise.all`, one hung request would stall the whole
 * fetch forever and the mock-data fallback would never get a chance to run — the map would just
 * never show any stations, with no error to explain why. Bounding every request fixes that.
 */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches real charging stations from the Open Charge Map API (PlugShare free alternative).
 * Falls back to mock stations if no API key is provided or the call fails.
 */
export async function getRealStations(
  center: MapCoordinates,
  maxRadiusKm: number,
  fallbackStations: ChargingStation[],
  maxResults: number = 40
): Promise<ChargingStation[]> {
  if (!OPEN_CHARGE_MAP_API_KEY) {
    console.log('[OpenChargeMap] No API Key found, using mock station data.');
    return fallbackStations;
  }

  // No countrycode filter here on purpose — the lat/lng + distance params already scope the
  // search geographically, and a hardcoded country code only ever discards otherwise-valid
  // results (e.g. anything OCM didn't happen to tag with that exact country).
  const url = `https://api.openchargemap.io/v3/poi?key=${OPEN_CHARGE_MAP_API_KEY}&latitude=${center.latitude}&longitude=${center.longitude}&distance=${maxRadiusKm}&distanceunit=KM&maxresults=${maxResults}`;

  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`API HTTP error: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return fallbackStations;
    }

    return data.map((poi: any, index: number) => {
      const lat = poi.AddressInfo?.Latitude;
      const lng = poi.AddressInfo?.Longitude;
      const name = poi.AddressInfo?.Title || 'EV Charger';

      // Check connections to see if DC fast charging is available (usually >= 50 kW is DC fast)
      const hasDC = poi.Connections?.some(
        (conn: any) => conn.PowerKW && conn.PowerKW >= 50
      ) || false;

      // Find max power rating across all connectors
      const maxPower = poi.Connections?.reduce(
        (max: number, conn: any) => Math.max(max, conn.PowerKW || 0),
        0
      ) || 22;

      // Determine operational status
      let status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE' = 'AVAILABLE';
      const statusType = poi.StatusType?.ID;
      if (statusType === 50) { // Under maintenance / Not Operational
        status = 'MAINTENANCE';
      } else if (statusType === 100) { // Occupied / In Use
        status = 'OCCUPIED';
      }

      // Extract address fields
      const addressLines = [
        poi.AddressInfo?.AddressLine1,
        poi.AddressInfo?.AddressLine2,
        poi.AddressInfo?.Town,
        poi.AddressInfo?.StateOrProvince
      ].filter(Boolean);
      const address = addressLines.join(', ') || undefined;

      // Extract Operator Title
      const operator = poi.OperatorInfo?.Title || undefined;

      // Extract Phone Info
      const phone = poi.AddressInfo?.ContactTelephone1 || undefined;

      // Calculate total charger slots
      const slots = poi.Connections?.reduce(
        (sum: number, conn: any) => sum + (conn.Quantity || 1),
        0
      ) || 1;

      return {
        id: `real-station-${poi.ID || index}`,
        name,
        latitude: lat,
        longitude: lng,
        type: hasDC ? 'DC' as const : 'AC' as const,
        powerKW: maxPower,
        status,
        distanceKm: getDistanceKm(center, { latitude: lat, longitude: lng }),
        address,
        operator,
        phone,
        slots,
      };
    }).filter((station) => station.distanceKm <= maxRadiusKm);
  } catch (error) {
    console.warn('[OpenChargeMap] Fetch failed. Falling back to mock stations:', error);
    return fallbackStations;
  }
}

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
// Overpass "around" queries scan raw OSM data rather than a distance-indexed database, so a
// country-wide radius can be slow or time out on the free public instance — but with request
// timeouts and a graceful fallback in place (see fetchWithTimeout / getAllRealStations), a slow
// query just degrades to OCM+mock rather than hanging the app. Raised close to the full
// country-wide radius so OSM's contribution isn't cut off partway through a large country
// (a 400km cap from a Bangkok-centered search excluded most of Thailand north-south).
const OVERPASS_MAX_RADIUS_KM = 800;

/**
 * Fetches EV charging points tagged directly in OpenStreetMap via the free, keyless Overpass
 * API. OSM's community-tagged data frequently covers locations Open Charge Map's curated
 * database doesn't have yet — a second, independent source to widen real-world coverage.
 *
 * Matches both the standard `amenity=charging_station` tag and `amenity=fuel` stations with a
 * `fuel:electricity=yes` sub-tag — in Thailand (and elsewhere) EV chargers are frequently added
 * at existing PTT/gas station sites under the latter tagging rather than as a standalone POI.
 *
 * Data quality varies (power/connector tags aren't always present), so unspecified specs fall
 * back to reasonable defaults rather than being dropped.
 */
export async function getOverpassStations(
  center: MapCoordinates,
  maxRadiusKm: number
): Promise<ChargingStation[]> {
  const radiusKm = Math.min(maxRadiusKm, OVERPASS_MAX_RADIUS_KM);
  const radiusMeters = Math.round(radiusKm * 1000);
  const around = `around:${radiusMeters},${center.latitude},${center.longitude}`;
  const query =
    `[out:json][timeout:25];` +
    `(node["amenity"="charging_station"](${around});` +
    `way["amenity"="charging_station"](${around});` +
    `node["amenity"="fuel"]["fuel:electricity"="yes"](${around});` +
    `way["amenity"="fuel"]["fuel:electricity"="yes"](${around}););` +
    `out center;`;

  try {
    const response = await fetchWithTimeout(
      `${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': 'EVRangeRadiusApp/1.0.0 (https://github.com/tsnuttakorn/ev-range-radius-app)',
        },
      },
      4000
    );
    if (!response.ok) {
      throw new Error(`Overpass HTTP error: ${response.status}`);
    }
    const data = await response.json();
    const elements: any[] = Array.isArray(data.elements) ? data.elements : [];

    return elements
      .map((el, index): ChargingStation | null => {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (typeof lat !== 'number' || typeof lng !== 'number') return null;

        const tags: Record<string, string> = el.tags || {};
        const name = tags.name || tags.operator || tags.brand || 'EV Charger (OSM)';

        // Best-effort DC-fast classification from whichever connector tags are present.
        const tagText = Object.keys(tags).join(' ').toLowerCase();
        const isDC = /chademo|combo|ccs|supercharger/.test(tagText);

        // Best-effort peak power from any "*output*" tag, e.g. "socket:ccs:output" = "50 kW".
        let maxPower = 0;
        for (const [key, value] of Object.entries(tags)) {
          if (/output/i.test(key)) {
            const match = value.match(/([\d.]+)\s*kw/i);
            if (match) maxPower = Math.max(maxPower, parseFloat(match[1]));
          }
        }
        if (maxPower <= 0) maxPower = isDC ? 50 : 22; // sensible default when unspecified

        const address =
          [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ') || undefined;

        return {
          id: `osm-station-${el.id ?? index}`,
          name,
          latitude: lat,
          longitude: lng,
          type: isDC ? ('DC' as const) : ('AC' as const),
          powerKW: maxPower,
          status: 'AVAILABLE' as const, // OSM doesn't carry reliable live occupancy data
          distanceKm: getDistanceKm(center, { latitude: lat, longitude: lng }),
          address,
          operator: tags.operator || undefined,
          phone: tags.phone || tags['contact:phone'] || undefined,
          slots: 1,
        };
      })
      .filter((station): station is ChargingStation => station !== null && station.distanceKm <= maxRadiusKm);
  } catch (error) {
    console.warn('[Overpass] Failed to fetch OSM charging stations:', error);
    return [];
  }
}

let sessionGoogleApiCallCount = 0;
const MAX_SESSION_GOOGLE_CALLS = 80; // Safeguard limit to protect user's billing

// Billing Emergency Lock parameters to catch rapid rendering loops
let requestCountInLastWindow = 0;
let windowStartTime = 0;
const RATE_LIMIT_WINDOW_MS = 5000; // 5 seconds
const MAX_REQUESTS_IN_WINDOW = 15;  // Max 15 requests in 5 seconds to accommodate multi-stop trip planning
let isEmergencyLocked = false;

/**
 * Fetches EV charging stations from the Google Places API (Nearby Search) using
 * the user-provided Google Maps API key.
 */
export async function getGooglePlacesStations(
  center: MapCoordinates,
  maxRadiusKm: number
): Promise<ChargingStation[]> {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || apiKey === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
    return [];
  }

  // Load offline stations and queried regions to see if we already have this region cached
  const offline = await loadOfflineStations();
  const localOfflineDC = offline
    .filter((s) => s.type === 'DC' && getDistanceKm(center, s) <= maxRadiusKm)
    .map((s) => ({ ...s, distanceKm: getDistanceKm(center, s) }));

  const queriedRegions = await loadOfflineQueriedRegions();
  const isRegionCached = queriedRegions.some((r) => getDistanceKm(r, center) < 20);

  if (isRegionCached) {
    console.log('[Offline Cache] Google Places region cached. Returning offline DC stations:', localOfflineDC.length);
    return localOfflineDC;
  }

  const now = Date.now();

  if (isEmergencyLocked) {
    console.warn('[Google Places] API is emergency locked to protect billing.');
    return [];
  }

  // Rate limiting check
  if (now - windowStartTime > RATE_LIMIT_WINDOW_MS) {
    windowStartTime = now;
    requestCountInLastWindow = 0;
  }

  requestCountInLastWindow++;

  if (requestCountInLastWindow > MAX_REQUESTS_IN_WINDOW) {
    isEmergencyLocked = true;
    console.error('[Google Places] EMERGENCY LOCK TRIGGERED: Too many API requests in a short time. Blocking Places API.');
    Alert.alert(
      'Billing Emergency Lock',
      'The app detected unusually high API activity (potential rendering loop) and has locked Google Places API to protect your billing. Free stations are still active.',
      [{ text: 'OK' }]
    );
    return [];
  }

  if (sessionGoogleApiCallCount >= MAX_SESSION_GOOGLE_CALLS) {
    console.warn(`[Google Places] Safeguard triggered: Limit of ${MAX_SESSION_GOOGLE_CALLS} requests reached. Skipping Places query.`);
    if (sessionGoogleApiCallCount === MAX_SESSION_GOOGLE_CALLS) {
      Alert.alert(
        'Billing Safeguard Active',
        'Google Places API calls have been paused for this session to prevent unexpected charges. Free stations are still active.',
        [{ text: 'OK' }]
      );
      sessionGoogleApiCallCount++; // Increment to only alert once
    }
    return [];
  }

  sessionGoogleApiCallCount++;

  const radiusMeters = Math.min(Math.round(maxRadiusKm * 1000), 50000); // Google Places maximum radius is 50,000 meters
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${center.latitude},${center.longitude}&radius=${radiusMeters}&type=charging_station&key=${apiKey}`;

  try {
    const response = await fetchWithTimeout(url, {}, 5000);
    if (!response.ok) {
      throw new Error(`Google Places HTTP error: ${response.status}`);
    }
    const data = await response.json();
    if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'REQUEST_DENIED') {
      console.warn('[Google Places] API status:', data.status, 'Message:', data.error_message);
      Alert.alert(
        'Google API Notice',
        `Google API status: ${data.status}. App will fall back to free offline/free charging databases.`,
        [{ text: 'OK' }]
      );
      return [];
    }
    if (data.status && data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn('[Google Places] API returned status:', data.status, 'Error message:', data.error_message);
    }
    const results = Array.isArray(data.results) ? data.results : [];
    console.log(`[Google Places] Fetched ${results.length} DC stations near`, center);

    const stations = results.map((place: any): ChargingStation => {
      const lat = place.geometry?.location?.lat;
      const lng = place.geometry?.location?.lng;
      const distanceKm = getDistanceKm(center, { latitude: lat, longitude: lng });

      return {
        id: `google-${place.place_id}`,
        name: place.name || 'EV Charging Station (Google)',
        latitude: lat,
        longitude: lng,
        type: 'DC', // Explicitly DC as requested
        powerKW: 120, // Default to a standard DC fast charging power in kW
        status: 'AVAILABLE' as const,
        distanceKm,
        operator: place.vicinity || 'Google Places',
      };
    });

    if (stations.length > 0) {
      await saveOfflineStations(stations);
      await saveOfflineQueriedRegion(center);
    }

    return stations;
  } catch (error) {
    console.warn('[Google Places] Failed to fetch EV stations:', error);
    return [];
  }
}


const SAME_LOCATION_KM = 0.05; // ~50m — treat as the same physical charger
// Grid cell sized to roughly match the dedupe threshold (~55m of latitude at the equator), so
// each candidate only ever needs to check its own cell + immediate neighbors instead of every
// station collected so far.
const DEDUPE_CELL_DEG = 0.0005;

const cellKey = (lat: number, lng: number): string => `${Math.floor(lat / DEDUPE_CELL_DEG)}_${Math.floor(lng / DEDUPE_CELL_DEG)}`;

/**
 * Merges two station lists, deduping physically-identical chargers (the same real-world
 * location tagged in both datasets) by proximity. Kept as a pure, network-free function so it's
 * directly load-testable with large synthetic datasets.
 *
 * Uses a spatial grid bucket rather than comparing every candidate against every already-merged
 * station: with up to hundreds of stations from each of two sources, a naive O(n·m) nested loop
 * (each comparison involving a haversine calculation) becomes a real, measurable CPU cost on
 * every fetch. Bucketing by a grid cell sized to the dedupe threshold makes each lookup check a
 * small, roughly-constant number of neighbors instead of the entire accumulated list — O(n+m)
 * in practice for realistically-distributed station data.
 */
export function mergeStationSources(
  primary: ChargingStation[],
  secondary: ChargingStation[],
  maxResults: number
): ChargingStation[] {
  const buckets = new Map<string, ChargingStation[]>();
  const addToBucket = (station: ChargingStation) => {
    const key = cellKey(station.latitude, station.longitude);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(station);
    else buckets.set(key, [station]);
  };
  primary.forEach(addToBucket);

  const merged = [...primary];
  for (const candidate of secondary) {
    const cellLat = Math.floor(candidate.latitude / DEDUPE_CELL_DEG);
    const cellLng = Math.floor(candidate.longitude / DEDUPE_CELL_DEG);

    let isDuplicate = false;
    for (let dLat = -1; dLat <= 1 && !isDuplicate; dLat++) {
      for (let dLng = -1; dLng <= 1 && !isDuplicate; dLng++) {
        const neighbors = buckets.get(`${cellLat + dLat}_${cellLng + dLng}`);
        if (!neighbors) continue;
        isDuplicate = neighbors.some((existing) => getDistanceKm(existing, candidate) < SAME_LOCATION_KM);
      }
    }

    if (!isDuplicate) {
      merged.push(candidate);
      addToBucket(candidate);
    }
  }

  return merged.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, maxResults);
}

// Corridor sampling: instead of one big-radius fetch centered on wherever the vehicle currently
// sits (which, on a country-wide search, still truncates to the closest `maxResults` stations to
// that single center — see `mergeStationSources` below — and starves anything near the far end of
// a long trip), fan queries out to points spaced along the *actual route* the trip planner will
// drive. Each waypoint gets its own small radius + result budget, so density near the origin can
// no longer crowd out coverage near the destination.
const CORRIDOR_SAMPLE_INTERVAL_KM = 150; // one waypoint roughly every 150km of route
const CORRIDOR_SAMPLE_RADIUS_KM = 100; // generous enough to catch stations just off the route
const CORRIDOR_SAMPLE_MAX_RESULTS = 60; // per-waypoint budget, independent of every other waypoint
const CORRIDOR_MAX_SAMPLES = 12; // safety cap: at 150km spacing this covers ~1,800km of route

/**
 * Fetches charging stations along an entire route corridor by sampling waypoints spaced roughly
 * `CORRIDOR_SAMPLE_INTERVAL_KM` apart (always including the origin and destination) and querying
 * Open Charge Map + OSM/Overpass around each one independently, then merging/deduping the results.
 *
 * Deliberately skips Google Places here — it's a paid, rate-limited source already queried
 * per-hop by the trip planner itself (see `EVMapAdapter`'s `fetchStations`), and firing it once
 * per corridor waypoint on every trip plan would multiply that cost for comparatively little gain
 * over the two free sources.
 *
 * If a waypoint comes back with no real data at all (typically: fully offline, or no API keys
 * configured — the common first-launch state), it's seeded with deterministic mock stations
 * local to that waypoint rather than left as a dead zone, so a long trip on a fresh install still
 * has *something* to plan a route through instead of failing outright partway along.
 */
export async function getCorridorStations(
  routeCoordinates: MapCoordinates[],
  maxSamples: number = CORRIDOR_MAX_SAMPLES
): Promise<ChargingStation[]> {
  const samplePoints = samplePointsAlongRoute(routeCoordinates, CORRIDOR_SAMPLE_INTERVAL_KM, maxSamples);
  if (samplePoints.length === 0) return [];

  const offline = await loadOfflineStations();

  const perPointResults = await Promise.all(
    samplePoints.map(async (point) => {
      const localOffline = offline
        .filter((s) => getDistanceKm(point, s) <= CORRIDOR_SAMPLE_RADIUS_KM)
        .map((s) => ({ ...s, distanceKm: getDistanceKm(point, s) }));

      const [ocmStations, osmStations] = await Promise.all([
        getRealStations(point, CORRIDOR_SAMPLE_RADIUS_KM, [], CORRIDOR_SAMPLE_MAX_RESULTS),
        getOverpassStations(point, CORRIDOR_SAMPLE_RADIUS_KM),
      ]);

      let merged = mergeStationSources(localOffline, ocmStations, CORRIDOR_SAMPLE_MAX_RESULTS);
      merged = mergeStationSources(merged, osmStations, CORRIDOR_SAMPLE_MAX_RESULTS);

      if (merged.length === 0) {
        merged = generateMockStations(point, CORRIDOR_SAMPLE_RADIUS_KM);
      }

      return merged;
    })
  );

  let combined: ChargingStation[] = [];
  for (const stations of perPointResults) {
    combined = mergeStationSources(combined, stations, combined.length + stations.length);
  }

  if (combined.length > 0) {
    await saveOfflineStations(combined);
  }

  return combined;
}

/**
 * Combines Open Charge Map and OpenStreetMap/Overpass results for wider real-world coverage
 * than either source alone, preferring the Open Charge Map entry on duplicates since it
 * typically carries richer metadata (live status, operator, phone). Falls back to mock data
 * only if both real sources come back empty.
 */
export async function getAllRealStations(
  center: MapCoordinates,
  maxRadiusKm: number,
  fallbackStations: ChargingStation[],
  maxResults: number = 40
): Promise<ChargingStation[]> {
  const offline = await loadOfflineStations();
  const localOffline = offline
    .filter((s) => getDistanceKm(center, s) <= maxRadiusKm)
    .map((s) => ({ ...s, distanceKm: getDistanceKm(center, s) }));

  const queriedRegions = await loadOfflineQueriedRegions();
  const isRegionCached = queriedRegions.some((r) => getDistanceKm(r, center) < 20);

  if (isRegionCached && localOffline.length > 0) {
    console.log('[Offline Cache] Region already queried. Serving from local storage:', localOffline.length);
    return localOffline.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, maxResults);
  }

  const [ocmStations, osmStations, googleStations] = await Promise.all([
    getRealStations(center, maxRadiusKm, [], maxResults),
    getOverpassStations(center, maxRadiusKm),
    getGooglePlacesStations(center, maxRadiusKm),
  ]);

  let merged = mergeStationSources(ocmStations, osmStations, maxResults);
  merged = mergeStationSources(merged, googleStations, maxResults);
  
  const finalStations = merged.length > 0 ? merged : fallbackStations;

  if (merged.length > 0) {
    await saveOfflineStations(merged);
    await saveOfflineQueriedRegion(center);
  }

  const combined = mergeStationSources(localOffline, finalStations, maxResults);
  return combined;
}
