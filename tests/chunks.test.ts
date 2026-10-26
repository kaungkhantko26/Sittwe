import { describe, expect, it } from 'vitest';
import { ChunkManager } from '../src/world/ChunkManager';

function setup(opts: { fail?: Set<string> } = {}) {
  const loaded: string[] = [];
  const unloaded: string[] = [];
  let now = 0;
  const m = new ChunkManager<string>({
    chunkSize: 256,
    available: (cx, cz) => Math.abs(cx) <= 4 && Math.abs(cz) <= 4,
    load: async (cx, cz) => {
      if (opts.fail?.has(`${cx}_${cz}`)) throw new Error('boom');
      return `${cx}_${cz}`;
    },
    onLoaded: (k) => loaded.push(k),
    onUnloaded: (k) => unloaded.push(k),
    maxConcurrent: 100,
    retryDelayMs: 1000,
    maxRetries: 2,
    now: () => now,
  });
  return { m, loaded, unloaded, advance: (ms: number) => (now += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ChunkManager', () => {
  it('loads the square around the player', async () => {
    const { m, loaded } = setup();
    m.viewRadius = 1;
    m.update(10, 10);
    await flush();
    expect(loaded.sort()).toEqual(['-1_-1', '-1_0', '-1_1', '0_-1', '0_0', '0_1', '1_-1', '1_0', '1_1'].sort());
    expect(m.loadedCount).toBe(9);
  });

  it('unloads chunks only beyond the hysteresis margin', async () => {
    const { m, unloaded } = setup();
    m.viewRadius = 1;
    m.unloadPadding = 1;
    m.update(10, 10);
    await flush();
    m.update(256 + 10, 10); // move one chunk east
    await flush();
    expect(unloaded).toHaveLength(0);
    m.update(3 * 256 + 10, 10); // move three chunks east
    await flush();
    expect(unloaded).toContain('-1_0');
    expect(unloaded).not.toContain('2_0');
  });

  it('skips chunks that are not in the manifest', async () => {
    const { m, loaded } = setup();
    m.viewRadius = 1;
    m.update(4 * 256 + 5, 0);
    await flush();
    expect(loaded.every((k) => Number(k.split('_')[0]) <= 4)).toBe(true);
  });

  it('retries failed loads and waitForArea resolves after giving up', async () => {
    const { m, advance } = setup({ fail: new Set(['0_0']) });
    m.viewRadius = 0;
    m.update(1, 1);
    await flush();
    expect(m.state('0_0')).toBe('failed');
    advance(2000);
    m.update(1, 1);
    await flush();
    await expect(Promise.race([m.waitForArea(1, 1, 0).then(() => 'done'), new Promise((r) => setTimeout(() => r('timeout'), 100))])).resolves.toBe('done');
  });

  it('does not deliver a chunk that was unloaded while loading', async () => {
    const loaded: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const m = new ChunkManager<string>({
      chunkSize: 256,
      available: () => true,
      load: async (cx, cz) => {
        await gate;
        return `${cx}_${cz}`;
      },
      onLoaded: (k) => loaded.push(k),
      onUnloaded: () => undefined,
    });
    m.viewRadius = 0;
    m.unloadPadding = 0;
    m.update(1, 1);
    m.update(5000, 5000);
    release();
    await flush();
    await flush();
    expect(loaded).not.toContain('0_0');
  });
});
