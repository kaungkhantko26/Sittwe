import { chunkKey } from '../geo/chunkFormat';

/**
 * Generic chunk streaming lifecycle, independent of Three.js so it can be
 * unit-tested. Decides which chunks should be resident around a position,
 * starts async loads (nearest first, limited concurrency), and unloads chunks
 * that fall outside the view radius plus a hysteresis margin.
 */

export interface ChunkManagerOptions<T> {
  chunkSize: number;
  /** Whether a chunk exists in the world manifest. */
  available: (cx: number, cz: number) => boolean;
  load: (cx: number, cz: number, signal: AbortSignal) => Promise<T>;
  onLoaded: (key: string, cx: number, cz: number, data: T) => void;
  onUnloaded: (key: string, cx: number, cz: number, data: T) => void;
  onError?: (key: string, error: unknown) => void;
  maxConcurrent?: number;
  /** Delay before retrying a failed load (ms). */
  retryDelayMs?: number;
  maxRetries?: number;
  now?: () => number;
}

interface Entry<T> {
  cx: number;
  cz: number;
  state: 'queued' | 'loading' | 'loaded' | 'failed';
  data?: T;
  abort?: AbortController;
  retries: number;
  failedAt: number;
}

export class ChunkManager<T> {
  viewRadius = 2;
  /** Chunks are unloaded only beyond viewRadius + unloadPadding (hysteresis). */
  unloadPadding = 1;
  private readonly entries = new Map<string, Entry<T>>();
  private inFlight = 0;
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private readonly waiters: Array<{ keys: string[]; resolve: () => void }> = [];

  constructor(private readonly opts: ChunkManagerOptions<T>) {}

  private get now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  chunkOf(x: number, z: number): [number, number] {
    return [Math.floor(x / this.opts.chunkSize), Math.floor(z / this.opts.chunkSize)];
  }

  /** Keys of available chunks within `radius` (Chebyshev, in chunks) of the chunk containing (x, z). */
  keysAround(x: number, z: number, radius: number): Array<{ key: string; cx: number; cz: number; d: number }> {
    const [ccx, ccz] = this.chunkOf(x, z);
    const out: Array<{ key: string; cx: number; cz: number; d: number }> = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        if (!this.opts.available(cx, cz)) continue;
        out.push({ key: chunkKey(cx, cz), cx, cz, d: Math.hypot(dx, dz) });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Call every frame (cheap when the player stays inside the same chunk). */
  update(x: number, z: number): void {
    const [ccx, ccz] = this.chunkOf(x, z);
    const moved = ccx !== this.centerX || ccz !== this.centerZ;
    this.centerX = ccx;
    this.centerZ = ccz;

    if (moved) {
      for (const want of this.keysAround(x, z, this.viewRadius)) {
        if (!this.entries.has(want.key)) this.entries.set(want.key, { cx: want.cx, cz: want.cz, state: 'queued', retries: 0, failedAt: 0 });
      }
      const limit = this.viewRadius + this.unloadPadding;
      for (const [key, e] of this.entries) {
        if (Math.max(Math.abs(e.cx - ccx), Math.abs(e.cz - ccz)) > limit) this.unload(key, e);
      }
    }
    this.pump();
  }

  private pump(): void {
    const max = this.opts.maxConcurrent ?? 3;
    const retryDelay = this.opts.retryDelayMs ?? 5000;
    const maxRetries = this.opts.maxRetries ?? 3;
    // Nearest queued chunks first.
    const queued = [...this.entries.entries()]
      .filter(([, e]) => e.state === 'queued' || (e.state === 'failed' && e.retries < maxRetries && this.now - e.failedAt > retryDelay))
      .sort(([, a], [, b]) => Math.hypot(a.cx - this.centerX, a.cz - this.centerZ) - Math.hypot(b.cx - this.centerX, b.cz - this.centerZ));
    for (const [key, e] of queued) {
      if (this.inFlight >= max) break;
      this.start(key, e);
    }
  }

  private start(key: string, e: Entry<T>): void {
    e.state = 'loading';
    e.abort = new AbortController();
    this.inFlight++;
    const signal = e.abort.signal;
    this.opts
      .load(e.cx, e.cz, signal)
      .then((data) => {
        if (signal.aborted || this.entries.get(key) !== e) return;
        e.state = 'loaded';
        e.data = data;
        this.opts.onLoaded(key, e.cx, e.cz, data);
      })
      .catch((err: unknown) => {
        if (signal.aborted || this.entries.get(key) !== e) return;
        e.state = 'failed';
        e.retries++;
        e.failedAt = this.now;
        this.opts.onError?.(key, err);
      })
      .finally(() => {
        this.inFlight--;
        this.checkWaiters();
        this.pump();
      });
  }

  private unload(key: string, e: Entry<T>): void {
    e.abort?.abort();
    this.entries.delete(key);
    if (e.state === 'loaded' && e.data !== undefined) this.opts.onUnloaded(key, e.cx, e.cz, e.data);
  }

  /** Resolves when every available chunk within `radius` of (x, z) has finished loading (or failed). */
  waitForArea(x: number, z: number, radius: number): Promise<void> {
    const keys = this.keysAround(x, z, radius).map((k) => k.key);
    return new Promise((resolve) => {
      this.waiters.push({ keys, resolve });
      this.checkWaiters();
    });
  }

  private checkWaiters(): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i]!;
      const done = w.keys.every((k) => {
        const e = this.entries.get(k);
        return !e || e.state === 'loaded' || (e.state === 'failed' && e.retries >= (this.opts.maxRetries ?? 3));
      });
      if (done) {
        this.waiters.splice(i, 1);
        w.resolve();
      }
    }
  }

  /** Forces a full re-evaluation on the next update (e.g. after changing viewRadius). */
  invalidate(): void {
    this.centerX = Number.NaN;
    this.centerZ = Number.NaN;
  }

  state(key: string): Entry<T>['state'] | undefined {
    return this.entries.get(key)?.state;
  }

  get loadedCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.state === 'loaded') n++;
    return n;
  }

  get pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.state === 'queued' || e.state === 'loading') n++;
    return n;
  }

  loadedKeys(): string[] {
    return [...this.entries.entries()].filter(([, e]) => e.state === 'loaded').map(([k]) => k);
  }

  dispose(): void {
    for (const [key, e] of [...this.entries]) this.unload(key, e);
  }
}
