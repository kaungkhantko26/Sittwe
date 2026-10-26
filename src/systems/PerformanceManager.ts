import type * as THREE from 'three';

/** Rolling frame-time statistics plus renderer/memory diagnostics. */
export class PerformanceManager {
  private readonly samples: number[] = [];
  private acc = 0;
  private frames = 0;
  fps = 0;
  avgMs = 0;
  worstMs = 0;

  frame(dt: number): void {
    const ms = dt * 1000;
    this.samples.push(ms);
    if (this.samples.length > 240) this.samples.shift();
    this.acc += dt;
    this.frames++;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.acc = 0;
      this.frames = 0;
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.avgMs = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
      this.worstMs = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    }
  }

  /** JS heap usage in MB (Chromium only), or null. */
  heapMB(): number | null {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return mem ? mem.usedJSHeapSize / 1048576 : null;
  }

  renderStats(r: THREE.WebGLRenderer): { calls: number; triangles: number; geometries: number; textures: number } {
    return { calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
  }
}
