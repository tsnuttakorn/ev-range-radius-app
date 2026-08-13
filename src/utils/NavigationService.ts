import { MapCoordinates } from '../types/ev';

const coordParam = (c: MapCoordinates): string => `${c.latitude},${c.longitude}`;

/**
 * Builds a Google Maps "directions" deep link for a driving route, optionally including
 * intermediate stops (e.g. charging stations) as waypoints in order. Works as a universal
 * link — opens the Google Maps app if installed (with free turn-by-turn/voice guidance),
 * or falls back to Google Maps in the browser otherwise. Supports up to ~9 waypoints, well
 * above the trip planner's stop cap.
 *
 * `origin` is optional: omit it to let Google Maps use the device's live GPS location as the
 * starting point (the usual "get directions to this single place" case).
 */
export function buildGoogleMapsDirectionsUrl(
  destination: MapCoordinates,
  options?: { origin?: MapCoordinates; waypoints?: MapCoordinates[] }
): string {
  const params: string[] = ['api=1', `destination=${encodeURIComponent(coordParam(destination))}`, 'travelmode=driving'];
  if (options?.origin) {
    params.push(`origin=${encodeURIComponent(coordParam(options.origin))}`);
  }
  if (options?.waypoints && options.waypoints.length > 0) {
    params.push(`waypoints=${encodeURIComponent(options.waypoints.map(coordParam).join('|'))}`);
  }
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}
