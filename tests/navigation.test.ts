import { describe, expect, it } from 'vitest';
import { buildGraphData, buildSteps, RoadGraph } from '../src/geo/roadGraph';
import { fitPromenade } from '../src/geo/promenade';
import type { Pt } from '../src/geo/geometry2d';

// A small grid: a main road along z = 0 and two side streets.
const graph = new RoadGraph(
  buildGraphData([
    { pts: [[0, 0], [100, 0], [200, 0]], cls: 'primary', oneway: false, name: 'Main Road' },
    { pts: [[100, 0], [100, 100]], cls: 'residential', oneway: false, name: 'Side Street' },
    { pts: [[200, 0], [200, 100], [100, 100]], cls: 'residential', oneway: true, name: 'Loop Lane' },
    { pts: [[0, 0], [0, 100], [100, 100]], cls: 'path', oneway: false },
  ]),
);

describe('road graph routing', () => {
  it('connects ways that share OSM vertices', () => {
    expect(graph.nodeCount).toBe(6);
    expect(graph.data.names).toEqual(['Main Road', 'Side Street', 'Loop Lane']);
  });

  it('finds a driving route and produces turn instructions', () => {
    const r = graph.route(0, 0, 100, 100, 'drive')!;
    expect(r).not.toBeNull();
    expect(r.length).toBeCloseTo(200, 0);
    expect(r.steps[0]!.text).toContain('Main Road');
    expect(r.steps.some((s) => s.text.includes('Side Street'))).toBe(true);
    expect(r.steps.at(-1)!.turn).toBe('arrive');
  });

  it('walking may use footpaths that cars cannot', () => {
    // Destination next to the footpath end: walking takes the path (100 m + 40 m),
    // driving must go round by Main Road and Side Street (200 m + 60 m).
    const walk = graph.route(0, 0, 40, 100, 'walk')!;
    expect(walk.length).toBeCloseTo(140, 0);
    const drive = graph.route(0, 0, 40, 100, 'drive')!;
    expect(drive.length).toBeCloseTo(260, 0);
  });

  it('respects one-way streets when driving', () => {
    // Loop Lane is one-way 200,0 → 100,100: allowed forwards, not backwards.
    const back = graph.route(100, 100, 200, 100, 'drive')!;
    // Must go via Side Street + Main Road instead of the one-way lane backwards.
    expect(back.points.some(([x, z]) => x === 100 && z === 0)).toBe(true);
  });

  it('merges tiny steps and labels left/right turns', () => {
    const r = buildSteps([[0, 0], [0, -50], [50, -50]], [undefined, 'A', 'B', undefined]);
    expect(r.steps[1]!.turn).toBe('right');
  });
});

describe('promenade fitting', () => {
  // A headland pointing south: land is x in [-20, 20] for z < 100, sea elsewhere.
  const sea: Pt[][][] = [
    [[[-500, -500], [-20, -500], [-20, 100], [20, 100], [20, -500], [500, -500], [500, 500], [-500, 500]]],
  ];
  it('runs inland from the tip and stays on land', () => {
    const p = fitPromenade(0, 80, sea)!;
    expect(p).not.toBeNull();
    expect(p.axis[1]).toBeLessThan(-0.9); // inland = north (-Z)
    for (let i = 0; i < p.stations.length; i += 4) {
      expect(p.stations[i + 2]!).toBeLessThanOrEqual(20);
      expect(p.stations[i + 3]!).toBeLessThanOrEqual(20);
    }
  });
  it('returns null for points in the sea', () => {
    expect(fitPromenade(200, 200, sea)).toBeNull();
  });
});
