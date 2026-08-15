import { samplePointsAlongRoute } from '../StationGenerator';
import { MapCoordinates } from '../../types/ev';

/** Builds a straight-line route of `totalKm` roughly along a meridian, one point per km. */
function buildStraightRoute(totalKm: number): MapCoordinates[] {
  const points: MapCoordinates[] = [];
  for (let i = 0; i <= totalKm; i++) {
    points.push({ latitude: 13.75 + i / 111, longitude: 100.5 });
  }
  return points;
}

describe('samplePointsAlongRoute', () => {
  it('returns an empty array for an empty route', () => {
    expect(samplePointsAlongRoute([], 150, 12)).toEqual([]);
  });

  it('always includes the start and end of the route', () => {
    const route = buildStraightRoute(1000);
    const samples = samplePointsAlongRoute(route, 150, 12);

    expect(samples[0]).toEqual(route[0]);
    expect(samples[samples.length - 1]).toEqual(route[route.length - 1]);
  });

  it('spaces samples out so a long trip gets coverage past the first interval, not just near the origin', () => {
    const route = buildStraightRoute(1000);
    const samples = samplePointsAlongRoute(route, 150, 12);

    // A 1000km route at 150km spacing should produce multiple waypoints beyond the first 200km —
    // this is the corridor-sampling behavior a single origin-centered radius fetch can't provide.
    const farSamples = samples.filter((p) => (p.latitude - route[0].latitude) * 111 > 200);
    expect(farSamples.length).toBeGreaterThan(3);
    expect(samples.length).toBeGreaterThan(5);
  });

  it('respects the maxSamples cap', () => {
    const route = buildStraightRoute(3000);
    const samples = samplePointsAlongRoute(route, 150, 5);

    expect(samples.length).toBeLessThanOrEqual(5);
  });

  it('does not sample beyond a short route', () => {
    const route = buildStraightRoute(50);
    const samples = samplePointsAlongRoute(route, 150, 12);

    // Shorter than one interval — start and end only (deduped if effectively the same point).
    expect(samples.length).toBeLessThanOrEqual(2);
  });
});
