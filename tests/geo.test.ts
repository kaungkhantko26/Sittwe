import { describe, expect, it } from 'vitest';
import { GeoProjection, geoToWorld, haversineMeters, headingFromDirection, projection, worldToGeo } from '../src/geo/GeoProjection';
import { GEO_ORIGIN } from '../src/config';

describe('GeoProjection', () => {
  it('maps the origin to (0, 0, 0)', () => {
    const p = geoToWorld(GEO_ORIGIN.lat, GEO_ORIGIN.lon);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('uses X = east, Z = south', () => {
    const east = geoToWorld(GEO_ORIGIN.lat, GEO_ORIGIN.lon + 0.001);
    const north = geoToWorld(GEO_ORIGIN.lat + 0.001, GEO_ORIGIN.lon);
    expect(east.x).toBeGreaterThan(100);
    expect(Math.abs(east.z)).toBeLessThan(1e-9);
    expect(north.z).toBeLessThan(-100);
  });

  it('round-trips within 1e-9 degrees across the world area', () => {
    for (let i = 0; i < 500; i++) {
      const lat = GEO_ORIGIN.lat + (Math.random() - 0.5) * 0.05;
      const lon = GEO_ORIGIN.lon + (Math.random() - 0.5) * 0.05;
      const alt = Math.random() * 30;
      const w = geoToWorld(lat, lon, alt);
      const g = worldToGeo(w.x, w.y, w.z);
      expect(Math.abs(g.lat - lat)).toBeLessThan(1e-9);
      expect(Math.abs(g.lon - lon)).toBeLessThan(1e-9);
      expect(g.alt).toBeCloseTo(alt, 9);
    }
  });

  it('matches haversine distances to < 0.05% within 2 km', () => {
    for (const [dLat, dLon] of [[0.009, 0], [0, 0.0095], [0.006, -0.007], [-0.008, 0.004]] as const) {
      const lat = GEO_ORIGIN.lat + dLat;
      const lon = GEO_ORIGIN.lon + dLon;
      const w = geoToWorld(lat, lon);
      const planar = Math.hypot(w.x, w.z);
      const truth = haversineMeters(GEO_ORIGIN.lat, GEO_ORIGIN.lon, lat, lon);
      expect(Math.abs(planar - truth) / truth).toBeLessThan(5e-3);
    }
  });

  it('xz helpers are inverses', () => {
    const [x, z] = projection.lonLatToXZ(92.9, 20.14);
    const [lon, lat] = projection.xzToLonLat(x, z);
    expect(lon).toBeCloseTo(92.9, 10);
    expect(lat).toBeCloseTo(20.14, 10);
  });

  it('rejects invalid origins', () => {
    expect(() => new GeoProjection(Number.NaN, 0)).toThrow();
    expect(() => new GeoProjection(89, 0)).toThrow();
  });

  it('computes compass headings', () => {
    expect(headingFromDirection(0, -1)).toBeCloseTo(0);
    expect(headingFromDirection(1, 0)).toBeCloseTo(90);
    expect(headingFromDirection(0, 1)).toBeCloseTo(180);
    expect(headingFromDirection(-1, 0)).toBeCloseTo(270);
  });
});
