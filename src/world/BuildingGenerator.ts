import * as THREE from 'three';
import type { BuildingStyle, ChunkBuilding } from '../geo/chunkFormat';
import { signedArea, type Pt } from '../geo/geometry2d';
import { addBeam, GeometryBuilder } from './GeometryBuilder';
import { facadeColor, hashString, roofColor, WINDOW_BAY_H, WINDOW_BAY_W } from './materials';

/**
 * Extrudes real OSM building footprints into 3D.
 *
 * Geometry follows the mapped footprint exactly (outer ring + courtyard holes).
 * Heights come from OSM tags or the documented estimate in OSMParser.
 * Roofs: flat by default; a hipped/pyramidal roof is used when OSM says
 * roof:shape=hipped|gabled|pyramidal, or — as an artistic choice that matches
 * Sittwe's common corrugated-tin houses — for small 1–2 storey four-cornered
 * footprints without roof tags. Window/door detailing is decorative.
 */

const NO_WINDOWS = new Set(['hut', 'shed', 'garage', 'garages', 'roof', 'carport', 'kiosk', 'toilets', 'service', 'container', 'tank']);
const NO_PITCH = new Set(['apartments', 'commercial', 'retail', 'office', 'industrial', 'warehouse', 'hospital', 'school', 'university', 'hotel', 'roof']);

export interface BuildingMeshes {
  /** Geometry with two groups: 0 = walls (textured), 1 = roofs/trim. */
  geometry: THREE.BufferGeometry | null;
  /** Collider data (walls + roof caps), merged for one trimesh. */
  collider: { vertices: Float32Array; indices: Uint32Array } | null;
  /** Footprints in x,z for spatial queries (vegetation, lamps, spawn checks). */
  footprints: Pt[][];
  triangles: number;
}

function flatToPts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  if (out.length > 1 && out[0]![0] === out[out.length - 1]![0] && out[0]![1] === out[out.length - 1]![1]) out.pop();
  return out;
}

/**
 * Wall orientation: for the edge a→b, the triangle (a0, b0, b1) has normal
 * (-dz, 0, dx). For outward-facing walls the outer ring must therefore have
 * negative signed area in the (x, z) plane; holes positive.
 */
function orientRing(pts: Pt[], outer: boolean): Pt[] {
  const a = signedArea(pts);
  const wantNegative = outer;
  return (a < 0) === wantNegative ? pts : pts.slice().reverse();
}

function addWalls(walls: GeometryBuilder, col: ColliderBuilder, ring: Pt[], y0: number, y1: number, windows: boolean): void {
  let u = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = -dz / len;
    const nz = dx / len;
    const u0 = windows ? u / WINDOW_BAY_W : 0.002;
    const u1 = windows ? (u + len) / WINDOW_BAY_W : 0.002;
    const v0 = windows ? y0 / WINDOW_BAY_H : 0.002;
    const v1 = windows ? y1 / WINDOW_BAY_H : 0.002;
    const i0 = walls.vertex(a[0], y0, a[1], nx, 0, nz, u0, v0);
    const i1 = walls.vertex(b[0], y0, b[1], nx, 0, nz, u1, v0);
    const i2 = walls.vertex(b[0], y1, b[1], nx, 0, nz, u1, v1);
    const i3 = walls.vertex(a[0], y1, a[1], nx, 0, nz, u0, v1);
    walls.tri(i0, i1, i2);
    walls.tri(i0, i2, i3);
    col.quad(a[0], a[1], b[0], b[1], y0, y1);
    u += len;
  }
}

class ColliderBuilder {
  v: number[] = [];
  idx: number[] = [];
  quad(ax: number, az: number, bx: number, bz: number, y0: number, y1: number): void {
    const base = this.v.length / 3;
    this.v.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const base = this.v.length / 3;
    this.v.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.idx.push(base, base + 1, base + 2);
  }
}

