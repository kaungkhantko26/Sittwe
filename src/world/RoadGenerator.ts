import type * as THREE from 'three';
import type { ChunkRoad } from '../geo/chunkFormat';
import type { RoadClass } from '../geo/OSMParser';
import { addBeam, GeometryBuilder } from './GeometryBuilder';
import { SurfaceY } from './materials';

/**
 * Turns real OSM road centerlines into continuous road meshes.
 *
 *  - Each polyline becomes a ribbon with mitred joins (miter length clamped).
 *  - Original OSM end vertices get a round cap so T-junctions/crossings have
 *    no visible gaps; chunk-border cuts get no cap (the neighbour continues it).
 *  - Primary/secondary/tertiary roads get raised sidewalks with a curb face
 *    and centre-line dashes, both interrupted near junctions.
 *  - Streetlight positions are generated along major roads (these are
 *    decorative props, NOT mapped street lamps).
 */

export const DRIVABLE: ReadonlySet<RoadClass> = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service']);
const WITH_SIDEWALK: ReadonlySet<RoadClass> = new Set(['primary', 'secondary', 'tertiary']);
const WITH_CENTERLINE: ReadonlySet<RoadClass> = new Set(['primary', 'secondary', 'tertiary']);

const SIDEWALK_WIDTH = 1.8;
const SIDEWALK_Y = 0.15;
const CAP_SEGMENTS = 10;
const LAMP_SPACING = 34;

const PATH_COLORS: Partial<Record<RoadClass, number>> = {
  path: 0xb9ad93,
  pedestrian: 0xb3aea4,
  track: 0x95805f,
};

export interface RoadMeshes {
  asphalt: THREE.BufferGeometry | null;
  sidewalk: THREE.BufferGeometry | null;
  path: THREE.BufferGeometry | null;
  marking: THREE.BufferGeometry | null;
  wood: THREE.BufferGeometry | null;
  rail: THREE.BufferGeometry | null;
  /** Bridge arches, hangers and railings (steel material). */
  steel: THREE.BufferGeometry | null;
  /** Vertex-coloured solids: red/white kerbs, bridge end posts. */
  solid: THREE.BufferGeometry | null;
  /** Generated (not mapped) streetlight positions, flat x,z. */
  lampCandidates: number[];
  stats: { triangles: number };
}

interface Junction {
  x: number;
  z: number;
  r: number;
}

const key = (x: number, z: number) => `${Math.round(x * 10)},${Math.round(z * 10)}`;

/** Finds junctions: points shared by two or more road polylines. */
export function findJunctions(roads: ChunkRoad[]): Junction[] {
  const map = new Map<string, { x: number; z: number; roads: Set<number>; hw: number }>();
  roads.forEach((r, ri) => {
    if (r.c === 'path' || r.c === 'pier') return;
    const n = r.p.length / 2;
    for (let i = 0; i < n; i++) {
      // Skip chunk-border cut points: they are not real vertices.
      if ((i === 0 && !r.s) || (i === n - 1 && !r.e)) continue;
      const x = r.p[i * 2]!;
      const z = r.p[i * 2 + 1]!;
      const k = key(x, z);
      let j = map.get(k);
      if (!j) {
        j = { x, z, roads: new Set(), hw: 0 };
        map.set(k, j);
      }
      j.roads.add(ri);
      j.hw = Math.max(j.hw, r.w / 2);
    }
  });
  const out: Junction[] = [];
  for (const j of map.values()) if (j.roads.size >= 2) out.push({ x: j.x, z: j.z, r: j.hw + SIDEWALK_WIDTH + 0.6 });
  return out;
}

