import * as THREE from 'three';
import type { PagodaSite } from './landmarks/LawkanandarPagoda';
import { PLATFORM_Y } from '../geo/pagodaLayout';
import type { FxKind } from '../systems/Missions';

/**
 * Thadingyut (Festival of Lights) visuals and mission effects. Everything is
 * unlit, additive geometry: no scene lights are added, so it is cheap.
 *  - Floating sky lanterns drifting up around the player at night.
 *  - Rows of oil lamps around pagoda platforms at night.
 *  - Fireworks over Sittwe Point at night.
 *  - One-off effects from missions: released lanterns, lamps lit, cheers, etc.
 */

const AMBIENT_LANTERNS = 70;
const MAX_LAMPS = 1600;

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,220,1)');
  grad.addColorStop(0.25, 'rgba(255,200,110,0.85)');
  grad.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function emojiTexture(emoji: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.font = '96px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Lantern { x: number; y: number; z: number; vy: number; phase: number; life: number }
interface Burst { points: THREE.Points; vel: Float32Array; age: number }
interface Floater { sprite: THREE.Sprite; age: number; life: number }

export class FestivalFx {
  private readonly glow = glowTexture();
  private readonly lanternMesh: THREE.InstancedMesh;
  private readonly lanternGlow: THREE.InstancedMesh;
  private readonly lanterns: Lantern[] = [];
  /** Lanterns released by players (rise from their spot, then drift). */
  private readonly released: Lantern[] = [];
  private readonly lampMesh: THREE.InstancedMesh;
  private lampCount = 0;
  private lampSites = new Set<string>();
  /** Sites where players lit lamps this visit: shown every night, festival or not. */
  readonly litSites = new Set<string>();
  private readonly bursts: Burst[] = [];
  private readonly floaters: Floater[] = [];
  private nextFirework = 2;
  private time = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene, private readonly fireworksAt: { x: number; z: number } | null) {
    // Paper sky lantern: an open cylinder with a warm inner glow.
    const paper = new THREE.MeshBasicMaterial({ color: 0xffa34a, transparent: true, opacity: 0.92, side: THREE.DoubleSide, fog: false });
    this.lanternMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.32, 0.9, 10, 1, true), paper, AMBIENT_LANTERNS + 40);
    const glowPlane = new THREE.MeshBasicMaterial({ map: this.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.lanternGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 2.4), glowPlane, AMBIENT_LANTERNS + 40);
    const lampMat = new THREE.MeshBasicMaterial({ map: this.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0xffd38a });
    this.lampMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.55, 0.75), lampMat, MAX_LAMPS);
    for (const mesh of [this.lanternMesh, this.lanternGlow, this.lampMesh]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
    }
  }

  /** Mission effect for everyone (from the shared mission event). */
  play(fx: FxKind, x: number, z: number, nearSite?: PagodaSite): void {
    if (fx === 'lanterns') {
      for (let i = 0; i < 3; i++) this.released.push({ x: x + (Math.random() - 0.5) * 3, y: 2, z: z + (Math.random() - 0.5) * 3, vy: 0.9 + Math.random() * 0.4, phase: Math.random() * 6, life: 0 });
    } else if (fx === 'fireworks') {
      for (let i = 0; i < 8; i++) setTimeout(() => this.firework(x + (Math.random() - 0.5) * 60, z - 60 + (Math.random() - 0.5) * 60), i * 450);
    } else if (fx === 'lamps') {
      if (nearSite) { this.litSites.add(nearSite.id); this.lampSites.delete(nearSite.id); }
    }
    const emoji = ({ cheers: '🍻', feast: '🦐', gadaw: '🙏', lamps: '🪔', lanterns: '🏮', fireworks: '🎆', campfire: '🔥', dance: '💃', pickup: '✨', tag: '🏃', sit: '🪵' } as Record<FxKind, string>)[fx];
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthWrite: false }));
    sprite.position.set(x, 3, z);
    sprite.scale.setScalar(1.6);
    this.scene.add(sprite);
    this.floaters.push({ sprite, age: 0, life: 3 });
  }

  private firework(x: number, z: number): void {
    const n = 90;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const y = 45 + Math.random() * 25;
    for (let i = 0; i < n; i++) {
      pos.set([x, y, z], i * 3);
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = 9 + Math.random() * 4;
      vel.set([r * Math.cos(a) * sp, u * sp, r * Math.sin(a) * sp], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const colors = [0xffd25a, 0xff5a6e, 0x6ad7ff, 0x9dff7a, 0xffffff];
    const mat = new THREE.PointsMaterial({ color: colors[Math.floor(Math.random() * colors.length)]!, size: 1.4, map: this.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const points = new THREE.Points(g, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, vel, age: 0 });
  }

  /** Lamps along the visitors' path, the platform edge and the stairs of a pagoda. */
  private addLamps(site: PagodaSite, dense: boolean): void {
    const L = site.layout;
    const put = (x: number, z: number, y: number) => {
      if (this.lampCount >= MAX_LAMPS) return;
      this.m.compose(this.v.set(x, y + 0.3, z), this.q.identity(), this.s.set(1, 1, 1));
      this.lampMesh.setMatrixAt(this.lampCount++, this.m);
    };
    const step = dense ? 1.2 : 2.6;
    // Around the circumambulation path.
    const c = L.circuit;
    for (let i = 0; i < c.length; i++) {
      const a = c[i]!, b = c[(i + 1) % c.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t < len; t += step) put(a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len, PLATFORM_Y);
    }
    // Along the platform edge, just inside the balustrade.
    const r = L.ring;
    const [cx, cz] = L.centre;
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!, b = r[(i + 1) % r.length]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t < len; t += step * 1.5) {
        const x = a[0] + ((b[0] - a[0]) * t) / len, z = a[1] + ((b[1] - a[1]) * t) / len;
        const k = 1.2 / Math.max(1, Math.hypot(x - cx, z - cz));
        put(x + (cx - x) * k, z + (cz - z) * k, PLATFORM_Y);
      }
    }
    // Both sides of each staircase.
    for (const e of L.entrances) for (const side of [-1, 1]) for (let t = 0; t <= 1; t += 0.25) {
      const x = e.edge[0] + (e.bottom[0] - e.edge[0]) * t + e.along[0] * side * (L.stairWidth / 2 + 0.4);
      const z = e.edge[1] + (e.bottom[1] - e.edge[1]) * t + e.along[1] * side * (L.stairWidth / 2 + 0.4);
      put(x, z, PLATFORM_Y * (1 - t));
    }
  }

  update(dt: number, o: { night: number; festival: boolean; px: number; pz: number; sites: PagodaSite[]; camera: THREE.Camera }): void {
    this.time += dt;
    const dark = o.night > 0.35;
    const festive = o.festival && dark;

    // Ambient sky lanterns around the player.
    if (festive) {
      while (this.lanterns.length < AMBIENT_LANTERNS) {
        const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 320;
        this.lanterns.push({ x: o.px + Math.cos(a) * d, y: Math.random() * 120, z: o.pz + Math.sin(a) * d, vy: 0.5 + Math.random() * 0.7, phase: Math.random() * 6, life: 0 });
      }
    } else this.lanterns.length = 0;
    const all = [...this.lanterns, ...this.released];
    let i = 0;
    const camQ = o.camera.quaternion;
    for (const l of all) {
      l.y += l.vy * dt;
      l.life += dt;
      l.x += Math.sin(this.time * 0.3 + l.phase) * 0.4 * dt + 0.6 * dt; // gentle sea breeze
      if (i >= this.lanternMesh.instanceMatrix.count) break;
      this.m.compose(this.v.set(l.x, l.y, l.z), this.q.identity(), this.s.set(1, 1, 1));
      this.lanternMesh.setMatrixAt(i, this.m);
      this.m.compose(this.v.set(l.x, l.y, l.z), camQ, this.s.set(1, 1, 1));
      this.lanternGlow.setMatrixAt(i, this.m);
      i++;
    }
    // Recycle ambient lanterns that drifted too high or too far; drop released ones after a while.
    for (const l of this.lanterns) if (l.y > 170 || Math.hypot(l.x - o.px, l.z - o.pz) > 450) {
      const a = Math.random() * Math.PI * 2, d = 60 + Math.random() * 320;
      Object.assign(l, { x: o.px + Math.cos(a) * d, z: o.pz + Math.sin(a) * d, y: 0, life: 0 });
    }
    for (let k = this.released.length - 1; k >= 0; k--) if (this.released[k]!.y > 220) this.released.splice(k, 1);
    this.lanternMesh.count = this.lanternGlow.count = i;
    this.lanternMesh.visible = this.lanternGlow.visible = i > 0;
    this.lanternMesh.instanceMatrix.needsUpdate = this.lanternGlow.instanceMatrix.needsUpdate = true;

    // Oil lamps at nearby pagodas (festival nights, or where players lit them).
    if (dark) {
      const want = o.sites.filter((s) => (o.festival || this.litSites.has(s.id)) && Math.hypot(s.layout.centre[0] - o.px, s.layout.centre[1] - o.pz) < 600);
      const key = want.map((s) => s.id + (this.litSites.has(s.id) ? '*' : '')).join('|');
      if (key !== [...this.lampSites].join('|')) {
        this.lampCount = 0;
        for (const s of want) this.addLamps(s, this.litSites.has(s.id));
        this.lampSites = new Set(key ? key.split('|') : []);
        this.lampMesh.count = this.lampCount;
        this.lampMesh.instanceMatrix.needsUpdate = true;
      }
      this.lampMesh.visible = this.lampCount > 0;
      // Lamp flames face the camera and flicker together (cheap).
      if (this.lampMesh.visible) {
        (this.lampMesh.material as THREE.MeshBasicMaterial).opacity = 0.85 + Math.sin(this.time * 9) * 0.08 + Math.sin(this.time * 23) * 0.05;
        for (let k = 0; k < this.lampCount; k++) {
          this.lampMesh.getMatrixAt(k, this.m);
          this.v.setFromMatrixPosition(this.m);
          this.m.compose(this.v, camQ, this.s.set(1, 1, 1));
          this.lampMesh.setMatrixAt(k, this.m);
        }
        this.lampMesh.instanceMatrix.needsUpdate = true;
      }
    } else {
      this.lampMesh.visible = false;
      this.lampSites.clear();
    }

    // Fireworks over Sittwe Point on festival nights, when the player is within view.
    if (festive && this.fireworksAt && Math.hypot(this.fireworksAt.x - o.px, this.fireworksAt.z - o.pz) < 2500) {
      this.nextFirework -= dt;
      if (this.nextFirework <= 0) {
        this.nextFirework = 2.5 + Math.random() * 4;
        this.firework(this.fireworksAt.x + (Math.random() - 0.5) * 120, this.fireworksAt.z + 80 + Math.random() * 120);
      }
    }
    for (let k = this.bursts.length - 1; k >= 0; k--) {
      const b = this.bursts[k]!;
      b.age += dt;
      const pos = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < pos.count; j++) {
        b.vel[j * 3 + 1]! -= 6 * dt;
        for (let a = 0; a < 3; a++) { b.vel[j * 3 + a]! *= 1 - 0.9 * dt; pos.array[j * 3 + a]! += b.vel[j * 3 + a]! * dt; }
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - b.age / 2.6);
      if (b.age > 2.6) { b.points.removeFromParent(); b.points.geometry.dispose(); (b.points.material as THREE.Material).dispose(); this.bursts.splice(k, 1); }
    }
    for (let k = this.floaters.length - 1; k >= 0; k--) {
      const f = this.floaters[k]!;
      f.age += dt;
      f.sprite.position.y += dt * 0.8;
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, (f.life - f.age) * 2);
      if (f.age > f.life) { f.sprite.removeFromParent(); (f.sprite.material as THREE.SpriteMaterial).map?.dispose(); f.sprite.material.dispose(); this.floaters.splice(k, 1); }
    }
  }
}
