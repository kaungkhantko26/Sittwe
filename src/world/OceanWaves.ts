import * as THREE from 'three';
import type { Pt } from '../geo/geometry2d';
import { SurfaceY } from './materials';
import { waterMaterial } from './WaterGenerator';

/**
 * Rolling sea waves near the camera.
 *
 * The flat sea polygon stays as the base. On top of it, a 1 km detailed grid
 * that follows the camera is lifted by swells (directional sine waves). A
 * mask drawn from the real sea outline keeps it off the land (1 m precision)
 * and a blurred copy measures distance to the shore: waves calm down near the
 * beach, where white foam lines roll in and break.
 */

const SIZE = 1024; // metres covered by the wave grid and its masks
const SEGMENTS = 200; // ~5 m between vertices
const MASK_PX = 1024; // 1 m per pixel: where the sea is
const SHORE_PX = 128; // 8 m per pixel, blurred: how far from the shore

const vertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform vec2 uCenter;
  uniform sampler2D uShore;
  varying vec3 vWorld;
  varying vec3 vNormal2;
  varying vec2 vUv2;
  varying float vHeight;
  varying float vShore;

  // Swells from the Bay of Bengal (south-west), plus two crossing wind seas.
  vec3 swell(vec2 p, vec2 d, float len, float amp, float speed) {
    float k = 6.2831853 / len;
    float ph = dot(p, d) * k - uTime * speed * k;
    return vec3(sin(ph) * amp, cos(ph) * amp * k * d);
  }
  vec3 waves(vec2 p) {
    return swell(p, normalize(vec2(-0.55, -0.83)), 38.0, 0.20, 5.5)
         + swell(p, normalize(vec2(-0.9, -0.3)), 17.0, 0.09, 4.2)
         + swell(p, normalize(vec2(0.3, -0.95)), 9.0, 0.04, 3.1);
  }
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vUv2 = (world.xz - uCenter) / ${SIZE.toFixed(1)} + 0.5;
    float open = texture2D(uShore, vUv2).r; // 0 at the shore → 1 out at sea
    vShore = open;
    // Calm near the beach and at the grid edge, so it meets the flat sea smoothly.
    float edge = 1.0 - smoothstep(0.38, 0.5, max(abs(vUv2.x - 0.5), abs(vUv2.y - 0.5)));
    float amp = smoothstep(0.08, 0.7, open) * edge;
    vec3 w = waves(world.xz) * amp;
    world.y += w.x;
    vHeight = w.x;
    vNormal2 = normalize(vec3(-w.y, 1.0, -w.z));
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform float uDay;
  uniform sampler2D uMask;
  varying vec3 vWorld;
  varying vec3 vNormal2;
  varying vec2 vUv2;
  varying float vHeight;
  varying float vShore;

  void main() {
    if (texture2D(uMask, vUv2).r < 0.5 || vUv2.x < 0.0 || vUv2.y < 0.0 || vUv2.x > 1.0 || vUv2.y > 1.0) discard;
    // Small ripples on top of the swell.
    vec2 p = vWorld.xz;
    vec3 n = normalize(vNormal2 + vec3(0.04 * sin(p.x * 1.3 + uTime * 2.1), 0.0, 0.04 * cos(p.y * 1.1 + uTime * 1.7)));
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    vec3 base = mix(uShallow, uDeep, clamp(0.45 + vShore * 0.35 + vHeight * 0.8, 0.0, 1.0));
    vec3 col = mix(base, uSky, fres * 0.55);
    vec3 r = reflect(-uSunDir, n);
    col += uSunColor * pow(max(dot(r, viewDir), 0.0), 140.0) * uDay * 1.6;
    // Breaking waves: foam lines rolling toward the shore, strongest at the beach.
    float near = 1.0 - smoothstep(0.05, 0.42, vShore);
    float band = sin(vShore * 60.0 + uTime * 1.6 + sin(p.x * 0.05 + p.y * 0.04) * 2.0);
    float foam = smoothstep(0.7, 0.98, band) * near;
    foam += (1.0 - smoothstep(0.0, 0.07, vShore)) * (0.55 + 0.25 * sin(uTime * 2.3 + p.x * 0.3));
    // Whitecaps on the tallest crests.
    foam += smoothstep(0.2, 0.3, vHeight) * 0.5;
    col = mix(col, vec3(0.93, 0.95, 0.93) * (0.45 + 0.55 * uDay), clamp(foam, 0.0, 0.85));
    gl_FragColor = vec4(col, 0.95);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class OceanWaves {
  readonly mesh: THREE.Mesh;
  private readonly maskCanvas = document.createElement('canvas');
  private readonly shoreCanvas = document.createElement('canvas');
  private readonly maskTex: THREE.CanvasTexture;
  private readonly shoreTex: THREE.CanvasTexture;
  private readonly center = new THREE.Vector2(Infinity, Infinity);
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly sea: Array<{ rings: Pt[][]; bounds: { minX: number; maxX: number; minY: number; maxY: number } }>) {
    this.maskCanvas.width = this.maskCanvas.height = MASK_PX;
    this.shoreCanvas.width = this.shoreCanvas.height = SHORE_PX;
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.shoreTex = new THREE.CanvasTexture(this.shoreCanvas);
    for (const t of [this.maskTex, this.shoreTex]) {
      t.colorSpace = THREE.NoColorSpace;
      t.flipY = false; // canvas row 0 = smallest z
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    }
    const w = waterMaterial().uniforms;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        // Shared with the flat water, so day/night and time stay in step.
        uTime: w['uTime']!, uDeep: w['uDeep']!, uShallow: w['uShallow']!, uSunDir: w['uSunDir']!,
        uSunColor: w['uSunColor']!, uSky: w['uSky']!, uDay: w['uDay']!,
        fogColor: w['fogColor']!, fogNear: w['fogNear']!, fogFar: w['fogFar']!, fogDensity: w['fogDensity']!,
        uCenter: { value: new THREE.Vector2() },
        uMask: { value: this.maskTex },
        uShore: { value: this.shoreTex },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      fog: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'ocean-waves';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
  }

  /** Is any sea inside the square around (cx, cz)? */
  private seaNear(cx: number, cz: number): boolean {
    const h = SIZE / 2;
    return this.sea.some((p) => p.bounds.maxX > cx - h && p.bounds.minX < cx + h && p.bounds.maxY > cz - h && p.bounds.minY < cz + h);
  }

  private redraw(cx: number, cz: number): void {
    const draw = (canvas: HTMLCanvasElement, px: number) => {
      const g = canvas.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, px, px);
      g.fillStyle = '#fff';
      const k = px / SIZE, ox = cx - SIZE / 2, oz = cz - SIZE / 2;
      g.beginPath();
      for (const poly of this.sea) for (const ring of poly.rings) {
        ring.forEach((pt, i) => (i ? g.lineTo : g.moveTo).call(g, (pt[0] - ox) * k, (pt[1] - oz) * k));
        g.closePath();
      }
      g.fill('evenodd');
    };
    draw(this.maskCanvas, MASK_PX);
    // Distance to shore: a coarse copy of the mask, blurred by repeated smoothing.
    draw(this.shoreCanvas, SHORE_PX);
    const g = this.shoreCanvas.getContext('2d')!;
    const img = g.getImageData(0, 0, SHORE_PX, SHORE_PX);
    let a = new Float32Array(SHORE_PX * SHORE_PX);
    for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4]! / 255;
    const sea = a.slice();
    for (let pass = 0; pass < 4; pass++) {
      const b = new Float32Array(a.length);
      for (let y = 0; y < SHORE_PX; y++) for (let x = 0; x < SHORE_PX; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= SHORE_PX || yy >= SHORE_PX) continue;
          s += a[yy * SHORE_PX + xx]!; n++;
        }
        b[y * SHORE_PX + x] = s / n;
      }
      a = b;
    }
    for (let i = 0; i < a.length; i++) {
      // Only the sea side matters; push the shoreline value down to 0.
      const v = sea[i]! > 0.5 ? Math.max(0, (a[i]! - 0.5) * 2) : 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.round(v * 255);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.maskTex.needsUpdate = true;
    this.shoreTex.needsUpdate = true;
  }

  /** Follows the camera; redraws the masks after moving ~250 m. */
  update(camX: number, camZ: number, camY: number): void {
    if (camY > 400) { this.mesh.visible = false; return; }
    if (Math.hypot(camX - this.center.x, camZ - this.center.y) > 250) {
      const cx = Math.round(camX / 32) * 32, cz = Math.round(camZ / 32) * 32;
      this.center.set(cx, cz);
      if (this.seaNear(cx, cz)) this.redraw(cx, cz);
      this.mesh.visible = this.seaNear(cx, cz);
      this.mesh.position.set(cx, SurfaceY.water + 0.02, cz);
      (this.material.uniforms['uCenter']!.value as THREE.Vector2).set(cx, cz);
    }
  }
}
