/**
 * Alternative to fetch-osm.ts when the public Overpass servers are
 * overloaded: reads a Geofabrik OpenStreetMap extract (.osm.pbf) locally and
 * writes the same Overpass-style JSON (with inline geometry) that
 * convert-osm.ts expects, for the world bounds in src/config.ts.
 *
 * Usage:
 *   curl -L -o data/pbf/myanmar.osm.pbf https://download.geofabrik.de/asia/myanmar-latest.osm.pbf
 *   npm run data:extract -- data/pbf/myanmar.osm.pbf
 *
 * The OSM PBF format is decoded directly (BlobHeader/Blob, zlib, PrimitiveBlock
 * with DenseNodes, Ways and Relations) using the `pbf` protobuf reader.
 * Three passes keep memory small: (1) nodes inside the area + ways/relations
 * that touch it, (2) member ways of kept relations that lie outside it,
 * (3) coordinates of any referenced nodes still missing.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { visit, type Tags as PbfTags } from './pbfReader';
import { SEA_MARGIN, WORLD_BOUNDS } from '../src/config';
import { projection } from '../src/geo/GeoProjection';

const ROOT = join(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'data', 'osm');
const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: npm run data:extract -- <path/to/extract.osm.pbf>');
  process.exit(1);
}
const TAG = `b${WORLD_BOUNDS.minX}_${WORLD_BOUNDS.maxX}_${WORLD_BOUNDS.minZ}_${WORLD_BOUNDS.maxZ}`.replace(/-/g, 'm');
const world = projection.bboxOfRect(WORLD_BOUNDS, 64);
const seaBox = projection.bboxOfRect(WORLD_BOUNDS, SEA_MARGIN);
const inBox = (b: typeof world, lat: number, lon: number) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

type Tags = PbfTags;

// ---------------------------------------------------------------------------
// Feature selection (mirrors the Overpass query in fetch-osm.ts)
// ---------------------------------------------------------------------------

const AREA_KEYS = ['building', 'landuse', 'leisure', 'waterway', 'amenity'];
function wantWay(t: Tags): boolean {
  if (t['barrier'] || t['highway'] || t['man_made'] === 'pier') return true;
  if (t['natural'] && t['natural'] !== 'coastline') return true;
  return AREA_KEYS.some((k) => t[k] !== undefined);
}
function wantRelation(t: Tags): boolean {
  return t['type'] === 'multipolygon' && (['building', 'landuse', 'natural', 'leisure', 'waterway', 'amenity'] as const).some((k) => t[k] !== undefined);
}
function wantNode(t: Tags | null): boolean {
  return !!t && (t['natural'] === 'tree' || t['highway'] === 'street_lamp' || t['name'] !== undefined);
}

function main(): void {
  const t0 = Date.now();
  const coords = new Map<number, [number, number]>();
  const nodesOut: unknown[] = [];
  const ways = new Map<number, { refs: number[]; tags: Tags }>();
  const coast = new Map<number, number[]>();
  const rels: Array<{ id: number; members: Array<{ type: 'node' | 'way' | 'relation'; ref: number; role: string }>; tags: Tags }> = [];

  console.log(`Reading ${file} (${(statSync(file).size / 1048576).toFixed(0)} MB) for ${TAG}…`);
  // Pass 1.
  visit(file, {
    node(id, lat, lon, tags) {
      if (!inBox(seaBox, lat, lon)) return;
      coords.set(id, [lat, lon]);
      if (inBox(world, lat, lon) && wantNode(tags)) nodesOut.push({ type: 'node', id, lat, lon, tags });
    },
    way(id, refs, tags) {
      if (tags['natural'] === 'coastline') {
        if (refs.some((r) => coords.has(r))) coast.set(id, refs);
        return;
      }
      if (!wantWay(tags)) return;
      if (refs.some((r) => {
        const c = coords.get(r);
        return c !== undefined && inBox(world, c[0], c[1]);
      })) ways.set(id, { refs, tags });
    },
    relation(id, members, tags) {
      if (!wantRelation(tags)) return;
      if (members.some((m) => m.type === 'way' && ways.has(m.ref))) rels.push({ id, members, tags });
    },
  });
  console.log(`Pass 1: ${coords.size} nodes in area, ${ways.size} ways, ${rels.length} relations, ${coast.size} coastline ways (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // Pass 2: member ways of kept relations that are not yet loaded.
  const memberWays = new Map<number, number[]>();
  const needWays = new Set<number>();
  for (const r of rels) for (const m of r.members) if (m.type === 'way' && !ways.has(m.ref)) needWays.add(m.ref);
  if (needWays.size) {
    visit(file, {
      way(id, refs) {
        if (needWays.has(id)) memberWays.set(id, refs);
      },
    });
  }
  // Pass 3: coordinates of nodes referenced but outside the area.
  const missing = new Set<number>();
  const want = (refs: number[]) => refs.forEach((r) => !coords.has(r) && missing.add(r));
  for (const w of ways.values()) want(w.refs);
  for (const refs of coast.values()) want(refs);
  for (const refs of memberWays.values()) want(refs);
  if (missing.size) {
    visit(file, {
      node(id, lat, lon) {
        if (missing.has(id)) coords.set(id, [lat, lon]);
      },
    });
  }
  console.log(`Pass 2/3: ${memberWays.size} extra member ways, ${missing.size} extra nodes (${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  const geom = (refs: number[]) => refs.map((r) => {
    const c = coords.get(r);
    return c ? { lat: c[0], lon: c[1] } : null;
  });
  const elements: unknown[] = [...nodesOut];
  for (const [id, w] of ways) elements.push({ type: 'way', id, nodes: w.refs, geometry: geom(w.refs), tags: w.tags });
  for (const r of rels) {
    elements.push({
      type: 'relation',
      id: r.id,
      tags: r.tags,
      members: r.members.map((m) => {
        if (m.type !== 'way') return m;
        const refs = ways.get(m.ref)?.refs ?? memberWays.get(m.ref);
        return refs ? { ...m, geometry: geom(refs) } : m;
      }),
    });
  }
  const coastEls = [...coast].map(([id, refs]) => ({ type: 'way', id, nodes: refs, geometry: geom(refs), tags: { natural: 'coastline' } }));

  mkdirSync(OUT_DIR, { recursive: true });
  const meta = (label: string, bbox: unknown) => ({
    label,
    source: `OpenStreetMap extract by Geofabrik (${file.split('/').pop()})`,
    license: 'ODbL 1.0 — © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)',
    endpoint: 'https://download.geofabrik.de/asia/',
    retrievedAt: new Date(statSync(file).mtime).toISOString(),
    osmBaseTimestamp: null,
    bbox,
    query: 'local PBF extract (scripts/extract-pbf.ts)',
  });
  writeFileSync(join(OUT_DIR, `region_${TAG}_pbf.json`), JSON.stringify({ meta: meta('Geofabrik extract', world), elements }));
  writeFileSync(join(OUT_DIR, `coastline_${TAG}.json`), JSON.stringify({ meta: meta('coastline', seaBox), elements: coastEls }));
  console.log(`Wrote ${elements.length} elements + ${coastEls.length} coastline ways in ${((Date.now() - t0) / 1000).toFixed(0)} s. Next: npm run data:convert`);
}

main();
