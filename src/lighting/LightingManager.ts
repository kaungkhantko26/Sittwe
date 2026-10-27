import * as THREE from 'three';
import { materials } from '../world/materials';
import { LAMP_LIGHT_HEIGHT } from '../world/StreetFurniture';
import { waterMaterial } from '../world/WaterGenerator';
import type { LightingState } from './DayNightCycle';

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uStars;
  uniform float uSunVisible;
  uniform float uTime;
  uniform float uCover;
  uniform float uDay;
  uniform float uTwilight;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return v;
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
    if (h < 0.0) col = mix(uHorizon, uHorizon * 0.75, min(1.0, -h * 4.0));
    float sd = dot(d, uSunDir);
    col += uSunColor * (smoothstep(0.9993, 0.9997, sd) * 4.0 + pow(max(sd, 0.0), 64.0) * 0.35) * uSunVisible;
    // Moon: opposite the sun.
    float md = dot(d, normalize(vec3(-uSunDir.x * 0.6, 0.75, -uSunDir.z - 0.2)));
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.99955, 0.9998, md) * uStars * 1.4;
    if (uStars > 0.0 && h > 0.02) {
      vec3 cell = floor(d * 380.0);
      float s = hash(cell);
      float tw = step(0.9965, s) * (0.5 + 0.5 * hash(cell + 7.0));
      col += vec3(tw) * uStars * smoothstep(0.02, 0.25, h);
    }
    // Clouds: a drifting noise layer projected onto a flat ceiling.
    if (h > 0.0 && uCover > 0.0) {
      vec2 uv = d.xz / (h + 0.12) * 1.6;
      vec2 drift = vec2(uTime * 0.012, uTime * 0.004);
      float n = fbm(uv + drift);
      float n2 = fbm(uv * 1.9 - drift * 1.6 + 4.0);
      float shape = n * 0.75 + n2 * 0.25;
      float thr = 0.62 - uCover * 0.32;
      float dens = smoothstep(thr, thr + 0.2, shape) * smoothstep(0.0, 0.18, h);
      // Lit tops face the sun; thick parts are shaded underneath.
      vec3 lit = mix(uHorizon * 1.25 + vec3(0.03), vec3(1.0), uDay);
      lit = mix(lit, uSunColor * 1.1, uTwilight * 0.55);
      vec3 shade = mix(lit * 0.62, uTop * 0.5 + uHorizon * 0.3, 0.25) * mix(1.0, 0.75, uCover);
      vec3 cloud = mix(lit, shade, smoothstep(thr + 0.08, thr + 0.4, shape));
      cloud += uSunColor * pow(max(sd, 0.0), 12.0) * 0.35 * uSunVisible * (1.0 - dens * 0.5);
      col = mix(col, cloud, dens * 0.92);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface LightingOptions {
  shadowMapSize: number; // 0 = shadows off
  maxPointLights: number;
  fogFar: number;
}

/**
 * Applies a LightingState to the scene: sun/moon key light (with a shadow
 * frustum that follows the player), hemisphere light, sky dome, fog, window
 * glow, streetlights (emissive heads + a small pool of real point lights
 * placed on the lamps nearest the player), and water tint.
 */
export class LightingManager {
  readonly key: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly fog: THREE.Fog;
  private pointLights: THREE.PointLight[] = [];
  private opts: LightingOptions;
  private lampTimer = 0;
  private lampSlots = 0;
  private readonly shadowExtent = 70;
  /** Fair-weather cloud amount, 0 (clear) .. 1 (overcast); rain adds more. */
  cloudCover = 0.45;

  constructor(
    private readonly scene: THREE.Scene,
    opts: LightingOptions,
  ) {
    this.opts = opts;
    this.key = new THREE.DirectionalLight(0xffffff, 2.5);
    this.key.name = 'sun';
    const cam = this.key.shadow.camera;
    cam.left = -this.shadowExtent;
    cam.right = this.shadowExtent;
    cam.top = this.shadowExtent;
    cam.bottom = -this.shadowExtent;
    cam.near = 1;
    cam.far = 400;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.04;
    scene.add(this.key, this.key.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6f6b4f, 1.2);
    scene.add(this.hemi);

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uStars: { value: 0 },
        uSunVisible: { value: 1 },
        uTime: { value: 0 },
        uCover: { value: 0.45 },
        uDay: { value: 1 },
        uTwilight: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.skyMat);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.fog = new THREE.Fog(0xc2dbee, 80, opts.fogFar);
    scene.fog = this.fog;
    this.applyOptions(opts);
  }

  applyOptions(opts: LightingOptions): void {
    this.opts = opts;
    const shadows = opts.shadowMapSize > 0;
    this.key.castShadow = shadows;
    if (shadows && this.key.shadow.mapSize.x !== opts.shadowMapSize) {
      this.key.shadow.mapSize.set(opts.shadowMapSize, opts.shadowMapSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.fog.far = opts.fogFar;
    this.fog.near = Math.min(120, opts.fogFar * 0.25);
    while (this.pointLights.length > opts.maxPointLights) {
      const l = this.pointLights.pop()!;
      this.scene.remove(l);
      l.dispose();
    }
    while (this.pointLights.length < opts.maxPointLights) {
      const l = new THREE.PointLight(0xffd59a, 0, 26, 1.6);
      l.castShadow = false;
      l.position.set(0, -1000, 0);
      this.scene.add(l);
      this.pointLights.push(l);
    }
  }

  update(
    dt: number,
    s: LightingState,
    focus: THREE.Vector3,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    lampsNear: (x: number, z: number, r: number, n: number) => Array<[number, number]>,
    rain: number,
  ): void {
    // Key light follows the focus point; snap to shadow texels to avoid shimmering.
    const texel = (this.shadowExtent * 2) / Math.max(512, this.key.shadow.mapSize.x);
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.key.target.position.set(fx, 0, fz);
    this.key.position.set(fx + s.keyDir.x * 200, s.keyDir.y * 200, fz + s.keyDir.z * 200);
    this.key.color.copy(s.keyColor);
    this.key.intensity = s.keyIntensity;
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    this.hemi.intensity = s.hemiIntensity;

    const u = this.skyMat.uniforms;
    (u['uTop']!.value as THREE.Color).copy(s.skyTop);
    (u['uHorizon']!.value as THREE.Color).copy(s.skyHorizon);
    (u['uSunDir']!.value as THREE.Vector3).copy(s.sunDir);
    (u['uSunColor']!.value as THREE.Color).copy(s.keyColor);
    u['uStars']!.value = s.stars;
    u['uSunVisible']!.value = (1 - rain * 0.9) * (s.elevation > -0.05 ? 1 : 0);
    u['uTime']!.value = (u['uTime']!.value as number) + dt;
    u['uCover']!.value = this.cloudCover + rain * (1 - this.cloudCover);
    u['uDay']!.value = s.day;
    u['uTwilight']!.value = s.twilight;
    this.sky.position.copy(camera.position);
    this.fog.color.copy(s.fogColor);
    const fogScale = 1 - rain * 0.45;
    this.fog.far = this.opts.fogFar * fogScale * (1 - s.night * 0.25);
    renderer.toneMappingExposure = s.exposure;

    const m = materials();
    m.buildingWall.emissiveIntensity = 1.3 * s.night;
    m.lampHead.emissiveIntensity = s.night > 0.25 ? 3 : 0;

    const w = waterMaterial().uniforms;
    (w['uSunDir']!.value as THREE.Vector3).copy(s.keyDir);
    (w['uSunColor']!.value as THREE.Color).copy(s.keyColor);
    (w['uSky']!.value as THREE.Color).copy(s.skyHorizon);
    w['uDay']!.value = Math.max(0.15, s.day) * (1 - rain * 0.8);

    // Streetlight point-light pool.
    this.lampTimer -= dt;
    const lampsOn = s.night > 0.3;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.4;
      const near = lampsOn ? lampsNear(focus.x, focus.z, 90, this.pointLights.length) : [];
      this.lampSlots = near.length;
      this.pointLights.forEach((l, i) => {
        const p = near[i];
        // Lights stay in the scene (toggling visibility would force shader recompiles).
        if (p) l.position.set(p[0], LAMP_LIGHT_HEIGHT - 0.2, p[1]);
        else l.position.set(0, -1000, 0);
      });
    }
    const k = lampsOn ? 18 * Math.min(1, (s.night - 0.3) / 0.3) : 0;
    this.pointLights.forEach((l, i) => (l.intensity = i < this.lampSlots ? k : 0));
  }
}
