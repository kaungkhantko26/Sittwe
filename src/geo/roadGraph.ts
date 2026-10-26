/**
 * Routable road graph built from real OSM road centerlines.
 *
 * Nodes are polyline vertices (OSM ways that share a vertex are connected,
 * exactly as in OSM). Routing is A* with a straight-line heuristic. Driving
 * routes use only car roads and respect `oneway`; walking routes use every
 * road and path in both directions. Pure TypeScript: used by the pipeline
 * (writer), the game (reader) and unit tests.
 */
import type { RoadClass } from './OSMParser';

export const CLASS_IDS: RoadClass[] = ['primary', 'secondary', 'tertiary', 'residential', 'service', 'track', 'pedestrian', 'path', 'pier'];
const CAR: ReadonlySet<RoadClass> = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service', 'track']);
/** Relative driving cost per meter by class (prefers main roads). */
const CAR_COST: Partial<Record<RoadClass, number>> = { primary: 1, secondary: 1.05, tertiary: 1.1, residential: 1.25, service: 1.6, track: 2.2 };

export interface RoadGraphData {
  v: number;
  /** Flat node coordinates x0, z0, x1, z1, … (meters). */
  nodes: number[];
  /** Flat edges: a, b, classId, oneway (0/1), nameId (-1 = unnamed). */
  edges: number[];
  names: string[];
  /** One representative point per road name, for search: [nameId, x, z]. */
  namePoints: number[];
}

export type TravelMode = 'drive' | 'walk';

export interface Route {
  points: Array<[number, number]>;
  length: number;
  /** Turn-by-turn steps. `at` = distance from route start (m). */
  steps: Array<{ at: number; text: string; turn: 'start' | 'left' | 'right' | 'slight-left' | 'slight-right' | 'straight' | 'arrive'; road?: string }>;
}

/** Builds graph data from road polylines (pipeline side). */
export function buildGraphData(roads: Array<{ pts: Array<[number, number]>; cls: RoadClass; oneway: boolean; name?: string }>): RoadGraphData {
  const index = new Map<string, number>();
  const nodes: number[] = [];
  const edges: number[] = [];
  const names: string[] = [];
  const nameIdx = new Map<string, number>();
  const nameBest = new Map<number, { len: number; x: number; z: number }>();
  const node = (x: number, z: number) => {
    const k = `${Math.round(x * 10)},${Math.round(z * 10)}`;
    let id = index.get(k);
    if (id === undefined) {
      id = nodes.length / 2;
      index.set(k, id);
      nodes.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
    }
    return id;
  };
  for (const r of roads) {
    const cid = CLASS_IDS.indexOf(r.cls);
    if (cid < 0 || r.pts.length < 2) continue;
    let nid = -1;
    if (r.name) {
      nid = nameIdx.get(r.name) ?? -1;
      if (nid < 0) {
        nid = names.length;
        names.push(r.name);
        nameIdx.set(r.name, nid);
      }
    }
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = node(r.pts[i]![0], r.pts[i]![1]);
      const b = node(r.pts[i + 1]![0], r.pts[i + 1]![1]);
      if (a === b) continue;
      edges.push(a, b, cid, r.oneway ? 1 : 0, nid);
      if (nid >= 0) {
        const len = Math.hypot(r.pts[i + 1]![0] - r.pts[i]![0], r.pts[i + 1]![1] - r.pts[i]![1]);
        const best = nameBest.get(nid);
        if (!best || len > best.len) nameBest.set(nid, { len, x: (r.pts[i]![0] + r.pts[i + 1]![0]) / 2, z: (r.pts[i]![1] + r.pts[i + 1]![1]) / 2 });
      }
    }
  }
  const namePoints: number[] = [];
  for (const [id, p] of nameBest) namePoints.push(id, Math.round(p.x), Math.round(p.z));
  return { v: 1, nodes, edges, names, namePoints };
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= this.keys[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0]!;
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.ids.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b]!, this.ids[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}

export class RoadGraph {
  readonly nodeCount: number;
  /** adjacency: per node, list of [neighbor, edgeIndex, forwardAllowedForCars]. */
  private readonly adj: Array<Array<[number, number, boolean]>>;
  private readonly grid = new Map<string, number[]>();
  private readonly cell = 64;

  constructor(readonly data: RoadGraphData) {
    this.nodeCount = data.nodes.length / 2;
    this.adj = Array.from({ length: this.nodeCount }, () => []);
    for (let e = 0; e < data.edges.length / 5; e++) {
      const a = data.edges[e * 5]!;
      const b = data.edges[e * 5 + 1]!;
      const oneway = data.edges[e * 5 + 3] === 1;
      this.adj[a]!.push([b, e, true]);
      this.adj[b]!.push([a, e, !oneway]);
    }
    for (let i = 0; i < this.nodeCount; i++) {
      const k = this.key(this.x(i), this.z(i));
      let arr = this.grid.get(k);
      if (!arr) this.grid.set(k, (arr = []));
      arr.push(i);
    }
  }