function nearJunction(x: number, z: number, js: Junction[], extra = 0): boolean {
  for (const j of js) {
    const dx = x - j.x;
    const dz = z - j.z;
    const r = j.r + extra;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

/** Per-vertex miter offset vectors (unit normal × miter scale) for a polyline. */
export function miterNormals(p: number[]): Float64Array {
  const n = p.length / 2;
  const out = new Float64Array(n * 2);
  const segN = (i: number): [number, number] => {
    const dx = p[(i + 1) * 2]! - p[i * 2]!;
    const dz = p[(i + 1) * 2 + 1]! - p[i * 2 + 1]!;
    const len = Math.hypot(dx, dz) || 1;
    return [-dz / len, dx / len];
  };
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? segN(i - 1) : null;
    const b = i < n - 1 ? segN(i) : null;
    let nx: number;
    let nz: number;
    if (a && b) {
      nx = a[0] + b[0];
      nz = a[1] + b[1];
      const len = Math.hypot(nx, nz);
      if (len < 1e-6) {
        nx = b[0];
        nz = b[1];
      } else {
        nx /= len;
        nz /= len;
        const cos = nx * b[0] + nz * b[1];
        const scale = 1 / Math.max(0.4, cos);
        nx *= scale;
        nz *= scale;
      }
    } else {
      const s = (a ?? b)!;
      nx = s[0];
      nz = s[1];
    }
    out[i * 2] = nx;
    out[i * 2 + 1] = nz;
  }
  return out;
}

/** Adds a ribbon covering offsets [d0, d1] from the centerline. */
export function addStrip(b: GeometryBuilder, p: number[], normals: Float64Array, d0: number, d1: number, y: number, skip?: (x: number, z: number) => boolean, pieceLen = 4): void {
  const n = p.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2]!;
    const az = p[i * 2 + 1]!;
    const bx = p[(i + 1) * 2]!;
    const bz = p[(i + 1) * 2 + 1]!;
    const segLen = Math.hypot(bx - ax, bz - az);
    const pieces = skip ? Math.max(1, Math.ceil(segLen / pieceLen)) : 1;
    const nax = normals[i * 2]!;
    const naz = normals[i * 2 + 1]!;
    const nbx = normals[(i + 1) * 2]!;
    const nbz = normals[(i + 1) * 2 + 1]!;
    for (let k = 0; k < pieces; k++) {
      const t0 = k / pieces;
      const t1 = (k + 1) / pieces;
      const cx0 = ax + (bx - ax) * t0;
      const cz0 = az + (bz - az) * t0;
      const cx1 = ax + (bx - ax) * t1;
      const cz1 = az + (bz - az) * t1;
      if (skip && skip((cx0 + cx1) / 2 + (nax + nbx) * 0.25 * (d0 + d1), (cz0 + cz1) / 2 + (naz + nbz) * 0.25 * (d0 + d1))) continue;
      const nx0 = nax + (nbx - nax) * t0;
      const nz0 = naz + (nbz - naz) * t0;
      const nx1 = nax + (nbx - nax) * t1;
      const nz1 = naz + (nbz - naz) * t1;
      const p0x = cx0 + nx0 * d0;
      const p0z = cz0 + nz0 * d0;
      const p1x = cx0 + nx0 * d1;
      const p1z = cz0 + nz0 * d1;
      const p2x = cx1 + nx1 * d1;
      const p2z = cz1 + nz1 * d1;
      const p3x = cx1 + nx1 * d0;
      const p3z = cz1 + nz1 * d0;
      b.upTri(p0x, p0z, p1x, p1z, p2x, p2z, y);
      b.upTri(p0x, p0z, p2x, p2z, p3x, p3z, y);
    }
  }
}

function addCap(b: GeometryBuilder, x: number, z: number, r: number, y: number): void {
  for (let i = 0; i < CAP_SEGMENTS; i++) {
    const a0 = (i / CAP_SEGMENTS) * Math.PI * 2;
    const a1 = ((i + 1) / CAP_SEGMENTS) * Math.PI * 2;
    b.upTri(x, z, x + Math.cos(a0) * r, z + Math.sin(a0) * r, x + Math.cos(a1) * r, z + Math.sin(a1) * r, y);
  }
}

