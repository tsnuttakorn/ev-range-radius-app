import { MapCoordinates } from '../types/ev';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 3000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

export interface RouteData {
  coordinates: MapCoordinates[];
  distanceKm: number;
}

// OpenRouteService's free tier caps distance-type isochrones at 120km regardless of profile
// (confirmed empirically — the API rejects anything above this with a 400). Ranges beyond it are
// extrapolated rather than requested outright; see fetchIsochronePolygon.
const ORS_MAX_RANGE_KM = 120;
const ORS_ISOCHRONES_URL = 'https://api.openrouteservice.org/v2/isochrones/driving-car';
const EARTH_RADIUS_KM = 6371;

/** Bearing (radians) and great-circle distance (km) of `point` from `center`. */
function bearingAndDistanceFromCenter(
  center: MapCoordinates,
  point: MapCoordinates
): { bearingRad: number; distanceKm: number } {
  const lat1 = (center.latitude * Math.PI) / 180;
  const lat2 = (point.latitude * Math.PI) / 180;
  const dLon = ((point.longitude - center.longitude) * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingRad = Math.atan2(y, x);

  const dLat = lat2 - lat1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const distanceKm = EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return { bearingRad, distanceKm };
}

/** Point at `distanceKm` along `bearingRad` from `center`. */
function destinationPoint(center: MapCoordinates, bearingRad: number, distanceKm: number): MapCoordinates {
  const latRad = (center.latitude * Math.PI) / 180;
  const lngRad = (center.longitude * Math.PI) / 180;
  const distRatio = distanceKm / EARTH_RADIUS_KM;

  const destLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(distRatio) + Math.cos(latRad) * Math.sin(distRatio) * Math.cos(bearingRad)
  );
  const destLngRad =
    lngRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(distRatio) * Math.cos(latRad),
      Math.cos(distRatio) - Math.sin(latRad) * Math.sin(destLatRad)
    );

  return { latitude: (destLatRad * 180) / Math.PI, longitude: (destLngRad * 180) / Math.PI };
}

/**
 * Stretches every vertex of a real isochrone ring radially outward from `center` by `scale`,
 * preserving its actual directional shape (which roads run where, what water/terrain cuts it
 * short) — used when the requested range exceeds ORS's free-tier distance cap. This is an
 * approximation beyond the cap, but a road-shape-informed one, not a random simulation.
 */
function scaleRingFromCenter(center: MapCoordinates, ring: MapCoordinates[], scale: number): MapCoordinates[] {
  return ring.map((point) => {
    const { bearingRad, distanceKm } = bearingAndDistanceFromCenter(center, point);
    return destinationPoint(center, bearingRad, distanceKm * scale);
  });
}

/**
 * Decodes a Google Maps encoded polyline string into an array of MapCoordinates.
 */
function decodePolyline(encoded: string): MapCoordinates[] {
  const points: MapCoordinates[] = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    points.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5
    });
  }
  return points;
}

/**
 * Fetches real street routing geometry and road distance between two points using Google Directions (preferred) or OSRM (fallback).
 */
export async function fetchRealRoute(
  start: MapCoordinates,
  end: MapCoordinates
): Promise<RouteData | null> {
  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  
  if (apiKey && apiKey !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
    // Google Maps Directions API is highly robust and easily handles long-distance routes (1000km+)
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.latitude},${start.longitude}&destination=${end.latitude},${end.longitude}&key=${apiKey}`;
    try {
      const response = await fetchWithTimeout(url, {}, 4000);
      if (!response.ok) {
        throw new Error(`Google Directions HTTP error: ${response.status}`);
      }
      const data = await response.json();
      if (data.status === 'OK' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const encodedPolyline = route.overview_polyline?.points;
        const coords = encodedPolyline ? decodePolyline(encodedPolyline) : [];
        const distanceKm = route.legs.reduce((sum: number, leg: any) => sum + (leg.distance?.value ?? 0), 0) / 1000;
        
        return {
          coordinates: coords,
          distanceKm,
        };
      } else {
        console.warn('[RouteService] Google Directions failed with status:', data.status, data.error_message);
      }
    } catch (error) {
      console.warn('[RouteService] Google Directions failed, falling back to OSRM:', error);
    }
  }

  // Fallback to OSRM
  const url = `https://router.project-osrm.org/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;
  
  try {
    const response = await fetchWithTimeout(url, {}, 3000);
    if (!response.ok) {
      throw new Error(`OSRM HTTP error: ${response.status}`);
    }
    const data = await response.json();
    if (!data.routes || data.routes.length === 0) {
      return null;
    }
    const route = data.routes[0];
    const coords = route.geometry.coordinates.map((coord: [number, number]) => ({
      latitude: coord[1],
      longitude: coord[0],
    }));
    return {
      coordinates: coords,
      distanceKm: route.distance / 1000, // convert meters to km
    };
  } catch (error) {
    console.warn('[RouteService] Failed to fetch OSRM driving route:', error);
    return null;
  }
}

