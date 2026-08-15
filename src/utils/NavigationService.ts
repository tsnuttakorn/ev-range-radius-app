import { MapCoordinates } from '../types/ev';

const coordParam = (c: MapCoordinates): string => `${c.latitude},${c.longitude}`;

/**
 * Builds a Google Maps "directions" deep link for a driving route, optionally including
 * intermediate stops (e.g. charging stations) as waypoints in order. Works as a universal
 * link — opens the Google Maps app if installed (with free turn-by-turn/voice guidance),
 * or falls back to Google Maps in the browser otherwise. Google Maps' own free/web waypoint
 * limit (commonly ~9-10) is below the trip planner's stop cap for a long enough multi-stop
 * trip, in which case Google Maps itself is the one that truncates the list — nothing further
 * to do about that from here.
 *
 * `origin` is optional: omit it to let Google Maps use the device's live GPS location as the
 * starting point (the usual "get directions to this single place" case).
 */
export function buildGoogleMapsDirectionsUrl(
  destination: MapCoordinates,
  options?: { origin?: MapCoordinates; waypoints?: MapCoordinates[] }
): string {
  const params: string[] = [
    'api=1',
    `destination=${encodeURIComponent(coordParam(destination))}`,
    'travelmode=driving',
    // Requests the Google Maps app jump straight into turn-by-turn navigation instead of
    // stopping on the route-preview screen first (an extra tap otherwise needed on every trip).
    'dir_action=navigate',
  ];
  if (options?.origin) {
    params.push(`origin=${encodeURIComponent(coordParam(options.origin))}`);
  }
  if (options?.waypoints && options.waypoints.length > 0) {
    // `optimize:false` is required — without it, Google Maps silently reorders the waypoints
    // for the shortest overall route, discarding the range-constrained charging-stop order the
    // trip planner actually computed (a station visited "out of order" can easily be
    // unreachable, or reachable but stranding the driver afterward).
    const waypointsParam = ['optimize:false', ...options.waypoints.map(coordParam)].join('|');
    params.push(`waypoints=${encodeURIComponent(waypointsParam)}`);
  }
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}
