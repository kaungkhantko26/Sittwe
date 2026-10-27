/**
 * Pulls Sittwe Airport (ICAO VYSW) out of an OpenStreetMap .osm.pbf extract:
 * the aerodrome boundary, runway, taxiways, apron, terminal and any other
 * aeroway=* features around it, projected to local game meters.
 *
 * Usage:
 *   npx tsx scripts/extract-airport.ts data/pbf/myanmar-261025.osm.pbf
 *
 * Writes public/data/airport.json. Nothing here is invented: every shape is
 * an OSM way with its id, so the game can draw the airport where it really is.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projection } from '../src/geo/GeoProjection';
import { visit, type Tags } from './pbfReader';

const ROOT = join(import.meta.dirname, '..');
const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: npx tsx scripts/extract-airport.ts <path/to/extract.osm.pbf>');
  process.exit(1);
}

/** Search box around Sittwe Airport (generous; features are filtered by their centre). */
const BOX = { south: 20.11, north: 20.16, west: 92.85, east: 92.9 };
const inBox = (lat: number, lon: number) => lat >= BOX.south && lat <= BOX.north && lon >= BOX.west && lon <= BOX.east;

const wanted = (t: Tags) => t['aeroway'] !== undefined;

// Pass 1: aeroway ways and nodes (any location; filtered after we know coordinates),
// plus buildings that share a wall (node) with the terminal: OSM splits the
// terminal complex into touching pieces. Ways come sorted by id, and the
// terminal (way 222638250) is older than its touching pieces.
const ways = new Map<number, { refs: number[]; tags: Tags }>();
const terminalNodes = new Set<number>();
const points: Array<{ id: number; lat: number; lon: number; tags: Tags }> = [];
visit(file, {
  node(id, lat, lon, tags) {
    if (tags && wanted(tags) && inBox(lat, lon)) points.push({ id, lat, lon, tags });
  },
  way(id, refs, tags) {
    if (wanted(tags)) {
      ways.set(id, { refs, tags });
      if (tags['aeroway'] === 'terminal') for (const r of refs) terminalNodes.add(r);
    } else if (tags['building'] && terminalNodes.size && refs.some((r) => terminalNodes.has(r))) {
      ways.set(id, { refs, tags: { ...tags, 'sittwe3d:part': 'terminal' } });
    }
  },
});
const need = new Set<number>();
for (const w of ways.values()) for (const r of w.refs) need.add(r);

// Pass 2: coordinates of their nodes.
const coords = new Map<number, [number, number]>();
visit(file, {
  node(id, lat, lon) {
    if (need.has(id)) coords.set(id, [lat, lon]);
  },
});

const features: Array<{ id: number; tags: Tags; closed: boolean; points: Array<[number, number]> }> = [];
for (const [id, w] of ways) {
  const ll = w.refs.map((r) => coords.get(r)).filter((c): c is [number, number] => !!c);
  if (ll.length < 2) continue;
  const lat = ll.reduce((a, c) => a + c[0], 0) / ll.length;
  const lon = ll.reduce((a, c) => a + c[1], 0) / ll.length;
  if (!inBox(lat, lon)) continue;
  const pts = ll.map(([la, lo]) => {
    const [x, z] = projection.lonLatToXZ(lo, la);
    return [Math.round(x * 10) / 10, Math.round(z * 10) / 10] as [number, number];
  });
  features.push({ id, tags: w.tags, closed: w.refs[0] === w.refs[w.refs.length - 1], points: pts });
}
features.sort((a, b) => a.id - b.id);
const nodes = points.map((p) => {
  const [x, z] = projection.lonLatToXZ(p.lon, p.lat);
  return { id: p.id, tags: p.tags, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
});

const out = {
  source: `OpenStreetMap contributors (ODbL), extracted from ${file.split('/').pop()}`,
  features,
  nodes,
};
writeFileSync(join(ROOT, 'public', 'data', 'airport.json'), JSON.stringify(out));
const count = (k: string) => features.filter((f) => f.tags['aeroway'] === k || f.tags['sittwe3d:part'] === k).length;
console.log(`Airport: ${features.length} ways (runway ${count('runway')}, taxiway ${count('taxiway')}, apron ${count('apron')}, terminal ${count('terminal')} + ${features.filter((f) => f.tags['sittwe3d:part']).length} touching, aerodrome ${count('aerodrome')}), ${nodes.length} nodes`);
for (const f of features) console.log(' ', f.id, JSON.stringify(f.tags), f.points.length, 'pts');
for (const n of nodes) console.log('  node', n.id, JSON.stringify(n.tags), n.x, n.z);