function addTri3(b: GeometryBuilder, col: ColliderBuilder, p: number[][]): void {
  // Generic triangle with computed normal, flipped to face upward.
  let [a, c1, c2] = p as [number[], number[], number[]];
  let ux = c1[0]! - a[0]!;
  let uy = c1[1]! - a[1]!;
  let uz = c1[2]! - a[2]!;
  let vx = c2[0]! - a[0]!;
  let vy = c2[1]! - a[1]!;
  let vz = c2[2]! - a[2]!;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  if (ny < 0) {
    [c1, c2] = [c2, c1];
    nx = -nx;
    ny = -ny;
    nz = -nz;
    [ux, uy, uz, vx, vy, vz] = [vx, vy, vz, ux, uy, uz];
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  const i0 = b.vertex(a[0]!, a[1]!, a[2]!, nx / l, ny / l, nz / l, 0, 0);
  const i1 = b.vertex(c1[0]!, c1[1]!, c1[2]!, nx / l, ny / l, nz / l, 0, 0);
  const i2 = b.vertex(c2[0]!, c2[1]!, c2[2]!, nx / l, ny / l, nz / l, 0, 0);
  b.tri(i0, i1, i2);
  col.tri(a[0]!, a[1]!, a[2]!, c1[0]!, c1[1]!, c1[2]!, c2[0]!, c2[1]!, c2[2]!);
}

/** Hipped (or pyramidal) roof over a 4-corner footprint. Returns false if unsuitable. */
function addHippedRoof(roof: GeometryBuilder, col: ColliderBuilder, ring: Pt[], y: number, riseScale = 1): boolean {
  if (ring.length !== 4) return false;
  const [A, B, C, D] = ring as [Pt, Pt, Pt, Pt];
  const ab = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const bc = Math.hypot(C[0] - B[0], C[1] - B[1]);
  const cd = Math.hypot(D[0] - C[0], D[1] - C[1]);
  const da = Math.hypot(A[0] - D[0], A[1] - D[1]);
  // Require a roughly rectangular footprint.
  if (Math.abs(ab - cd) > 0.25 * Math.max(ab, cd) || Math.abs(bc - da) > 0.25 * Math.max(bc, da)) return false;
  // Rotate so that A-B is a long side.
  const [P0, P1, P2, P3] = ab >= bc ? [A, B, C, D] : [B, C, D, A];
  const long = Math.max(ab, bc);
  const short = Math.min(ab, bc);
  const rise = Math.min(short * 0.32, 2.6) * riseScale;
  const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const sStart = mid(P3, P0);
  const sEnd = mid(P1, P2);
  const dirx = (sEnd[0] - sStart[0]) / long;
  const dirz = (sEnd[1] - sStart[1]) / long;
  const inset = Math.min(short / 2, long / 2);
  const R1: Pt = [sStart[0] + dirx * inset, sStart[1] + dirz * inset];
  const R2: Pt = [sEnd[0] - dirx * inset, sEnd[1] - dirz * inset];
  const ry = y + rise;
  const v = (p: Pt, h: number) => [p[0], h, p[1]];
  // Long sides (trapezoids, or triangles when pyramidal).
  addTri3(roof, col, [v(P0, y), v(P1, y), v(R2, ry)]);
  addTri3(roof, col, [v(P0, y), v(R2, ry), v(R1, ry)]);
  addTri3(roof, col, [v(P2, y), v(P3, y), v(R1, ry)]);
  addTri3(roof, col, [v(P2, y), v(R1, ry), v(R2, ry)]);
  // Hip ends.
  addTri3(roof, col, [v(P1, y), v(P2, y), v(R2, ry)]);
  addTri3(roof, col, [v(P3, y), v(P0, y), v(R1, ry)]);
  return true;
}

function addFlatRoof(roof: GeometryBuilder, col: ColliderBuilder, outer: Pt[], holes: Pt[][], y: number): void {
  const contour = outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const hv = holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  let faces: number[][];
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, hv);
  } catch {
    return;
  }
  const all = contour.concat(...hv);
  for (const f of faces) {
    const a = all[f[0]!];
    const b = all[f[1]!];
    const c = all[f[2]!];
    if (!a || !b || !c) continue;
    roof.upTri(a.x, a.y, b.x, b.y, c.x, c.y, y);
    col.tri(a.x, y, a.y, b.x, y, b.y, c.x, y, c.y);
  }
}

