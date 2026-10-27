/**
 * Pure layout of a pagoda complex on its real mapped footprint (no Three.js),
 * shared by the 3D builder, navigation, visitor NPCs, interactions and tests.
 *
 * Everything is derived from the OSM footprint polygon and the mapped
 * landmark node: the platform's principal axes, where the four staircases
 * meet the real (possibly concave) platform edge, which entrance faces the
 * nearest road (the main entrance), and where the main hall, the stupa
 * terraces, the visitors' clockwise circumambulation path and the prayer
 * and meditation spots go.
 */
import { pointInRing, type Pt } from './geometry2d';

export const PLATFORM_Y = 1.2;

export interface Entrance {
  /** Where the stair meets the platform edge. */
  edge: [number, number];
  /** Bottom of the stairs on the ground (navigation target). */
  bottom: [number, number];
  /** Unit vector pointing outward from the platform. */
  out: [number, number];
  /** Unit vector along the stair width. */
  along: [number, number];
}

export interface PagodaLayout {
  centre: [number, number];
  /** Footprint ring (open). */
  ring: Pt[];
  u: [number, number];
  v: [number, number];
  lenU: number;
  lenV: number;
  minSide: number;
  stairWidth: number;
  entrances: Entrance[];
  /** Index into `entrances` of the main entrance (nearest a road). */
  main: number;
  stupa: { baseR: number; height: number; terraceR: number[]; terraceH: number };
  /** Ring of small stupas: radius and the angles (radians, atan2(z, x)) actually used. */
  smallStupas: { radius: number; angles: number[] };
  /** Main hall in front of the stupa on the main axis. */
  hall: { centre: [number, number]; out: [number, number]; width: number; depth: number; height: number } | null;
  /** Clockwise circumambulation loop for visitors (closed polyline on the platform). */
  circuit: Array<[number, number]>;
  /** Spots facing the stupa where visitors pause to pray: [x, z, yaw]. */
  prayerSpots: Array<[number, number, number]>;
  /** Meditation mats inside the hall: [x, z, yaw]. */
  mats: Array<[number, number, number]>;
}

function principalAxes(ring: Pt[]): { u: [number, number]; v: [number, number]; lenU: number; lenV: number; cx: number; cz: number } {
  // Longest edge direction defines u.
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
    const pu = p[0] * ux + p[1] * uz;
    const pv = -p[0] * uz + p[1] * ux;
    minU = Math.min(minU, pu);
    maxU = Math.max(maxU, pu);
    minV = Math.min(minV, pv);
    maxV = Math.max(maxV, pv);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return { u: [ux, uz], v: [-uz, ux], lenU: maxU - minU, lenV: maxV - minV, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux };
}

/** Distance from (cx, cz) along (dx, dz) to the polygon edge (first crossing). */
function rayToEdge(cx: number, cz: number, dx: number, dz: number, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const cross = dx * ez - dz * ex;
    if (Math.abs(cross) < 1e-9) continue;
    const ax = a[0] - cx;
    const az = a[1] - cz;
    const t = (ax * ez - az * ex) / cross;
    const s = (ax * dz - az * dx) / cross;
    if (t >= 0 && s >= 0 && s <= 1) best = Math.min(best, t);
  }
  return best;
}

export interface LayoutOptions {
  /** Distance to the nearest road from a point (used to pick the main entrance). */
  roadDistance?: (x: number, z: number) => number;
  /** Override stupa size (e.g. published dimensions). */
  stupa?: { baseR: number; height: number };
  /** Build a main hall with an interior. */
  hall?: boolean;
  /** Preferred outward direction of the main entrance (from the data pipeline). */
  mainOut?: [number, number];
}

