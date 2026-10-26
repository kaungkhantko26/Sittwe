/**
 * Step 2 of the data pipeline: normalize cached raw Overpass JSON into
 * GeoJSON layers (data/geojson/*.geojson) plus a metadata/report file.
 *
 * Usage: npm run data:convert
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureCollection, Polygon, Position } from 'geojson';
import { SEA_MARGIN, WORLD_BOUNDS } from '../src/config';
import { projection } from '../src/geo/GeoProjection';
import { buildSeaPolygons, type Pt } from '../src/geo/geometry2d';
import { parseOsm } from '../src/geo/OSMParser';

const ROOT = join(import.meta.dirname, '..');
const OSM_DIR = join(ROOT, 'data', 'osm');
const OUT_DIR = join(ROOT, 'data', 'geojson');

interface CachedFile {
  meta: { label: string; endpoint: string; retrievedAt: string; osmBaseTimestamp: string | null; bbox: unknown };
  elements: unknown[];
}

function load(file: string): CachedFile {
  return JSON.parse(readFileSync(join(OSM_DIR, file), 'utf8')) as CachedFile;
}

function main(): void {
  if (!existsSync(OSM_DIR)) throw new Error('data/osm not found. Run `npm run data:fetch` first.');
  mkdirSync(OUT_DIR, { recursive: true });

  // Prefer a local PBF extract for the current bounds when present (scripts/extract-pbf.ts).
  const tagName = `b${WORLD_BOUNDS.minX}_${WORLD_BOUNDS.maxX}_${WORLD_BOUNDS.minZ}_${WORLD_BOUNDS.maxZ}`.replace(/-/g, 'm');
  const all = readdirSync(OSM_DIR).filter((f) => /^region_.*\.json$/.test(f)).sort();
  const pbfFile = `region_${tagName}_pbf.json`;
  const regionFiles = all.includes(pbfFile) ? [pbfFile] : all;
  if (regionFiles.length === 0) throw new Error('No cached regions in data/osm. Run `npm run data:fetch` first.');
  const metas: CachedFile['meta'][] = [];
  const elements: unknown[] = [];
  for (const f of regionFiles) {
    const c = load(f);
    metas.push(c.meta);
    elements.push(...c.elements);
  }
  console.log(`Parsing ${elements.length} raw elements from ${regionFiles.length} regions…`);
  const parsed = parseOsm(elements);

  // Sea polygons from the coastline.
  const warnings: string[] = [];
  let sea: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: [] };
  const tag = `b${WORLD_BOUNDS.minX}_${WORLD_BOUNDS.maxX}_${WORLD_BOUNDS.minZ}_${WORLD_BOUNDS.maxZ}`.replace(/-/g, 'm');
  const coastFile = existsSync(join(OSM_DIR, `coastline_${tag}.json`)) ? `coastline_${tag}.json` : 'coastline.json';
  if (existsSync(join(OSM_DIR, coastFile))) {
    const coast = load(coastFile);
    metas.push(coast.meta);
    const coastParsed = parseOsm(coast.elements);
    const b = projection.bboxOfRect(WORLD_BOUNDS, SEA_MARGIN);
    const res = buildSeaPolygons(coastParsed.coastlines as Pt[][], { minX: b.west, minY: b.south, maxX: b.east, maxY: b.north });
    warnings.push(...res.warnings);
    sea = {
      type: 'FeatureCollection',
      features: res.rings.map((poly, i) => ({
        type: 'Feature',
        id: `sea/${i}`,
        properties: { id: `sea/${i}`, kind: 'sea', source: 'derived from OSM natural=coastline ways' },
        geometry: { type: 'Polygon', coordinates: poly.map((r) => r.map((p): Position => [p[0], p[1]])) },
      })),
    };
    console.log(`Coastline: ${coastParsed.stats.coastlineWays} ways → ${sea.features.length} sea polygon(s)`);
  } else {
    warnings.push('coastline.json missing: no sea polygon generated.');
  }

  const layers: Record<string, unknown> = {
    roads: parsed.roads,
    buildings: parsed.buildings,
    water: parsed.water,
    waterways: parsed.waterways,
    landuse: parsed.landuse,
    landmarks: parsed.landmarks,
    places: parsed.places,
    trees: parsed.trees,
    streetlamps: parsed.streetLamps,
    sea,
  };
  for (const [name, fc] of Object.entries(layers)) {
    writeFileSync(join(OUT_DIR, `${name}.geojson`), JSON.stringify(fc));
  }

  const s = parsed.stats;
  const report = {
    generatedAt: new Date().toISOString(),
    source: 'OpenStreetMap via Overpass API',
    attribution: '© OpenStreetMap contributors. Data available under the Open Database License (ODbL 1.0).',
    regions: metas.map((m) => ({ label: m.label, endpoint: m.endpoint, retrievedAt: m.retrievedAt, osmBaseTimestamp: m.osmBaseTimestamp, bbox: m.bbox })),
    stats: s,
    warnings,
    missingData: {
      buildingsWithoutHeightOrLevels: s.buildingsHeightEstimated,
      waysWithMissingGeometry: s.skippedMissingGeometry,
      unclosedRelationRings: s.skippedUnclosedRelationRings,
      unsupportedHighwayTypes: s.skippedUnsupportedHighway,
      invalidCoordinates: s.skippedInvalidCoordinates,
    },
    inferred: [
      'Building heights estimated from type/footprint area when no height or building:levels tag exists (see OSMParser.buildingHeight).',
      'Road widths default per highway class when no width/lanes tag exists (see OSMParser.DEFAULT_ROAD_WIDTH).',
      'Sea polygons derived from natural=coastline ways (water on the right-hand side of the way direction).',
      'Terrain is flat at sea level: no elevation model is used.',
    ],
  };
  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(report, null, 2));
  console.log('Stats:', s);
  if (warnings.length) console.warn('Warnings:', warnings);
  console.log('Done. Next: npm run data:chunks');
}

main();
