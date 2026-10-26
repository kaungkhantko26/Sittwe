import { describe, expect, it } from 'vitest';
import type { ChunkBuilding, ChunkLandmark } from '../src/geo/chunkFormat';
import { landmarkStyle, linkLandmarks, markCompounds, toRecord } from '../src/geo/landmarkLinker';
import { buildBuildings } from '../src/world/BuildingGenerator';
import { buildRoads } from '../src/world/RoadGenerator';

const sq = (id: string, x: number, z: number, s: number, extra: Partial<ChunkBuilding> = {}): ChunkBuilding => ({ id, k: 'yes', h: 9.6, mh: 0, hs: 'e', p: [x, z, x + s, z, x + s, z + s, x, z + s], ...extra });
const lm = (n: string, x: number, z: number, extra: Partial<ChunkLandmark> = {}): ChunkLandmark => ({ id: n, n, cat: 'other', k: 'office', fp: false, x, z, ...extra });

describe('landmark linking', () => {
  it('classifies landmark styles', () => {
    expect(landmarkStyle({ cat: 'worship', k: 'place_of_worship', n: 'Anglican Church', rel: undefined })).toBe('church');
    expect(landmarkStyle({ cat: 'other', k: 'monastery', n: 'Saiktathukha Monastery', rel: 'buddhist' })).toBe('buddhist');
    expect(landmarkStyle({ cat: 'other', k: 'monastery', n: 'Sacred Heart', rel: 'christian' })).toBe('church');
    expect(landmarkStyle({ cat: 'market', k: 'marketplace', n: 'May Yu Market' })).toBe('market');
    expect(landmarkStyle({ cat: 'other', k: 'restaurant', n: 'Cafe' })).toBeUndefined();
  });

  it('detects compound outlines that contain other buildings', () => {
    const recs = [sq('compound', 0, 0, 120), sq('church', 40, 40, 18), sq('lonely', 300, 300, 60)].map(toRecord);
    expect(markCompounds(recs)).toBe(1);
    expect(recs[0]!.b.cp).toBe(true);
    expect(recs[2]!.b.cp).toBeUndefined();
  });

  it('links to the smallest containing non-compound building and applies style + height', () => {
    const recs = [sq('compound', 0, 0, 120), sq('church', 40, 40, 18)].map(toRecord);
    markCompounds(recs);
    const l = lm('Sacred Heart Church', 45, 45, { k: 'monastery', rel: 'christian' });
    linkLandmarks(recs, [l], () => 5);
    expect(l.b).toBe('church');
    expect(l.fp).toBe(true);
    expect(recs[1]!.b.st).toBe('church');
    expect(recs[1]!.b.h).toBe(8);
  });

  it('links point landmarks to the nearest building within 15 m only', () => {
    const recs = [sq('a', 0, 0, 10)].map(toRecord);
    const near = lm('Hospital', 15, 5, { cat: 'health', k: 'hospital' });
    const far = lm('Far', 60, 5);
    linkLandmarks(recs, [near, far], () => 5);
    expect(near.b).toBe('a');
    expect(far.b).toBeUndefined();
  });

  it('never attaches a pagoda to a neighbouring house; finds a clear stupa spot', () => {
    const recs = [sq('house', 0, 0, 10)].map(toRecord);
    const p = lm('Phayar Gyi', 10.5, 5, { cat: 'worship', k: 'place_of_worship' });
    // Clearance grows with distance from the house.
    linkLandmarks(recs, [p], (x) => Math.max(0, x - 10));
    expect(p.b).toBeUndefined();
    expect(p.sx).toBeGreaterThan(12);
    expect(p.ss).toBeGreaterThan(0);
  });
});

describe('styled buildings and bridges', () => {
  it('renders compounds as walls (no footprint) and adds roof features', () => {
    const m = buildBuildings([sq('c', 0, 0, 100, { cp: true }), sq('b', 200, 0, 20, { st: 'buddhist', h: 6.5 })]);
    expect(m.footprints).toHaveLength(1);
    const pos = m.geometry!.getAttribute('position');
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getX(i) > 150) maxY = Math.max(maxY, pos.getY(i));
    expect(maxY).toBeGreaterThan(9); // tiered roof + finial above the 6.5 m walls
  });

  it('builds arches and kerbs on major-road bridges', () => {
    const r = buildRoads([{ id: 'br', c: 'primary', w: 10, p: [0, 0, 33, 0], s: true, e: true, b: true }]);
    expect(r.steel).not.toBeNull();
    expect(r.solid).not.toBeNull();
    let maxY = 0;
    const pos = r.steel!.getAttribute('position');
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
    expect(maxY).toBeGreaterThan(5);
  });
});