function addDoor(trim: GeometryBuilder, ring: Pt[], baseY: number): void {
  // Door on the longest outer wall, centred, 2.1 m × 1.1 m, 3 cm proud of the wall.
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  if (best < 0 || bestLen < 2.5) return;
  const a = ring[best]!;
  const b = ring[(best + 1) % ring.length]!;
  const dx = (b[0] - a[0]) / bestLen;
  const dz = (b[1] - a[1]) / bestLen;
  const nx = -dz;
  const nz = dx;
  const cx = (a[0] + b[0]) / 2 + nx * 0.03;
  const cz = (a[1] + b[1]) / 2 + nz * 0.03;
  const hw = 0.55;
  const p0 = [cx - dx * hw, cz - dz * hw];
  const p1 = [cx + dx * hw, cz + dz * hw];
  const y0 = baseY;
  const y1 = baseY + 2.1;
  const i0 = trim.vertex(p0[0]!, y0, p0[1]!, nx, 0, nz);
  const i1 = trim.vertex(p1[0]!, y0, p1[1]!, nx, 0, nz);
  const i2 = trim.vertex(p1[0]!, y1, p1[1]!, nx, 0, nz);
  const i3 = trim.vertex(p0[0]!, y1, p0[1]!, nx, 0, nz);
  trim.tri(i0, i1, i2);
  trim.tri(i0, i2, i3);
}

export function shouldPitch(b: ChunkBuilding, ring: Pt[], holes: number): boolean {
  if (b.roof) return ['hipped', 'gabled', 'pyramidal', 'half-hipped'].includes(b.roof) && ring.length === 4 && holes === 0;
  if (holes > 0 || ring.length !== 4 || NO_PITCH.has(b.k)) return false;
  const area = Math.abs(signedArea(ring));
  return b.h <= 7 && area < 320;
}

// ---------------------------------------------------------------------------
// Landmark styles (buildings linked to a named OSM landmark in the pipeline)
// ---------------------------------------------------------------------------

interface StyleDef {
  wall: number;
  roof: number;
  /** Force a hipped roof on four-cornered footprints regardless of size. */
  hip: boolean;
  windows: boolean;
}

const STYLES: Record<BuildingStyle, StyleDef> = {
  church: { wall: 0xf3f1ec, roof: 0xa8402e, hip: true, windows: true },
  buddhist: { wall: 0xeadfc4, roof: 0x8e2f23, hip: true, windows: true },
  mosque: { wall: 0xf4f4f0, roof: 0xd8d6cf, hip: false, windows: true },
  hindu: { wall: 0xf1d9b0, roof: 0xb5532e, hip: true, windows: true },
  market: { wall: 0xcfc6b2, roof: 0x9aa1a7, hip: true, windows: false },
  stadium: { wall: 0xbdb9b0, roof: 0xb3afa6, hip: false, windows: false },
  hospital: { wall: 0xf6f6f2, roof: 0xdedcd5, hip: false, windows: true },
  civic: { wall: 0xf0dfae, roof: 0xa2452f, hip: true, windows: true },
  school: { wall: 0xf3eedf, roof: 0x3e7b55, hip: true, windows: true },
  // Raised white platform; the stupas and gates are added by PagodaGenerator.
  pagoda: { wall: 0xf4f2ec, roof: 0xf4f2ec, hip: false, windows: false },
};

/** Rectangle aligned with the footprint's longest edge, inset by `scale` around the centroid. */
export function orientedRect(ring: Pt[], scale: number): Pt[] {
  let bi = 0;
  let bl = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  const a = ring[bi]!;
  const b = ring[(bi + 1) % ring.length]!;
  const ux = (b[0] - a[0]) / bl;
  const uz = (b[1] - a[1]) / bl;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of ring) {
    const u = p[0] * ux + p[1] * uz;
    const v = -p[0] * uz + p[1] * ux;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  const hu = ((maxU - minU) / 2) * scale;
  const hv = ((maxV - minV) / 2) * scale;
  const toXZ = (u: number, v: number): Pt => [u * ux - v * uz, u * uz + v * ux];
  return [toXZ(cu - hu, cv - hv), toXZ(cu + hu, cv - hv), toXZ(cu + hu, cv + hv), toXZ(cu - hu, cv + hv)];
}

function rectWalls(b: GeometryBuilder, rect: Pt[], y0: number, y1: number): void {
  for (let i = 0; i < 4; i++) {
    const a = rect[i]!;
    const c = rect[(i + 1) % 4]!;
    addBeam(b, a[0], (y0 + y1) / 2, a[1], c[0], (y0 + y1) / 2, c[1], 0.12, y1 - y0);
  }
  // Fill top so the tier reads as solid from above.
  b.upTri(rect[0]![0], rect[0]![1], rect[1]![0], rect[1]![1], rect[2]![0], rect[2]![1], y1 - 0.01);
  b.upTri(rect[0]![0], rect[0]![1], rect[2]![0], rect[2]![1], rect[3]![0], rect[3]![1], y1 - 0.01);
}

function centroidOf(r: Pt[]): Pt {
  return [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length];
}

