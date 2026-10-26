import type { ChunkData, SeaData, WorldManifest } from '../geo/chunkFormat';
import { clipPolyline, pointInRings, rectsIntersect, ringBounds, type Pt, type Rect } from '../geo/geometry2d';
import type { BoundaryData } from '../world/BoundaryGenerator';
import type { MapDataLoader } from '../geo/MapDataLoader';

export interface HomeLocation { x: number; z: number }
export const HOME_FLOOR = 1.92;
export const HOME_HALF_X = 7;
export const HOME_HALF_Z = 10;
export const STARTER_HOME: HomeLocation = { x: 101, z: -47 };
const KEY = 'sittwe3d.home.v1';
export const homeRect = (p: HomeLocation): Rect => ({ minX: p.x - HOME_HALF_X, maxX: p.x + HOME_HALF_X, minY: p.z - HOME_HALF_Z, maxY: p.z + HOME_HALF_Z });
const pts = (p: number[]): Pt[] => Array.from({ length: p.length / 2 }, (_, i) => [p[i * 2]!, p[i * 2 + 1]!] as Pt);
const corners = (r: Rect): Pt[] => [[r.minX, r.minY], [r.maxX, r.minY], [r.maxX, r.maxY], [r.minX, r.maxY]];
const overlaps = (r: Rect, rings: number[][]): boolean => rectsIntersect(r, ringBounds(pts(rings[0]!)));

/** Conservative plot checks use the whole yard, not just its centre. No mapped buildings are removed. */
export function validateHomePlot(p: HomeLocation, chunks: ChunkData[], sea: SeaData, bounds: WorldManifest['bounds'],boundaries?:BoundaryData): string | null {
  if (!validHome(p)) return 'Invalid location.';
  const r = homeRect(p);
  if (r.minX < bounds.minX || r.maxX > bounds.maxX || r.minY < bounds.minZ || r.maxY > bounds.maxZ) return 'Choose a plot inside the mapped city.';
  const cs = corners(r);
  for(const line of boundaries?.lines??[])if(clipPolyline(pts(line.p),{minX:r.minX-1,maxX:r.maxX+1,minY:r.minY-1,maxY:r.maxY+1}).length)return 'Leave existing mapped walls and fences clear.';
  for (const poly of sea.polygons) {
    const rings = poly.map(pts);
    if (cs.some(([x, z]) => pointInRings(x, z, rings)) || poly.some(ring => clipPolyline([...pts(ring), pts(ring)[0]!], r).length > 0)) return 'The plot overlaps the sea.';
  }
  const residential = chunks.flatMap(c => c.landuse.filter(a => a.k === 'residential'));
  if (!cs.every(([x, z]) => residential.some(a => pointInRings(x, z, a.r.map(pts))))) return 'Choose land mapped as residential.';
  let access = false;
  for (const c of chunks) {
    for (const b of c.buildings) if (overlaps(r, [b.p])) return 'The plot is too close to an existing building.';
    for (const a of c.water) if (overlaps(r, a.r)) return 'The plot overlaps water.';
    for (const a of c.landuse) if (a.k !== 'residential' && overlaps(r, a.r)) return 'The plot overlaps protected or non-residential land.';
    for (const line of [...c.roads, ...c.waterways]) {
      const pad = line.w / 2 + 1.5;
      const expanded = { minX: r.minX - pad, maxX: r.maxX + pad, minY: r.minY - pad, maxY: r.maxY + pad };
      if (clipPolyline(pts(line.p), expanded).length) return 'Keep the house and yard clear of roads, paths and waterways.';
    }
    for (const road of c.roads) {
      if (clipPolyline(pts(road.p), { minX: r.minX - 35, maxX: r.maxX + 35, minY: r.minY - 35, maxY: r.maxY + 35 }).length) access = true;
    }
    for (const lm of c.landmarks) if (lm.x > r.minX - 8 && lm.x < r.maxX + 8 && lm.z > r.minY - 8 && lm.z < r.maxY + 8) return 'Leave space around mapped landmarks.';
    for (const points of [c.trees, c.lamps]) for (let i = 0; i < points.length; i += 2) {
      if (points[i]! > r.minX - 1 && points[i]! < r.maxX + 1 && points[i + 1]! > r.minY - 1 && points[i + 1]! < r.maxY + 1) return 'The plot overlaps a mapped tree or streetlight.';
    }
  }
  return access ? null : 'Choose a residential plot within 35 m of a mapped road or path.';
}

export function validHome(raw: unknown): raw is HomeLocation {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as HomeLocation;
  return Number.isFinite(p.x) && Number.isFinite(p.z) && Math.abs(p.x) < 50_000 && Math.abs(p.z) < 50_000;
}

export class Housing {
  home: HomeLocation = { ...STARTER_HOME };
  constructor(private readonly loader: MapDataLoader, private readonly manifest: WorldManifest, private readonly sea: SeaData, private readonly storage: Storage | null,private readonly boundaries?:BoundaryData) {}

  async validate(p: HomeLocation): Promise<string | null> {
    const s = this.manifest.chunkSize;
    const cx = Math.floor(p.x / s), cz = Math.floor(p.z / s);
    const nearby = this.manifest.chunks.filter(c => Math.abs(c.cx - cx) <= 1 && Math.abs(c.cz - cz) <= 1);
    // Include neighbours because mapped buildings are assigned by centroid.
    const data = await Promise.all(nearby.map(c => this.loader.chunk(c.cx, c.cz, s)));
    return validateHomePlot(p, data, this.sea, this.manifest.bounds,this.boundaries);
  }

  async init(): Promise<void> {
    try {
      const saved: unknown = JSON.parse(this.storage?.getItem(KEY) ?? 'null');
      if (validHome(saved) && !(await this.validate(saved))) { this.home = saved; return; }
    } catch { /* An invalid local home must not prevent loading the game. */ }
    if (await this.validate(this.home)) throw new Error('Starter home plot is unavailable.');
  }

  commit(p: HomeLocation): boolean {
    try {
      if (!this.storage || !validHome(p)) return false;
      this.storage.setItem(KEY, JSON.stringify(p));
      this.home = { ...p };
      return true;
    } catch { return false; }
  }
}
