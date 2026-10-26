import { describe, expect, it } from 'vitest';
import { buildingHeight, classifyRoad, parseLength, parseOsm, roadWidth, assembleMultipolygon, type OsmRelation } from '../src/geo/OSMParser';
import { buildSeaPolygons, clipPolyline, clipRing, joinLines, pointInRing, signedArea } from '../src/geo/geometry2d';

const sq = (lat: number, lon: number, d = 0.0002) => [
  { lat, lon }, { lat, lon: lon + d }, { lat: lat + d, lon: lon + d }, { lat: lat + d, lon }, { lat, lon },
];

describe('OSM tag parsing', () => {
  it('parses lengths', () => {
    expect(parseLength('12')).toBe(12);
    expect(parseLength('7.5 m')).toBe(7.5);
    expect(parseLength("10'")).toBeCloseTo(3.048);
    expect(parseLength('abc')).toBeUndefined();
    expect(parseLength('-3')).toBeUndefined();
  });

  it('classifies roads and widths', () => {
    expect(classifyRoad('primary')).toBe('primary');
    expect(classifyRoad('unclassified')).toBe('residential');
    expect(classifyRoad('footway')).toBe('path');
    expect(classifyRoad('proposed')).toBeUndefined();
    expect(roadWidth('primary', { width: '12' })).toEqual({ width: 12, source: 'tag' });
    expect(roadWidth('secondary', { lanes: '3' }).source).toBe('lanes');
    expect(roadWidth('residential', {}).source).toBe('default');
  });

  it('derives building heights by documented priority', () => {
    expect(buildingHeight({ building: 'yes', height: '15' }, 100)).toMatchObject({ height: 15, source: 'tag' });
    expect(buildingHeight({ building: 'yes', 'building:levels': '4' }, 100)).toMatchObject({ height: 12.8, source: 'levels' });
    expect(buildingHeight({ building: 'hut' }, 400)).toMatchObject({ height: 3.2, source: 'estimate' });
    expect(buildingHeight({ building: 'yes' }, 50).levels).toBe(1);
    expect(buildingHeight({ building: 'yes' }, 200).levels).toBe(2);
    expect(buildingHeight({ building: 'yes' }, 1000).levels).toBe(3);
  });
});

