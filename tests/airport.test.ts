import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { airportBuildingIds, buildAirport, validAirport } from '../src/world/AirportGenerator';

const data: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'airport.json'), 'utf8'));

describe('Sittwe Airport', () => {
  it('ships the mapped runway 11/29, apron, taxiways and terminal from OpenStreetMap', () => {
    expect(validAirport(data)).toBe(true);
    if (!validAirport(data)) return;
    const kinds = data.features.map((f) => f.tags['aeroway']);
    const runway = data.features.find((f) => f.tags['aeroway'] === 'runway');
    expect(runway?.tags['ref']).toBe('11/29');
    expect(kinds).toContain('apron');
    expect(kinds.filter((k) => k === 'taxiway').length).toBeGreaterThan(0);
    expect(airportBuildingIds(data)).toEqual(['way/222638250', 'way/1547723417']);
    expect(data.source).toContain('OpenStreetMap');
  });

  it('builds the airport with solid terminal and aircraft colliders', () => {
    if (!validAirport(data)) throw new Error('invalid airport data');
    const a = buildAirport(data);
    expect(a.terminal).not.toBeNull();
    expect(a.hulls.length).toBe(3);
    expect(a.group.getObjectByName('windsock')).toBeTruthy();
    a.dispose();
  });

  it('rejects malformed data', () => {
    expect(validAirport(null)).toBe(false);
    expect(validAirport({ features: [{ id: 1, tags: {}, closed: false, points: [[0, NaN]] }] })).toBe(false);
  });
});
