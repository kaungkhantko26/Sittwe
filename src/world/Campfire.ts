import * as THREE from 'three';

/**
 * A beach campfire on the sand near Sittwe Point (generated scenery): a ring
 * of stones, a tipi of logs, flickering flames, glowing embers, sparks and a
 * little smoke, with four log benches to sit on. It burns at night, or for a
 * while after players light it in the campfire mission. One warm point light
 * is always in the scene (dark by day), so lighting it never recompiles shaders.
 */

const SEAT_R = 2.9;

export class Campfire {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight(0xff9a48, 0, 22, 1.6);
  /** Bench spots [x, z, yaw] (yaw faces the fire). */
  seats: Array<[number, number, number]> = [];
  x = 0;
  z = 0;
  placed = false;
  private boostUntil = 0;
  private time = 0;
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameMat: THREE.MeshBasicMaterial;
  private readonly coreMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Mesh;
  private readonly sparks: THREE.Points;
  private readonly sparkVel: Float32Array;
  private readonly smoke: THREE.Sprite[] = [];

  constructor(scene: THREE.Scene) {
    this.group.name = 'campfire';
    this.group.visible = false;
    const stone = new THREE.MeshStandardMaterial({ color: 0x7c7770, roughness: 0.95 });
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + (i % 3) * 0.04, 0), stone);
      s.position.set(Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85);
      s.rotation.set(i, i * 2, 0);
      s.castShadow = true;
      this.group.add(s);
    }
    const bark = new THREE.MeshStandardMaterial({ color: 0x5a4130, roughness: 0.9 });
    const charred = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 1, emissive: 0x6a1d00, emissiveIntensity: 0.6 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), i % 2 ? bark : charred);
      log.position.set(Math.cos(a) * 0.25, 0.42, Math.sin(a) * 0.25);
      log.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
      log.castShadow = true;
      this.group.add(log);
    }
    // Flames: nested open cones, additive, flickering.
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a1e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const core = i >= 3;
      const f = new THREE.Mesh(new THREE.ConeGeometry(core ? 0.18 : 0.3, core ? 0.8 : 1.25, 7, 1, true), core ? this.coreMat : this.flameMat);
      const a = i * 1.7;
      f.position.set(Math.cos(a) * (core ? 0.04 : 0.12), core ? 0.5 : 0.65, Math.sin(a) * (core ? 0.04 : 0.12));
      f.userData['base'] = f.position.y;
      this.flames.push(f);
      this.group.add(f);
    }
    // Ember glow on the sand.
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,170,80,0.9)');
    grad.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(c);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.position.y = 0.06;
    this.group.add(this.glow);
    // Sparks.
    const n = 40;
    const pos = new Float32Array(n * 3);
    this.sparkVel = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb35a, size: 0.09, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparks.frustumCulled = false;
    for (let i = 0; i < n; i++) this.resetSpark(i, Math.random() * 2.5);
    this.group.add(this.sparks);
    const smokeMat = new THREE.SpriteMaterial({ map: glowTex, color: 0x6a6a6a, transparent: true, opacity: 0.25, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(smokeMat.clone());
      s.userData['t'] = i / 6;
      this.smoke.push(s);
      this.group.add(s);
    }
    // Log benches around the fire.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bench = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 1.8, 8).rotateZ(Math.PI / 2), bark);
      bench.position.set(Math.cos(a) * (SEAT_R + 0.35), 0.2, Math.sin(a) * (SEAT_R + 0.35));
      bench.rotation.y = -a + Math.PI / 2;
      bench.castShadow = true;
      this.group.add(bench);
    }
    this.light.position.set(0, 1.4, 0);
    this.group.add(this.light);
    scene.add(this.group);
  }

  private resetSpark(i: number, h = 0): void {
    const p = (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    p.set([(Math.random() - 0.5) * 0.4, 0.5 + h, (Math.random() - 0.5) * 0.4], i * 3);
    this.sparkVel.set([(Math.random() - 0.5) * 0.4, 1 + Math.random() * 1.4, (Math.random() - 0.5) * 0.4], i * 3);
  }

  place(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);
    this.group.visible = true;
    this.placed = true;
    this.seats = [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const sx = x + Math.cos(a) * SEAT_R, sz = z + Math.sin(a) * SEAT_R;
      // Face the fire: -Z of the character points from the seat to the centre.
      return [sx, sz, Math.atan2(sx - x, sz - z)];
    });
  }

  /** Lit by players: burns brightly for a while, day or night. */
  boost(seconds: number): void {
    this.boostUntil = this.time + seconds;
  }

  nearestSeat(x: number, z: number, maxD = 1.6): [number, number, number] | null {
    let best: [number, number, number] | null = null, bd = maxD;
    for (const s of this.seats) { const d = Math.hypot(s[0] - x, s[1] - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  update(dt: number, night: number, nearDist: number): void {
    this.time += dt;
    if (!this.placed) return;
    const burning = night > 0.3 || this.time < this.boostUntil;
    const strength = burning ? (this.time < this.boostUntil ? 1.25 : 1) : 0;
    for (const f of this.flames) f.visible = burning;
    this.sparks.visible = burning && nearDist < 120;
    for (const s of this.smoke) s.visible = burning;
    this.glow.visible = burning;
    if (!burning) { this.light.intensity = 0; return; }
    const flick = 0.85 + Math.sin(this.time * 17) * 0.08 + Math.sin(this.time * 31 + 1) * 0.06 + Math.sin(this.time * 7) * 0.05;
    this.flames.forEach((f, i) => {
      const s = (0.8 + 0.25 * Math.sin(this.time * (9 + i * 2) + i)) * strength;
      f.scale.set(0.9 + 0.15 * Math.sin(this.time * 13 + i), s, 0.9 + 0.15 * Math.cos(this.time * 11 + i));
      f.position.y = (f.userData['base'] as number) * (0.85 + 0.15 * s);
      f.rotation.y = this.time * (0.6 + i * 0.2);
    });
    this.flameMat.opacity = 0.7 * flick;
    this.light.intensity = 26 * flick * strength * Math.min(1, 0.4 + night);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.75 * flick;
    if (this.sparks.visible) {
      const pos = this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        for (let k = 0; k < 3; k++) p[i * 3 + k]! += this.sparkVel[i * 3 + k]! * dt;
        this.sparkVel[i * 3]! += Math.sin(this.time * 3 + i) * 0.3 * dt;
        if (p[i * 3 + 1]! > 3.2) this.resetSpark(i);
      }
      pos.needsUpdate = true;
    }
    for (const s of this.smoke) {
      const t = ((s.userData['t'] as number) + this.time * 0.12) % 1;
      s.position.set(Math.sin(t * 5) * 0.4 + t * 0.8, 1.2 + t * 4.5, Math.cos(t * 4) * 0.3);
      s.scale.setScalar(0.8 + t * 2.5);
      s.material.opacity = 0.22 * (1 - t);
    }
  }
}
