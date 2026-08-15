import { samplePointsAlongRoute, inferIsTeslaOnly, isTeslaVehicle, generateMockStations } from '../StationGenerator';
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

describe('inferIsTeslaOnly', () => {
  it('flags a station that only mentions a Tesla connector', () => {
    expect(inferIsTeslaOnly('Tesla Supercharger - CentralWorld')).toBe(true);
    expect(inferIsTeslaOnly('Some Station Tesla (Model 3)')).toBe(true);
  });

  it('does not flag a station whose name merely contains "Supercharger" generically', () => {
    // Real examples from this app's own mock data — non-Tesla networks using the word as
    // marketing copy, not as a Tesla-specific signal.
    expect(inferIsTeslaOnly('PEA Volta Supercharger')).toBe(false);
    expect(inferIsTeslaOnly('EleX by EGAT Supercharger')).toBe(false);
  });

  it('does not flag a Tesla site that also lists a non-Tesla connector', () => {
    expect(inferIsTeslaOnly('Tesla Supercharger Tesla (Model 3) CCS (Type 2)')).toBe(false);
    expect(inferIsTeslaOnly('Tesla Destination Charger CHAdeMO')).toBe(false);
  });

  it('does not flag a station with no Tesla mention at all', () => {
    expect(inferIsTeslaOnly('Shell Recharge Hub')).toBe(false);
    expect(inferIsTeslaOnly('')).toBe(false);
  });
});

describe('isTeslaVehicle', () => {
  it('recognizes preset-style Tesla model names', () => {
    expect(isTeslaVehicle('Tesla Model Y (RWD)')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isTeslaVehicle('tesla model 3')).toBe(true);
  });

  it('does not flag non-Tesla vehicles', () => {
    expect(isTeslaVehicle('BYD Atto 3 (Extended Range)')).toBe(false);
    expect(isTeslaVehicle('My EV')).toBe(false);
  });
});

describe('generateMockStations Tesla flag', () => {
  it('marks the mock Tesla Supercharger template as Tesla-only and leaves the rest unflagged', () => {
    const stations = generateMockStations({ latitude: 13.7563, longitude: 100.5018 }, 500);
    const tesla = stations.find((s) => s.name === 'Tesla Supercharger V4');
    const others = stations.filter((s) => s.name !== 'Tesla Supercharger V4');

    expect(tesla?.isTeslaOnly).toBe(true);
    expect(others.every((s) => !s.isTeslaOnly)).toBe(true);
  });
});
