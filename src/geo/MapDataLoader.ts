import { chunkFileName, type ChunkData, type SeaData, type WorldManifest } from './chunkFormat';
import type { RoadGraphData } from './roadGraph';
import type { BoundaryData } from '../world/BoundaryGenerator';
import { validateChunk } from './validateChunk';

/**
 * Loads the locally cached, pre-processed map data (manifest, sea polygon,
 * chunk files) from /data/. Keeps a small LRU cache of parsed chunks so
 * re-entering an area does not re-download or re-parse it.
 */
export class MapDataLoader {
  private readonly cache = new Map<string, ChunkData>();
  private readonly maxCache = 48;

  constructor(private readonly baseUrl = `${import.meta.env.BASE_URL}data/`) {}

  private async json<T>(path: string, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(20_000);
    const res = await fetch(this.baseUrl + path, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) throw new Error(`${path} was not found (the server returned an HTML page)`);
    return (await res.json()) as T;
  }

  async boundaries():Promise<BoundaryData> {
    try{return await this.json<BoundaryData>('boundaries.json')}catch{return {version:1,lines:[]}}
  }

  async manifest(): Promise<WorldManifest> {
    const m = await this.json<WorldManifest>('manifest.json');
    if (!m || !Array.isArray(m.chunks) || typeof m.chunkSize !== 'number' || !m.spawn?.player) {
      throw new Error('World manifest is invalid. Re-run `npm run data:all`.');
    }
    return m;
  }

  async sea(): Promise<SeaData> {
    try {
      const s = await this.json<SeaData>('sea.json');
      return Array.isArray(s.polygons) ? s : { polygons: [] };
    } catch (e) {
      console.warn('[MapDataLoader] sea.json unavailable; continuing without sea polygon.', e);
      return { polygons: [] };
    }
  }

  /** Routable road graph for navigation/search/traffic (null if not generated). */
  async roadGraph(): Promise<RoadGraphData | null> {
    try {
      const g = await this.json<RoadGraphData>('roadgraph.json');
      return Array.isArray(g.nodes) && Array.isArray(g.edges) ? g : null;
    } catch (e) {
      console.warn('[MapDataLoader] roadgraph.json unavailable; navigation disabled.', e);
      return null;
    }
  }

  async chunk(cx: number, cz: number, chunkSize: number, signal?: AbortSignal): Promise<ChunkData> {
    const key = `${cx}_${cz}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const raw = await this.json<unknown>(`chunks/${chunkFileName(cx, cz)}`, signal);
    const data = sanitizeChunk(raw, chunkSize);
    this.cache.set(key, data);
    if (this.cache.size > this.maxCache) this.cache.delete(this.cache.keys().next().value!);
    return data;
  }
}

/**
 * Validates a chunk and drops individual malformed features instead of
 * failing the whole chunk. Throws only if the chunk structure is unusable.
 */
export function sanitizeChunk(raw: unknown, chunkSize: number): ChunkData {
  const res = validateChunk(raw, chunkSize);
  const structural = res.errors.filter((e) => e.startsWith('missing') || e.startsWith('chunk is not'));
  if (structural.length) throw new Error(`Invalid chunk data: ${structural.join('; ')}`);
  const d = raw as ChunkData;
  if (res.errors.length) {
    console.warn(`[MapDataLoader] chunk ${d.cx}_${d.cz}: dropping invalid features`, res.errors);
    const ok = (arr: unknown): boolean => Array.isArray(arr) && arr.every((n) => typeof n === 'number' && Number.isFinite(n));
    d.roads = d.roads.filter((r) => ok(r.p) && r.p.length >= 4 && r.w > 0);
    d.buildings = d.buildings.filter((b) => ok(b.p) && b.p.length >= 6 && b.h > 0);
    d.water = d.water.filter((a) => Array.isArray(a.r) && a.r.every(ok));
    d.landuse = d.landuse.filter((a) => Array.isArray(a.r) && a.r.every(ok));
  }
  d.trees = ok2(d.trees);
  d.lamps = ok2(d.lamps);
  d.waterways = Array.isArray(d.waterways) ? d.waterways : [];
  return d;
}

function ok2(arr: unknown): number[] {
  return Array.isArray(arr) && arr.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (arr as number[]) : [];
}
