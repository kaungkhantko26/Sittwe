/**
 * On-disk chunk format shared by the data pipeline (writer) and the game
 * (reader). All coordinates are local meters relative to GEO_ORIGIN, stored
 * as flat [x0, z0, x1, z1, ...] arrays (X = East, Z = South).
 */
import { CHUNK_SIZE } from '../config';
import type { LandmarkCategory, RoadClass } from './OSMParser';

export interface ChunkRoad {
  id: string;
  c: RoadClass;
  /** Width in meters. */
  w: number;
  /** Flat x,z coordinate list. */
  p: number[];
  /** Start / end point is an original OSM vertex (true) or a chunk-border cut (false). */
  s: boolean;
  e: boolean;
  n?: string;
  b?: boolean;
}

export interface ChunkBuilding {
  id: string;
  k: string;
  h: number;
  mh: number;
  /** Height source: t = height tag, l = levels tag, e = estimate. */
  hs: 't' | 'l' | 'e';
  lv?: number;
  roof?: string;
  n?: string;
  /** Outer ring (open, flat x,z). */
  p: number[];
  holes?: number[][];
  /** Compound outline (a mapped enclosure containing other buildings): rendered as a perimeter wall. */
  cp?: boolean;
  /** Architectural style derived from the landmark mapped in/at this building. */
  st?: BuildingStyle;
}

export type BuildingStyle = 'church' | 'buddhist' | 'mosque' | 'hindu' | 'market' | 'stadium' | 'hospital' | 'civic' | 'school' | 'pagoda';

export interface ChunkArea {
  id: string;
  k: string;
  /** Rings (first = outer, rest = holes), each a flat x,z list, clipped to the chunk. */
  r: number[][];
}

export interface ChunkWaterway {
  id: string;
  k: string;
  w: number;
  p: number[];
}

export interface ChunkLandmark {
  id: string;
  n: string;
  ne?: string;
  /** Local Myanmar-script name: name:rki → name → name:my. */
  nl?: string;
  cat: LandmarkCategory;
  k: string;
  rel?: string;
  fp: boolean;
  x: number;
  z: number;
  /** Id of the mapped building this landmark belongs to (linked in the pipeline). */
  b?: string;
  /** Top height of the linked building, for label placement. */
  h?: number;
  /** Clear spot + scale for a generated stupa (pagodas mapped as points). */
  sx?: number;
  sz?: number;
  ss?: number;
  /** Seaside promenade fitted to the real headland shape (viewpoints such as Sittwe Point). */
  pr?: { axis: [number, number]; stations: number[] };
  /** Original mapped point when a small roundabout centre refines the model placement. */
  sourcePosition?: {x:number;z:number};
  /** Clock tower style: colonial (Old Clock Tower, 1887) or burmese (New Clock Tower). */
  cs?: 'colonial' | 'burmese';
  /** Pagoda complex footprint (flat x,z ring of the mapped platform/building). */
  pg?: number[];
  /** Outward direction of the pagoda's main entrance (toward the nearest major road). */
  pe?: [number, number];
  /** Mirror-shrine placement (user-supplied landmark): facing yaw and the linking walkway [x0, z0, x1, z1]. */
  ms?: { yaw: number; link: [number, number, number, number] };
  /** Source note for landmarks that are not from OpenStreetMap. */
  src?: string;
}

export interface ChunkData {
  v: number;
  key: string;
  cx: number;
  cz: number;
  roads: ChunkRoad[];
  buildings: ChunkBuilding[];
  water: ChunkArea[];
  waterways: ChunkWaterway[];
  landuse: ChunkArea[];
  /** OSM-mapped trees (natural=tree), flat x,z. */
  trees: number[];
  /** OSM-mapped street lamps (highway=street_lamp), flat x,z. */
  lamps: number[];
  landmarks: ChunkLandmark[];
}

export interface SpawnPoint {
  x: number;
  z: number;
  /** Yaw in radians around +Y; 0 faces -Z (north). */
  yaw: number;
  road?: string;
}

export interface PlaceEntry {
  id: string;
  name: string;
  nameEn?: string;
  nameLocal?: string;
  place: string;
  x: number;
  z: number;
}

export interface WorldManifest {
  version: number;
  generatedAt: string;
  origin: { lat: number; lon: number; source: string };
  chunkSize: number;
  /** World extent in local meters. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  chunks: Array<{ key: string; cx: number; cz: number; roads: number; buildings: number }>;
  spawn: { player: SpawnPoint; vehicles: SpawnPoint[] };
  landmarks: ChunkLandmark[];
  places: PlaceEntry[];
  attribution: string;
  sources: Array<{ label: string; endpoint: string; retrievedAt: string; osmBaseTimestamp: string | null }>;
}

export interface SeaData {
  /** Polygons, each [outer, ...holes], rings as flat x,z lists. */
  polygons: number[][][];
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx}_${cz}`;
}

export function chunkCoordOf(v: number, size = CHUNK_SIZE): number {
  return Math.floor(v / size);
}

export function chunkRect(cx: number, cz: number, size = CHUNK_SIZE): { minX: number; minY: number; maxX: number; maxY: number } {
  return { minX: cx * size, minY: cz * size, maxX: (cx + 1) * size, maxY: (cz + 1) * size };
}

export function chunkFileName(cx: number, cz: number): string {
  return `c_${cx}_${cz}.json`;
}
