import * as THREE from 'three';

export interface RendererOptions {
  antialias: boolean;
  pixelRatio: number;
  shadows: boolean;
}

/** Thin wrapper around THREE.WebGLRenderer that owns the canvas and resize handling. */
export class Renderer {
  readonly three: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private readonly onResizeCallbacks: Array<(w: number, h: number) => void> = [];
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, opts: RendererOptions) {
    this.three = new THREE.WebGLRenderer({ antialias: opts.antialias, powerPreference: 'high-performance', stencil: false });
    this.canvas = this.three.domElement;
    this.canvas.id = 'game-canvas';
    this.canvas.tabIndex = 0;
    this.three.outputColorSpace = THREE.SRGBColorSpace;
    this.three.toneMapping = THREE.ACESFilmicToneMapping;
    this.three.toneMappingExposure = 1.0;
    this.three.shadowMap.type = THREE.PCFShadowMap;
    this.setPixelRatio(opts.pixelRatio);
    this.setShadows(opts.shadows);
    container.appendChild(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  get width(): number {
    return this.canvas.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.canvas.clientHeight || window.innerHeight;
  }

  setPixelRatio(ratio: number): void {
    this.three.setPixelRatio(Math.min(ratio, window.devicePixelRatio || 1));
  }

  setShadows(enabled: boolean): void {
    this.three.shadowMap.enabled = enabled;
    this.three.shadowMap.needsUpdate = true;
  }

  onResize(cb: (w: number, h: number) => void): void {
    this.onResizeCallbacks.push(cb);
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.three.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    for (const cb of this.onResizeCallbacks) cb(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.three.render(scene, camera);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.three.dispose();
  }
}
