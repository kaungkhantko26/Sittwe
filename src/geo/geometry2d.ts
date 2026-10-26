/**
 * Small, dependency-free 2D geometry toolkit used by both the data pipeline
 * (in lon/lat space) and the game (in local x/z meter space).
 *
 * Unless stated otherwise, "clockwise" / "counter-clockwise" assume a Y-up
 * plane (e.g. lon = x, lat = y).
 */

export type Pt = [number, number];
export type Ring = Pt[];

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function signedArea(ring: Ring): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    a += (ring[j]![0] * ring[i]![1]) - (ring[i]![0] * ring[j]![1]);
  }
  return a / 2;
}

/** Removes a duplicated closing vertex (first == last) if present. */
export function openRing(ring: Ring): Ring {
  if (ring.length > 1) {
    const a = ring[0]!;
    const b = ring[ring.length - 1]!;
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

export function ringCentroid(ring: Ring): Pt {
  const r = openRing(ring);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const p = r[j]!;
    const q = r[i]!;
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate: fall back to vertex average.
    let sx = 0;
    let sy = 0;
    for (const p of r) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / Math.max(1, r.length), sy / Math.max(1, r.length)];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd test over all rings (outer + holes). */
export function pointInRings(x: number, y: number, rings: Ring[]): boolean {
  let inside = false;
  for (const r of rings) if (pointInRing(x, y, r)) inside = !inside;
  return inside;
}

export function ringBounds(ring: Ring): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

// ---------------------------------------------------------------------------
// Clipping
// ---------------------------------------------------------------------------

/** Liang–Barsky segment clip. Returns [t0, t1] or null if fully outside. */
function clipSegment(ax: number, ay: number, bx: number, by: number, r: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - r.minX, r.maxX - ax, ay - r.minY, r.maxY - ay];
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return null;
    } else {
      const t = qi / pi;
      if (pi < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [t0, t1];
}

export interface ClippedLine {
  points: Pt[];
  /** True if the first point was created by the clip (not an original vertex). */
  startCut: boolean;
  /** True if the last point was created by the clip (not an original vertex). */
  endCut: boolean;
}

/** Clips a polyline to a rectangle, preserving direction. May return several pieces. */
export function clipPolyline(points: Pt[], r: Rect): ClippedLine[] {
  const out: ClippedLine[] = [];
  let cur: ClippedLine | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const t = clipSegment(a[0], a[1], b[0], b[1], r);
    if (!t) {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      continue;
    }
    const [t0, t1] = t;
    const p0: Pt = t0 === 0 ? a : [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
    const p1: Pt = t1 === 1 ? b : [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    if (cur && t0 === 0) {
      cur.points.push(p1);
      cur.endCut = t1 !== 1;
    } else {
      if (cur) out.push(cur);
      cur = { points: [p0, p1], startCut: t0 !== 0, endCut: t1 !== 1 };
    }
    if (t1 !== 1 && cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.points.length >= 2);
}

/** Sutherland–Hodgman clip of a (open or closed) ring against a rectangle. */
export function clipRing(ring: Ring, r: Rect): Ring {
  let poly = openRing(ring);
  const edges: Array<[(p: Pt) => boolean, (a: Pt, b: Pt) => Pt]> = [
    [(p) => p[0] >= r.minX, (a, b) => lerpX(a, b, r.minX)],
    [(p) => p[0] <= r.maxX, (a, b) => lerpX(a, b, r.maxX)],
    [(p) => p[1] >= r.minY, (a, b) => lerpY(a, b, r.minY)],
    [(p) => p[1] <= r.maxY, (a, b) => lerpY(a, b, r.maxY)],
  ];
  for (const [inside, intersect] of edges) {
    if (poly.length === 0) break;
    const input = poly;
    poly = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      const cIn = inside(cur);
      const pIn = inside(prev);
      if (cIn) {
        if (!pIn) poly.push(intersect(prev, cur));
        poly.push(cur);
      } else if (pIn) {
        poly.push(intersect(prev, cur));
      }
    }
  }
  return poly.length >= 3 ? poly : [];
}

function lerpX(a: Pt, b: Pt, x: number): Pt {
  const t = (x - a[0]) / (b[0] - a[0]);
  return [x, a[1] + (b[1] - a[1]) * t];
}
function lerpY(a: Pt, b: Pt, y: number): Pt {
  const t = (y - a[1]) / (b[1] - a[1]);
  return [a[0] + (b[0] - a[0]) * t, y];
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// ---------------------------------------------------------------------------
// Ring assembly (for OSM multipolygon relations and coastline merging)
// ---------------------------------------------------------------------------

function samePt(a: Pt, b: Pt): boolean {
  return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/**
 * Joins open line strings that share endpoints into longer lines (and closed
 * rings when possible). Lines may be reversed to connect.
 * Returns { rings, open } where rings are closed (first point repeated).
 */
export function joinLines(lines: Pt[][], allowReverse = true): { rings: Ring[]; open: Pt[][] } {
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  const rings: Ring[] = [];
  const open: Pt[][] = [];
  while (pool.length) {
    let cur = pool.pop()!;
    let extended = true;
    while (!samePt(cur[0]!, cur[cur.length - 1]!) && extended) {
      extended = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i]!;
        const end = cur[cur.length - 1]!;
        const start = cur[0]!;
        if (samePt(end, l[0]!)) {
          cur = cur.concat(l.slice(1));
        } else if (samePt(l[l.length - 1]!, start)) {
          cur = l.concat(cur.slice(1));
        } else if (allowReverse && samePt(end, l[l.length - 1]!)) {
          cur = cur.concat(l.slice(0, -1).reverse());
        } else if (allowReverse && samePt(l[0]!, start)) {
          cur = l.slice(1).reverse().concat(cur);
        } else {
          continue;
        }
        pool.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (cur.length >= 4 && samePt(cur[0]!, cur[cur.length - 1]!)) rings.push(cur);
    else open.push(cur);
  }
  return { rings, open };
}

// ---------------------------------------------------------------------------
// Coastline -> sea polygons
// ---------------------------------------------------------------------------

/** Clockwise perimeter parameter of a point on the rect boundary (Y-up). */
function perimeterT(p: Pt, r: Rect): number {
  const w = r.maxX - r.minX;
  const h = r.maxY - r.minY;
  const dTop = Math.abs(p[1] - r.maxY);
  const dRight = Math.abs(p[0] - r.maxX);
  const dBottom = Math.abs(p[1] - r.minY);
  const dLeft = Math.abs(p[0] - r.minX);
  const m = Math.min(dTop, dRight, dBottom, dLeft);
  if (m === dTop) return p[0] - r.minX;
  if (m === dRight) return w + (r.maxY - p[1]);
  if (m === dBottom) return w + h + (r.maxX - p[0]);
  return 2 * w + h + (p[1] - r.minY);
}

export interface SeaResult {
  rings: Ring[][]; // polygons: [outer, ...holes]
  warnings: string[];
}

/**
 * Builds water polygons inside `r` from OSM natural=coastline ways.
 * OSM convention: land is on the LEFT of the coastline direction, water on
 * the RIGHT. Coordinates must be Y-up (lon, lat).
 */
export function buildSeaPolygons(coastlines: Pt[][], r: Rect): SeaResult {
  const warnings: string[] = [];
  const { rings: closed, open } = joinLines(coastlines, false);
  const w = r.maxX - r.minX;
  const h = r.maxY - r.minY;
  const per = 2 * (w + h);

  interface Piece {
    pts: Pt[];
    tIn: number;
    tOut: number;
  }
  const pieces: Piece[] = [];
  const islands: Ring[] = [];

  for (const ring of closed) {
    const b = ringBounds(ring);
    if (b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY) {
      islands.push(ring);
      continue;
    }
    // A closed coastline crossing the rect: treat it as an open line.
    open.push(ring);
  }

  for (const line of open) {
    for (const c of clipPolyline(line, r)) {
      if (!c.startCut || !c.endCut) {
        // Only acceptable if the original line started/ended exactly on the boundary.
        const s = c.points[0]!;
        const e = c.points[c.points.length - 1]!;
        const onB = (p: Pt) =>
          Math.min(Math.abs(p[0] - r.minX), Math.abs(p[0] - r.maxX), Math.abs(p[1] - r.minY), Math.abs(p[1] - r.maxY)) < 1e-9;
        if (!onB(s) || !onB(e)) {
          warnings.push('Coastline segment ends inside the extraction area (incomplete coastline); skipped.');
          continue;
        }
      }
      pieces.push({ pts: c.points, tIn: perimeterT(c.points[0]!, r), tOut: perimeterT(c.points[c.points.length - 1]!, r) });
    }
  }

  const corners: Array<[number, Pt]> = [
    [0, [r.minX, r.maxY]],
    [w, [r.maxX, r.maxY]],
    [w + h, [r.maxX, r.minY]],
    [2 * w + h, [r.minX, r.minY]],
  ];
  const cw = (from: number, to: number) => (((to - from) % per) + per) % per;

  const polygons: Ring[][] = [];
  const used = new Set<number>();
  for (let start = 0; start < pieces.length; start++) {
    if (used.has(start)) continue;
    const ring: Pt[] = [];
    let idx = start;
    let guard = 0;
    while (guard++ < pieces.length + 2) {
      used.add(idx);
      const piece = pieces[idx]!;
      ring.push(...piece.pts);
      // Find the next piece entry clockwise from this exit.
      let best = -1;
      let bestD = Infinity;
      for (let j = 0; j < pieces.length; j++) {
        if (used.has(j) && j !== start) continue;
        const d = cw(piece.tOut, pieces[j]!.tIn);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      if (best < 0) break;
      for (const [ct, cp] of [...corners].sort((a, b) => cw(piece.tOut, a[0]) - cw(piece.tOut, b[0]))) {
        const dc = cw(piece.tOut, ct);
        if (dc > 0 && dc < bestD) ring.push(cp);
      }
      if (best === start) break;
      idx = best;
    }
    if (ring.length >= 3) polygons.push([ring]);
  }

  if (pieces.length === 0 && islands.length === 0) {
    warnings.push('No coastline crosses the extraction area; assuming it is all land.');
  }
  if (pieces.length === 0 && islands.length > 0) {
    polygons.push([
      [
        [r.minX, r.minY],
        [r.maxX, r.minY],
        [r.maxX, r.maxY],
        [r.minX, r.maxY],
      ],
    ]);
  }
  // Islands become holes of whichever sea polygon contains them.
  for (const isl of islands) {
    const c = ringCentroid(isl);
    const host = polygons.find((p) => pointInRing(c[0], c[1], p[0]!));
    if (host) host.push(isl);
  }
  return { rings: polygons, warnings };
}
