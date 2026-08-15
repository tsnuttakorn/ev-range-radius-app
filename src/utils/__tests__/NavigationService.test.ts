import { buildGoogleMapsDirectionsUrl } from '../NavigationService';

describe('buildGoogleMapsDirectionsUrl', () => {
  const destination = { latitude: 18.7883, longitude: 98.9853 };

  it('builds a destination-only link when no origin is given', () => {
    const url = buildGoogleMapsDirectionsUrl(destination);
    expect(url).toContain('https://www.google.com/maps/dir/?');
    expect(url).toContain('destination=18.7883%2C98.9853');
    expect(url).not.toContain('origin=');
    expect(url).not.toContain('waypoints=');
  });

  it('includes the origin when provided', () => {
    const origin = { latitude: 13.7563, longitude: 100.5018 };
    const url = buildGoogleMapsDirectionsUrl(destination, { origin });
    expect(url).toContain('origin=13.7563%2C100.5018');
  });

  it('joins multiple waypoints with a pipe, in order, with optimize:false so Google Maps cannot silently reorder them', () => {
    const origin = { latitude: 13.7563, longitude: 100.5018 };
    const waypoints = [
      { latitude: 15.0, longitude: 99.5 },
      { latitude: 16.5, longitude: 99.0 },
    ];
    const url = buildGoogleMapsDirectionsUrl(destination, { origin, waypoints });
    expect(url).toContain(encodeURIComponent('optimize:false|15,99.5|16.5,99'));
  });

  it('omits the waypoints param entirely when the list is empty', () => {
    const url = buildGoogleMapsDirectionsUrl(destination, { waypoints: [] });
    expect(url).not.toContain('waypoints=');
  });

  it('always requests turn-by-turn navigation directly, skipping the route-preview screen', () => {
    expect(buildGoogleMapsDirectionsUrl(destination)).toContain('dir_action=navigate');
    expect(
      buildGoogleMapsDirectionsUrl(destination, {
        origin: { latitude: 13.7563, longitude: 100.5018 },
        waypoints: [{ latitude: 15.0, longitude: 99.5 }],
      })
    ).toContain('dir_action=navigate');
  });
});