/** Burmese tiered roof (pyatthat-inspired): stacked hipped tiers and a gold finial. */
function addTieredRoof(roof: GeometryBuilder, col: ColliderBuilder, base: Pt[], y: number, def: StyleDef, wallColor: number): void {
  let yy = y;
  const tiers = [
    { s: 0.62, wall: 0.9 },
    { s: 0.36, wall: 0.8 },
  ];
  for (const t of tiers) {
    const rect = orientedRect(base, t.s);
    const rise = 0.9;
    roof.setColor(wallColor);
    rectWalls(roof, rect, yy + rise * 0.5, yy + rise * 0.5 + t.wall);
    roof.setColor(def.roof);
    addHippedRoof(roof, col, rect, yy + rise * 0.5 + t.wall, 0.9);
    yy += rise * 0.5 + t.wall + 0.4;
  }
  const [cx, cz] = centroidOf(base);
  roof.setColor(0xd9a93c);
  addBeam(roof, cx, yy + 0.4, cz, cx, yy + 3.2, cz, 0.18, 0.18);
  addBeam(roof, cx, yy + 0.3, cz, cx, yy + 1.0, cz, 0.55, 0.55);
}

function addBellTower(roof: GeometryBuilder, ring: Pt[], y: number, wall: number, cap: number): void {
  const rect = orientedRect(ring, 1);
  // Tower centred on one short end of the building.
  const mid: Pt = [(rect[0]![0] + rect[3]![0]) / 2, (rect[0]![1] + rect[3]![1]) / 2];
  const [cx, cz] = centroidOf(rect);
  const tx = mid[0] + (cx - mid[0]) * 0.15;
  const tz = mid[1] + (cz - mid[1]) * 0.15;
  roof.setColor(wall);
  addBeam(roof, tx, 0, tz, tx, y + 5, tz, 2.6, 2.6);
  roof.setColor(cap);
  addBeam(roof, tx, y + 5, tz, tx, y + 6.2, tz, 1.6, 1.6);
  roof.setColor(0xf2efe6);
  addBeam(roof, tx, y + 6.2, tz, tx, y + 8, tz, 0.16, 0.16);
  addBeam(roof, tx - 0.5, y + 7.4, tz, tx + 0.5, y + 7.4, tz, 0.14, 0.14);
}

function addDome(roof: GeometryBuilder, cx: number, y: number, cz: number, r: number): void {
  const rings = 5;
  const segs = 12;
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings) * (Math.PI / 2);
    const a1 = ((i + 1) / rings) * (Math.PI / 2);
    for (let j = 0; j < segs; j++) {
      const b0 = (j / segs) * Math.PI * 2;
      const b1 = ((j + 1) / segs) * Math.PI * 2;
      const p = (a: number, b: number) => [cx + Math.cos(a) * Math.cos(b) * r, y + Math.sin(a) * r, cz + Math.cos(a) * Math.sin(b) * r] as const;
      const q = [p(a0, b0), p(a0, b1), p(a1, b1), p(a1, b0)];
      const mx = (q[0][0] + q[2][0]) / 2 - cx;
      const my = (q[0][1] + q[2][1]) / 2 - y;
      const mz = (q[0][2] + q[2][2]) / 2 - cz;
      const l = Math.hypot(mx, my, mz) || 1;
      const idx = q.map((v) => roof.vertex(v[0], v[1], v[2], mx / l, my / l, mz / l));
      roof.tri(idx[0]!, idx[2]!, idx[1]!);
      roof.tri(idx[0]!, idx[3]!, idx[2]!);
    }
  }
}

function addRoofCross(roof: GeometryBuilder, ring: Pt[], y: number): void {
  const rect = orientedRect(ring, 0.25);
  const [cx, cz] = centroidOf(rect);
  const s = Math.min(Math.hypot(rect[1]![0] - rect[0]![0], rect[1]![1] - rect[0]![1]), Math.hypot(rect[3]![0] - rect[0]![0], rect[3]![1] - rect[0]![1]));
  roof.setColor(0xd23434);
  addBeam(roof, cx - s / 2, y + 0.03, cz, cx + s / 2, y + 0.03, cz, s / 3, 0.04);
  addBeam(roof, cx, y + 0.03, cz - s / 2, cx, y + 0.03, cz + s / 2, s / 3, 0.04);
}

