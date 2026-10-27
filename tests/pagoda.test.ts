import { describe, expect, it } from 'vitest';
import { pointInRing } from '../src/geo/geometry2d';
import { isLawkanandar, pagodaLayout } from '../src/geo/pagodaLayout';
import { Discoveries, parseDiscoveries } from '../src/systems/Discoveries';

// A 70 m square platform centred at (100, 200), like Lawkanandar's footprint.
const sq = [65, 165, 135, 165, 135, 235, 65, 235];

describe('pagoda layout', () => {
  const L = pagodaLayout(sq, { x: 100, z: 200 }, { stupa: { baseR: 11.25, height: 49.4 }, roadDistance: (_x, z) => Math.abs(z - 120), hall: false })!;

  it('finds four entrances on the real platform edge', () => {
    expect(L.entrances).toHaveLength(4);
    for (const e of L.entrances) {
      const d = Math.min(Math.abs(e.edge[0] - 65), Math.abs(e.edge[0] - 135), Math.abs(e.edge[1] - 165), Math.abs(e.edge[1] - 235));
      expect(d).toBeLessThan(0.01);
      // Stair bottom lies outside the platform.
      expect(pointInRing(e.bottom[0], e.bottom[1], L.ring)).toBe(false);
    }
  });

  it('chooses the entrance nearest a road as the main entrance', () => {
    // The road runs along z = 120 (north of the platform), so the main entrance faces north.
    expect(L.entrances[L.main]!.out[1]).toBeLessThan(-0.9);
  });

  it('keeps the visitor circuit between the stupa base and the platform edge', () => {
    for (const [x, z] of L.circuit) {
      const r = Math.hypot(x - 100, z - 200);
      expect(r).toBeGreaterThan(L.stupa.terraceR[0]!);
      expect(pointInRing(x, z, L.ring)).toBe(true);
    }
  });

  it('prayer spots face the stupa', () => {
    for (const [x, z, yaw] of L.prayerSpots) {
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const tx = 100 - x;
      const tz = 200 - z;
      expect((fx * tx + fz * tz) / Math.hypot(tx, tz)).toBeGreaterThan(0.99);
    }
  });

  it('places a hall with mats inside it when requested', () => {
    const H = pagodaLayout(sq, { x: 100, z: 200 }, { stupa: { baseR: 11.25, height: 49.4 }, hall: true })!;
    expect(H.hall).not.toBeNull();
    expect(H.mats).toHaveLength(3);
    for (const [x, z] of H.mats) expect(pointInRing(x, z, H.ring)).toBe(true);
  });

  it('identifies Lawkanandar by OSM id or name', () => {
    expect(isLawkanandar({ id: 'node/1230796347', n: 'x' })).toBe(true);
    expect(isLawkanandar({ id: 'node/1', n: 'လောကနန္ဒာ စေတီတော်မြတ်ကြီး' })).toBe(true);
    expect(isLawkanandar({ id: 'node/2', n: 'Other', ne: 'Other Pagoda' })).toBe(false);
  });
});

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('discoveries', () => {
  it('persists discoveries and reports only new ones', () => {
    const st = new MemStorage();
    const d = new Discoveries(st);
    expect(d.discover('node/1')).toBe(true);
    expect(d.discover('node/1')).toBe(false);
    const again = new Discoveries(st);
    expect(again.has('node/1')).toBe(true);
    expect(again.count).toBe(1);
  });
  it('rejects malformed or wrong-version data', () => {
    expect(parseDiscoveries({ version: 2, found: { a: '2026-01-01' } }).found).toEqual({});
    expect(parseDiscoveries({ version: 1, found: { a: 'not a date', b: '2026-10-27T00:00:00Z' } }).found).toEqual({ b: '2026-10-27T00:00:00Z' });
    expect(parseDiscoveries('garbage').found).toEqual({});
  });
});