/**
 * Fetches a real road-network reachability polygon (isochrone) from OpenRouteService — the actual
 * area drivable within `rangeKm`, following real roads, rather than a straight-line radius.
 *
 * Requires a free ORS API key (openrouteservice.org — free signup, no card, 2000 req/day) set as
 * `EXPO_PUBLIC_ORS_API_KEY`. Returns null (caller should fall back to the offline simulated
 * polygon) when no key is configured, the range is non-positive, or the request fails for any
 * reason — this must never crash the map.
 *
 * ORS's free tier caps distance-type isochrones at 120km, well under most EV ranges, so anything
 * beyond that is requested at the 120km cap and the resulting real polygon is stretched radially
 * outward to the actual range (see scaleRingFromCenter) — still shaped by real roads near the
 * vehicle, just extrapolated further out.
 */
export async function fetchIsochronePolygon(
  center: MapCoordinates,
  rangeKm: number
): Promise<MapCoordinates[] | null> {
  // Commented out ORS API call as requested, returning null to force fallback.
  return null;

  /*
  const apiKey = process.env.EXPO_PUBLIC_ORS_API_KEY;
  if (!apiKey || rangeKm <= 0) return null;

  const cappedRangeKm = Math.min(rangeKm, ORS_MAX_RANGE_KM);

  try {
    const response = await fetchWithTimeout(ORS_ISOCHRONES_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locations: [[center.longitude, center.latitude]],
        range: [cappedRangeKm * 1000],
        range_type: 'distance',
        smoothing: 25,
      }),
    }, 3000);
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No detail');
      throw new Error(`ORS isochrones HTTP error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const geometry = data?.features?.[0]?.geometry;
    if (!geometry) return null;

    // Isochrones are normally a single Polygon, but ORS can return a MultiPolygon when the
    // reachable area is split (e.g. by water) — take the largest ring as the representative shape.
    let ring: [number, number][] | undefined;
    if (geometry.type === 'Polygon') {
      ring = geometry.coordinates?.[0];
    } else if (geometry.type === 'MultiPolygon') {
      ring = [...geometry.coordinates]
        .map((polygon: [number, number][][]) => polygon[0])
        .sort((a: [number, number][], b: [number, number][]) => b.length - a.length)[0];
    }
    if (!ring || ring.length === 0) return null;

    const coords = ring.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
    return rangeKm > ORS_MAX_RANGE_KM ? scaleRingFromCenter(center, coords, rangeKm / cappedRangeKm) : coords;
  } catch (error) {
    console.warn('[RouteService] Failed to fetch ORS isochrone, falling back to simulated polygon:', error);
    return null;
  }
  */
}

/**
 * Searches for coordinates by text input using OpenStreetMap's Nominatim geocoding engine.
 */
export async function searchLocations(query: string): Promise<any[]> {
  if (!query || query.trim().length < 2) return [];
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'EV-Range-Trip-Planner', // Nominatim requests a custom user-agent
      },
    });
    if (!response.ok) {
      throw new Error(`Geocoding HTTP error: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('[RouteService] Nominatim geocoding failed:', error);
    return [];
  }
}
