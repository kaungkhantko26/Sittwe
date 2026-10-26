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
import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { PbfReader as Pbf } from 'pbf';
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

type Tags = Record<string, string>;

// ---------------------------------------------------------------------------
// Low-level PBF block iteration
// ---------------------------------------------------------------------------

interface Block {
  strings: string[];
  granularity: number;
  latOffset: number;
  lonOffset: number;
  groups: Uint8Array[];
}

function* blocks(path: string): Generator<Block> {
  const fd = openSync(path, 'r');
  const size = statSync(path).size;
  let pos = 0;
  const lenBuf = Buffer.alloc(4);
  try {
    while (pos < size) {
      readSync(fd, lenBuf, 0, 4, pos);
      const hlen = lenBuf.readUInt32BE(0);
      pos += 4;
      const hbuf = Buffer.alloc(hlen);
      readSync(fd, hbuf, 0, hlen, pos);
      pos += hlen;
      const header = new Pbf(hbuf).readFields((tag, h: { type: string; size: number }, p) => {
        if (tag === 1) h.type = p!.readString();
        else if (tag === 3) h.size = p!.readVarint();
      }, { type: '', size: 0 });
      const bbuf = Buffer.alloc(header.size);
      readSync(fd, bbuf, 0, header.size, pos);
      pos += header.size;
      if (header.type !== 'OSMData') continue;
      const blob = new Pbf(bbuf).readFields((tag, b: { raw?: Uint8Array; zlib?: Uint8Array }, p) => {
        if (tag === 1) b.raw = p!.readBytes();
        else if (tag === 3) b.zlib = p!.readBytes();
        else if (tag === 4 || tag === 7) throw new Error('LZMA/ZSTD-compressed PBF blobs are not supported; use a Geofabrik (zlib) extract.');
      }, {} as { raw?: Uint8Array; zlib?: Uint8Array });
      const data = blob.raw ?? inflateSync(blob.zlib!);
      const block: Block = { strings: [], granularity: 100, latOffset: 0, lonOffset: 0, groups: [] };
      new Pbf(data).readFields((tag, b: Block, p) => {
        if (tag === 1) {
          p!.readMessage((t, s: string[], pp) => {
            if (t === 1) s.push(Buffer.from(pp!.readBytes()).toString('utf8'));
          }, b.strings);
        } else if (tag === 2) b.groups.push(p!.readBytes());
        else if (tag === 17) b.granularity = p!.readVarint();
        else if (tag === 19) b.latOffset = p!.readVarint(true);
        else if (tag === 20) b.lonOffset = p!.readVarint(true);
      }, block);
      yield block;
    }
  } finally {
    closeSync(fd);
  }
}

interface Visitor {
  node?(id: number, lat: number, lon: number, tags: Tags | null): void;
  way?(id: number, refs: number[], tags: Tags): void;
  relation?(id: number, members: Array<{ type: 'node' | 'way' | 'relation'; ref: number; role: string }>, tags: Tags): void;
}

function tagsOf(keys: number[], vals: number[], s: string[]): Tags {
  const t: Tags = {};
  for (let i = 0; i < keys.length; i++) t[s[keys[i]!]!] = s[vals[i]!]!;
  return t;
}

function visit(path: string, v: Visitor): void {
  for (const b of blocks(path)) {
    const s = b.strings;
    const scale = 1e-9;
    for (const g of b.groups) {
      new Pbf(g).readFields((tag, _o: object, p) => {
        const pbf = p!;
        if (tag === 2 && v.node) {
          // DenseNodes
          const d = pbf.readMessage((t, o: { id: number[]; lat: number[]; lon: number[]; kv: number[] }, pp) => {
            if (t === 1) pp!.readPackedSVarint(o.id);
            else if (t === 8) pp!.readPackedSVarint(o.lat);
            else if (t === 9) pp!.readPackedSVarint(o.lon);
            else if (t === 10) pp!.readPackedVarint(o.kv);
          }, { id: [], lat: [], lon: [], kv: [] });
          let id = 0;
          let lat = 0;
          let lon = 0;
          let k = 0;
          for (let i = 0; i < d.id.length; i++) {
            id += d.id[i]!;
            lat += d.lat[i]!;
            lon += d.lon[i]!;
            let tags: Tags | null = null;
            if (d.kv.length) {
              while (k < d.kv.length && d.kv[k] !== 0) {
                (tags ??= {})[s[d.kv[k]!]!] = s[d.kv[k + 1]!]!;
                k += 2;
              }
              k++;
            }
            v.node(id, scale * (b.latOffset + b.granularity * lat), scale * (b.lonOffset + b.granularity * lon), tags);
          }
        } else if (tag === 1 && v.node) {
          const n = pbf.readMessage((t, o: { id: number; keys: number[]; vals: number[]; lat: number; lon: number }, pp) => {
            if (t === 1) o.id = pp!.readSVarint();
            else if (t === 2) pp!.readPackedVarint(o.keys);
            else if (t === 3) pp!.readPackedVarint(o.vals);
            else if (t === 8) o.lat = pp!.readSVarint();
            else if (t === 9) o.lon = pp!.readSVarint();
          }, { id: 0, keys: [], vals: [], lat: 0, lon: 0 });
          v.node(n.id, scale * (b.latOffset + b.granularity * n.lat), scale * (b.lonOffset + b.granularity * n.lon), n.keys.length ? tagsOf(n.keys, n.vals, s) : null);
        } else if (tag === 3 && v.way) {
          const w = pbf.readMessage((t, o: { id: number; keys: number[]; vals: number[]; refs: number[] }, pp) => {
            if (t === 1) o.id = pp!.readVarint();
            else if (t === 2) pp!.readPackedVarint(o.keys);
            else if (t === 3) pp!.readPackedVarint(o.vals);
            else if (t === 8) pp!.readPackedSVarint(o.refs);
          }, { id: 0, keys: [], vals: [], refs: [] });
          let r = 0;
          const refs = w.refs.map((dlt) => (r += dlt));
          v.way(w.id, refs, tagsOf(w.keys, w.vals, s));
        } else if (tag === 4 && v.relation) {
          const rel = pbf.readMessage((t, o: { id: number; keys: number[]; vals: number[]; roles: number[]; ids: number[]; types: number[] }, pp) => {
            if (t === 1) o.id = pp!.readVarint();
            else if (t === 2) pp!.readPackedVarint(o.keys);
            else if (t === 3) pp!.readPackedVarint(o.vals);
            else if (t === 8) pp!.readPackedVarint(o.roles);
            else if (t === 9) pp!.readPackedSVarint(o.ids);
            else if (t === 10) pp!.readPackedVarint(o.types);
          }, { id: 0, keys: [], vals: [], roles: [], ids: [], types: [] });
          let m = 0;
          const members = rel.ids.map((dlt, i) => ({ type: (['node', 'way', 'relation'] as const)[rel.types[i]!]!, ref: (m += dlt), role: s[rel.roles[i]!] ?? '' }));
          v.relation(rel.id, members, tagsOf(rel.keys, rel.vals, s));
        }
      }, {});
    }
  }
}

// ---------------------------------------------------------------------------
// Feature selection (mirrors the Overpass query in fetch-osm.ts)
// ---------------------------------------------------------------------------

const AREA_KEYS = ['building', 'landuse', 'leisure', 'waterway', 'amenity'];
function wantWay(t: Tags): boolean {
  if (t['highway'] || t['man_made'] === 'pier') return true;
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