  x(i: number): number {
    return this.data.nodes[i * 2]!;
  }
  z(i: number): number {
    return this.data.nodes[i * 2 + 1]!;
  }
  edgeClass(e: number): RoadClass {
    return CLASS_IDS[this.data.edges[e * 5 + 2]!]!;
  }
  edgeName(e: number): string | undefined {
    const n = this.data.edges[e * 5 + 4]!;
    return n >= 0 ? this.data.names[n] : undefined;
  }
  /** Neighbours usable in a mode: [neighbor, edge]. */
  neighbors(i: number, mode: TravelMode): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    for (const [n, e, carOk] of this.adj[i]!) {
      if (mode === 'drive' && (!carOk || !CAR.has(this.edgeClass(e)))) continue;
      out.push([n, e]);
    }
    return out;
  }

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  /** Nearest node usable in `mode`, searching outward up to maxDist meters. */
  nearestNode(x: number, z: number, mode: TravelMode, maxDist = 600): number {
    let best = -1;
    let bd = maxDist;
    const r = Math.ceil(maxDist / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let ring = 0; ring <= r; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iz = cz - ring; iz <= cz + ring; iz++) {
          if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
          for (const n of this.grid.get(`${ix},${iz}`) ?? []) {
            if (this.neighbors(n, mode).length === 0) continue;
            const d = Math.hypot(this.x(n) - x, this.z(n) - z);
            if (d < bd) {
              bd = d;
              best = n;
            }
          }
        }
      }
      if (best >= 0 && (ring + 1) * this.cell > bd + this.cell) break;
    }
    return best;
  }

  /** A* shortest path. Returns null when unreachable. */
  route(fromX: number, fromZ: number, toX: number, toZ: number, mode: TravelMode): Route | null {
    const s = this.nearestNode(fromX, fromZ, mode);
    const t = this.nearestNode(toX, toZ, mode);
    if (s < 0 || t < 0) return null;
    const g = new Float64Array(this.nodeCount).fill(Infinity);
    const prev = new Int32Array(this.nodeCount).fill(-1);
    const prevEdge = new Int32Array(this.nodeCount).fill(-1);
    const closed = new Uint8Array(this.nodeCount);
    const heap = new MinHeap();
    const tx = this.x(t);
    const tz = this.z(t);
    g[s] = 0;
    heap.push(s, Math.hypot(this.x(s) - tx, this.z(s) - tz));
    while (heap.size) {
      const u = heap.pop();
      if (closed[u]) continue;
      if (u === t) break;
      closed[u] = 1;
      for (const [v, e] of this.neighbors(u, mode)) {
        if (closed[v]) continue;
        const len = Math.hypot(this.x(v) - this.x(u), this.z(v) - this.z(u));
        const cost = mode === 'drive' ? len * (CAR_COST[this.edgeClass(e)] ?? 1.5) : len;
        const ng = g[u]! + cost;
        if (ng < g[v]!) {
          g[v] = ng;
          prev[v] = u;
          prevEdge[v] = e;
          heap.push(v, ng + Math.hypot(this.x(v) - tx, this.z(v) - tz));
        }
      }
    }
    if (s !== t && prev[t] === -1) return null;
    const ids: number[] = [];
    const edgesOnPath: number[] = [];
    for (let n = t; n !== -1; n = prev[n]!) {
      ids.push(n);
      if (prevEdge[n]! >= 0) edgesOnPath.push(prevEdge[n]!);
      if (n === s) break;
    }
    ids.reverse();
    edgesOnPath.reverse();
    const points: Array<[number, number]> = [[fromX, fromZ], ...ids.map((i): [number, number] => [this.x(i), this.z(i)]), [toX, toZ]];
    return buildSteps(points, [undefined, ...edgesOnPath.map((e) => this.edgeName(e)), undefined]);
  }
}

/** Turn-by-turn instructions from turning angles and road-name changes. */
export function buildSteps(points: Array<[number, number]>, segNames: Array<string | undefined>): Route {
  let length = 0;
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
    cum.push(length);
  }
  const steps: Route['steps'] = [{ at: 0, text: segNames[1] ? `Head along ${segNames[1]}` : 'Start', turn: 'start', ...(segNames[1] ? { road: segNames[1] } : {}) }];
  let lastName = segNames[1];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const c = points[i + 1]!;
    const h1 = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
    const h2 = Math.atan2(c[0] - b[0], -(c[1] - b[1]));
    let d = ((h2 - h1) * 180) / Math.PI;
    d = ((d + 540) % 360) - 180; // + = right (clockwise heading change)
    const name = segNames[i + 1];
    const nameChanged = name !== undefined && name !== lastName;
    const ad = Math.abs(d);
    if (ad < 25 && !nameChanged) continue;
    if (Math.hypot(c[0] - b[0], c[1] - b[1]) < 4 && ad < 60) continue;
    const turn = ad < 25 ? 'straight' : ad < 50 ? (d > 0 ? 'slight-right' : 'slight-left') : d > 0 ? 'right' : 'left';
    const verb = turn === 'straight' ? 'Continue' : turn.startsWith('slight') ? `Bear ${turn.endsWith('right') ? 'right' : 'left'}` : `Turn ${turn}`;
    steps.push({ at: cum[i]!, text: name ? `${verb} onto ${name}` : verb, turn, ...(name ? { road: name } : {}) });
    lastName = name ?? lastName;
  }
  steps.push({ at: length, text: 'Arrive at destination', turn: 'arrive' });
  // Merge steps closer than 15 m (keep the later, more informative one).
  const merged: Route['steps'] = [];
  for (const s of steps) {
    const last = merged[merged.length - 1];
    if (last && s.at - last.at < 15 && last.turn !== 'start' && s.turn !== 'arrive') merged[merged.length - 1] = s;
    else merged.push(s);
  }
  return { points, length, steps: merged };
}