/** Vertical face along an offset line (curbs, bridge railings). */
function addWall(b: GeometryBuilder, p: number[], normals: Float64Array, d: number, y0: number, y1: number, skip?: (x: number, z: number) => boolean): void {
  const n = p.length / 2;
  const side = Math.sign(d) || 1;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2]! + normals[i * 2]! * d;
    const az = p[i * 2 + 1]! + normals[i * 2 + 1]! * d;
    const bx = p[(i + 1) * 2]! + normals[(i + 1) * 2]! * d;
    const bz = p[(i + 1) * 2 + 1]! + normals[(i + 1) * 2 + 1]! * d;
    const segLen = Math.hypot(bx - ax, bz - az);
    const pieces = skip ? Math.max(1, Math.ceil(segLen / 4)) : 1;
    // Wall faces toward the road centerline (inward).
    const fx = -normals[i * 2]! * side;
    const fz = -normals[i * 2 + 1]! * side;
    const fl = Math.hypot(fx, fz) || 1;
    for (let k = 0; k < pieces; k++) {
      const x0 = ax + (bx - ax) * (k / pieces);
      const z0 = az + (bz - az) * (k / pieces);
      const x1 = ax + (bx - ax) * ((k + 1) / pieces);
      const z1 = az + (bz - az) * ((k + 1) / pieces);
      if (skip && skip((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      const i0 = b.vertex(x0, y0, z0, fx / fl, 0, fz / fl);
      const i1 = b.vertex(x1, y0, z1, fx / fl, 0, fz / fl);
      const i2 = b.vertex(x1, y1, z1, fx / fl, 0, fz / fl);
      const i3 = b.vertex(x0, y1, z0, fx / fl, 0, fz / fl);
      // Orientation: ensure the face normal matches (fx, fz).
      const ex = x1 - x0;
      const ez = z1 - z0;
      // (i1-i0) × (i2-i0) = e × up = (-ez, 0, ex)
      if (-ez * fx + ex * fz >= 0) b.quad(i0, i1, i2, i3);
      else b.quad(i0, i3, i2, i1);
    }
  }
}

function addDashes(b: GeometryBuilder, p: number[], halfW: number, y: number, skip: (x: number, z: number) => boolean, dash = 3, gap = 5): void {
  const n = p.length / 2;
  let phase = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2]!;
    const az = p[i * 2 + 1]!;
    const bx = p[(i + 1) * 2]!;
    const bz = p[(i + 1) * 2 + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    let t = -phase;
    while (t < len) {
      const s0 = Math.max(0, t);
      const s1 = Math.min(len, t + dash);
      if (s1 > s0 + 0.3) {
        const mx = ax + dx * (s0 + s1) * 0.5;
        const mz = az + dz * (s0 + s1) * 0.5;
        if (!skip(mx, mz)) {
          const x0 = ax + dx * s0;
          const z0 = az + dz * s0;
          const x1 = ax + dx * s1;
          const z1 = az + dz * s1;
          const nx = -dz * halfW;
          const nz = dx * halfW;
          b.upTri(x0 + nx, z0 + nz, x1 + nx, z1 + nz, x1 - nx, z1 - nz, y);
          b.upTri(x0 + nx, z0 + nz, x1 - nx, z1 - nz, x0 - nx, z0 - nz, y);
        }
      }
      t += dash + gap;
    }
    phase = (t - len) > 0 ? (dash + gap) - (t - len) : 0;
    phase = ((phase % (dash + gap)) + dash + gap) % (dash + gap);
  }
}

