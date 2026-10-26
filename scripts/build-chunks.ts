/**
 * Step 3 of the data pipeline: project normalized GeoJSON into local meters
 * and split it into 256 m × 256 m chunk files for streaming.
 *
 * Outputs (served statically by Vite):
 *   public/data/manifest.json          world manifest (origin, chunk list, spawn, landmarks)
 *   public/data/chunks/c_<cx>_<cz>.json per-chunk geometry
 *   public/data/sea.json               sea polygons (local meters) from the coastline
 *   public/data/geojson/*.geojson      lon/lat layers for the MapLibre minimap
 *
 * Usage: npm run data:chunks
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import { CHUNK_SIZE, DATA_VERSION, GEO_ORIGIN, WORLD_BOUNDS } from '../src/config';
import { projection } from '../src/geo/GeoProjection';
import {
  chunkFileName,
  chunkKey,
  chunkRect,
  type ChunkArea,
  type ChunkData,
  type ChunkLandmark,
  type PlaceEntry,
  type SeaData,
  type SpawnPoint,
  type WorldManifest,
} from '../src/geo/chunkFormat';
import { buildGraphData } from '../src/geo/roadGraph';
import { fitPromenade } from '../src/geo/promenade';
import { roundaboutSite } from '../src/geo/landmarkSite';
import { linkLandmarks, markCompounds, toRecord } from '../src/geo/landmarkLinker';
import { clipPolyline, clipRing, distToSegmentSq, pointInRing, ringBounds, ringCentroid, rectsIntersect, type Pt, type Rect } from '../src/geo/geometry2d';
import type { AreaProps, BuildingProps, LandmarkProps, PlaceProps, RoadProps, WaterwayProps } from '../src/geo/OSMParser';

const ROOT = join(import.meta.dirname, '..');
const GEO_DIR = join(ROOT, 'data', 'geojson');
const PUB = join(ROOT, 'public', 'data');
const CHUNK_DIR = join(PUB, 'chunks');
const MAP_DIR = join(PUB, 'geojson');

const B = WORLD_BOUNDS;
const WORLD_RECT: Rect = { minX: B.minX, minY: B.minZ, maxX: B.maxX, maxY: B.maxZ };

function read<G extends Polygon | MultiPolygon | LineString | Point, P>(name: string): FeatureCollection<G, P> {
  return JSON.parse(readFileSync(join(GEO_DIR, `${name}.geojson`), 'utf8')) as FeatureCollection<G, P>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const toXZ = (p: Position): Pt => projection.lonLatToXZ(p[0]!, p[1]!);
const flat = (pts: Pt[]): number[] => {
  const out: number[] = [];
  for (const p of pts) out.push(r2(p[0]), r2(p[1]));
  return out;
};
const openXZ = (ring: Position[]): Pt[] => {
  const pts = ring.map(toXZ);
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  if (pts.length > 1 && a[0] === b[0] && a[1] === b[1]) pts.pop();
  return pts;
};
function polygonsOf(g: Polygon | MultiPolygon): Position[][][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

function main(): void {
  const roads = read<LineString, RoadProps>('roads');
  const buildings = read<Polygon | MultiPolygon, BuildingProps>('buildings');
  const water = read<Polygon | MultiPolygon, AreaProps>('water');
  const waterways = read<LineString, WaterwayProps>('waterways');
  const landuse = read<Polygon | MultiPolygon, AreaProps>('landuse');
  const landmarks = read<Point, LandmarkProps>('landmarks');
  const places = read<Point, PlaceProps>('places');
  const trees = read<Point, { id: string }>('trees');
  const lamps = read<Point, { id: string }>('streetlamps');
  const sea = read<Polygon, AreaProps>('sea');
  const meta = JSON.parse(readFileSync(join(GEO_DIR, 'meta.json'), 'utf8')) as {
    attribution: string;
    regions: Array<{ label: string; endpoint: string; retrievedAt: string; osmBaseTimestamp: string | null }>;
  };

  // Prepare all chunks.
  const chunks = new Map<string, ChunkData>();
  for (let cx = Math.floor(B.minX / CHUNK_SIZE); cx < Math.ceil(B.maxX / CHUNK_SIZE); cx++) {
    for (let cz = Math.floor(B.minZ / CHUNK_SIZE); cz < Math.ceil(B.maxZ / CHUNK_SIZE); cz++) {
      chunks.set(chunkKey(cx, cz), { v: DATA_VERSION, key: chunkKey(cx, cz), cx, cz, roads: [], buildings: [], water: [], waterways: [], landuse: [], trees: [], lamps: [], landmarks: [] });
    }
  }
  const chunkAt = (x: number, z: number): ChunkData | undefined => chunks.get(chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)));
  const allChunks = [...chunks.values()];

  // Roads: clip polylines to each chunk.
  const roadXZ: Array<{ props: RoadProps; pts: Pt[] }> = [];
  for (const f of roads.features) {
    const pts = f.geometry.coordinates.map(toXZ);
    roadXZ.push({ props: f.properties, pts });
    const b = ringBounds(pts);
    for (const c of allChunks) {
      const rect = chunkRect(c.cx, c.cz);
      if (!rectsIntersect(b, rect)) continue;
      for (const piece of clipPolyline(pts, rect)) {
        const road = { id: f.properties.id, c: f.properties.cls, w: r2(f.properties.width), p: flat(piece.points), s: !piece.startCut, e: !piece.endCut } as ChunkData['roads'][number];
        const name = f.properties.nameEn ?? f.properties.name;
        if (name) road.n = f.properties.nameEn && f.properties.name && f.properties.name !== f.properties.nameEn ? `${f.properties.nameEn} · ${f.properties.name}` : name;
        if (f.properties.bridge) road.b = true;
        c.roads.push(road);
      }
    }
  }

  // Buildings: assigned whole to the chunk containing their centroid.
  const buildingRings: Pt[][] = [];
  let buildingsOutside = 0;
  for (const f of buildings.features) {
    for (const poly of polygonsOf(f.geometry)) {
      const outer = openXZ(poly[0]!);
      if (outer.length < 3) continue;
      const c = ringCentroid(outer);
      const chunk = chunkAt(c[0], c[1]);
      if (!chunk) {
        buildingsOutside++;
        continue;
      }
      buildingRings.push(outer);
      const p = f.properties;
      const b: ChunkData['buildings'][number] = { id: p.id, k: p.kind, h: r2(p.height), mh: r2(p.minHeight), hs: p.heightSource === 'tag' ? 't' : p.heightSource === 'levels' ? 'l' : 'e', p: flat(outer) };
      if (p.levels) b.lv = p.levels;
      if (p.roofShape) b.roof = p.roofShape;
      if (p.nameEn ?? p.name) b.n = (p.nameEn ?? p.name)!;
      const holes = poly.slice(1).map(openXZ).filter((h) => h.length >= 3);
      if (holes.length) b.holes = holes.map(flat);
      chunk.buildings.push(b);
    }
  }

  // Area layers: clip polygons to chunks.
  function addAreas(fc: FeatureCollection<Polygon | MultiPolygon, AreaProps>, key: 'water' | 'landuse'): void {
    for (const f of fc.features) {
      for (const poly of polygonsOf(f.geometry)) {
        const rings = poly.map(openXZ);
        const b = ringBounds(rings[0]!);
        if (!rectsIntersect(b, WORLD_RECT)) continue;
        for (const c of allChunks) {
          const rect = chunkRect(c.cx, c.cz);
          if (!rectsIntersect(b, rect)) continue;
          const outer = clipRing(rings[0]!, rect);
          if (outer.length < 3) continue;
          const holes = rings.slice(1).map((h) => clipRing(h, rect)).filter((h) => h.length >= 3);
          const area: ChunkArea = { id: f.properties.id, k: f.properties.kind, r: [flat(outer), ...holes.map(flat)] };
          c[key].push(area);
        }
      }
    }
  }
  addAreas(water, 'water');
  addAreas(landuse, 'landuse');

  // Waterways. Streams without a width tag default to 3 m, but Sittwe's canals
  // are much wider: where a mapped bridge crosses a waterway, the channel is
  // widened to ~55% of the bridge length (max 22 m). Documented estimate.
  const bridges = roadXZ.filter((r) => r.props.bridge && r.pts.length >= 2);
  let widened = 0;
  for (const f of waterways.features) {
    const pts = f.geometry.coordinates.map(toXZ);
    let width = f.properties.width;
    for (const br of bridges) {
      for (let i = 0; i < pts.length - 1; i++) {
        for (let j = 0; j < br.pts.length - 1; j++) {
          if (segmentsCross(pts[i]!, pts[i + 1]!, br.pts[j]!, br.pts[j + 1]!)) {
            const len = Math.hypot(br.pts[br.pts.length - 1]![0] - br.pts[0]![0], br.pts[br.pts.length - 1]![1] - br.pts[0]![1]);
            const w = Math.min(22, len * 0.55);
            if (w > width) {
              width = w;
              widened++;
            }
          }
        }
      }
    }
    const b = ringBounds(pts);
    for (const c of allChunks) {
      const rect = chunkRect(c.cx, c.cz);
      if (!rectsIntersect(b, rect)) continue;
      for (const piece of clipPolyline(pts, rect)) c.waterways.push({ id: f.properties.id, k: f.properties.kind, w: r2(width), p: flat(piece.points) });
    }
  }
  console.log(`Waterways widened to fit mapped bridges: ${widened}`);

  for (const f of trees.features) {
    const [x, z] = toXZ(f.geometry.coordinates);
    chunkAt(x, z)?.trees.push(r2(x), r2(z));
  }
  for (const f of lamps.features) {
    const [x, z] = toXZ(f.geometry.coordinates);
    chunkAt(x, z)?.lamps.push(r2(x), r2(z));
  }
  const allLandmarks: ChunkLandmark[] = [];
  for (const f of landmarks.features) {
    const [x, z] = toXZ(f.geometry.coordinates);
    const p = f.properties;
    const lm: ChunkLandmark = { id: p.id, n: p.name, cat: p.category, k: p.kind, fp: p.hasFootprint, x: r2(x), z: r2(z) };
    if (p.nameEn) lm.ne = p.nameEn;
    if (p.nameLocal) lm.nl = p.nameLocal;
    if (p.religion) lm.rel = p.religion;
    const c = chunkAt(x, z);
    if (!c) continue;
    c.landmarks.push(lm);
    allLandmarks.push(lm);
  }
  // Link landmarks to the real buildings they describe; detect compound outlines.
  const records = allChunks.flatMap((c) => c.buildings.map(toRecord));
  const compounds = markCompounds(records);
  const clearance = (x: number, z: number): number => {
    let best = 6;
    for (const r of records) {
      const bb = r.bounds;
      if (x < bb.minX - best || x > bb.maxX + best || z < bb.minY - best || z > bb.maxY + best) continue;
      if (!r.b.cp && pointInRing(x, z, r.ring)) return 0;
      if (r.b.cp) continue;
      for (let i = 0, j = r.ring.length - 1; i < r.ring.length; j = i++) best = Math.min(best, Math.sqrt(distToSegmentSq(x, z, r.ring[j]![0], r.ring[j]![1], r.ring[i]![0], r.ring[i]![1])));
    }
    for (const { props, pts } of roadXZ) {
      for (let i = 0; i < pts.length - 1; i++) {
        const d = Math.sqrt(distToSegmentSq(x, z, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])) - props.width / 2;
        if (d < best) best = Math.max(0, d);
      }
    }
    return best;
  };
  const link = linkLandmarks(records, allLandmarks, clearance);
  for(const lm of allLandmarks)if(lm.id==='node/1230796347')lm.h=49.4;
  console.log(`Compound outlines: ${compounds}; landmarks linked to buildings: ${link.linked}; stupa spots: ${link.stupas}`);

  const allPlaces: PlaceEntry[] = [];
  for (const f of places.features) {
    const [x, z] = toXZ(f.geometry.coordinates);
    if (x < B.minX - 500 || x > B.maxX + 500 || z < B.minZ - 500 || z > B.maxZ + 500) continue;
    const p = f.properties;
    const e: PlaceEntry = { id: p.id, name: p.name, place: p.place, x: r2(x), z: r2(z) };
    if (p.nameEn) e.nameEn = p.nameEn;
    if (p.nameLocal) e.nameLocal = p.nameLocal;
    allPlaces.push(e);
  }

  // Sea polygons in local meters.
  const seaData: SeaData = { polygons: sea.features.map((f) => f.geometry.coordinates.map((r) => flat(openXZ(r)))) };
  const seaRings = sea.features.map((f) => openXZ(f.geometry.coordinates[0]!));

  // Clock towers: Sittwe has an Old (colonial, 1887, near the Central Market)
  // and a New (Burmese-style, downtown) clock tower. Style by name, else by
  // proximity to a mapped market (the old one stands near the Central Market).
  const markets = allLandmarks.filter((l) => l.k === 'marketplace');
  for (const lm of allLandmarks) {
    if (lm.k !== 'clock') continue;
    const site=roundaboutSite(lm.x,lm.z,roadXZ.map(r=>({p:flat(r.pts),w:r.props.width})));
    if(site){
      lm.sourcePosition={x:lm.x,z:lm.z};
      lm.x=r2(site.x);lm.z=r2(site.z);
    }
    const name = `${lm.n} ${lm.ne ?? ''}`;
    if (/old|ဟောင်း|victoria|1887/i.test(name)) lm.cs = 'colonial';
    else if (/new|သစ်/i.test(name)) lm.cs = 'burmese';
    else lm.cs = markets.some((m) => Math.hypot(m.x - lm.x, m.z - lm.z) < 300) ? 'colonial' : 'burmese';
    console.log(`Clock tower "${lm.ne ?? lm.n}" → ${lm.cs}`);
  }

  // Seaside promenades at mapped viewpoints on the coast (e.g. Sittwe Point / View Point).
  const seaPolysXZ = sea.features.map((f) => f.geometry.coordinates.map(openXZ));
  for (const lm of allLandmarks) {
    if (lm.k !== 'viewpoint' || !/view\s*point|point|ရှုခင်း/i.test(`${lm.n} ${lm.ne ?? ''}`)) continue;
    const pr = fitPromenade(lm.x, lm.z, seaPolysXZ);
    if (pr) {
      lm.pr = pr;
      console.log(`Promenade fitted at ${lm.ne ?? lm.n}: ${pr.stations.length / 4} stations`);
    }
  }

  // Spawn points: on real road centerlines near the origin.
  const spawn = chooseSpawn(roadXZ, buildingRings, seaRings);

  // Write outputs.
  rmSync(CHUNK_DIR, { recursive: true, force: true });
  mkdirSync(CHUNK_DIR, { recursive: true });
  mkdirSync(MAP_DIR, { recursive: true });
  const manifestChunks: WorldManifest['chunks'] = [];
  let bytes = 0;
  for (const c of allChunks) {
    const json = JSON.stringify(c);
    bytes += json.length;
    writeFileSync(join(CHUNK_DIR, chunkFileName(c.cx, c.cz)), json);
    manifestChunks.push({ key: c.key, cx: c.cx, cz: c.cz, roads: c.roads.length, buildings: c.buildings.length });
  }
  const manifest: WorldManifest = {
    version: DATA_VERSION,
    generatedAt: new Date().toISOString(),
    origin: { lat: GEO_ORIGIN.lat, lon: GEO_ORIGIN.lon, source: GEO_ORIGIN.source },
    chunkSize: CHUNK_SIZE,
    bounds: { minX: B.minX, maxX: B.maxX, minZ: B.minZ, maxZ: B.maxZ },
    chunks: manifestChunks,
    spawn,
    landmarks: allLandmarks,
    places: allPlaces,
    attribution: meta.attribution,
    sources: meta.regions.map((r) => ({ label: r.label, endpoint: r.endpoint, retrievedAt: r.retrievedAt, osmBaseTimestamp: r.osmBaseTimestamp })),
  };
  writeFileSync(join(PUB, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(join(PUB, 'sea.json'), JSON.stringify(seaData));
  // Routable road graph (real OSM connectivity) for navigation, search and traffic.
  const graph = buildGraphData(
    roadXZ.map((r) => {
      const name = r.props.nameEn ?? r.props.name;
      return { pts: r.pts, cls: r.props.cls, oneway: r.props.oneway, ...(name ? { name } : {}) };
    }),
  );
  writeFileSync(join(PUB, 'roadgraph.json'), JSON.stringify(graph));
  console.log(`Road graph: ${graph.nodes.length / 2} nodes, ${graph.edges.length / 5} edges, ${graph.names.length} named roads`);

  // Minimap layers (lon/lat), trimmed to the world area plus a margin.
  const mapBox = projection.bboxOfRect(B, 600);
  const inMapBox = (coords: Position[]) => coords.some((p) => p[0]! >= mapBox.west && p[0]! <= mapBox.east && p[1]! >= mapBox.south && p[1]! <= mapBox.north);
  // ~0.1 m for roads, ~1 m for area outlines: plenty for a 2D map and much smaller to load.
  const r6 = (p: Position): Position => [Math.round(p[0]! * 1e6) / 1e6, Math.round(p[1]! * 1e6) / 1e6];
  const r5 = (p: Position): Position => [Math.round(p[0]! * 1e5) / 1e5, Math.round(p[1]! * 1e5) / 1e5];
  const slimLines = (fc: FeatureCollection<LineString, RoadProps>) => ({
    type: 'FeatureCollection',
    features: fc.features
      .filter((f) => inMapBox(f.geometry.coordinates))
      .map((f) => ({ type: 'Feature', properties: { cls: f.properties.cls, name: f.properties.nameEn ?? f.properties.name ?? null }, geometry: { type: 'LineString', coordinates: f.geometry.coordinates.map(r6) } })),
  });
  const slimPolys = (fc: FeatureCollection<Polygon | MultiPolygon, { kind?: string }>) => ({
    type: 'FeatureCollection',
    features: fc.features
      .filter((f) => polygonsOf(f.geometry).some((p) => inMapBox(p[0]!)))
      .map(
        (f): Feature => ({
          type: 'Feature',
          properties: { kind: f.properties.kind ?? 'building' },
          geometry: f.geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: f.geometry.coordinates.map((r) => r.map(r5)) } : { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map((p) => p.map((r) => r.map(r5))) },
        }),
      ),
  });
  writeFileSync(join(MAP_DIR, 'roads.geojson'), JSON.stringify(slimLines(roads)));
  writeFileSync(join(MAP_DIR, 'buildings.geojson'), JSON.stringify(slimPolys(buildings as FeatureCollection<Polygon | MultiPolygon, { kind?: string }>)));
  writeFileSync(join(MAP_DIR, 'landuse.geojson'), JSON.stringify(slimPolys(landuse)));
  const waterAll = slimPolys(water) as { features: Feature[] };
  waterAll.features.push(...(sea.features as Feature[]));
  writeFileSync(join(MAP_DIR, 'water.geojson'), JSON.stringify(waterAll));

  console.log(`Wrote ${allChunks.length} chunks (${(bytes / 1024 / 1024).toFixed(2)} MB), ${allLandmarks.length} landmarks, ${allPlaces.length} places.`);
  console.log(`Buildings with centroid outside the world area (not chunked): ${buildingsOutside}`);
  console.log('Spawn:', JSON.stringify(spawn));
  console.log('Done. Next: npm run data:validate');
}

const DRIVABLE = new Set(['primary', 'secondary', 'tertiary', 'residential', 'service']);
const CLASS_PRIORITY: Record<string, number> = { primary: 0, secondary: 1, tertiary: 2, residential: 3, service: 4 };

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function chooseSpawn(roadXZ: Array<{ props: RoadProps; pts: Pt[] }>, buildingRings: Pt[][], seaRings: Pt[][]): WorldManifest['spawn'] {
  const blocked = (x: number, z: number, clearance: number): boolean => {
    for (const r of buildingRings) {
      const b = ringBounds(r);
      if (x < b.minX - clearance || x > b.maxX + clearance || z < b.minY - clearance || z > b.maxY + clearance) continue;
      if (pointInRing(x, z, r)) return true;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        if (distToSegmentSq(x, z, r[j]![0], r[j]![1], r[i]![0], r[i]![1]) < clearance * clearance) return true;
      }
    }
    return seaRings.some((r) => pointInRing(x, z, r));
  };

  interface Cand {
    x: number;
    z: number;
    dx: number;
    dz: number;
    w: number;
    d: number;
    pr: number;
    name?: string;
  }
  const cands: Cand[] = [];
  for (const { props, pts } of roadXZ) {
    if (!DRIVABLE.has(props.cls) || props.bridge) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 24) continue;
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      const c: Cand = { x: mx, z: mz, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len, w: props.width, d: Math.hypot(mx, mz), pr: CLASS_PRIORITY[props.cls] ?? 5 };
      const nm = props.nameEn ?? props.name;
      if (nm) c.name = nm;
      cands.push(c);
    }
  }
  if (cands.length === 0) return { player: { x: 0, z: 0, yaw: 0 }, vehicles: [{ x: 6, z: 0, yaw: 0 }] };
  const yawOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);
  const usable = (c: Cand) => !blocked(c.x + -c.dz * (c.w / 2 - 1.4), c.z + c.dx * (c.w / 2 - 1.4), 2.5);
  cands.sort((a, b) => a.d + a.pr * 60 - (b.d + b.pr * 60));
  const main = cands.find(usable) ?? cands[0]!;
  // Perpendicular (right-hand side of travel direction in an X-east/Z-south plane).
  const px = -main.dz;
  const pz = main.dx;
  const carOff = main.w / 2 - 1.4;
  const vehicles: SpawnPoint[] = [{ x: r2(main.x + px * carOff), z: r2(main.z + pz * carOff), yaw: yawOf(main.dx, main.dz), ...(main.name ? { road: main.name } : {}) }];
  const player: SpawnPoint = { x: r2(main.x - main.dx * 7 + px * (main.w / 2 + 0.2)), z: r2(main.z - main.dz * 7 + pz * (main.w / 2 + 0.2)), yaw: yawOf(main.dx, main.dz), ...(main.name ? { road: main.name } : {}) };
  // A couple of extra parked cars on other real roads, 120–400 m away.
  for (const c of cands) {
    if (vehicles.length >= 3) break;
    const dist = Math.hypot(c.x - main.x, c.z - main.z);
    if (dist < 120 || dist > 400 || c.pr > 3) continue;
    if (vehicles.some((v) => Math.hypot(v.x - c.x, v.z - c.z) < 150)) continue;
    if (!usable(c)) continue;
    const off = c.w / 2 - 1.4;
    vehicles.push({ x: r2(c.x - c.dz * off), z: r2(c.z + c.dx * off), yaw: yawOf(c.dx, c.dz), ...(c.name ? { road: c.name } : {}) });
  }
  return { player, vehicles };
}

main();
