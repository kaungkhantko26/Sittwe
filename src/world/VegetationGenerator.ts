import * as THREE from 'three';
import type { ChunkArea } from '../geo/chunkFormat';
import { pointInRings, ringBounds, type Pt } from '../geo/geometry2d';
import { hashString, materials, rng } from './materials';
import type { PolygonIndex, SegmentIndex } from './SpatialIndex';

/**
 * Trees are placed from two sources, kept separate:
 *  1. OSM-mapped trees (natural=tree nodes) — real positions.
 *  2. Procedural filler — deterministic random scatter inside real OSM
 *     land-use polygons (parks, woods, gardens, residential plots), avoiding
 *     roads, buildings and water. These are decorative, not surveyed.
 */

/** Filler trees per 1000 m² by land-use kind (before the quality multiplier). */
export const TREE_DENSITY: Record<string, number> = {
  forest: 7,
  orchard: 5,
  scrub: 2.5,
  park: 1.6,
  wetland: 1.0,
  cemetery: 1.2,
  religious: 1.0,
  grass: 0.5,
  institutional: 0.5,
  residential: 0.9,
  farmland: 0.15,
};

const MAX_TREES_PER_CHUNK = 2200;

function colored(geo: THREE.BufferGeometry, hex: number, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
  g.deleteAttribute('uv');
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const p of parts) total += p.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    const n = p.getAttribute('position').count;
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    col.set(p.getAttribute('color').array as Float32Array, o * 3);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

const M = () => new THREE.Matrix4();

let palmGeo: THREE.BufferGeometry | null = null;
let broadleafGeo: THREE.BufferGeometry | null = null;
let bushGeo: THREE.BufferGeometry | null = null;
let mangroveGeo: THREE.BufferGeometry | null = null;

/** Low-poly coconut palm, ~8 m tall. */
export function palmGeometry(): THREE.BufferGeometry {
  if (palmGeo) return palmGeo;
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 7.6, 6, 3);
  // Gentle lean: shear the trunk.
  const posAttr = trunk.getAttribute('position');
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i) + 3.8;
    posAttr.setX(i, posAttr.getX(i) + (y / 7.6) ** 2 * 0.6);
  }
  parts.push(colored(trunk, 0x8a7458, M().makeTranslation(0, 3.8, 0)));
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const frond = new THREE.BufferGeometry();
    // Simple drooping leaf: 3 segments, 2 triangles each.
    const L = 3.4;
    const pts: number[] = [];
    const seg = 3;
    for (let s = 0; s < seg; s++) {
      const t0 = s / seg;
      const t1 = (s + 1) / seg;
      const w0 = 0.55 * Math.sin(Math.PI * (0.15 + 0.85 * t0));
      const w1 = 0.55 * Math.sin(Math.PI * (0.15 + 0.85 * t1));
      const y0 = -1.6 * t0 * t0;
      const y1 = -1.6 * t1 * t1;
      const x0 = L * t0;
      const x1 = L * t1;
      pts.push(x0, y0, -w0, x1, y1, -w1, x1, y1, w1, x0, y0, -w0, x1, y1, w1, x0, y0, w0);
    }
    frond.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    frond.computeVertexNormals();
    const m = M()
      .makeTranslation(0.6, 7.6, 0)
      .multiply(M().makeRotationY((i / fronds) * Math.PI * 2 + (i % 2) * 0.3))
      .multiply(M().makeRotationZ(0.25 + (i % 3) * 0.12));
    parts.push(colored(frond, i % 2 ? 0x4f8a3a : 0x5e9a42, m));
  }
  parts.push(colored(new THREE.IcosahedronGeometry(0.35, 0), 0x6b5a2e, M().makeTranslation(0.6, 7.3, 0)));
  palmGeo = merge(parts);
  return palmGeo;
}

/** Low-poly broadleaf tree (e.g. rain tree / mango), ~7 m tall. */
export function broadleafGeometry(): THREE.BufferGeometry {
  if (broadleafGeo) return broadleafGeo;
  const parts = [
    colored(new THREE.CylinderGeometry(0.2, 0.32, 3.4, 6), 0x6e5a44, M().makeTranslation(0, 1.7, 0)),
    colored(new THREE.IcosahedronGeometry(2.6, 0), 0x4f7f3a, M().makeTranslation(0, 4.6, 0).multiply(M().makeScale(1.15, 0.85, 1.15))),
    colored(new THREE.IcosahedronGeometry(1.7, 0), 0x5d8f45, M().makeTranslation(1.1, 5.6, 0.5)),
    colored(new THREE.IcosahedronGeometry(1.5, 0), 0x46733a, M().makeTranslation(-1.0, 5.2, -0.7)),
  ];
  broadleafGeo = merge(parts);
  return broadleafGeo;
}

