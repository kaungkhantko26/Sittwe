import * as THREE from 'three';
import { SurfaceY } from './materials';

/**
 * Ambient sea life near the player (decorative, not mapped data):
 *  - Seagull flocks circling over nearby water by day, wings flapping and gliding.
 *  - Fish jumping out of the sea, with splash rings where they leave and re-enter.
 */

const FLOCKS = 3;
const PER_FLOCK = 9;
const GULLS = FLOCKS * PER_FLOCK;
const FISH = 6;
const RINGS = 14;

interface Flock { cx: number; cz: number; tx: number; tz: number; r: number; h: number; speed: number; angle: number; retarget: number }
interface Jump { active: boolean; x: number; z: number; dx: number; dz: number; t: number; dur: number; len: number; h: number; scale: number }
interface Ring { active: boolean; x: number; z: number; t: number; size: number }

function gullBody(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(0.3, 0);
  g.scale(0.55, 0.45, 1.6);
  return g;
}

/** One wing as a thin tapered quad, from the body (x = 0) out to the tip. */
function gullWing(side: 1 | -1): THREE.BufferGeometry {
  const s = side;
  const pts = [0, 0, -0.18, s * 0.95, 0.02, -0.05, s * 0.95, 0.02, 0.12, 0, 0, 0.2, s * 0.95, 0.02, -0.05, s * 1.25, 0.0, 0.15];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...pts.slice(0, 9), ...pts.slice(0, 3), ...pts.slice(6, 9), ...pts.slice(9, 12), ...pts.slice(12, 18), ...pts.slice(6, 9)], 3));
  g.computeVertexNormals();
  return g;
}

function fishGeometry(): THREE.BufferGeometry {
  const body = new THREE.OctahedronGeometry(0.18, 0);
  body.scale(0.45, 0.8, 2.1);
  const tail = new THREE.ConeGeometry(0.14, 0.25, 3);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0, 0.48);
  const merged = new THREE.BufferGeometry();
  const a = body.toNonIndexed(), b = tail.toNonIndexed();
  const pos = new Float32Array(a.getAttribute('position').array.length + b.getAttribute('position').array.length);
  pos.set(a.getAttribute('position').array as Float32Array, 0);
  pos.set(b.getAttribute('position').array as Float32Array, a.getAttribute('position').array.length);
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.computeVertexNormals();
  return merged;
}