describe('parseOsm', () => {
  it('normalizes roads, buildings, landuse, landmarks and dedupes by id', () => {
    const els = [
      { type: 'way', id: 1, tags: { highway: 'primary', name: 'Main Road', 'name:my': 'လမ်းမကြီး' }, geometry: [{ lat: 20.1, lon: 92.9 }, { lat: 20.101, lon: 92.9 }] },
      { type: 'way', id: 1, tags: { highway: 'primary' }, geometry: [{ lat: 20.1, lon: 92.9 }, { lat: 20.101, lon: 92.9 }] },
      { type: 'way', id: 2, tags: { building: 'yes', 'building:levels': '2', name: 'School', amenity: 'school' }, geometry: sq(20.1, 92.9) },
      { type: 'way', id: 3, tags: { landuse: 'grass' }, geometry: sq(20.11, 92.91, 0.001) },
      { type: 'node', id: 4, lat: 20.1, lon: 92.9, tags: { natural: 'tree' } },
      { type: 'node', id: 5, lat: 20.1, lon: 92.9, tags: { amenity: 'place_of_worship', religion: 'buddhist', name: 'Pagoda' } },
      { type: 'way', id: 6, tags: { natural: 'coastline' }, geometry: [{ lat: 20.0, lon: 92.9 }, { lat: 20.2, lon: 92.9 }] },
    ];
    const r = parseOsm(els);
    expect(r.roads.features).toHaveLength(1);
    expect(r.roads.features[0]!.properties).toMatchObject({ cls: 'primary', name: 'Main Road', nameMy: 'လမ်းမကြီး', nameLocal: 'လမ်းမကြီး', width: 10 });
    expect(r.buildings.features[0]!.properties).toMatchObject({ heightSource: 'levels', height: 6.4 });
    expect(r.landuse.features[0]!.properties.kind).toBe('grass');
    expect(r.trees.features).toHaveLength(1);
    expect(r.landmarks.features.map((f) => f.properties.category).sort()).toEqual(['education', 'worship']);
    expect(r.coastlines).toHaveLength(1);
    expect(r.stats.buildingsHeightFromLevels).toBe(1);
  });

  it('skips invalid map data without throwing', () => {
    const r = parseOsm([
      null,
      42,
      { type: 'way', id: 10, tags: { highway: 'residential' } },
      { type: 'way', id: 11, tags: { highway: 'residential' }, geometry: [{ lat: Number.NaN, lon: 92 }, { lat: 20, lon: 92 }] },
      { type: 'node', id: 12, lat: 999, lon: 92, tags: { natural: 'tree' } },
      { type: 'relation', id: 13, tags: { type: 'multipolygon', building: 'yes' }, members: [] },
    ]);
    expect(r.roads.features).toHaveLength(0);
    expect(r.trees.features).toHaveLength(0);
    expect(r.stats.skippedMissingGeometry).toBeGreaterThanOrEqual(3);
    expect(r.stats.skippedInvalidCoordinates).toBe(1);
  });

  it('assembles multipolygons from split outer ways with holes', () => {
    const rel: OsmRelation = {
      type: 'relation', id: 1, tags: { type: 'multipolygon', landuse: 'grass' },
      members: [
        { type: 'way', ref: 1, role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }] },
        { type: 'way', ref: 2, role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: 0 }] },
        { type: 'way', ref: 3, role: 'inner', geometry: [{ lat: 0.4, lon: 0.4 }, { lat: 0.4, lon: 0.6 }, { lat: 0.6, lon: 0.6 }, { lat: 0.4, lon: 0.4 }] },
      ],
    };
    const mp = assembleMultipolygon(rel);
    expect(mp.polygons).toHaveLength(1);
    expect(mp.polygons[0]).toHaveLength(2);
    expect(signedArea(mp.polygons[0]![0]!)).toBeGreaterThan(0);
    expect(signedArea(mp.polygons[0]![1]!)).toBeLessThan(0);
  });
});

describe('geometry2d', () => {
  const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  it('clips polylines into pieces and marks cut ends', () => {
    const pieces = clipPolyline([[-5, 5], [5, 5], [15, 5]], rect);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.points[0]).toEqual([0, 5]);
    expect(pieces[0]!.points.at(-1)).toEqual([10, 5]);
    expect(pieces[0]!.startCut && pieces[0]!.endCut).toBe(true);
    const two = clipPolyline([[2, 2], [2, 20], [8, 20], [8, 2]], rect);
    expect(two).toHaveLength(2);
    expect(two[0]!.startCut).toBe(false);
  });
  it('clips rings', () => {
    const r = clipRing([[-5, -5], [5, -5], [5, 5], [-5, 5]], rect);
    expect(Math.abs(signedArea(r))).toBeCloseTo(25);
    expect(clipRing([[20, 20], [30, 20], [30, 30]], rect)).toHaveLength(0);
  });
  it('joins lines into rings', () => {
    const { rings, open } = joinLines([[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 0]]]);
    expect(rings).toHaveLength(1);
    expect(open).toHaveLength(0);
  });
  it('builds sea polygons with water on the right of the coastline', () => {
    // Coastline running north along x = 5: land west (left), sea east (right).
    const { rings } = buildSeaPolygons([[[5, -10], [5, 20]]], rect);
    expect(rings).toHaveLength(1);
    const sea = rings[0]![0]!;
    expect(pointInRing(8, 5, sea)).toBe(true);
    expect(pointInRing(2, 5, sea)).toBe(false);
    expect(Math.abs(signedArea(sea))).toBeCloseTo(50);
  });
});