export function bushGeometry(): THREE.BufferGeometry {
  if (bushGeo) return bushGeo;
  bushGeo = merge([colored(new THREE.IcosahedronGeometry(0.9, 0), 0x5b8a40, M().makeTranslation(0, 0.6, 0).multiply(M().makeScale(1.3, 0.8, 1.3)))]);
  return bushGeo;
}

/** Mangrove clump, ~4.5 m tall: arching stilt roots under a dense, low crown. */
export function mangroveGeometry(): THREE.BufferGeometry {
  if (mangroveGeo) return mangroveGeo;
  const parts: THREE.BufferGeometry[] = [
    colored(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 5), 0x5d4a38, M().makeTranslation(0, 1.9, 0)),
  ];
  // Stilt (prop) roots arching out from the trunk into the mud.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + (i % 2) * 0.2;
    const root = new THREE.CylinderGeometry(0.045, 0.06, 1.9, 4);
    const m = M().makeRotationY(a).multiply(M().makeTranslation(0.62, 0.62, 0)).multiply(M().makeRotationZ(0.62 + (i % 3) * 0.08));
    parts.push(colored(root, 0x6a5643, m));
  }
  parts.push(colored(new THREE.IcosahedronGeometry(1.9, 0), 0x335f2e, M().makeTranslation(0, 3.5, 0).multiply(M().makeScale(1.35, 0.62, 1.35))));
  parts.push(colored(new THREE.IcosahedronGeometry(1.3, 0), 0x3d6d33, M().makeTranslation(0.9, 3.9, 0.4).multiply(M().makeScale(1.2, 0.7, 1.2))));
  parts.push(colored(new THREE.IcosahedronGeometry(1.2, 0), 0x2f5729, M().makeTranslation(-0.8, 3.7, -0.5).multiply(M().makeScale(1.2, 0.65, 1.2))));
  mangroveGeo = merge(parts);
  return mangroveGeo;
}

/**
 * Generated trees along the real sea coastline (decorative, like the filler
 * trees): coconut palms a few metres inland on built-up stretches, and
 * mangrove clumps at the water's edge on wild, building-free shores.
 * `coast` holds coastline segments as [x1, z1, x2, z2] near this chunk.
 */
export function placeCoastalTrees(chunkKey: string, coast: number[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, ctx: PlacementContext, density: number): TreeInstance[] {
  const out: TreeInstance[] = [];
  if (density <= 0) return out;
  const rand = rng(hashString(`coast:${chunkKey}`));
  const inside = (x: number, z: number) => x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ;
  const spacing = 13 / Math.min(1.5, density);
  for (let i = 0; i < coast.length; i += 4) {
    const ax = coast[i]!, az = coast[i + 1]!, bx = coast[i + 2]!, bz = coast[i + 3]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    for (let t = rand() * spacing; t < len; t += spacing * (0.7 + rand() * 0.6)) {
      const px = ax + ux * t, pz = az + uz * t;
      if (!inside(px, pz)) continue;
      // Which side of the coastline is land?
      let nx = -uz, nz = ux;
      if (ctx.isWater(px + nx * 6, pz + nz * 6)) { nx = -nx; nz = -nz; }
      if (ctx.isWater(px + nx * 6, pz + nz * 6)) continue; // a thin spit: skip
      const wild = !ctx.buildings.hit(px + nx * 20, pz + nz * 20, 18) && !ctx.roads.hit(px + nx * 10, pz + nz * 10, 8);
      if (wild) {
        // Mangroves stand in the shallows, in small groups.
        const n = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const d = -(0.5 + rand() * 4), side = (rand() - 0.5) * 6;
          const x = px + nx * d + ux * side, z = pz + nz * d + uz * side;
          if (ctx.isReserved?.(x, z) || ctx.roads.hit(x, z, 2)) continue;
          out.push({ x, z, type: 3, scale: 0.75 + rand() * 0.5, rot: rand() * Math.PI * 2, mapped: false });
        }
      } else if (rand() < 0.7) {
        const d = 3 + rand() * 6;
        const x = px + nx * d, z = pz + nz * d;
        if (ctx.isWater(x, z) || ctx.buildings.hit(x, z, 1.5) || ctx.roads.hit(x, z, 1.5) || ctx.isReserved?.(x, z)) continue;
        out.push({ x, z, type: 0, scale: 0.85 + rand() * 0.35, rot: rand() * Math.PI * 2, mapped: false });
      }
    }
  }
  return out;
}

