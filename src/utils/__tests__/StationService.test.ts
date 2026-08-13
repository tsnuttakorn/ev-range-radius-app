import { mergeStationSources } from '../StationService';
import { ChargingStation, getDistanceKm } from '../StationGenerator';

const BANGKOK = { latitude: 13.7563, longitude: 100.5018 };

const makeStation = (id: string, latitude: number, longitude: number, overrides: Partial<ChargingStation> = {}): ChargingStation => ({
  id,
  name: overrides.name || `Station ${id}`,
  latitude,
  longitude,
  type: overrides.type || 'DC',
  powerKW: overrides.powerKW ?? 100,
  status: overrides.status || 'AVAILABLE',
  distanceKm: getDistanceKm(BANGKOK, { latitude, longitude }),
  ...overrides,
});

/** Scatters `count` stations pseudo-randomly (deterministic) within ~`spreadKm` of Bangkok. */
function generateSyntheticStations(count: number, idPrefix: string, spreadKm: number): ChargingStation[] {
  const stations: ChargingStation[] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random spread so the test is reproducible.
    const angle = (i * 137.5) % 360; // golden-angle spiral for even coverage
    const distKm = (i / count) * spreadKm;
    const bearingRad = (angle * Math.PI) / 180;
    const dLat = (distKm / 111) * Math.cos(bearingRad);
    const dLng = (distKm / 111) * Math.sin(bearingRad);
    stations.push(makeStation(`${idPrefix}-${i}`, BANGKOK.latitude + dLat, BANGKOK.longitude + dLng));
  }
  return stations;
}

describe('mergeStationSources', () => {
  it('keeps all stations from both sources when none overlap', () => {
    const primary = [makeStation('a', 13.75, 100.50), makeStation('b', 13.80, 100.55)];
    const secondary = [makeStation('c', 14.00, 100.90), makeStation('d', 14.20, 101.10)];

    const merged = mergeStationSources(primary, secondary, 100);

    expect(merged).toHaveLength(4);
  });

  it('drops a secondary-source station that is the same physical charger as a primary one', () => {
    const primary = [makeStation('ocm-1', 13.7563, 100.5018, { name: 'OCM Station', operator: 'PEA' })];
    // ~10m away — well within the ~50m same-location threshold.
    const secondary = [makeStation('osm-1', 13.75639, 100.50189, { name: 'OSM Station' })];

    const merged = mergeStationSources(primary, secondary, 100);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('ocm-1'); // primary (OCM) wins over the duplicate
  });

  it('keeps two genuinely distinct stations that are merely close together, not duplicates', () => {
    const primary = [makeStation('a', 13.7563, 100.5018)];
    // ~500m away — a different charger, not a dupe of the same physical site.
    const secondary = [makeStation('b', 13.7608, 100.5018)];

    const merged = mergeStationSources(primary, secondary, 100);

    expect(merged).toHaveLength(2);
  });

  it('catches duplicates that straddle a grid cell boundary', () => {
    // Coordinates chosen to land in adjacent (not the same) internal grid cells while still
    // being well within the same-location distance threshold.
    const primary = [makeStation('a', 13.00050, 100.00050)];
    const secondary = [makeStation('b', 13.00049, 100.00051)];

    const merged = mergeStationSources(primary, secondary, 100);

    expect(merged).toHaveLength(1);
  });

  it('sorts the merged result by distance and respects maxResults', () => {
    const primary = [makeStation('far', 14.5, 101.5), makeStation('near', 13.76, 100.51)];
    const secondary = [makeStation('mid', 14.0, 101.0)];

    const merged = mergeStationSources(primary, secondary, 2);

    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe('near');
    expect(merged[1].id).toBe('mid');
  });

  describe('load test', () => {
    it('merges two 500-station datasets with ~20% overlap correctly and well within budget', () => {
      const primary = generateSyntheticStations(500, 'ocm', 300);
      // Half of the "secondary" set is near-duplicates of the primary set (simulating real
      // overlap between OCM and OSM coverage); the other half is genuinely distinct.
      const secondary: ChargingStation[] = [];
      for (let i = 0; i < 500; i++) {
        if (i < 100) {
          const dupeOf = primary[i];
          secondary.push(
            makeStation(`osm-dupe-${i}`, dupeOf.latitude + 0.0001, dupeOf.longitude + 0.0001)
          );
        } else {
          secondary.push(makeStation(`osm-unique-${i}`, BANGKOK.latitude + i * 0.01, BANGKOK.longitude + i * 0.01));
        }
      }

      const start = Date.now();
      const merged = mergeStationSources(primary, secondary, 1000);
      const elapsedMs = Date.now() - start;

      // 500 primary + 400 genuinely-new secondary (100 were duplicates and got dropped).
      expect(merged).toHaveLength(900);
      // Generous budget for a CI machine — the point is confirming no pathological O(n*m) blowup,
      // not chasing a specific number. The naive nested-loop version of this (pre-optimization)
      // took multiple seconds on 500x500; the bucketed version should be near-instant.
      expect(elapsedMs).toBeLessThan(1000);
    });

    it('scales roughly linearly, not quadratically, as the dataset grows', () => {
      const timeFor = (n: number): number => {
        const primary = generateSyntheticStations(n, 'p', 500);
        const secondary = generateSyntheticStations(n, 's', 500);
        const start = Date.now();
        mergeStationSources(primary, secondary, n * 2);
        return Date.now() - start;
      };

      // Warm up the JIT so timing reflects steady-state performance, not first-run compilation.
      timeFor(100);

      const small = timeFor(200) || 1; // avoid divide-by-zero on very fast machines
      const large = timeFor(1600); // 8x the input size

      // A true O(n*m) implementation would take ~64x longer (8x * 8x) going from 200 to 1600.
      // The bucketed O(n+m) approach should land far below that — allow generous headroom for
      // timing noise while still catching a real quadratic regression.
      expect(large / small).toBeLessThan(30);
    });
  });
});
