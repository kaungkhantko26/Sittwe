/**
 * Step 1 of the data pipeline: download raw OpenStreetMap data for the game
 * world from the Overpass API, split into bounded extraction regions, and
 * cache each response locally in data/osm/.
 *
 * Usage:  npm run data:fetch            (skips regions already cached)
 *         npm run data:fetch -- --force (re-downloads everything)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GEO_ORIGIN, SEA_MARGIN, WORLD_BOUNDS } from '../src/config';
import { projection } from '../src/geo/GeoProjection';

const OUT_DIR = join(import.meta.dirname, '..', 'data', 'osm');
// Override with OVERPASS_ENDPOINTS="url1,url2" when some servers are overloaded.
const ENDPOINTS = (process.env['OVERPASS_ENDPOINTS'] ?? 'https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
const USER_AGENT = 'Sittwe3D-data-pipeline/0.1 (open-source game; contact via repository)';
/** Regions per axis, sized so each extraction box is ~1.4 km (kind to public Overpass servers). */
const SPLIT_X = Math.max(1, Math.ceil((WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / 1400));
const SPLIT_Z = Math.max(1, Math.ceil((WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / 1400));
/** Tag for cache file names, so changing the world bounds never reuses mismatched regions. */
const TAG = `b${WORLD_BOUNDS.minX}_${WORLD_BOUNDS.maxX}_${WORLD_BOUNDS.minZ}_${WORLD_BOUNDS.maxZ}`.replace(/-/g, 'm');
/** Extra margin (m) so features straddling the world edge are complete. */
const MARGIN = 64;

const force = process.argv.includes('--force');
/** --single: fetch the whole world in one large request (faster when public servers are queueing). */
const single = process.argv.includes('--single');

interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

function regionQuery(b: BBox): string {
  const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:180][bbox:${bb}];
(
  way["highway"];
  way["man_made"="pier"];
  way["building"];
  relation["type"="multipolygon"]["building"];
  way["landuse"];
  relation["type"="multipolygon"]["landuse"];
  way["natural"]["natural"!="coastline"];
  relation["type"="multipolygon"]["natural"];
  way["leisure"];
  relation["type"="multipolygon"]["leisure"];
  way["waterway"];
  relation["type"="multipolygon"]["waterway"];
  way["amenity"];
  relation["type"="multipolygon"]["amenity"];
  node["natural"="tree"];
  node["highway"="street_lamp"];
  node["name"];
);
out geom;`;
}

function coastlineQuery(b: BBox): string {
  const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  return `[out:json][timeout:180];way["natural"="coastline"](${bb});out geom;`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runQuery(query: string, attempts = 8): Promise<{ json: { elements: unknown[]; osm3s?: { timestamp_osm_base?: string } }; endpoint: string }> {
  let delay = 4000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length]!;
    try {
      console.log(`  → ${endpoint} (attempt ${attempt + 1})`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(single ? 1_000_000 : 240_000),
      });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith('{')) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
      const json = JSON.parse(text) as { elements: unknown[]; remark?: string };
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(`Overpass remark: ${json.remark}`);
      return { json, endpoint };
    } catch (err) {
      console.warn(`    failed: ${(err as Error).message}`);
      await sleep(delay);
      delay = Math.min(delay * 2, 60_000);
    }
  }
  throw new Error('All Overpass attempts failed. Check your network connection and try again later.');
}

async function fetchTo(file: string, query: string, bbox: BBox, label: string, attempts = 8): Promise<void> {
  const path = join(OUT_DIR, file);
  if (existsSync(path) && !force) {
    const cached = JSON.parse(readFileSync(path, 'utf8')) as { meta: { retrievedAt: string }; elements: unknown[] };
    console.log(`✓ ${label}: cached (${cached.elements.length} elements, retrieved ${cached.meta.retrievedAt})`);
    return;
  }
  console.log(`↓ ${label}`);
  const { json, endpoint } = await runQuery(query, attempts);
  const meta = {
    label,
    source: 'OpenStreetMap via Overpass API',
    license: 'ODbL 1.0 — © OpenStreetMap contributors (https://www.openstreetmap.org/copyright)',
    endpoint,
    retrievedAt: new Date().toISOString(),
    osmBaseTimestamp: json.osm3s?.timestamp_osm_base ?? null,
    bbox,
    query,
  };
  writeFileSync(path, JSON.stringify({ meta, elements: json.elements }));
  console.log(`✓ ${label}: ${json.elements.length} elements (OSM data as of ${meta.osmBaseTimestamp})`);
  await sleep(3000); // be polite to the shared public servers
}

/**
 * Fetches one extraction region. If the public servers keep timing out on a
 * region, it is split into 2 × 2 smaller sub-regions (up to two levels deep).
 */
async function fetchRegion(b: BBox, id: string, depth: number): Promise<void> {
  const file = `region_${id}.json`;
  if (single && existsSync(join(OUT_DIR, `region_${TAG}_all.json`))) return; // already covered by the single request
  const subIds = ['a', 'b', 'c', 'd'].map((s) => `${id}${s}`);
  const subCached = subIds.every((s) => existsSync(join(OUT_DIR, `region_${s}.json`)));
  if (!force && subCached) {
    for (const s of subIds) console.log(`✓ region ${s}: cached`);
    return;
  }
  try {
    await fetchTo(file, regionQuery(b), b, `region ${id}`, depth < 2 ? 4 : 8);
  } catch (err) {
    if (depth >= 2) throw err;
    console.warn(`  region ${id} failed repeatedly; splitting into 4 sub-regions`);
    const midLat = (b.south + b.north) / 2;
    const midLon = (b.west + b.east) / 2;
    const parts: BBox[] = [
      { south: b.south, north: midLat, west: b.west, east: midLon },
      { south: b.south, north: midLat, west: midLon, east: b.east },
      { south: midLat, north: b.north, west: b.west, east: midLon },
      { south: midLat, north: b.north, west: midLon, east: b.east },
    ];
    for (let k = 0; k < 4; k++) await fetchRegion(parts[k]!, subIds[k]!, depth + 1);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Origin: ${GEO_ORIGIN.lat}, ${GEO_ORIGIN.lon} — ${GEO_ORIGIN.source}`);
  const world = projection.bboxOfRect(WORLD_BOUNDS, MARGIN);
  console.log(`World bbox: S${world.south.toFixed(5)} W${world.west.toFixed(5)} N${world.north.toFixed(5)} E${world.east.toFixed(5)}`);

  if (single) {
    await fetchTo(`region_${TAG}_all.json`, regionQuery(world).replace('[timeout:180]', '[timeout:900][maxsize:1073741824]'), world, 'whole world (single request)', 6);
  }
  const dLat = (world.north - world.south) / SPLIT_Z;
  const dLon = (world.east - world.west) / SPLIT_X;
  console.log(`Regions: ${SPLIT_X} × ${SPLIT_Z}`);
  for (let i = 0; i < SPLIT_Z; i++) {
    for (let j = 0; j < SPLIT_X; j++) {
      const b: BBox = { south: world.south + i * dLat, north: world.south + (i + 1) * dLat, west: world.west + j * dLon, east: world.west + (j + 1) * dLon };
      await fetchRegion(b, `${TAG}_${i}_${j}`, 0);
    }
  }
  const seaBox = projection.bboxOfRect(WORLD_BOUNDS, SEA_MARGIN);
  await fetchTo(`coastline_${TAG}.json`, coastlineQuery(seaBox), seaBox, 'coastline');
  console.log('Done. Next: npm run data:convert');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
