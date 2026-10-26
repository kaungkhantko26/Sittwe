/**
 * Links named OSM landmarks to the real building footprints they describe,
 * so landmark buildings render in a style that matches what they are
 * (church, monastery, market, hospital…). Pure functions, used by the data
 * pipeline and covered by unit tests.
 *
 * Rules:
 *  - Compound outlines: a "building" polygon > 2,500 m² containing the
 *    centroid of a much smaller building is a mapped enclosure (e.g. a church
 *    compound) and is rendered as a perimeter wall, not a solid block.
 *  - A landmark links to the smallest non-compound building containing it,
 *    otherwise to the nearest non-compound building within 15 m.
 *  - Pagodas mapped as points are never linked to a neighbouring house; the
 *    clearest spot within 25 m of the mapped point gets a stupa marker.
 */
import type { BuildingStyle, ChunkBuilding, ChunkLandmark } from './chunkFormat';
import { distToSegmentSq, pointInRing, ringBounds, ringCentroid, signedArea, type Pt, type Rect } from './geometry2d';

export interface BuildingRecord {
  b: ChunkBuilding;
  ring: Pt[];
  area: number;
  bounds: Rect;
  centroid: Pt;
}

export function toRecord(b: ChunkBuilding): BuildingRecord {
  const ring: Pt[] = [];
  for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i]!, b.p[i + 1]!]);
  return { b, ring, area: Math.abs(signedArea(ring)), bounds: ringBounds(ring), centroid: ringCentroid(ring) };
}

const PAGODA_NAME = /ဘုရား|စေတီ|pagoda|phaya|paya|zedi|stupa/i;
const NO_LINK_KINDS = new Set(['monument', 'memorial', 'statue', 'artwork', 'clock', 'atm', 'fountain']);

/** Architectural style for a landmark, or undefined for an ordinary building. */
export function landmarkStyle(lm: Pick<ChunkLandmark, 'cat' | 'k' | 'rel' | 'n' | 'ne'>): BuildingStyle | undefined {
  const name = `${lm.n} ${lm.ne ?? ''}`;
  const christian = lm.rel === 'christian' || /church|cathedral|chapel|convent/i.test(name);
  if (lm.k === 'place_of_worship' || lm.k === 'monastery' || lm.cat === 'worship') {
    if (christian) return 'church';
    if (lm.rel === 'muslim' || /mosque|masjid/i.test(name)) return 'mosque';
    if (lm.rel === 'hindu' || /mandir|hindu/i.test(name)) return 'hindu';
    if (lm.rel === 'buddhist' || lm.k === 'monastery' || /monastery|kyaung|ကျောင်း|ဘုရား/i.test(name)) return 'buddhist';
    return undefined;
  }
  if (lm.k === 'marketplace') return 'market';
  if (lm.k === 'stadium' || lm.k === 'sports_centre') return 'stadium';
  if (lm.k === 'hospital' || lm.k === 'clinic') return 'hospital';
  if (['townhall', 'office', 'post_office', 'police', 'fire_station', 'courthouse', 'prison', 'museum', 'library', 'attraction'].includes(lm.k) || lm.cat === 'government') return 'civic';
  if (lm.cat === 'education') return 'school';
  return undefined;
}

/** Style priority when several landmarks share one building. */
const PRIORITY: Record<BuildingStyle, number> = { pagoda: 10, church: 9, buddhist: 9, mosque: 9, hindu: 9, stadium: 8, market: 7, hospital: 6, school: 5, civic: 4 };

/** Estimated heights (m) for styled buildings without height tags. */
export const STYLE_HEIGHT: Partial<Record<BuildingStyle, number>> = { stadium: 5.5, market: 6.5, church: 8, buddhist: 6.5, mosque: 7, hindu: 7 };

export function markCompounds(recs: BuildingRecord[]): number {
  let n = 0;
  for (const outer of recs) {
    if (outer.area <= 2500) continue;
    const bb = outer.bounds;
    for (const inner of recs) {
      if (inner === outer || inner.area * 4 > outer.area) continue;
      const [cx, cz] = inner.centroid;
      if (cx < bb.minX || cx > bb.maxX || cz < bb.minY || cz > bb.maxY) continue;
      if (pointInRing(cx, cz, outer.ring)) {
        outer.b.cp = true;
        n++;
        break;
      }
    }
  }
  return n;
}