export function pagodaLayout(footprint: number[], node: { x: number; z: number }, opts: LayoutOptions = {}): PagodaLayout | null {
  const ring: Pt[] = [];
  for (let i = 0; i < footprint.length; i += 2) ring.push([footprint[i]!, footprint[i + 1]!]);
  if (ring.length < 3) return null;
  const ax = principalAxes(ring);
  const minSide = Math.min(ax.lenU, ax.lenV);
  // Centre: the mapped node when it sits near the middle of the platform.
  const nodeInside = pointInRing(node.x, node.z, ring) && Math.hypot(node.x - ax.cx, node.z - ax.cz) < minSide * 0.25;
  const cx = nodeInside ? node.x : ax.cx;
  const cz = nodeInside ? node.z : ax.cz;
  const stairWidth = Math.min(6, minSide * 0.12 + 2);

  const dirs: Array<[number, number]> = [ax.u, [-ax.u[0], -ax.u[1]], ax.v, [-ax.v[0], -ax.v[1]]];
  const entrances: Entrance[] = [];
  for (const d of dirs) {
    const dist = rayToEdge(cx, cz, d[0], d[1], ring);
    if (!Number.isFinite(dist)) continue;
    const edge: [number, number] = [cx + d[0] * dist, cz + d[1] * dist];
    entrances.push({ edge, bottom: [edge[0] + d[0] * 2.4, edge[1] + d[1] * 2.4], out: d, along: [-d[1], d[0]] });
  }
  if (!entrances.length) return null;
  let main = 0;
  if (opts.mainOut) {
    let best = -Infinity;
    entrances.forEach((e, i) => {
      const d = e.out[0] * opts.mainOut![0] + e.out[1] * opts.mainOut![1];
      if (d > best) {
        best = d;
        main = i;
      }
    });
  } else if (opts.roadDistance) {
    let bd = Infinity;
    entrances.forEach((e, i) => {
      const d = opts.roadDistance!(e.bottom[0], e.bottom[1]);
      if (d < bd) {
        bd = d;
        main = i;
      }
    });
  }

  const baseR = opts.stupa?.baseR ?? Math.max(4, minSide * 0.2);
  const height = opts.stupa?.height ?? Math.min(38, Math.max(14, minSide * 0.5));
  const terraceR = [baseR * 1.55, baseR * 1.36, baseR * 1.18];
  const terraceH = 1.0;
  const m = entrances[main]!;
  const mainDist = Math.hypot(m.edge[0] - cx, m.edge[1] - cz);

  // Main hall between the terraces and the main entrance, if there is room.
  let hall: PagodaLayout['hall'] = null;
  const hallStart = terraceR[0]! + 5;
  const hallEnd = mainDist - 2.5;
  if (opts.hall !== false && hallEnd - hallStart >= 7) {
    const depth = Math.min(11, hallEnd - hallStart);
    const mid = hallEnd - depth / 2;
    hall = { centre: [cx + m.out[0] * mid, cz + m.out[1] * mid], out: m.out, width: Math.min(15, minSide * 0.24), depth, height: 6.5 };
  }

  // Small stupas around the terraces, skipping the hall direction.
  const radius = terraceR[0]! + 4;
  const mainAngle = Math.atan2(m.out[1], m.out[0]);
  const angles: number[] = [];
  for (let k = 0; k < 8; k++) {
    const a = mainAngle + Math.PI / 8 + (k * Math.PI) / 4;
    const da = Math.abs(Math.atan2(Math.sin(a - mainAngle), Math.cos(a - mainAngle)));
    if (hall && da < 0.5) continue;
    const x = cx + Math.cos(a) * radius;
    const z = cz + Math.sin(a) * radius;
    if (!pointInRing(x, z, ring)) continue;
    angles.push(a);
  }

  // Loop just outside the terraces. With X = east and Z = south, increasing
  // atan2(z, x) runs clockwise seen from above, keeping the stupa on the
  // walker's right, as in traditional circumambulation.
  const circuitR = terraceR[0]! + 1.7;
  const circuit: Array<[number, number]> = [];
  for (let k = 0; k < 24; k++) {
    const a = mainAngle + (k / 24) * Math.PI * 2;
    circuit.push([cx + Math.cos(a) * circuitR, cz + Math.sin(a) * circuitR]);
  }
  const prayerSpots: Array<[number, number, number]> = [];
  for (let k = 0; k < 4; k++) {
    const a = mainAngle + Math.PI / 4 + (k * Math.PI) / 2;
    const x = cx + Math.cos(a) * (circuitR + 0.2);
    const z = cz + Math.sin(a) * (circuitR + 0.2);
    // Face the stupa: yaw so that -Z local points toward the centre.
    prayerSpots.push([x, z, Math.atan2(x - cx, z - cz)]);
  }
  const mats: Array<[number, number, number]> = [];
  if (hall) {
    const back = hall.depth / 2 - 3.2; // in front of the altar at the back wall
    for (const s of [-2.2, 0, 2.2]) {
      const x = hall.centre[0] - hall.out[0] * back + -hall.out[1] * s;
      const z = hall.centre[1] - hall.out[1] * back + hall.out[0] * s;
      // Face the altar (which is toward the stupa, i.e. -out).
      mats.push([x, z, Math.atan2(hall.out[0], hall.out[1])]);
    }
  }

  return {
    centre: [cx, cz],
    ring,
    u: ax.u,
    v: ax.v,
    lenU: ax.lenU,
    lenV: ax.lenV,
    minSide,
    stairWidth,
    entrances,
    main,
    stupa: { baseR, height, terraceR, terraceH },
    smallStupas: { radius, angles },
    hall,
    circuit,
    prayerSpots,
    mats,
  };
}

/** Published figures for Lawkanandar Pagoda used to size the model (162 ft ≈ 49.4 m tall; 232 ft ≈ 70.7 m base circumference). */
export const LAWKANANDAR = {
  osmId: 'node/1230796347',
  totalHeight: 49.4,
  baseCircumference: 70.7,
} as const;

export function isLawkanandar(lm: { id: string; n: string; ne?: string }): boolean {
  return lm.id === LAWKANANDAR.osmId || /lawkanand|လောကနန္ဒာ/i.test(`${lm.ne ?? ''} ${lm.n}`);
}
