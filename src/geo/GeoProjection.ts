import { GEO_ORIGIN } from '../config';

/**
 * WGS84 latitude/longitude  <->  local game-world meters.
 *
 * Projection: a local tangent-plane (equirectangular) projection on the WGS84
 * ellipsoid, using the meridional radius of curvature M and the prime-vertical
 * radius of curvature N evaluated at the origin latitude:
 *
 *   east  (m) = (lon - lon0) · N · cos(lat0) · π/180
 *   north (m) = (lat - lat0) · M · π/180
 *
 * Axis convention used everywhere in the game:
 *   Three.js +X = East, +Y = Up, +Z = South   (so North = -Z)
 *
 * Accuracy: within ±2 km of the origin the scale error from holding cos(lat0)
 * constant is < 1.3e-4 (≈ 13 cm per km at Sittwe's latitude, 20.1° N), which
 * is far below the accuracy of the OSM source data. Earth curvature (≈ 0.3 m
 * drop at 2 km) is ignored: the world is treated as flat at sea level.
 * The transform is exactly invertible, so round trips are lossless up to
 * floating-point precision.
 */

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  alt: number;
}

export class GeoProjection {
  readonly lat0: number;
  readonly lon0: number;
  /** Meters per degree of latitude at the origin. */
  readonly metersPerDegLat: number;
  /** Meters per degree of longitude at the origin. */
  readonly metersPerDegLon: number;

  constructor(lat0: number, lon0: number) {
    if (!Number.isFinite(lat0) || !Number.isFinite(lon0) || Math.abs(lat0) > 85) {
      throw new Error(`Invalid projection origin: ${lat0}, ${lon0}`);
    }
    this.lat0 = lat0;
    this.lon0 = lon0;
    const sinPhi = Math.sin(lat0 * DEG);
    const w = Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
    const n = WGS84_A / w;
    const m = (WGS84_A * (1 - WGS84_E2)) / (w * w * w);
    this.metersPerDegLat = m * DEG;
    this.metersPerDegLon = n * Math.cos(lat0 * DEG) * DEG;
  }

  geoToWorld(lat: number, lon: number, alt = 0): WorldPoint {
    return {
      x: (lon - this.lon0) * this.metersPerDegLon,
      y: alt,
      z: -(lat - this.lat0) * this.metersPerDegLat,
    };
  }

  worldToGeo(x: number, y: number, z: number): GeoPoint {
    return {
      lat: this.lat0 - z / this.metersPerDegLat,
      lon: this.lon0 + x / this.metersPerDegLon,
      alt: y,
    };
  }

  /** Fast 2D helper used by the data pipeline: returns [x, z]. */
  lonLatToXZ(lon: number, lat: number): [number, number] {
    return [(lon - this.lon0) * this.metersPerDegLon, -(lat - this.lat0) * this.metersPerDegLat];
  }

  /** Inverse of lonLatToXZ: returns [lon, lat] (GeoJSON order). */
  xzToLonLat(x: number, z: number): [number, number] {
    return [this.lon0 + x / this.metersPerDegLon, this.lat0 - z / this.metersPerDegLat];
  }

  /** Geographic bounding box of a local-meter rectangle, grown by `margin` meters. */
  bboxOfRect(r: { minX: number; maxX: number; minZ: number; maxZ: number }, margin = 0): { south: number; west: number; north: number; east: number } {
    return {
      south: this.lat0 - (r.maxZ + margin) / this.metersPerDegLat,
      north: this.lat0 - (r.minZ - margin) / this.metersPerDegLat,
      west: this.lon0 + (r.minX - margin) / this.metersPerDegLon,
      east: this.lon0 + (r.maxX + margin) / this.metersPerDegLon,
    };
  }

  /** Geographic bounding box covering a square of halfSize meters around the origin. */
  bboxAround(halfSize: number): { south: number; west: number; north: number; east: number } {
    const dLat = halfSize / this.metersPerDegLat;
    const dLon = halfSize / this.metersPerDegLon;
    return { south: this.lat0 - dLat, west: this.lon0 - dLon, north: this.lat0 + dLat, east: this.lon0 + dLon };
  }
}

/** The single shared projection for the whole game, anchored at central Sittwe. */
export const projection = new GeoProjection(GEO_ORIGIN.lat, GEO_ORIGIN.lon);

export function geoToWorld(latitude: number, longitude: number, altitude = 0): WorldPoint {
  return projection.geoToWorld(latitude, longitude, altitude);
}

export function worldToGeo(x: number, y: number, z: number): GeoPoint {
  return projection.worldToGeo(x, y, z);
}

/**
 * Compass heading in degrees (0 = North, 90 = East, clockwise) of a world-space
 * direction vector. Uses North = -Z, East = +X.
 */
export function headingFromDirection(dx: number, dz: number): number {
  const deg = Math.atan2(dx, -dz) / DEG;
  return (deg + 360) % 360;
}

/** Straight-line (great-circle) distance in meters between two WGS84 points (haversine). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371008.8;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}
