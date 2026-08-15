import { MapCoordinates } from '../types/ev';

export interface ChargingStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type: 'AC' | 'DC';
  powerKW: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE';
  distanceKm: number;
  address?: string;
  operator?: string;
  phone?: string;
  slots?: number;
}

/**
 * Calculates the estimated real-world driving road distance in kilometers between two coordinates.
 * Applies a standard road network circuity factor (~1.27) to the straight-line Haversine distance.
 */
export function getDistanceKm(c1: MapCoordinates, c2: MapCoordinates): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((c2.latitude - c1.latitude) * Math.PI) / 180;
  const dLng = ((c2.longitude - c1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((c1.latitude * Math.PI) / 180) *
      Math.cos((c2.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const straightLine = R * c;
  
  // Real road circuity factor (averages 1.27x straight-line distance in real road networks)
  return straightLine * 1.27;
}

/**
 * Recomputes each station's `distanceKm` relative to an arbitrary reference point and
 * filters to those within range. Used by the trip planner to reuse one broad, pre-fetched
 * station list at every simulated hop along a route instead of re-querying the network.
 */
export function withinRadiusOf(
  stations: ChargingStation[],
  point: MapCoordinates,
  maxRadiusKm: number
): ChargingStation[] {
  return stations
    .map((station) => ({
      ...station,
      distanceKm: getDistanceKm(point, { latitude: station.latitude, longitude: station.longitude }),
    }))
    .filter((station) => station.distanceKm <= maxRadiusKm);
}

/**
 * Picks waypoints spaced roughly `intervalKm` apart along a route polyline (always including the
 * start and end), capped at `maxSamples` points. Used to fan station-source queries out along the
 * whole corridor of a long trip instead of a single fetch centered on the origin — a fetch that
 * only ever has a fixed radius/result budget and structurally can't cover the far end of a
 * multi-hundred-km trip once that budget is spent near the start.
 */
export function samplePointsAlongRoute(
  coordinates: MapCoordinates[],
  intervalKm: number,
  maxSamples: number
): MapCoordinates[] {
  if (coordinates.length === 0 || maxSamples <= 0) return [];

  const points: MapCoordinates[] = [coordinates[0]];
  let accumulated = 0;

  for (let i = 0; i < coordinates.length - 1 && points.length < maxSamples; i++) {
    accumulated += getDistanceKm(coordinates[i], coordinates[i + 1]);
    if (accumulated >= intervalKm) {
      points.push(coordinates[i + 1]);
      accumulated = 0;
    }
  }

  const last = coordinates[coordinates.length - 1];
  if (points.length < maxSamples && getDistanceKm(points[points.length - 1], last) > 1) {
    points.push(last);
  }

  return points;
}

/**
 * Deterministically generates mock EV charging stations around a given coordinate.
 * Uses math coordinate offsets so the same pin location always yields the same nearby stations.
 */
export function generateMockStations(center: MapCoordinates, maxRadiusKm: number): ChargingStation[] {
  const stations: ChargingStation[] = [];
  
  // Deterministic mock templates
  const stationTemplates = [
    { name: 'PEA Volta Supercharger', type: 'DC' as const, powerKW: 120, status: 'AVAILABLE' as const, angle: 30, distFrac: 0.25 },
    { name: 'EA Anywhere Charging Station', type: 'AC' as const, powerKW: 22, status: 'OCCUPIED' as const, angle: 120, distFrac: 0.4 },
    { name: 'Tesla Supercharger V4', type: 'DC' as const, powerKW: 250, status: 'AVAILABLE' as const, angle: 210, distFrac: 0.15 },
    { name: 'MG Super Charge', type: 'DC' as const, powerKW: 120, status: 'MAINTENANCE' as const, angle: 285, distFrac: 0.6 },
    { name: 'PTT EV Station PluZ', type: 'AC' as const, powerKW: 22, status: 'AVAILABLE' as const, angle: 75, distFrac: 0.75 },
    { name: 'Shell Recharge Hub', type: 'DC' as const, powerKW: 180, status: 'AVAILABLE' as const, angle: 160, distFrac: 0.5 },
    { name: 'Evolt Charging Station', type: 'AC' as const, powerKW: 11, status: 'OCCUPIED' as const, angle: 340, distFrac: 0.35 },
    { name: 'EleX by EGAT Supercharger', type: 'DC' as const, powerKW: 150, status: 'AVAILABLE' as const, angle: 245, distFrac: 0.8 },
  ];

  const earthRadius = 6371;
  const latRad = (center.latitude * Math.PI) / 180;
  const lngRad = (center.longitude * Math.PI) / 180;

  stationTemplates.forEach((template, index) => {
    // Determine the distance based on the max radius of the vehicle
    const targetDistanceKm = maxRadiusKm * template.distFrac;
    
    // Convert distance and bearing (angle) to GPS offsets
    const bearingRad = (template.angle * Math.PI) / 180;
    const distRatio = targetDistanceKm / earthRadius;

    const destLatRad = Math.asin(
      Math.sin(latRad) * Math.cos(distRatio) +
        Math.cos(latRad) * Math.sin(distRatio) * Math.cos(bearingRad)
    );
    const destLngRad =
      lngRad +
      Math.atan2(
        Math.sin(bearingRad) * Math.sin(distRatio) * Math.cos(latRad),
        Math.cos(distRatio) - Math.sin(latRad) * Math.sin(destLatRad)
      );

    const latitude = (destLatRad * 180) / Math.PI;
    const longitude = (destLngRad * 180) / Math.PI;

    stations.push({
      id: `station-${index}-${center.latitude.toFixed(4)}-${center.longitude.toFixed(4)}`,
      name: template.name,
      latitude,
      longitude,
      type: template.type,
      powerKW: template.powerKW,
      status: template.status,
      distanceKm: getDistanceKm(center, { latitude, longitude }),
    });
  });

  // Only return stations that are strictly within the reachable max radius range
  return stations.filter((station) => station.distanceKm <= maxRadiusKm);
}
