import * as THREE from 'three';
import type { ChunkLandmark, ChunkRoad } from '../geo/chunkFormat';
import { distToSegmentSq } from '../geo/geometry2d';
import { buildMonument, disposeMonument, MONUMENT_KINDS } from './MonumentGenerator';
import { buildPromenade } from './PromenadeGenerator';
import { buildPagoda } from './PagodaGenerator';
import { isLawkanandar, LAWKANANDAR, pagodaLayout } from '../geo/pagodaLayout';
import { buildLawkanandar, type PagodaSite } from './landmarks/LawkanandarPagoda';
import { buildMirrorShrine } from './landmarks/MirrorShrine';
import { materials } from './materials';
import type { PolygonIndex, SegmentIndex } from './SpatialIndex';

/**
 * Landmarks come only from named OSM features. Each gets a floating label
 * (Burmese name when mapped, plus English when available) at its mapped
 * position. Buddhist places of worship that are mapped as a point without a
 * building footprint get a small stylised stupa — an artistic marker at the
 * mapped location, not a model of the real structure.
 */

const CATEGORY_COLORS: Record<string, string> = {
  worship: '#f5b84b',
  education: '#6cb6ff',
  health: '#ff6b6b',
  government: '#b39dff',
  market: '#ffa94d',
  tourism: '#63e6be',
  transport: '#91a7ff',
  shop: '#ffd43b',
  other: '#ced4da',
};

export const LABEL_FONT = '"Noto Sans Myanmar", "Myanmar Sangam MN", "Myanmar MN", Padauk, Inter, system-ui, sans-serif';

function labelTexture(primary: string, secondary: string | undefined, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const f1 = `600 40px ${LABEL_FONT}`;
  const f2 = `500 28px ${LABEL_FONT}`;
  ctx.font = f1;
  const w1 = ctx.measureText(primary).width;
  ctx.font = f2;
  const w2 = secondary ? ctx.measureText(secondary).width : 0;
  const w = Math.ceil(Math.max(w1, w2) + 56);
  const h = secondary ? 118 : 78;
  c.width = Math.min(w, 1024);
  c.height = h;
  ctx.fillStyle = 'rgba(12,18,26,0.78)';
  const r = 18;
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, h, r);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 8, h);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = f1;
  ctx.fillText(primary, 28, secondary ? 40 : h / 2 + 2, c.width - 40);
  if (secondary) {
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = f2;
    ctx.fillText(secondary, 28, 86, c.width - 40);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, aspect: c.width / h };
}

