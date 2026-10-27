import * as THREE from 'three';

/** A motorbike exhaust to puff smoke from this frame. */
export interface ExhaustSource {
  /** Marker at the exhaust pipe tip (see VehicleVisual.exhaust). */
  exhaust: THREE.Object3D;
  /** 0..1: how hard the engine is working. */
  throttle: number;
}

const SMOKE_COUNT = 220;

const smokeVertex = /* glsl */ `
  attribute float aLife;
  attribute float aSize;
  uniform float uScale;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    bool dead = aLife < 0.0 || aLife >= 1.0;
    gl_PointSize = dead ? 0.0 : aSize * uScale / max(0.1, -mv.z);
    // Quick fade in, slow fade out.
    vAlpha = dead ? 0.0 : min(1.0, aLife * 10.0) * (1.0 - aLife) * (1.0 - aLife);
  }
`;

const smokeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vAlpha * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const WIND_COUNT = 80;

/**
 * Riding effects: exhaust smoke from motorbikes (yours and traffic) and wind
 * streaks rushing past the camera when you ride or drive fast. Each is a
 * single draw call with a fixed pool of particles.
 */
export class BikeFx {
  private readonly smoke: THREE.Points;
  private readonly smokeMat: THREE.ShaderMaterial;
  private readonly sPos = new Float32Array(SMOKE_COUNT * 3);
  private readonly sVel = new Float32Array(SMOKE_COUNT * 3);
  private readonly sLife = new Float32Array(SMOKE_COUNT).fill(-1);
  private readonly sDur = new Float32Array(SMOKE_COUNT);
  private readonly sSize = new Float32Array(SMOKE_COUNT);
  private readonly sGrow = new Float32Array(SMOKE_COUNT);
  private next = 0;
  /** Per-exhaust emission state: fractional puffs owed and last position. */
  private readonly emit = new WeakMap<THREE.Object3D, { owed: number; last: THREE.Vector3 }>();

