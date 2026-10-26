/**
 * World-wide constants shared by the browser game and the Node data pipeline.
 *
 * The geographic origin is the OpenStreetMap place node for Sittwe city
 * (node 26576213, place=city, name=စစ်တွေမြို့), verified via Nominatim on
 * 2026-10-27. Every system (roads, buildings, player, minimap, saves) is
 * expressed relative to this single origin, so loaded chunks cannot drift.
 */
export const GEO_ORIGIN = {
  lat: 20.139197,
  lon: 92.8970859,
  source: 'OSM node 26576213 (place=city, Sittwe / စစ်တွေမြို့)',
} as const;

/** Size of one streaming chunk, in meters. */
export const CHUNK_SIZE = 256;

/**
 * Extracted world area in local meters (X = east, Z = south), as multiples of
 * CHUNK_SIZE. It covers the Sittwe peninsula: the town centre and Kaladan
 * waterfront (east), Sittwe Airport and the western shore (west), north to
 * the outskirts and south to the Point. 36 × 34 chunks ≈ 9.2 km × 8.7 km.
 * Change these and re-run `npm run data:all` to resize the world.
 */
export const WORLD_BOUNDS = { minX: -7168, maxX: 2048, minZ: -5120, maxZ: 3584 } as const;

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function boundsCenter(b: Bounds): { x: number; z: number } {
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
}

export function insideBounds(b: Bounds, x: number, z: number, margin = 0): boolean {
  return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
}

/** Extra margin (m) used when extracting coastline/sea so water reaches the horizon. */
export const SEA_MARGIN = 4000;

export const DATA_VERSION = 1;