function distToRing(x: number, z: number, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, distToSegmentSq(x, z, ring[j]![0], ring[j]![1], ring[i]![0], ring[i]![1]));
  return Math.sqrt(best);
}

export interface LinkResult {
  linked: number;
  stupas: number;
}

/**
 * Links landmarks to buildings (mutates both). `clearance(x, z)` returns the
 * free radius around a point (distance to the nearest building or road edge).
 */
export function linkLandmarks(recs: BuildingRecord[], landmarks: ChunkLandmark[], clearance: (x: number, z: number) => number, maxDist = 15): LinkResult {
  let linked = 0;
  let stupas = 0;
  const solid = recs.filter((r) => !r.b.cp);
  for (const lm of landmarks) {
    if (NO_LINK_KINDS.has(lm.k)) continue;
    const label = `${lm.n} ${lm.ne ?? ''}`;
    const pagoda = lm.cat === 'worship' && PAGODA_NAME.test(label) && !/monastery|kyaung|church/i.test(label);
    let host: BuildingRecord | undefined;
    const containing = solid.filter((r) => {
      const bb = r.bounds;
      return lm.x >= bb.minX && lm.x <= bb.maxX && lm.z >= bb.minY && lm.z <= bb.maxY && pointInRing(lm.x, lm.z, r.ring);
    });
    if (containing.length) host = containing.sort((a, b) => a.area - b.area)[0];
    else if (!pagoda) {
      let bd = maxDist;
      for (const r of solid) {
        const bb = r.bounds;
        if (lm.x < bb.minX - maxDist || lm.x > bb.maxX + maxDist || lm.z < bb.minY - maxDist || lm.z > bb.maxY + maxDist) continue;
        if (r.area > 6000) continue;
        const d = distToRing(lm.x, lm.z, r.ring);
        if (d < bd) {
          bd = d;
          host = r;
        }
      }
    }
    if (host && !pagoda) {
      lm.fp = true;
      lm.b = host.b.id;
      const style = landmarkStyle(lm);
      if (style && (!host.b.st || PRIORITY[style] > PRIORITY[host.b.st])) {
        host.b.st = style;
        const h = STYLE_HEIGHT[style];
        if (h && host.b.hs === 'e') host.b.h = h;
      }
      if (!host.b.n) host.b.n = lm.ne ?? lm.n;
      lm.h = host.b.h;
      linked++;
      continue;
    }
    // A pagoda point inside a large footprint: that footprint IS the pagoda
    // complex (e.g. Lawkanandar Pagoda). Render the complex on it.
    if (pagoda && containing.length) {
      const fp = containing.sort((a, b) => b.area - a.area)[0]!;
      if (fp.area >= 300) {
        fp.b.st = 'pagoda';
        fp.b.h = 1.2; // raised platform; the stupa and structures are added on top
        fp.b.hs = 'e';
        lm.fp = true;
        lm.b = fp.b.id;
        lm.pg = fp.b.p;
        lm.h = 30;
        linked++;
        continue;
      }
    }
    if (pagoda) {
      // Clearest spot within 25 m of the mapped point for a stupa marker.
      let best = { x: lm.x, z: lm.z, c: clearance(lm.x, lm.z) };
      for (let r = 1.5; r <= 25 && best.c < 3.2; r += 1.5) {
        const n = Math.round(r * 3);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = lm.x + Math.cos(a) * r;
          const z = lm.z + Math.sin(a) * r;
          const c = clearance(x, z);
          if (c > best.c + 0.25) best = { x, z, c };
        }
      }
      if (best.c >= 1.4) {
        lm.sx = Math.round(best.x * 100) / 100;
        lm.sz = Math.round(best.z * 100) / 100;
        lm.ss = Math.round(Math.min(1, (best.c - 0.3) / 3.2) * 100) / 100;
        stupas++;
      }
    }
  }
  return { linked, stupas };
}