let stupaGeo: THREE.BufferGeometry | null = null;
function stupaGeometry(): THREE.BufferGeometry {
  if (stupaGeo) return stupaGeo;
  // Bell-shaped profile with stepped base and spire (lathe), ~9 m tall.
  const pts = [
    [0, 0], [3.2, 0], [3.2, 0.6], [2.8, 0.6], [2.8, 1.2], [2.4, 1.2], [2.4, 1.7],
    [2.3, 2.4], [2.05, 3.4], [1.6, 4.2], [1.0, 4.8], [0.75, 5.1], [0.75, 5.4],
    [0.5, 6.2], [0.3, 7.4], [0.12, 8.6], [0.05, 9.2], [0, 9.4],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  stupaGeo = new THREE.LatheGeometry(pts, 14);
  return stupaGeo;
}

export interface LandmarkObjects {
  group: THREE.Group;
  labels: Array<{ sprite: THREE.Sprite; landmark: ChunkLandmark }>;
  /** Stupa footprints for colliders: flat x,z,radius. */
  stupas: number[];
  /** Box colliders: x, y, z, hx, hy, hz, yaw. */
  boxes: number[];
  /** Convex hull colliders (ramps). */
  ramps: number[][];
  /** Interactive landmark sites (pagoda complexes) in this chunk. */
  sites: PagodaSite[];
}

/** Yaw (0 = -Z) facing the nearest point on a major mapped road, or 0 if none nearby. */
function faceNearestMajorRoad(x: number, z: number, roads: ChunkRoad[]): number {
  let best = Infinity;
  let tx = 0;
  let tz = 0;
  for (const r of roads) {
    if (!['primary', 'secondary', 'tertiary', 'residential'].includes(r.c)) continue;
    const p = r.p;
    if (p[0] === p[p.length - 2] && p[1] === p[p.length - 1]) continue; // skip the roundabout loop itself
    for (let i = 0; i < p.length - 2; i += 2) {
      const d = distToSegmentSq(x, z, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!);
      const w = r.c === 'residential' ? d * 4 : d; // prefer major roads
      if (w < best) {
        best = w;
        // Closest point on the segment.
        const dx = p[i + 2]! - p[i]!;
        const dz = p[i + 3]! - p[i + 1]!;
        const t = Math.max(0, Math.min(1, ((x - p[i]!) * dx + (z - p[i + 1]!) * dz) / (dx * dx + dz * dz || 1)));
        tx = p[i]! + dx * t;
        tz = p[i + 1]! + dz * t;
      }
    }
  }
  return best === Infinity ? 0 : Math.atan2(-(tx - x), -(tz - z));
}

export function buildLandmarks(list: ChunkLandmark[], lang: 'en' | 'rki', buildings: PolygonIndex, roads: SegmentIndex, chunkRoads: ChunkRoad[] = []): LandmarkObjects {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const labels: LandmarkObjects['labels'] = [];
  const stupas: number[] = [];
  const boxes: number[] = [];
  const ramps: number[][] = [];
  const sites: PagodaSite[] = [];
  for (const lm of list) {
    const local = lm.nl ?? (/[က-႟]/.test(lm.n) ? lm.n : undefined);
    const en = lm.ne ?? (local ? undefined : lm.n);
    const primary = lang === 'rki' ? (local ?? en ?? lm.n) : (en ?? local ?? lm.n);
    const secondary = lang === 'rki' ? (local && en ? en : undefined) : (en && local ? local : undefined);
    const { tex, aspect } = labelTexture(primary, secondary, CATEGORY_COLORS[lm.cat] ?? '#ced4da');
    const mat = new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    const h = secondary ? 2.4 : 1.6;
    sprite.scale.set(h * aspect, h, 1);
    // Float just above the linked building (or a default height for point landmarks).
    sprite.position.set(lm.x, (lm.h ?? 8) + 5, lm.z);
    sprite.renderOrder = 10;
    sprite.visible = false;
    group.add(sprite);
    labels.push({ sprite, landmark: lm });

    // Pagodas mapped as points: the pipeline found the clearest spot near the mapped node (sx, sz, ss).
    const buddhist = lm.cat === 'worship' && (lm.rel === 'buddhist' || lm.k === 'pagoda' || /ဘုရား|စေတီ|pagoda|phaya|paya|zedi/i.test(`${lm.n} ${lm.ne ?? ''}`));
    const spot = lm.sx !== undefined && lm.sz !== undefined ? { x: lm.sx, z: lm.sz, s: lm.ss ?? 0.8 } : !lm.fp && !buildings.hit(lm.x, lm.z, 3.5) && !roads.hit(lm.x, lm.z, 3.5) ? { x: lm.x, z: lm.z, s: 0.8 } : null;
    if (lm.ms && typeof document !== 'undefined') {
      // User-supplied mirror shrine (Satkyar Muni), linked to its anchor pagoda.
      const shrine = buildMirrorShrine(lm);
      if (shrine) {
        group.add(shrine.group);
        stupas.push(...shrine.colliders);
        boxes.push(...shrine.boxes);
        ramps.push(...shrine.ramps);
        sites.push(shrine.site);
        sprite.position.y = 16;
      }
    } else if (lm.pg && typeof document !== 'undefined' && isLawkanandar(lm)) {
      // Dedicated modular model; replaces the generic pagoda for this landmark.
      const layout = pagodaLayout(lm.pg, lm, {
        roadDistance: (x, z) => roads.nearest(x, z, 300)?.dist ?? Infinity,
        stupa: { baseR: LAWKANANDAR.baseCircumference / (2 * Math.PI), height: LAWKANANDAR.totalHeight },
        hall: false, // satellite layout: gate pavilions; the image house is Satkyar Muni
        ...(lm.pe ? { mainOut: lm.pe } : {}),
      });
      if (layout) {
        const pag = buildLawkanandar(lm, layout);
        group.add(pag.group);
        stupas.push(...pag.colliders);
        boxes.push(...pag.boxes);
        ramps.push(...pag.ramps);
        sites.push(pag.site);
        sprite.position.set(layout.centre[0], LAWKANANDAR.totalHeight + 6, layout.centre[1]);
      }
    } else if (lm.pg && typeof document !== 'undefined') {
      const pag = buildPagoda(lm);
      if (pag) {
        group.add(pag.group);
        stupas.push(...pag.colliders);
        boxes.push(...pag.boxes);
        ramps.push(...pag.ramps);
        sprite.position.y = (lm.h ?? 30) + 8;
      }
    } else if (buddhist && spot) {
      const stupa = new THREE.Mesh(stupaGeometry(), materials().gold);
      stupa.position.set(spot.x, 0.05, spot.z);
      stupa.scale.setScalar(spot.s);
      stupa.castShadow = true;
      stupa.receiveShadow = true;
      stupa.userData['artistic'] = true;
      stupa.userData['sharedGeometry'] = true;
      group.add(stupa);
      stupas.push(spot.x, spot.z, 3.2 * spot.s);
      sprite.position.set(spot.x, 9.4 * spot.s + 3, spot.z);
    }

    if (lm.pr && typeof document !== 'undefined') {
      const prom = buildPromenade(lm);
      if (prom) {
        group.add(prom.group);
        stupas.push(...prom.colliders);
        sprite.position.y = 22;
      }
    }

    if (MONUMENT_KINDS.has(lm.k) && !lm.fp && !buildings.hit(lm.x, lm.z, 1.0) && typeof document !== 'undefined') {
      const mon = buildMonument(lm, chunkRoads, faceNearestMajorRoad(lm.x, lm.z, chunkRoads));
      group.add(mon.group);
      stupas.push(...mon.colliders);
      sprite.position.y = mon.height + 4;
    }
  }
  return { group, labels, stupas, boxes, ramps, sites };
}

export function disposeLandmarks(objs: LandmarkObjects): void {
  disposeMonument(objs.group);
  for (const l of objs.labels) {
    l.sprite.material.map?.dispose();
    l.sprite.material.dispose();
  }
}
