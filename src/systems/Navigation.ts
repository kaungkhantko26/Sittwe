import * as THREE from 'three';
import { RoadGraph, type Route, type RoadGraphData, type TravelMode } from '../geo/roadGraph';

/**
 * Turn-by-turn navigation on the real OSM road graph.
 *  - Routes are computed with A* (driving: car roads + one-way rules;
 *    walking: all roads and paths).
 *  - Tracks progress along the route, the next instruction and the remaining
 *    distance; re-routes automatically when the player strays > 25 m or
 *    switches between walking and driving.
 *  - Draws the route as a glowing ribbon on the ground in 3D.
 */
export interface NavState {
  route: Route;
  mode: TravelMode;
  remaining: number;
  nextText: string;
  nextTurn: Route['steps'][number]['turn'];
  nextIn: number;
}

const ROUTE_Y = 0.17;

export class Navigation {
  readonly graph: RoadGraph;
  private route: Route | null = null;
  private mode: TravelMode = 'walk';
  private dest: { x: number; z: number } | null = null;
  private progressIdx = 0;
  private rerouteCooldown = 0;
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  /** Called whenever the route geometry changes (for the 2D maps); points in local meters. */
  onRouteChanged: ((points: Array<[number, number]> | null) => void) | null = null;

  constructor(data: RoadGraphData, scene: THREE.Scene) {
    this.graph = new RoadGraph(data);
    this.mat = new THREE.MeshBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.7, depthWrite: false, fog: true, side: THREE.DoubleSide });
    this.mat.polygonOffset = true;
    this.mat.polygonOffsetFactor = -6;
    this.mat.polygonOffsetUnits = -12;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.name = 'nav-route';
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get active(): boolean {
    return this.route !== null;
  }

  get destination(): { x: number; z: number } | null {
    return this.dest;
  }

  /** Starts navigation. Returns false if no road route exists. */
  navigate(fromX: number, fromZ: number, dest: { x: number; z: number } | null, mode: TravelMode): boolean {
    this.dest = dest;
    this.mode = mode;
    this.progressIdx = 0;
    if (!dest) {
      this.clearRoute();
      return true;
    }
    const r = this.graph.route(fromX, fromZ, dest.x, dest.z, mode);
    if (!r) {
      this.clearRoute();
      return false;
    }
    this.setRoute(r);
    return true;
  }

  stop(): void {
    this.dest = null;
    this.clearRoute();
  }

  private clearRoute(): void {
    this.route = null;
    this.mesh.visible = false;
    this.onRouteChanged?.(null);
  }

  private setRoute(r: Route): void {
    this.route = r;
    this.mesh.geometry.dispose();
    this.mesh.geometry = ribbon(r.points, 1.4);
    this.mesh.visible = true;
    this.onRouteChanged?.(r.points);
  }

  /** Per-frame progress tracking. */
  update(dt: number, x: number, z: number, mode: TravelMode): NavState | null {
    this.mat.opacity = 0.55 + 0.2 * Math.sin(performance.now() / 350);
    if (!this.dest) return null;
    this.rerouteCooldown -= dt;
    const r = this.route;
    if (mode !== this.mode || !r) {
      if (this.rerouteCooldown <= 0) {
        this.rerouteCooldown = 2;
        this.navigate(x, z, this.dest, mode);
      }
      if (!this.route) return null;
    }
    const route = this.route!;
    // Nearest point on the route, searching forward from the last progress point.
    let best = { d: Infinity, i: this.progressIdx, t: 0 };
    const pts = route.points;
    const end = Math.min(pts.length - 1, this.progressIdx + 40);
    for (let i = Math.max(0, this.progressIdx - 3); i < end; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
      if (d < best.d) best = { d, i, t };
    }
    this.progressIdx = best.i;
    if (best.d > 25 && this.rerouteCooldown <= 0) {
      this.rerouteCooldown = 2;
      this.navigate(x, z, this.dest, mode);
      return this.route ? this.update(0, x, z, mode) : null;
    }
    let along = 0;
    for (let i = 0; i < best.i; i++) along += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]);
    along += best.t * Math.hypot(pts[best.i + 1]![0] - pts[best.i]![0], pts[best.i + 1]![1] - pts[best.i]![1]);
    const next = route.steps.find((s) => s.at > along + 3) ?? route.steps[route.steps.length - 1]!;
    return { route, mode: this.mode, remaining: Math.max(0, route.length - along), nextText: next.text, nextTurn: next.turn, nextIn: Math.max(0, next.at - along) };
  }
}

/** Flat ribbon along a polyline (mitred joins), slightly above the road surface. */
function ribbon(points: Array<[number, number]>, width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const hw = width / 2;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const a = points[Math.max(0, i - 1)]!;
    const b = points[Math.min(points.length - 1, i + 1)]!;
    let dx = b[0] - a[0];
    let dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    pos.push(p[0] - dz * hw, ROUTE_Y, p[1] + dx * hw, p[0] + dz * hw, ROUTE_Y, p[1] - dx * hw);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
