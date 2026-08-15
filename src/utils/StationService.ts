import { MapCoordinates } from '../types/ev';
import { ChargingStation, getDistanceKm } from './StationGenerator';

// Register for a free key at https://openchargemap.org
// If empty, the service will fall back to using generateMockStations automatically so the app still works.
export const OPEN_CHARGE_MAP_API_KEY = process.env.EXPO_PUBLIC_OCM_API_KEY || '';

const DEFAULT_FETCH_TIMEOUT_MS = 4000;

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
    // Overpass itself is asked for a server-side timeout; this client-side backstop is set
    // to 4 seconds to avoid blocking the app interface on slow public instances.
    const response = await fetchWithTimeout(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`, {}, 4000);
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
  const [ocmStations, osmStations] = await Promise.all([
    getRealStations(center, maxRadiusKm, [], maxResults),
    getOverpassStations(center, maxRadiusKm),
  ]);

  const merged = mergeStationSources(ocmStations, osmStations, maxResults);
  return merged.length > 0 ? merged : fallbackStations;
}