export function buildRoads(roads: ChunkRoad[]): RoadMeshes {
  const asphalt = new GeometryBuilder();
  const sidewalk = new GeometryBuilder();
  const path = new GeometryBuilder();
  const marking = new GeometryBuilder();
  const wood = new GeometryBuilder();
  const rail = new GeometryBuilder();
  const steel = new GeometryBuilder();
  const solid = new GeometryBuilder();
  const lampCandidates: number[] = [];
  const junctions = findJunctions(roads);
  const nearJ = (x: number, z: number) => nearJunction(x, z, junctions);
  const nearJTight = (x: number, z: number) => nearJunction(x, z, junctions, -SIDEWALK_WIDTH);
  sidewalk.setColor(0xb0aca3);

  for (const r of roads) {
    if (r.p.length < 4) continue;
    const hw = r.w / 2;
    const normals = miterNormals(r.p);
    const n = r.p.length / 2;
    const firstX = r.p[0]!;
    const firstZ = r.p[1]!;
    const lastX = r.p[(n - 1) * 2]!;
    const lastZ = r.p[(n - 1) * 2 + 1]!;

    if (r.c === 'pier') {
      addStrip(wood, r.p, normals, -hw, hw, SurfaceY.pier);
      addWall(rail, r.p, normals, hw, SurfaceY.pier, SurfaceY.pier + 0.9);
      addWall(rail, r.p, normals, -hw, SurfaceY.pier, SurfaceY.pier + 0.9);
      continue;
    }

    if (DRIVABLE.has(r.c)) {
      addStrip(asphalt, r.p, normals, -hw, hw, SurfaceY.asphalt);
      if (r.s) addCap(asphalt, firstX, firstZ, hw, SurfaceY.asphalt);
      if (r.e) addCap(asphalt, lastX, lastZ, hw, SurfaceY.asphalt);

      if (WITH_SIDEWALK.has(r.c) && !r.b) {
        for (const side of [1, -1]) {
          addStrip(sidewalk, r.p, normals, side * hw, side * (hw + SIDEWALK_WIDTH), SIDEWALK_Y, nearJ);
          addWall(sidewalk, r.p, normals, side * hw, SurfaceY.asphalt, SIDEWALK_Y, nearJ);
        }
      }
      if (WITH_CENTERLINE.has(r.c) && r.w >= 6) {
        addDashes(marking, r.p, 0.08, SurfaceY.marking, nearJTight);
      }
      if (r.b) addBridge(r, normals, hw, steel, solid, sidewalk);
      if (WITH_SIDEWALK.has(r.c) && !r.b) collectLamps(r.p, hw + SIDEWALK_WIDTH - 0.35, nearJ, lampCandidates);
    } else {
      path.setColor(PATH_COLORS[r.c] ?? 0xb9ad93);
      const y = r.c === 'track' ? SurfaceY.track : SurfaceY.path;
      addStrip(path, r.p, normals, -hw, hw, y);
      if (r.s) addCap(path, firstX, firstZ, hw, y);
      if (r.e) addCap(path, lastX, lastZ, hw, y);
    }
  }

  const out = (b: GeometryBuilder) => (b.isEmpty() ? null : b.build());
  const triangles = (steel.indices.length + solid.indices.length + asphalt.indices.length + sidewalk.indices.length + path.indices.length + marking.indices.length + wood.indices.length + rail.indices.length) / 3;
  return { asphalt: out(asphalt), sidewalk: out(sidewalk), path: out(path), marking: out(marking), wood: out(wood), rail: out(rail), steel: out(steel), solid: out(solid), lampCandidates, stats: { triangles } };
}

/** Points every `step` meters along a polyline offset sideways by `offset`: [x, z, segmentIndex][] */
function samplesAlong(p: number[], normals: Float64Array, offset: number, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = p.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2]! + normals[i * 2]! * offset;
    const az = p[i * 2 + 1]! + normals[i * 2 + 1]! * offset;
    const bx = p[(i + 1) * 2]! + normals[(i + 1) * 2]! * offset;
    const bz = p[(i + 1) * 2 + 1]! + normals[(i + 1) * 2 + 1]! * offset;
    const len = Math.hypot(bx - ax, bz - az);
    const k = Math.max(1, Math.round(len / step));
    for (let j = 0; j < k; j++) out.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]);
    if (i === n - 2) out.push([bx, bz]);
  }
  return out;
}

/**
 * Bridges (OSM bridge=yes). Deck = the road ribbon; this adds red/white
 * kerbs, walkways, outer railings, concrete end posts and — on major roads
 * long enough — a pair of steel bowstring arches with hangers, modelled on
 * Sittwe's arched canal bridges (e.g. Bilu Ma bridge on Main Road).
 * The arch design is an artistic representation; position and length are real.
 */