  private readonly wind: THREE.Mesh;
  private readonly wPos = new Float32Array(WIND_COUNT * 12);
  private readonly wCol = new Float32Array(WIND_COUNT * 16);
  private readonly wAt = new Float32Array(WIND_COUNT * 3);
  private readonly wLife = new Float32Array(WIND_COUNT).fill(1);
  private readonly wDur = new Float32Array(WIND_COUNT);
  private windAmount = 0;

  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly size = new THREE.Vector2();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.sLife, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(SMOKE_COUNT), 1).setUsage(THREE.DynamicDrawUsage));
    this.smokeMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xa9abad) }, uOpacity: { value: 0.5 }, uScale: { value: 500 } },
      vertexShader: smokeVertex,
      fragmentShader: smokeFragment,
      transparent: true,
      depthWrite: false,
    });
    this.smoke = new THREE.Points(geo, this.smokeMat);
    this.smoke.name = 'exhaust-smoke';
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 2;
    scene.add(this.smoke);

    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(this.wPos, 3).setUsage(THREE.DynamicDrawUsage));
    wg.setAttribute('color', new THREE.BufferAttribute(this.wCol, 4).setUsage(THREE.DynamicDrawUsage));
    // Each streak is a thin ribbon (two triangles) turned toward the camera.
    const idx: number[] = [];
    for (let i = 0; i < WIND_COUNT; i++) { const b = i * 4; idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3); }
    wg.setIndex(idx);
    this.wind = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.wind.name = 'wind-streaks';
    this.wind.frustumCulled = false;
    this.wind.visible = false;
    scene.add(this.wind);
  }

  /**
   * @param sources motorbike exhausts near the camera this frame
   * @param speed   your vehicle's speed in m/s (0 when on foot)
   * @param day     0 night → 1 day, to light the smoke
   */
  update(dt: number, sources: ExhaustSource[], speed: number, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, day: number): void {
    dt = Math.min(dt, 0.1);
    this.updateSmoke(dt, sources, camera, renderer, day);
    this.updateWind(dt, speed, camera);
  }

  private updateSmoke(dt: number, sources: ExhaustSource[], camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, day: number): void {
    for (const s of sources) {
      const tip = s.exhaust.getWorldPosition(this.tmp);
      let st = this.emit.get(s.exhaust);
      if (!st) {
        st = { owed: Math.random(), last: tip.clone() };
        this.emit.set(s.exhaust, st);
      }
      // Bike velocity from how far the pipe moved (ignore teleports).
      const vel = this.tmp2.subVectors(tip, st.last).divideScalar(Math.max(dt, 1e-3));
      if (vel.lengthSq() > 900) vel.set(0, 0, 0);
      st.last.copy(tip);
      // Pipe points backward: the bike's +Z axis in world space.
      const back = this.side.set(0, 0, 1).transformDirection(s.exhaust.matrixWorld);
      st.owed += dt * (4 + s.throttle * 26);
      while (st.owed >= 1) {
        st.owed -= 1;
        this.spawnPuff(tip, vel, back, s.throttle, Math.random() * dt);
      }
    }

    const p = this.sPos, v = this.sVel, life = this.sLife;
    const sizes = this.smoke.geometry.getAttribute('aSize') as THREE.BufferAttribute;
    const sz = sizes.array as Float32Array;
    const drag = Math.exp(-2.2 * dt);
    let alive = false;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      if (life[i]! < 0 || life[i]! >= 1) continue;
      alive = true;
      life[i]! += dt / this.sDur[i]!;
      const o = i * 3;
      v[o]! *= drag;
      v[o + 2]! *= drag;
      v[o + 1] = v[o + 1]! * drag + 0.5 * dt; // warm exhaust drifts up
      p[o]! += v[o]! * dt;
      p[o + 1]! += v[o + 1]! * dt;
      p[o + 2]! += v[o + 2]! * dt;
      sz[i] = this.sSize[i]! + this.sGrow[i]! * Math.sqrt(Math.min(1, life[i]!));
    }
    this.smoke.visible = alive;
    if (!alive) return;
    (this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.smoke.geometry.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
    sizes.needsUpdate = true;
    renderer.getDrawingBufferSize(this.size);
    const u = this.smokeMat.uniforms;
    u['uScale']!.value = this.size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    (u['uColor']!.value as THREE.Color).setRGB(0.5, 0.51, 0.53).multiplyScalar(0.3 + 0.7 * day);
    u['uOpacity']!.value = 0.32 + 0.15 * (1 - day);
  }

  private spawnPuff(at: THREE.Vector3, vel: THREE.Vector3, back: THREE.Vector3, throttle: number, age: number): void {
    const i = this.next;
    this.next = (this.next + 1) % SMOKE_COUNT;
    const o = i * 3;
    const r = () => Math.random() - 0.5;
    // Out of the pipe backward, carried a little by the bike, plus some swirl.
    const out = 0.6 + throttle * 1.2;
    this.sVel[o] = vel.x * 0.3 + back.x * out + r() * 0.35;
    this.sVel[o + 1] = 0.15 + Math.random() * 0.25;
    this.sVel[o + 2] = vel.z * 0.3 + back.z * out + r() * 0.35;
    this.sPos[o] = at.x + this.sVel[o]! * age;
    this.sPos[o + 1] = at.y;
    this.sPos[o + 2] = at.z + this.sVel[o + 2]! * age;
    this.sDur[i] = 1.1 + Math.random() * 0.9 + throttle * 0.4;
    this.sSize[i] = 0.1 + Math.random() * 0.05;
    this.sGrow[i] = 0.55 + Math.random() * 0.45 + throttle * 0.3;
    this.sLife[i] = 0.0001;
  }

  private updateWind(dt: number, speed: number, camera: THREE.PerspectiveCamera): void {
    // Streaks appear from ~20 km/h and are strongest from ~65 km/h.
    const target = THREE.MathUtils.smoothstep(Math.abs(speed), 5.5, 18);
    this.windAmount += (target - this.windAmount) * Math.min(1, dt * 3);
    if (this.windAmount < 0.01) {
      this.wind.visible = false;
      this.wLife.fill(1);
      return;
    }
    this.wind.visible = true;
    const cam = camera.position;
    camera.getWorldDirection(this.fwd);
    this.side.crossVectors(this.fwd, camera.up).normalize();
    this.up.crossVectors(this.side, this.fwd).normalize();
    const len = 1 + Math.abs(speed) * 0.16;
    for (let i = 0; i < WIND_COUNT; i++) {
      const o = i * 3;
      this.wLife[i]! += dt / this.wDur[i]!;
      const rel = this.tmp.set(this.wAt[o]! - cam.x, this.wAt[o + 1]! - cam.y, this.wAt[o + 2]! - cam.z);
      // Recycle when done or once it has rushed past the camera.
      if (this.wLife[i]! >= 1 || rel.dot(this.fwd) < 0.3) {
        // Spawn ahead in a ring around the view centre, never in the middle of the screen.
        const ang = Math.random() * Math.PI * 2;
        const rad = 1.1 + Math.random() * 2.6;
        const ahead = 3 + Math.random() * 12;
        this.tmp2.copy(cam).addScaledVector(this.fwd, ahead).addScaledVector(this.side, Math.cos(ang) * rad * 1.5).addScaledVector(this.up, Math.sin(ang) * rad * 0.8);
        this.wAt[o] = this.tmp2.x;
        this.wAt[o + 1] = this.tmp2.y;
        this.wAt[o + 2] = this.tmp2.z;
        this.wLife[i] = 0;
        this.wDur[i] = 0.4 + Math.random() * 0.6;
      }
      // Streaks hang in the air (you rush past them) along your direction of travel.
      const fade = Math.sin(Math.PI * Math.min(1, this.wLife[i]!));
      const a = fade * this.windAmount * (0.3 + 0.25 * ((i * 7) % 5) / 4);
      const k = len * (0.6 + ((i * 13) % 7) / 10);
      // Ribbon width across the view: perpendicular to travel and to the line of sight.
      const across = this.tmp2.crossVectors(this.fwd, rel).normalize().multiplyScalar(0.012 + rel.length() * 0.001);
      const x = this.wAt[o]!, y = this.wAt[o + 1]!, z = this.wAt[o + 2]!;
      const fx = this.fwd.x * k, fy = this.fwd.y * k, fz = this.fwd.z * k;
      this.wPos.set([x - across.x, y - across.y, z - across.z, x + across.x, y + across.y, z + across.z, x + fx - across.x, y + fy - across.y, z + fz - across.z, x + fx + across.x, y + fy + across.y, z + fz + across.z], i * 12);
      this.wCol.set([1, 1, 1, a, 1, 1, 1, a, 1, 1, 1, 0, 1, 1, 1, 0], i * 16);
    }
    (this.wind.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.wind.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
