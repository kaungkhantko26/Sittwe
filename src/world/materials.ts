import * as THREE from 'three';

/**
 * Shared materials and procedural textures. Every chunk reuses these, so the
 * number of GPU programs/textures stays constant as the world streams.
 */

/** Vertical layering of flat surfaces (meters above y = 0) to avoid z-fighting. */
export const SurfaceY = {
  ground: 0,
  landuse: 0.02,
  water: 0.035,
  sidewalk: 0.075,
  path: 0.07,
  track: 0.08,
  asphalt: 0.1,
  marking: 0.115,
  pier: 0.12,
} as const;

export const LANDUSE_COLORS: Record<string, number> = {
  residential: 0x9b9a7c,
  commercial: 0xa49d92,
  industrial: 0x9a9590,
  institutional: 0xa7a387,
  religious: 0xbdb08b,
  cemetery: 0x7f9a6a,
  grass: 0x7da359,
  park: 0x6da153,
  pitch: 0x5e9d4e,
  farmland: 0xa7a35d,
  forest: 0x4d773c,
  orchard: 0x6a9348,
  scrub: 0x7b8a4f,
  wetland: 0x6b8a6a,
  sand: 0xdccaa0,
  mud: 0x8a7a5e,
  bare: 0xa89a7f,
  parking: 0x77777a,
  aquaculture: 0x5d8a86,
  pier: 0x7a5a3a,
};

/** Small priority offset so overlapping landuse polygons resolve deterministically. */
export const LANDUSE_PRIORITY: Record<string, number> = {
  residential: 0,
  commercial: 1,
  industrial: 1,
  farmland: 2,
  institutional: 3,
  religious: 3,
  cemetery: 4,
  grass: 5,
  scrub: 5,
  wetland: 5,
  mud: 5,
  bare: 5,
  park: 6,
  orchard: 6,
  forest: 7,
  pitch: 8,
  sand: 8,
  aquaculture: 8,
  parking: 9,
  pier: 10,
};

const FACADE_COLORS = [0xf2ede3, 0xeee2c4, 0xf3e7b3, 0xd9e6ec, 0xcfe3d3, 0xf0d6cf, 0xd8d6d0, 0xe8dcc8, 0xb5654d, 0xc9c4b8, 0xe4cfa6, 0xbfd3e0];
const ROOF_TIN = [0x8f969c, 0x9da3a6, 0x7b8287, 0x9a5a3c, 0x7d4a34, 0x5f7f6a, 0x5d7590, 0xa8a49b];
const ROOF_FLAT = [0xb9b4aa, 0xa9a59c, 0xc4beb2, 0x9d9a94];

/** Deterministic 32-bit hash of a string (FNV-1a). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function facadeColor(id: string, kind: string): number {
  const h = hashString(id);
  if (kind === 'industrial' || kind === 'warehouse') return 0xbcbab4;
  return FACADE_COLORS[h % FACADE_COLORS.length]!;
}

export function roofColor(id: string, pitched: boolean): number {
  const h = hashString(id) >>> 3;
  return pitched ? ROOF_TIN[h % ROOF_TIN.length]! : ROOF_FLAT[h % ROOF_FLAT.length]!;
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Procedural facade textures
// ---------------------------------------------------------------------------

/** Window atlas: 8 × 8 window bays. One bay = 3 m wide × 3.2 m tall (one storey). */
export const WINDOW_BAY_W = 3;
export const WINDOW_BAY_H = 3.2;
export const ATLAS_CELLS = 8;

function makeCanvas(size: number): [HTMLCanvasElement | OffscreenCanvas, CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D] {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, size);
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  return [c, ctx];
}

function createFacadeTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const cell = 64;
  const size = cell * ATLAS_CELLS;
  const [c1, g] = makeCanvas(size);
  const [c2, e] = makeCanvas(size);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  e.fillStyle = '#000000';
  e.fillRect(0, 0, size, size);
  const rand = rng(1337);
  for (let cy = 0; cy < ATLAS_CELLS; cy++) {
    for (let cx = 0; cx < ATLAS_CELLS; cx++) {
      const x0 = cx * cell;
      const y0 = cy * cell;
      // Subtle plaster noise and a darker floor band at the bottom of each storey.
      g.fillStyle = 'rgba(0,0,0,0.05)';
      g.fillRect(x0, y0 + cell - 5, cell, 5);
      const wx = x0 + 18;
      const wy = y0 + 13;
      const ww = 28;
      const wh = 32;
      g.fillStyle = '#d9d6cf';
      g.fillRect(wx - 3, wy - 3, ww + 6, wh + 7); // frame + sill
      const shade = 40 + Math.floor(rand() * 25);
      g.fillStyle = `rgb(${shade},${shade + 14},${shade + 28})`;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(wx + 2, wy + 2, 6, wh - 4);
      g.fillStyle = '#c8c4bb';
      g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      if (rand() < 0.38) {
        const warm = rand();
        const r = 255;
        const gg = Math.floor(200 + warm * 40);
        const b = Math.floor(110 + warm * 90);
        e.fillStyle = `rgb(${r},${gg},${b})`;
        e.fillRect(wx, wy, ww, wh);
        e.fillStyle = '#000';
        e.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      }
    }
  }
  const map = new THREE.CanvasTexture(c1 as HTMLCanvasElement);
  const emissive = new THREE.CanvasTexture(c2 as HTMLCanvasElement);
  for (const t of [map, emissive]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / ATLAS_CELLS, 1 / ATLAS_CELLS);
    t.anisotropy = 4;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { map, emissive };
}

// ---------------------------------------------------------------------------
// Material registry
// ---------------------------------------------------------------------------

export interface MaterialSet {
  ground: THREE.MeshStandardMaterial;
  landuse: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  sidewalk: THREE.MeshStandardMaterial;
  path: THREE.MeshStandardMaterial;
  marking: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  buildingWall: THREE.MeshStandardMaterial;
  buildingRoof: THREE.MeshStandardMaterial;
  vegetation: THREE.MeshStandardMaterial;
  lampHead: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  /** Vertex-coloured solids: kerbs, embankments, bridge posts. */
  solid: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
}

let shared: MaterialSet | null = null;

function flat(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
}

/** Lazily created shared materials (requires a DOM for canvas textures). */
export function materials(): MaterialSet {
  if (shared) return shared;
  const facade = typeof document !== 'undefined' ? createFacadeTextures() : null;
  const offset = (m: THREE.MeshStandardMaterial, units: number) => {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -units;
    m.polygonOffsetUnits = -units * 2;
    return m;
  };
  shared = {
    ground: flat(0x8f9468),
    landuse: offset(flat(0xffffff, { vertexColors: true }), 1),
    asphalt: offset(flat(0x45474b, { roughness: 0.9 }), 4),
    sidewalk: offset(flat(0xa9a59b, { vertexColors: true }), 3),
    path: offset(flat(0xffffff, { vertexColors: true }), 2),
    marking: offset(flat(0xe9e6da, { roughness: 0.7 }), 5),
    wood: flat(0x7a5a3a),
    metal: flat(0x5d6166, { roughness: 0.6, metalness: 0.4 }),
    buildingWall: new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      map: facade?.map ?? null,
      emissiveMap: facade?.emissive ?? null,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0,
    }),
    buildingRoof: flat(0xffffff, { vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
    vegetation: flat(0xffffff, { vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: new THREE.Color(0xffd890), emissiveIntensity: 0 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a93c, roughness: 0.35, metalness: 0.75 }),
    solid: flat(0xffffff, { vertexColors: true, roughness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc3c8cd, roughness: 0.45, metalness: 0.55 }),
  };
  return shared;
}
