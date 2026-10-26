import { describe, expect, it } from 'vitest';
import type { ChunkBuilding, ChunkRoad } from '../src/geo/chunkFormat';
import { chunkCoordOf, chunkKey, chunkRect } from '../src/geo/chunkFormat';
import { buildBuildings } from '../src/world/BuildingGenerator';
import { buildRoads, findJunctions, miterNormals } from '../src/world/RoadGenerator';
import { sanitizeChunk } from '../src/geo/MapDataLoader';

describe('road mesh generation', () => {
  it('builds a ribbon of the requested width', () => {
    const road: ChunkRoad = { id: 'w1', c: 'residential', w: 6, p: [0, 0, 50, 0], s: false, e: false };
    const m = buildRoads([road]);
    expect(m.asphalt).not.toBeNull();
    const pos = m.asphalt!.getAttribute('position');
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      minZ = Math.min(minZ, pos.getZ(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
    }
    expect(maxZ - minZ).toBeCloseTo(6);
    // All faces point up.
    const n = m.asphalt!.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBe(1);
  });

  it('adds round caps only at real OSM endpoints', () => {
    const cut = buildRoads([{ id: 'a', c: 'residential', w: 6, p: [0, 0, 50, 0], s: false, e: false }]);
    const capped = buildRoads([{ id: 'a', c: 'residential', w: 6, p: [0, 0, 50, 0], s: true, e: true }]);
    expect(capped.asphalt!.index!.count).toBeGreaterThan(cut.asphalt!.index!.count);
  });

  it('keeps mitred corners at constant width', () => {
    const n = miterNormals([0, 0, 10, 0, 10, 10]);
    // 90° corner: miter length = sqrt(2).
    expect(Math.hypot(n[2]!, n[3]!)).toBeCloseTo(Math.SQRT2, 5);
  });

  it('detects junctions shared by two roads', () => {
    const j = findJunctions([
      { id: 'a', c: 'primary', w: 10, p: [0, 0, 20, 0, 40, 0], s: true, e: true },
      { id: 'b', c: 'residential', w: 6, p: [20, 0, 20, 30], s: true, e: true },
    ]);
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ x: 20, z: 0 });
  });

  it('generates sidewalks and markings for major roads', () => {
    const m = buildRoads([{ id: 'p', c: 'primary', w: 10, p: [0, 0, 100, 0], s: true, e: true }]);
    expect(m.sidewalk).not.toBeNull();
    expect(m.marking).not.toBeNull();
    expect(m.lampCandidates.length).toBeGreaterThan(0);
  });
});

describe('building extrusion', () => {
  const b: ChunkBuilding = { id: 'way/1', k: 'commercial', h: 9.6, mh: 0, hs: 'e', p: [0, 0, 10, 0, 10, 20, 0, 20] };
  it('extrudes footprints to the right height and follows the footprint', () => {
    const m = buildBuildings([b]);
    const pos = m.geometry!.getAttribute('position');
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) {
      maxY = Math.max(maxY, pos.getY(i));
      expect(pos.getX(i)).toBeGreaterThanOrEqual(-0.05);
      expect(pos.getX(i)).toBeLessThanOrEqual(10.05);
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(-0.05);
      expect(pos.getZ(i)).toBeLessThanOrEqual(20.05);
    }
    expect(maxY).toBeCloseTo(9.6);
    expect(m.collider!.indices.length % 3).toBe(0);
    expect(m.geometry!.groups).toHaveLength(2);
  });

  it('wall normals face outward regardless of input winding', () => {
    for (const p of [b.p, [0, 0, 0, 20, 10, 20, 10, 0]]) {
      const m = buildBuildings([{ ...b, p }]);
      const pos = m.geometry!.getAttribute('position');
      const nor = m.geometry!.getAttribute('normal');
      for (let i = 0; i < m.geometry!.groups[0]!.count; i++) {
        const vi = m.geometry!.index!.getX(i);
        const dx = pos.getX(vi) - 5;
        const dz = pos.getZ(vi) - 10;
        expect(dx * nor.getX(vi) + dz * nor.getZ(vi)).toBeGreaterThan(0);
      }
    }
  });

  it('adds a pitched roof to small houses (artistic choice)', () => {
    const house: ChunkBuilding = { id: 'way/2', k: 'house', h: 3.2, mh: 0, hs: 'e', p: [0, 0, 8, 0, 8, 6, 0, 6] };
    const m = buildBuildings([house]);
    const pos = m.geometry!.getAttribute('position');
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
    expect(maxY).toBeGreaterThan(3.2);
  });
});

describe('chunk boundaries', () => {
  it('assigns coordinates to chunks with floor semantics', () => {
    expect(chunkCoordOf(0)).toBe(0);
    expect(chunkCoordOf(255.99)).toBe(0);
    expect(chunkCoordOf(256)).toBe(1);
    expect(chunkCoordOf(-0.01)).toBe(-1);
    expect(chunkKey(-1, 3)).toBe('-1_3');
    expect(chunkRect(-1, 0)).toEqual({ minX: -256, minY: 0, maxX: 0, maxY: 256 });
  });

  it('sanitizes chunks: drops bad features, rejects broken structure', () => {
    const good = { v: 1, key: '0_0', cx: 0, cz: 0, roads: [{ id: 'a', c: 'primary', w: 8, p: [1, 1, 5, 5], s: true, e: true }, { id: 'bad', c: 'primary', w: 8, p: [Number.NaN, 1], s: true, e: true }], buildings: [], water: [], waterways: [], landuse: [], trees: [], lamps: [], landmarks: [] };
    const d = sanitizeChunk(good, 256);
    expect(d.roads).toHaveLength(1);
    expect(() => sanitizeChunk({ cx: 0 }, 256)).toThrow();
    expect(() => sanitizeChunk(null, 256)).toThrow();
  });
});
