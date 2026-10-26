/**
 * Converts raw Overpass API JSON (queried with `out geom`) into normalized
 * GeoJSON feature collections. Pure functions: no I/O, usable from Node and
 * the browser, and covered by unit tests.
 */
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon, Position } from 'geojson';
import { joinLines, pointInRing, ringCentroid, signedArea, type Pt, type Ring } from './geometry2d';

// ---------------------------------------------------------------------------
// Raw Overpass types
// ---------------------------------------------------------------------------

export type Tags = Record<string, string>;

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface OsmWay {
  type: 'way';
  id: number;
  nodes?: number[];
  geometry?: Array<{ lat: number; lon: number } | null>;
  tags?: Tags;
}

export interface OsmRelationMember {
  type: 'node' | 'way' | 'relation';
  ref: number;
  role: string;
  geometry?: Array<{ lat: number; lon: number } | null>;
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  members?: OsmRelationMember[];
  tags?: Tags;
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

// ---------------------------------------------------------------------------
// Normalized feature properties
// ---------------------------------------------------------------------------

export type RoadClass =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'service'
  | 'track'
  | 'pedestrian'
  | 'path'
  | 'pier';

export interface RoadProps {
  id: string;
  cls: RoadClass;
  highway: string;
  name?: string;
  nameEn?: string;
  nameMy?: string;
  /** Local-language name for Rakhine UI: name:rki, else the Myanmar-script `name`, else name:my. */
  nameLocal?: string;
  width: number;
  widthSource: 'tag' | 'lanes' | 'default';
  oneway: boolean;
  bridge: boolean;
  layer: number;
  surface?: string;
}

export type HeightSource = 'tag' | 'levels' | 'estimate';

export interface BuildingProps {
  id: string;
  kind: string;
  name?: string;
  nameEn?: string;
  height: number;
  minHeight: number;
  levels?: number;
  heightSource: HeightSource;
  roofShape?: string;
  /** Footprint area in m² (approximate, from lon/lat). */
  area: number;
}

export interface AreaProps {
  id: string;
  kind: string;
  name?: string;
}

export interface WaterwayProps {
  id: string;
  kind: string;
  width: number;
  name?: string;
}

export type LandmarkCategory = 'worship' | 'education' | 'health' | 'government' | 'market' | 'tourism' | 'transport' | 'shop' | 'other';

export interface LandmarkProps {
  id: string;
  name: string;
  nameEn?: string;
  nameMy?: string;
  /** Local-language name for Rakhine UI: name:rki, else the Myanmar-script `name`, else name:my. */
  nameLocal?: string;
  category: LandmarkCategory;
  kind: string;
  religion?: string;
  /** Whether the landmark has its own mapped building footprint. */
  hasFootprint: boolean;
}

export interface PlaceProps {
  id: string;
  name: string;
  nameEn?: string;
  nameMy?: string;
  /** Local-language name for Rakhine UI: name:rki, else the Myanmar-script `name`, else name:my. */
  nameLocal?: string;
  place: string;
}

export interface ParseStats {
  elements: number;
  roads: number;
  buildings: number;
  buildingsHeightFromTag: number;
  buildingsHeightFromLevels: number;
  buildingsHeightEstimated: number;
  water: number;
  waterways: number;
  landuse: number;
  landmarks: number;
  places: number;
  trees: number;
  streetLamps: number;
  coastlineWays: number;
  skippedMissingGeometry: number;
  skippedUnclosedRelationRings: number;
  skippedUnsupportedHighway: number;
  skippedInvalidCoordinates: number;
}

export interface ParsedOsm {
  roads: FeatureCollection<LineString, RoadProps>;
  buildings: FeatureCollection<Polygon | MultiPolygon, BuildingProps>;
  water: FeatureCollection<Polygon | MultiPolygon, AreaProps>;
  waterways: FeatureCollection<LineString, WaterwayProps>;
  landuse: FeatureCollection<Polygon | MultiPolygon, AreaProps>;
  landmarks: FeatureCollection<Point, LandmarkProps>;
  places: FeatureCollection<Point, PlaceProps>;
  trees: FeatureCollection<Point, { id: string }>;
  streetLamps: FeatureCollection<Point, { id: string }>;
  /** Raw coastline line strings in lon/lat; turned into sea polygons later. */
  coastlines: Pt[][];
  stats: ParseStats;
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

export const LEVEL_HEIGHT_M = 3.2;

const ROAD_CLASS: Record<string, RoadClass> = {
  motorway: 'primary',
  motorway_link: 'primary',
  trunk: 'primary',
  trunk_link: 'primary',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  residential: 'residential',
  unclassified: 'residential',
  living_street: 'residential',
  road: 'residential',
  service: 'service',
  track: 'track',
  pedestrian: 'pedestrian',
  footway: 'path',
  path: 'path',
  cycleway: 'path',
  steps: 'path',
  bridleway: 'path',
};

export const DEFAULT_ROAD_WIDTH: Record<RoadClass, number> = {
  primary: 10,
  secondary: 8.5,
  tertiary: 7,
  residential: 5.5,
  service: 4,
  track: 3.5,
  pedestrian: 4,
  path: 2,
  pier: 3,
};

const WATERWAY_WIDTH: Record<string, number> = {
  river: 15,
  canal: 6,
  stream: 3,
  drain: 1.5,
  ditch: 1.2,
};

/** Parses "12", "12 m", "12.5m", "40'" (feet) → meters. Returns undefined when invalid. */
export function parseLength(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase().replace(',', '.');
  const ft = /^([\d.]+)\s*(?:'|ft|feet)$/.exec(s);
  if (ft) {
    const n = parseFloat(ft[1]!) * 0.3048;
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const m = /^([\d.]+)\s*(?:m|meters?|metres?)?$/.exec(s);
  if (!m) return undefined;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseLevels(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 200 ? n : undefined;
}

export function classifyRoad(highway: string | undefined): RoadClass | undefined {
  if (!highway) return undefined;
  return ROAD_CLASS[highway];
}

export function roadWidth(cls: RoadClass, tags: Tags): { width: number; source: RoadProps['widthSource'] } {
  const w = parseLength(tags['width']);
  if (w && w >= 1 && w <= 40) return { width: w, source: 'tag' };
  const lanes = parseLevels(tags['lanes']);
  if (lanes && lanes >= 1 && lanes <= 8 && cls !== 'path') return { width: Math.max(lanes * 3.2, DEFAULT_ROAD_WIDTH[cls] * 0.8), source: 'lanes' };
  return { width: DEFAULT_ROAD_WIDTH[cls], source: 'default' };
}

const ONE_STOREY = new Set(['hut', 'shed', 'garage', 'garages', 'kiosk', 'carport', 'toilets', 'roof', 'cabin', 'farm_auxiliary', 'service']);
const MULTI_STOREY = new Set(['apartments', 'hotel', 'hospital', 'office', 'commercial', 'retail', 'school', 'university', 'college', 'public', 'government', 'civic', 'dormitory']);
const RELIGIOUS = new Set(['temple', 'monastery', 'mosque', 'church', 'religious', 'pagoda', 'shrine', 'cathedral']);

/**
 * Building height rules, in priority order:
 *  1. `height` tag (meters)                                  → 'tag'
 *  2. `building:levels` × 3.2 m (+ `roof:levels` × 0.5 × 3.2) → 'levels'
 *  3. Estimate (documented, deterministic)                    → 'estimate'
 *     - huts/sheds/garages/kiosks etc.: 1 storey (3.2 m)
 *     - religious buildings: 2 storeys (6.4 m)
 *     - apartments/offices/commercial/school/hospital: 3 storeys (9.6 m)
 *     - everything else (incl. building=yes/house): by footprint area
 *         < 90 m² → 1 storey, < 300 m² → 2 storeys, otherwise 3 storeys
 */
export function buildingHeight(tags: Tags, areaM2: number): { height: number; levels?: number; source: HeightSource } {
  const h = parseLength(tags['height']);
  if (h && h < 300) return { height: h, source: 'tag', levels: parseLevels(tags['building:levels']) };
  const levels = parseLevels(tags['building:levels']);
  if (levels) {
    const roofLevels = parseLevels(tags['roof:levels']) ?? 0;
    return { height: (levels + roofLevels * 0.5) * LEVEL_HEIGHT_M, levels, source: 'levels' };
  }
  const kind = tags['building'] ?? 'yes';
  let est: number;
  if (ONE_STOREY.has(kind)) est = 1;
  else if (RELIGIOUS.has(kind)) est = 2;
  else if (MULTI_STOREY.has(kind)) est = 3;
  else if (areaM2 < 90) est = 1;
  else if (areaM2 < 300) est = 2;
  else est = 3;
  return { height: est * LEVEL_HEIGHT_M, levels: est, source: 'estimate' };
}

function names(tags: Tags): { name?: string; nameEn?: string; nameMy?: string; nameLocal?: string } {
  const out: { name?: string; nameEn?: string; nameMy?: string; nameLocal?: string } = {};
  if (tags['name']) out.name = tags['name'];
  if (tags['name:en']) out.nameEn = tags['name:en'];
  if (tags['name:my']) out.nameMy = tags['name:my'];
  else if (tags['name'] && /[က-႟]/.test(tags['name'])) out.nameMy = tags['name'];
  // Rakhine UI label: explicit Rakhine name, else the locally mapped Myanmar-script name, else name:my.
  const localName = tags['name'] && /[က-႟]/.test(tags['name']) ? tags['name'] : undefined;
  const local = tags['name:rki'] ?? localName ?? tags['name:my'];
  if (local) out.nameLocal = local;
  return out;
}

function landmarkCategory(tags: Tags): { category: LandmarkCategory; kind: string } | undefined {
  const a = tags['amenity'];
  if (a === 'place_of_worship') return { category: 'worship', kind: a };
  if (a && ['school', 'university', 'college', 'kindergarten', 'library'].includes(a)) return { category: 'education', kind: a };
  if (a && ['hospital', 'clinic', 'doctors', 'pharmacy'].includes(a)) return { category: 'health', kind: a };
  if (a && ['townhall', 'police', 'courthouse', 'post_office', 'fire_station', 'prison'].includes(a)) return { category: 'government', kind: a };
  if (a === 'marketplace') return { category: 'market', kind: a };
  if (a && ['bus_station', 'ferry_terminal', 'fuel'].includes(a)) return { category: 'transport', kind: a };
  if (tags['office'] === 'government') return { category: 'government', kind: 'office' };
  if (tags['tourism'] || tags['historic']) return { category: 'tourism', kind: tags['tourism'] ?? tags['historic']! };
  if (tags['building'] && RELIGIOUS.has(tags['building'])) return { category: 'worship', kind: tags['building'] };
  if (tags['shop'] === 'mall' || tags['shop'] === 'supermarket') return { category: 'shop', kind: tags['shop'] };
  if (a) return { category: 'other', kind: a };
  if (tags['shop']) return { category: 'shop', kind: tags['shop'] };
  if (tags['office']) return { category: 'other', kind: 'office' };
  if (tags['leisure']) return { category: 'other', kind: tags['leisure'] };
  if (tags['man_made']) return { category: 'other', kind: tags['man_made'] };
  return undefined;
}

const LANDUSE_KINDS: Record<string, string> = {
  residential: 'residential',
  commercial: 'commercial',
  retail: 'commercial',
  industrial: 'industrial',
  railway: 'industrial',
  port: 'industrial',
  grass: 'grass',
  meadow: 'grass',
  village_green: 'grass',
  recreation_ground: 'park',
  farmland: 'farmland',
  farmyard: 'farmland',
  forest: 'forest',
  orchard: 'orchard',
  plant_nursery: 'orchard',
  cemetery: 'cemetery',
  religious: 'religious',
  military: 'institutional',
  education: 'institutional',
  construction: 'bare',
  brownfield: 'bare',
  greenfield: 'grass',
  aquaculture: 'aquaculture',
  salt_pond: 'water',
  basin: 'water',
  reservoir: 'water',
};

const NATURAL_KINDS: Record<string, string> = {
  water: 'water',
  wood: 'forest',
  scrub: 'scrub',
  grassland: 'grass',
  heath: 'scrub',
  wetland: 'wetland',
  sand: 'sand',
  beach: 'sand',
  mud: 'mud',
  bare_rock: 'bare',
  bay: 'water',
};

const LEISURE_KINDS: Record<string, string> = {
  park: 'park',
  garden: 'park',
  playground: 'park',
  pitch: 'pitch',
  stadium: 'pitch',
  sports_centre: 'pitch',
  golf_course: 'grass',
  swimming_pool: 'water',
};

const AMENITY_AREA_KINDS: Record<string, string> = {
  parking: 'parking',
  school: 'institutional',
  university: 'institutional',
  college: 'institutional',
  hospital: 'institutional',
  place_of_worship: 'religious',
  grave_yard: 'cemetery',
  marketplace: 'commercial',
};

/** Returns the area kind for a polygon's tags, or undefined if it isn't a surface we render. */
export function classifyArea(tags: Tags): string | undefined {
  if (tags['waterway'] === 'riverbank' || tags['waterway'] === 'dock') return 'water';
  if (tags['natural'] && NATURAL_KINDS[tags['natural']]) return NATURAL_KINDS[tags['natural']];
  if (tags['landuse'] && LANDUSE_KINDS[tags['landuse']]) return LANDUSE_KINDS[tags['landuse']];
  if (tags['leisure'] && LEISURE_KINDS[tags['leisure']]) return LEISURE_KINDS[tags['leisure']];
  if (tags['amenity'] && AMENITY_AREA_KINDS[tags['amenity']]) return AMENITY_AREA_KINDS[tags['amenity']];
  if (tags['man_made'] === 'pier') return 'pier';
  if (tags['place'] === 'islet') return undefined;
  return undefined;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function validLatLon(p: { lat: number; lon: number } | null | undefined): p is { lat: number; lon: number } {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}

function geomToLine(g: OsmWay['geometry']): Pt[] | undefined {
  if (!g || g.length < 2) return undefined;
  const out: Pt[] = [];
  for (const p of g) {
    if (!validLatLon(p)) return undefined;
    out.push([p.lon, p.lat]);
  }
  return out;
}

function isClosed(line: Pt[]): boolean {
  const a = line[0]!;
  const b = line[line.length - 1]!;
  return line.length >= 4 && a[0] === b[0] && a[1] === b[1];
}

/** Approximate area in m² of a lon/lat ring (local equirectangular). */
export function lonLatRingAreaM2(ring: Ring): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0]![1];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  const local: Ring = ring.map((p) => [p[0] * kx, p[1] * ky]);
  return Math.abs(signedArea(local));
}

/** Normalizes winding: outer rings counter-clockwise, holes clockwise (GeoJSON RFC 7946). */
function orient(ring: Ring, outer: boolean): Ring {
  const ccw = signedArea(ring) > 0;
  return ccw === outer ? ring : ring.slice().reverse();
}

function toPositions(r: Ring): Position[] {
  return r.map((p) => [round6(p[0]), round6(p[1])]);
}

function round6(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

/** Assembles a multipolygon relation into polygons (outer + holes). */
export function assembleMultipolygon(rel: OsmRelation): { polygons: Ring[][]; unclosed: number } {
  const outerLines: Pt[][] = [];
  const innerLines: Pt[][] = [];
  for (const m of rel.members ?? []) {
    if (m.type !== 'way') continue;
    const line = geomToLine(m.geometry);
    if (!line) continue;
    (m.role === 'inner' ? innerLines : outerLines).push(line);
  }
  const outer = joinLines(outerLines);
  const inner = joinLines(innerLines);
  const polygons: Ring[][] = outer.rings.map((r) => [orient(r, true)]);
  for (const hole of inner.rings) {
    const c = ringCentroid(hole);
    const host = polygons.find((p) => pointInRing(c[0], c[1], p[0]!));
    if (host) host.push(orient(hole, false));
  }
  return { polygons, unclosed: outer.open.length + inner.open.length };
}

function polygonGeometry(polys: Ring[][]): Polygon | MultiPolygon {
  if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0]!.map(toPositions) };
  return { type: 'MultiPolygon', coordinates: polys.map((p) => p.map(toPositions)) };
}

function emptyFC<G extends LineString | Polygon | MultiPolygon | Point, P>(): FeatureCollection<G, P> {
  return { type: 'FeatureCollection', features: [] };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parses (possibly duplicated, e.g. from overlapping extraction regions) raw
 * Overpass elements. Duplicates are removed by OSM type+id. Malformed elements
 * are skipped and counted in `stats` rather than throwing.
 */
export function parseOsm(elements: unknown[]): ParsedOsm {
  const out: ParsedOsm = {
    roads: emptyFC(),
    buildings: emptyFC(),
    water: emptyFC(),
    waterways: emptyFC(),
    landuse: emptyFC(),
    landmarks: emptyFC(),
    places: emptyFC(),
    trees: emptyFC(),
    streetLamps: emptyFC(),
    coastlines: [],
    stats: {
      elements: 0,
      roads: 0,
      buildings: 0,
      buildingsHeightFromTag: 0,
      buildingsHeightFromLevels: 0,
      buildingsHeightEstimated: 0,
      water: 0,
      waterways: 0,
      landuse: 0,
      landmarks: 0,
      places: 0,
      trees: 0,
      streetLamps: 0,
      coastlineWays: 0,
      skippedMissingGeometry: 0,
      skippedUnclosedRelationRings: 0,
      skippedUnsupportedHighway: 0,
      skippedInvalidCoordinates: 0,
    },
  };
  const seen = new Set<string>();
  const s = out.stats;

  for (const raw of elements) {
    if (!raw || typeof raw !== 'object') continue;
    const el = raw as OsmElement;
    if (el.type !== 'node' && el.type !== 'way' && el.type !== 'relation') continue;
    if (typeof el.id !== 'number') continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    s.elements++;
    const tags = el.tags ?? {};

    if (el.type === 'node') {
      if (!validLatLon(el)) {
        s.skippedInvalidCoordinates++;
        continue;
      }
      const coords: Position = [round6(el.lon), round6(el.lat)];
      if (tags['natural'] === 'tree') {
        out.trees.features.push({ type: 'Feature', id: key, properties: { id: key }, geometry: { type: 'Point', coordinates: coords } });
        s.trees++;
      }
      if (tags['highway'] === 'street_lamp') {
        out.streetLamps.features.push({ type: 'Feature', id: key, properties: { id: key }, geometry: { type: 'Point', coordinates: coords } });
        s.streetLamps++;
      }
      if (tags['name'] && tags['place'] && tags['place'] !== 'city') {
        out.places.features.push({
          type: 'Feature',
          id: key,
          properties: { id: key, place: tags['place'], ...names(tags), name: tags['name'] },
          geometry: { type: 'Point', coordinates: coords },
        });
        s.places++;
      } else if (tags['name']) {
        const cat = landmarkCategory(tags);
        if (cat) {
          out.landmarks.features.push(landmark(key, tags, cat, coords, false));
          s.landmarks++;
        }
      }
      continue;
    }

    // Ways and relations: build line or polygon geometry.
    let polys: Ring[][] | undefined;
    let line: Pt[] | undefined;
    if (el.type === 'way') {
      line = geomToLine(el.geometry);
      if (!line) {
        s.skippedMissingGeometry++;
        continue;
      }
      if (isClosed(line)) polys = [[orient(line, true)]];
    } else {
      if (tags['type'] !== 'multipolygon' && tags['type'] !== 'boundary') continue;
      if (tags['type'] === 'boundary') continue; // administrative boundaries are not rendered
      const mp = assembleMultipolygon(el);
      if (mp.unclosed > 0) s.skippedUnclosedRelationRings += mp.unclosed;
      if (mp.polygons.length === 0) {
        s.skippedMissingGeometry++;
        continue;
      }
      polys = mp.polygons;
    }

    // Coastline (kept as directed lines; land on the left).
    if (el.type === 'way' && tags['natural'] === 'coastline' && line) {
      out.coastlines.push(line);
      s.coastlineWays++;
      continue;
    }

    // Roads.
    if (el.type === 'way' && (tags['highway'] || tags['man_made'] === 'pier') && line && tags['area'] !== 'yes') {
      const cls: RoadClass | undefined = tags['man_made'] === 'pier' && !polys ? 'pier' : classifyRoad(tags['highway']);
      if (!cls) {
        if (tags['highway']) s.skippedUnsupportedHighway++;
      } else if (!(polys && cls === 'pier')) {
        const { width, source } = roadWidth(cls, tags);
        const props: RoadProps = {
          id: key,
          cls,
          highway: tags['highway'] ?? 'pier',
          ...names(tags),
          width,
          widthSource: source,
          oneway: tags['oneway'] === 'yes' || tags['oneway'] === '1',
          bridge: !!tags['bridge'] && tags['bridge'] !== 'no',
          layer: Number.parseInt(tags['layer'] ?? '0', 10) || 0,
        };
        if (tags['surface']) props.surface = tags['surface'];
        out.roads.features.push({ type: 'Feature', id: key, properties: props, geometry: { type: 'LineString', coordinates: toPositions(line) } });
        s.roads++;
        continue;
      }
    }

    // Waterway lines.
    if (el.type === 'way' && tags['waterway'] && WATERWAY_WIDTH[tags['waterway']] && line && !polys) {
      const w = parseLength(tags['width']) ?? WATERWAY_WIDTH[tags['waterway']]!;
      const wp: WaterwayProps = { id: key, kind: tags['waterway'], width: Math.min(w, 60) };
      if (tags['name']) wp.name = tags['name'];
      out.waterways.features.push({ type: 'Feature', id: key, properties: wp, geometry: { type: 'LineString', coordinates: toPositions(line) } });
      s.waterways++;
      continue;
    }

    if (!polys) continue;

    // Buildings.
    if (tags['building'] && tags['building'] !== 'no') {
      const area = polys.reduce((a, p) => a + lonLatRingAreaM2(p[0]!), 0);
      if (area < 2) {
        s.skippedMissingGeometry++;
        continue;
      }
      const hb = buildingHeight(tags, area);
      const minHeight = parseLength(tags['min_height']) ?? (parseLevels(tags['building:min_level']) ?? 0) * LEVEL_HEIGHT_M;
      const props: BuildingProps = {
        id: key,
        kind: tags['building'],
        ...names(tags),
        height: Math.max(hb.height, minHeight + 1),
        minHeight,
        heightSource: hb.source,
        area: Math.round(area),
      };
      if (hb.levels) props.levels = hb.levels;
      if (tags['roof:shape']) props.roofShape = tags['roof:shape'];
      out.buildings.features.push({ type: 'Feature', id: key, properties: props, geometry: polygonGeometry(polys) });
      s.buildings++;
      if (hb.source === 'tag') s.buildingsHeightFromTag++;
      else if (hb.source === 'levels') s.buildingsHeightFromLevels++;
      else s.buildingsHeightEstimated++;
      if (tags['name']) {
        const cat = landmarkCategory(tags);
        if (cat) {
          const c = ringCentroid(polys[0]![0]!);
          out.landmarks.features.push(landmark(key, tags, cat, [round6(c[0]), round6(c[1])], true));
          s.landmarks++;
        }
      }
      continue;
    }

    // Area surfaces.
    const kind = classifyArea(tags);
    if (kind) {
      const props: AreaProps = { id: key, kind };
      if (tags['name']) props.name = tags['name'];
      const f: Feature<Polygon | MultiPolygon, AreaProps> = { type: 'Feature', id: key, properties: props, geometry: polygonGeometry(polys) };
      if (kind === 'water') {
        out.water.features.push(f);
        s.water++;
      } else {
        out.landuse.features.push(f);
        s.landuse++;
      }
    }
    if (tags['name']) {
      const cat = landmarkCategory(tags);
      if (cat && cat.category !== 'other') {
        const c = ringCentroid(polys[0]![0]!);
        out.landmarks.features.push(landmark(key, tags, cat, [round6(c[0]), round6(c[1])], false));
        s.landmarks++;
      }
    }
  }
  return out;
}

function landmark(id: string, tags: Tags, cat: { category: LandmarkCategory; kind: string }, coords: Position, hasFootprint: boolean): Feature<Point, LandmarkProps> {
  const props: LandmarkProps = { id, name: tags['name']!, category: cat.category, kind: cat.kind, hasFootprint, ...names(tags) } as LandmarkProps;
  if (tags['religion']) props.religion = tags['religion'];
  return { type: 'Feature', id, properties: props, geometry: { type: 'Point', coordinates: coords } };
}