/** Compound enclosure: a 2.2 m perimeter wall (both faces) with a 5 m gate gap on the longest side. */
function addCompoundWall(walls: GeometryBuilder, col: ColliderBuilder, ring: Pt[]): void {
  let gate = 0;
  let gl = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > gl) {
      gl = l;
      gate = i;
    }
  });
  walls.setColor(0xece6d6);
  const seg = (a: Pt, b: Pt) => {
    addBeam(walls, a[0], 1.1, a[1], b[0], 1.1, b[1], 0.25, 2.2);
    col.quad(a[0], a[1], b[0], b[1], 0, 2.2);
  };
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    if (i !== gate || gl < 8) return seg(a, b);
    const t0 = 0.5 - 2.5 / gl;
    const t1 = 0.5 + 2.5 / gl;
    seg(a, [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
    seg([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1], b);
  });
}

export function buildBuildings(buildings: ChunkBuilding[]): BuildingMeshes {
  const walls = new GeometryBuilder();
  const roofs = new GeometryBuilder();
  const col = new ColliderBuilder();
  const footprints: Pt[][] = [];

  for (const b of buildings) {
    let outer = flatToPts(b.p);
    if (outer.length < 3) continue;
    outer = orientRing(outer, true);
    const holes = (b.holes ?? []).map(flatToPts).filter((h) => h.length >= 3).map((h) => orientRing(h, false));
    if (b.cp) {
      // Mapped compound outline: wall around it, open inside.
      addCompoundWall(walls, col, outer);
      continue;
    }
    footprints.push(outer);
    const def = b.st ? STYLES[b.st] : undefined;
    const pitched = def ? def.hip && outer.length === 4 && holes.length === 0 : shouldPitch(b, outer, holes.length);
    const y0 = Math.max(0, b.mh);
    const y1 = Math.max(y0 + 1, b.h);
    const windows = (def ? def.windows : !NO_WINDOWS.has(b.k)) && y1 - y0 >= 2.4;
    const wallColor = def ? def.wall : facadeColor(b.id, b.k);
    walls.setColor(wallColor);
    addWalls(walls, col, outer, y0, y1, windows);
    for (const h of holes) addWalls(walls, col, h, y0, y1, windows);

    roofs.setColor(def ? def.roof : roofColor(b.id, pitched));
    let roofDone = false;
    if (pitched) roofDone = addHippedRoof(roofs, col, outer, y1, b.st === 'buddhist' || b.st === 'hindu' ? 0.8 : 1);
    if (!roofDone) addFlatRoof(roofs, col, outer, holes, y1);
    if (def && b.st) {
      if (b.st === 'buddhist' || b.st === 'hindu') addTieredRoof(roofs, col, outer, y1 + (pitched ? 0.6 : 0), def, wallColor);
      else if (b.st === 'church') addBellTower(roofs, outer, y1, wallColor, def.roof);
      else if (b.st === 'mosque') {
        const [cx, cz] = centroidOf(outer);
        const rect = orientedRect(outer, 0.5);
        const r = Math.min(Math.hypot(rect[1]![0] - rect[0]![0], rect[1]![1] - rect[0]![1]), Math.hypot(rect[3]![0] - rect[0]![0], rect[3]![1] - rect[0]![1])) / 2;
        roofs.setColor(0x3f8a5a);
        addDome(roofs, cx, y1, cz, Math.max(1.5, r));
      } else if (b.st === 'hospital') addRoofCross(roofs, outer, y1);
    }
    if (y0 === 0 && (hashString(b.id) & 3) !== 3) {
      roofs.setColor(0x5a4636);
      addDoor(roofs, outer, 0);
    }
  }

  if (walls.isEmpty() && roofs.isEmpty()) return { geometry: null, collider: null, footprints, triangles: 0 };

  // Merge walls + roofs into one geometry with two material groups.
  const merged = new GeometryBuilder();
  merged.positions = walls.positions.concat(roofs.positions);
  merged.normals = walls.normals.concat(roofs.normals);
  merged.colors = walls.colors.concat(roofs.colors);
  merged.uvs = walls.uvs.concat(roofs.uvs);
  const offset = walls.vertexCount;
  merged.indices = walls.indices.concat(roofs.indices.map((i) => i + offset));
  const geometry = merged.build();
  geometry.addGroup(0, walls.indices.length, 0);
  geometry.addGroup(walls.indices.length, roofs.indices.length, 1);

  return {
    geometry,
    collider: { vertices: new Float32Array(col.v), indices: new Uint32Array(col.idx) },
    footprints,
    triangles: merged.indices.length / 3,
  };
}