export class Wildlife {
  private readonly body: THREE.InstancedMesh;
  private readonly wingL: THREE.InstancedMesh;
  private readonly wingR: THREE.InstancedMesh;
  private readonly fish: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly flocks: Flock[] = [];
  private readonly offsets: Array<{ a: number; r: number; h: number; phase: number; flapRate: number }> = [];
  private readonly jumps: Jump[] = [];
  private readonly ringState: Ring[] = [];
  private nextJump = 1;
  private time = 0;
  private readonly m = new THREE.Matrix4();
  private readonly m2 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene, private readonly isWater: (x: number, z: number) => boolean) {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xdfe2e4, roughness: 0.8, side: THREE.DoubleSide });
    this.body = new THREE.InstancedMesh(gullBody(), white, GULLS);
    this.wingL = new THREE.InstancedMesh(gullWing(-1), wingMat, GULLS);
    this.wingR = new THREE.InstancedMesh(gullWing(1), wingMat, GULLS);
    this.fish = new THREE.InstancedMesh(fishGeometry(), new THREE.MeshStandardMaterial({ color: 0x9fb3bb, roughness: 0.3, metalness: 0.6 }), FISH);
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2f6f2, transparent: true, opacity: 0.55, depthWrite: false }), RINGS);
    for (const mesh of [this.body, this.wingL, this.wingR, this.fish, this.rings]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
    for (let i = 0; i < FLOCKS; i++) this.flocks.push({ cx: NaN, cz: 0, tx: 0, tz: 0, r: 25, h: 20, speed: 7, angle: 0, retarget: 0 });
    for (let i = 0; i < GULLS; i++) this.offsets.push({ a: Math.random() * Math.PI * 2, r: 2 + Math.random() * 9, h: (Math.random() - 0.5) * 5, phase: Math.random() * 10, flapRate: 7 + Math.random() * 3 });
    for (let i = 0; i < FISH; i++) this.jumps.push({ active: false, x: 0, z: 0, dx: 1, dz: 0, t: 0, dur: 1, len: 2, h: 1, scale: 1 });
    for (let i = 0; i < RINGS; i++) this.ringState.push({ active: false, x: 0, z: 0, t: 0, size: 1 });
  }

  /** A random point on water within [minD, maxD] of (x, z), or null. */
  private waterPoint(x: number, z: number, minD: number, maxD: number, tries = 12): { x: number; z: number } | null {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (this.isWater(px, pz)) return { x: px, z: pz };
    }
    return null;
  }

  private ring(x: number, z: number, size: number): void {
    const r = this.ringState.find((v) => !v.active);
    if (r) Object.assign(r, { active: true, x, z, t: 0, size });
  }

  update(dt: number, o: { px: number; pz: number; day: number }): void {
    this.time += dt;
    this.updateBirds(dt, o);
    this.updateFish(dt, o);
  }

  private updateBirds(dt: number, o: { px: number; pz: number; day: number }): void {
    // Gulls roost at night.
    const visible = o.day > 0.25;
    if (!visible) { this.body.count = this.wingL.count = this.wingR.count = 0; return; }
    let n = 0;
    this.flocks.forEach((f, fi) => {
      f.retarget -= dt;
      const far = !Number.isFinite(f.cx) || Math.hypot(f.cx - o.px, f.cz - o.pz) > 450;
      if (far || f.retarget <= 0) {
        // Circle over water near the player when possible, otherwise over the town.
        const p = this.waterPoint(o.px, o.pz, 40, 260) ?? { x: o.px + (Math.random() - 0.5) * 300, z: o.pz + (Math.random() - 0.5) * 300 };
        Object.assign(f, { tx: p.x, tz: p.z, r: 18 + Math.random() * 30, h: 14 + Math.random() * 22, speed: 6 + Math.random() * 4, retarget: 18 + Math.random() * 20 });
        if (far) { f.cx = p.x; f.cz = p.z; }
      }
      // Drift the circle's centre toward its target.
      f.cx += (f.tx - f.cx) * Math.min(1, dt * 0.15);
      f.cz += (f.tz - f.cz) * Math.min(1, dt * 0.15);
      f.angle += (f.speed / f.r) * dt * (fi % 2 ? -1 : 1);
      for (let i = 0; i < PER_FLOCK; i++, n++) {
        const off = this.offsets[n]!;
        const a = f.angle + off.a * 0.25;
        const r = f.r + off.r;
        const x = f.cx + Math.cos(a) * r + Math.sin(this.time * 0.3 + off.phase) * 2;
        const z = f.cz + Math.sin(a) * r;
        const y = f.h + off.h + Math.sin(this.time * 0.7 + off.phase) * 1.5;
        // Heading along the circle; bank into the turn.
        const dir = fi % 2 ? -1 : 1;
        const vx = -Math.sin(a) * dir, vz = Math.cos(a) * dir; // velocity along the circle
        const yaw = Math.atan2(-vx, -vz); // models face -Z
        this.e.set(0, yaw, -0.35 * dir, 'YXZ');
        this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(x, y, z), this.q, this.s);
        this.body.setMatrixAt(n, this.m);
        // Flap in bursts, then glide with wings held level.
        const cycle = (this.time + off.phase) % 6;
        const flap = cycle < 2.2 ? Math.sin((this.time + off.phase) * off.flapRate) * 0.75 : 0.08;
        this.m2.makeRotationZ(flap);
        this.wingR.setMatrixAt(n, this.m2.premultiply(this.m));
        this.m2.makeRotationZ(-flap);
        this.wingL.setMatrixAt(n, this.m2.premultiply(this.m));
      }
    });
    this.body.count = this.wingL.count = this.wingR.count = n;
    for (const mesh of [this.body, this.wingL, this.wingR]) mesh.instanceMatrix.needsUpdate = true;
  }

  private updateFish(dt: number, o: { px: number; pz: number; day: number }): void {
    this.nextJump -= dt;
    if (this.nextJump <= 0) {
      this.nextJump = 1.2 + Math.random() * 3;
      const j = this.jumps.find((v) => !v.active);
      const p = j ? this.waterPoint(o.px, o.pz, 10, 90, 8) : null;
      if (j && p) {
        const a = Math.random() * Math.PI * 2;
        Object.assign(j, { active: true, x: p.x, z: p.z, dx: Math.cos(a), dz: Math.sin(a), t: 0, dur: 0.7 + Math.random() * 0.5, len: 1.5 + Math.random() * 2.5, h: 0.6 + Math.random() * 1, scale: 0.7 + Math.random() * 0.8 });
        this.ring(p.x, p.z, 0.6 * j.scale);
      }
    }
    let n = 0;
    const water = SurfaceY.water;
    for (const j of this.jumps) {
      if (!j.active) continue;
      j.t += dt;
      const u = j.t / j.dur;
      if (u >= 1) {
        j.active = false;
        this.ring(j.x + j.dx * j.len, j.z + j.dz * j.len, 0.8 * j.scale);
        continue;
      }
      const x = j.x + j.dx * j.len * u, z = j.z + j.dz * j.len * u;
      const y = water + 4 * j.h * u * (1 - u) - 0.1;
      // Nose follows the arc: up on the way out, down on the way back in.
      const pitch = Math.atan2(4 * j.h * (1 - 2 * u), j.len);
      this.e.set(pitch, Math.atan2(-j.dx, -j.dz), Math.sin(u * 12) * 0.3, 'YXZ');
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(x, y, z), this.q, this.s.setScalar(j.scale));
      this.fish.setMatrixAt(n++, this.m);
    }
    this.s.set(1, 1, 1);
    this.fish.count = n;
    this.fish.instanceMatrix.needsUpdate = true;
    let r = 0;
    for (const ring of this.ringState) {
      if (!ring.active) continue;
      ring.t += dt;
      if (ring.t > 1.6) { ring.active = false; continue; }
      const k = ring.size * (0.6 + ring.t * 2.2);
      this.m.compose(this.v.set(ring.x, water + 0.06, ring.z), this.q.identity(), this.s.set(k, 1, k));
      this.rings.setMatrixAt(r++, this.m);
    }
    this.s.set(1, 1, 1);
    this.rings.count = r;
    (this.rings.material as THREE.MeshBasicMaterial).opacity = 0.5;
    this.rings.instanceMatrix.needsUpdate = true;
  }
}
