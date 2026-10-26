/**
 * requestAnimationFrame loop with a fixed-timestep accumulator for physics
 * and a variable-timestep update for rendering/animation.
 */
export interface LoopCallbacks {
  /** Fixed-rate step (physics, controllers). */
  fixedUpdate(dt: number): void;
  /** Per-frame update; alpha = interpolation factor between fixed steps. */
  update(dt: number, alpha: number): void;
  render(): void;
}

export class GameLoop {
  readonly fixedDt: number;
  private accumulator = 0;
  private last = 0;
  private rafId = 0;
  private running = false;
  /** Max fixed steps per frame, to avoid the "spiral of death" after a stall. */
  private readonly maxSteps = 5;
  frameMs = 0;

  constructor(
    private readonly cb: LoopCallbacks,
    hz = 60,
  ) {
    this.fixedDt = 1 / hz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(tick);
      const t0 = performance.now();
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, 0.25);
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < this.maxSteps) {
        this.cb.fixedUpdate(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps === this.maxSteps) this.accumulator = 0;
      this.cb.update(dt, this.accumulator / this.fixedDt);
      this.cb.render();
      this.frameMs = performance.now() - t0;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