function addBridge(r: ChunkRoad, normals: Float64Array, hw: number, steel: GeometryBuilder, solid: GeometryBuilder, walkway: GeometryBuilder): void {
  const p = r.p;
  const n = p.length / 2;
  const major = r.c === 'primary' || r.c === 'secondary' || r.c === 'tertiary';
  const walkW = major ? 2.0 : 0.9;
  const deckY = SurfaceY.asphalt;
  const ax = p[0]!;
  const az = p[1]!;
  const bx = p[(n - 1) * 2]!;
  const bz = p[(n - 1) * 2 + 1]!;
  const L = Math.hypot(bx - ax, bz - az);
  for (const side of [1, -1]) {
    // Walkway.
    addStrip(walkway, p, normals, side * (hw + 0.3), side * (hw + 0.3 + walkW), deckY + 0.12);
    // Red/white kerb blocks.
    const kerb = samplesAlong(p, normals, side * (hw + 0.15), 1.2);
    for (let i = 0; i < kerb.length - 1; i++) {
      solid.setColor(i % 2 ? 0xf2f0ea : 0xc8322f);
      addBeam(solid, kerb[i]![0], deckY + 0.16, kerb[i]![1], kerb[i + 1]![0], deckY + 0.16, kerb[i + 1]![1], 0.3, 0.32);
    }
    // Outer railing: posts every ~2 m plus a top rail.
    const rail = samplesAlong(p, normals, side * (hw + 0.3 + walkW), 2);
    for (let i = 0; i < rail.length; i++) {
      addBeam(steel, rail[i]![0], deckY, rail[i]![1], rail[i]![0], deckY + 1.15, rail[i]![1], 0.08, 0.08);
      if (i < rail.length - 1) {
        addBeam(steel, rail[i]![0], deckY + 1.12, rail[i]![1], rail[i + 1]![0], deckY + 1.12, rail[i + 1]![1], 0.07, 0.07);
        addBeam(steel, rail[i]![0], deckY + 0.6, rail[i]![1], rail[i + 1]![0], deckY + 0.6, rail[i + 1]![1], 0.05, 0.05);
      }
    }
    // Concrete end posts.
    solid.setColor(0xd9d4c8);
    for (const [ex, ez, i] of [[ax, az, 0], [bx, bz, n - 1]] as const) {
      const ox = normals[i * 2]! * side * (hw + 0.3 + walkW);
      const oz = normals[i * 2 + 1]! * side * (hw + 0.3 + walkW);
      addBeam(solid, ex + ox, deckY, ez + oz, ex + ox, deckY + 1.4, ez + oz, 0.55, 0.55);
    }
    // Bowstring arch between roadway and walkway.
    if (major && L >= 10) {
      const off = side * (hw + 0.3);
      const nx0 = normals[0]! * off;
      const nz0 = normals[1]! * off;
      const nx1 = normals[(n - 1) * 2]! * off;
      const nz1 = normals[(n - 1) * 2 + 1]! * off;
      const H = Math.min(6.5, 0.18 * L + 1.2);
      const segs = 18;
      const pt = (t: number): [number, number, number] => [
        ax + (bx - ax) * t + nx0 + (nx1 - nx0) * t,
        deckY + 0.9 + H * 4 * t * (1 - t),
        az + (bz - az) * t + nz0 + (nz1 - nz0) * t,
      ];
      for (let k = 0; k < segs; k++) {
        const a = pt(k / segs);
        const b = pt((k + 1) / segs);
        addBeam(steel, a[0], a[1], a[2], b[0], b[1], b[2], 0.34, 0.34);
      }
      // Bottom chord and vertical hangers.
      const s0 = pt(0);
      const s1 = pt(1);
      addBeam(steel, s0[0], deckY + 0.9, s0[2], s1[0], deckY + 0.9, s1[2], 0.26, 0.26);
      const hangers = Math.max(3, Math.round(L / 2.2));
      for (let k = 1; k < hangers; k++) {
        const a = pt(k / hangers);
        addBeam(steel, a[0], deckY + 0.9, a[2], a[0], a[1], a[2], 0.08, 0.08);
      }
    }
  }
}

/** Places streetlight candidates every LAMP_SPACING meters, alternating sides. */
function collectLamps(p: number[], offset: number, skip: (x: number, z: number) => boolean, out: number[]): void {
  let acc = LAMP_SPACING / 2;
  let side = 1;
  const n = p.length / 2;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2]!;
    const az = p[i * 2 + 1]!;
    const bx = p[(i + 1) * 2]!;
    const bz = p[(i + 1) * 2 + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    while (acc < len) {
      const x = ax + dx * acc + -dz * offset * side;
      const z = az + dz * acc + dx * offset * side;
      if (!skip(x, z)) out.push(x, z);
      side = -side;
      acc += LAMP_SPACING;
    }
    acc -= len;
  }
}