export interface TreeInstance {
  x: number;
  z: number;
  type: 0 | 1 | 2 | 3; // palm, broadleaf, bush, mangrove
  scale: number;
  rot: number;
  mapped: boolean;
}

export interface PlacementContext {
  buildings: PolygonIndex;
  roads: SegmentIndex;
  isWater: (x: number, z: number) => boolean;
  isReserved?: (x:number,z:number)=>boolean;
}

/** Computes tree positions for one chunk (pure; deterministic per chunk key). */
export function placeTrees(chunkKey: string, mappedTrees: number[], landuse: ChunkArea[], ctx: PlacementContext, density: number): TreeInstance[] {
  const out: TreeInstance[] = [];
  const rand = rng(hashString(`trees:${chunkKey}`));
  const clear = (x: number, z: number) => !ctx.buildings.hit(x, z, 1.2) && !ctx.roads.hit(x, z, 1.2) && !ctx.isWater(x, z);

  for (let i = 0; i < mappedTrees.length; i += 2) {
    const x = mappedTrees[i]!;
    const z = mappedTrees[i + 1]!;
    // Mapped trees are kept even if near a road (they are real); only skip if inside a building.
    if (ctx.buildings.hit(x, z) || ctx.isReserved?.(x,z)) continue;
    out.push({ x, z, type: rand() < 0.45 ? 0 : 1, scale: 0.85 + rand() * 0.35, rot: rand() * Math.PI * 2, mapped: true });
  }
  if (density <= 0) return out;

  for (const a of landuse) {
    const d = TREE_DENSITY[a.k];
    if (!d) continue;
    const rings: Pt[][] = a.r.map((flat) => {
      const pts: Pt[] = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i]!, flat[i + 1]!]);
      return pts;
    });
    const b = ringBounds(rings[0]!);
    const bboxArea = (b.maxX - b.minX) * (b.maxY - b.minY);
    const attempts = Math.min(4000, Math.round((bboxArea / 1000) * d * density));
    for (let i = 0; i < attempts && out.length < MAX_TREES_PER_CHUNK; i++) {
      const x = b.minX + rand() * (b.maxX - b.minX);
      const z = b.minY + rand() * (b.maxY - b.minY);
      if (!pointInRings(x, z, rings)) continue;
      if (!clear(x, z)) continue;
      const r = rand();
      const type: 0 | 1 | 2 = a.k === 'forest' || a.k === 'orchard' ? (r < 0.5 ? 1 : r < 0.8 ? 0 : 2) : r < 0.45 ? 0 : r < 0.8 ? 1 : 2;
      out.push({ x, z, type, scale: 0.7 + rand() * 0.55, rot: rand() * Math.PI * 2, mapped: false });
    }
  }
  return out;
}

export interface VegetationMeshes {
  meshes: THREE.InstancedMesh[];
  /** Trunk positions (flat x,z) for colliders. */
  trunks: number[];
}

export function buildVegetation(trees: TreeInstance[]): VegetationMeshes {
  const geos = [palmGeometry(), broadleafGeometry(), bushGeometry(), mangroveGeometry()];
  const meshes: THREE.InstancedMesh[] = [];
  const trunks: number[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (let t = 0; t < 4; t++) {
    const list = trees.filter((tr) => tr.type === t);
    if (list.length === 0) continue;
    const mesh = new THREE.InstancedMesh(geos[t]!, materials().vegetation, list.length);
    list.forEach((tr, i) => {
      q.setFromAxisAngle(up, tr.rot);
      s.setScalar(tr.scale);
      p.set(tr.x, 0, tr.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      const v = 0.85 + ((i * 7919) % 100) / 100 * 0.3;
      c.setRGB(v, v * (0.95 + ((i * 31) % 10) / 100), v);
      mesh.setColorAt(i, c);
      if (t !== 2) trunks.push(tr.x, tr.z);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    meshes.push(mesh);
  }
  return { meshes, trunks };
}
