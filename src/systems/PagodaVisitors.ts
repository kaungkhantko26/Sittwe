import * as THREE from 'three';
import { PLATFORM_Y } from '../geo/pagodaLayout';
import { kneelPose, resetPose } from '../player/Clothes';
import { disposeCharacter } from '../player/CharacterModels';
import { createNpc } from '../player/NpcModels';
import { NPC_PROFILES } from '../player/NpcProfiles';
import { PlayerAnimations } from '../player/PlayerAnimations';
import type { PlayerRig } from '../player/PlayerModel';
import type { PagodaSite } from '../world/landmarks/LawkanandarPagoda';

/**
 * Visitors at pagoda complexes. They walk the clockwise circumambulation
 * path around the stupa (stupa on their right), pause at prayer spots to
 * kneel facing the stupa with palms together, and some sit at the hall's
 * meditation mats. Visitors only exist while the player is within 220 m,
 * keep their distance from each other and from the player, and never stand
 * on the main staircase.
 */

const ROLES = ['Monk', 'Rakhine woman', 'Rakhine resident', 'Elder', 'Elderly woman', 'Tourist', 'Schoolgirl', 'Child'];
const roleIndex = (name: string) => Math.max(0, NPC_PROFILES.findIndex((p) => p.name === name));

interface Visitor {
  rig: PlayerRig;
  anim: PlayerAnimations;
  site: PagodaSite;
  mode: 'walk' | 'pray' | 'sit';
  /** Position along the circuit (segments, fractional). */
  s: number;
  speed: number;
  wait: number;
  matIndex: number;
  age: number;
}

export class PagodaVisitors {
  private visitors: Visitor[] = [];
  maxPerSite = 8;

  constructor(private readonly scene: THREE.Scene) {}

  private circuitPoint(site: PagodaSite, s: number): { x: number; z: number; dx: number; dz: number } {
    const c = site.layout.circuit;
    const n = c.length;
    const i = Math.floor(((s % n) + n) % n);
    const t = s - Math.floor(s);
    const a = c[i]!;
    const b = c[(i + 1) % n]!;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: b[0] - a[0], dz: b[1] - a[1] };
  }

  update(dt: number, sites: PagodaSite[], px: number, pz: number, hour: number): void {
    // Despawn visitors of sites that are gone or far away.
    for (let i = this.visitors.length - 1; i >= 0; i--) {
      const v = this.visitors[i]!;
      const [cx, cz] = v.site.layout.centre;
      if (!sites.includes(v.site) || Math.hypot(cx - px, cz - pz) > 240) this.remove(i);
    }
    const night = hour < 5.5 || hour > 21;
    for (const site of sites) {
      const [cx, cz] = site.layout.centre;
      if (Math.hypot(cx - px, cz - pz) > 220) continue;
      const mine = this.visitors.filter((v) => v.site === site);
      const want = night ? Math.min(3, this.maxPerSite) : this.maxPerSite;
      if (mine.length < want) this.spawn(site, mine);
    }
    for (const v of this.visitors) this.step(v, dt, px, pz);
  }

  private spawn(site: PagodaSite, existing: Visitor[]): void {
    const n = site.layout.circuit.length;
    const k = existing.length;
    const role = roleIndex(ROLES[k % ROLES.length]!);
    const rig = createNpc(role, NPC_PROFILES[role]!.name, 700 + k);
    const usedMats = new Set(existing.filter((v) => v.mode === 'sit').map((v) => v.matIndex));
    const freeMat = site.layout.mats.findIndex((_, i) => !usedMats.has(i));
    const sit = k % 4 === 3 && freeMat >= 0;
    const v: Visitor = { rig, anim: new PlayerAnimations(rig), site, mode: sit ? 'sit' : 'walk', s: (k * n) / Math.max(1, this.maxPerSite) + Math.random(), speed: 0.75 + Math.random() * 0.3, wait: 0, matIndex: sit ? freeMat : -1, age: Math.random() * 10 };
    if (sit) {
      const [x, z, yaw] = site.layout.mats[freeMat]!;
      rig.root.position.set(x, PLATFORM_Y, z);
      rig.root.rotation.y = yaw;
    } else {
      const p = this.circuitPoint(site, v.s);
      rig.root.position.set(p.x, PLATFORM_Y, p.z);
    }
    rig.nameTag.visible = false;
    this.scene.add(rig.root);
    this.visitors.push(v);
  }

  private step(v: Visitor, dt: number, px: number, pz: number): void {
    v.age += dt;
    const r = v.rig;
    const L = v.site.layout;
    if (v.mode === 'sit') {
      v.anim.update(dt, 0, true, 0);
      kneelPose(r, v.age);
      return;
    }
    if (v.mode === 'pray') {
      v.wait -= dt;
      v.anim.update(dt, 0, true, 0);
      kneelPose(r, v.age);
      if (v.wait <= 0) {
        v.mode = 'walk';
        resetPose(r);
      }
      return;
    }
    // Walking clockwise along the circuit; yield to others and the player.
    const ahead = this.circuitPoint(v.site, v.s + 0.25);
    const blocked =
      Math.hypot(ahead.x - px, ahead.z - pz) < 1.3 ||
      this.visitors.some((o) => o !== v && o.site === v.site && o.mode === 'walk' && Math.hypot(o.rig.root.position.x - ahead.x, o.rig.root.position.z - ahead.z) < 1.2 && o.s > v.s);
    const n = L.circuit.length;
    const segLen = Math.hypot(L.circuit[1]![0] - L.circuit[0]![0], L.circuit[1]![1] - L.circuit[0]![1]) || 1;
    const speed = blocked ? 0 : v.speed;
    const before = Math.floor(v.s);
    v.s = (v.s + (speed * dt) / segLen) % n;
    const p = this.circuitPoint(v.site, v.s);
    r.root.position.set(p.x, PLATFORM_Y, p.z);
    r.root.rotation.y = Math.atan2(-p.dx, -p.dz);
    v.anim.update(dt, speed, true, 0);
    // Pause to pray at the prayer spots (roughly every quarter of the loop).
    if (Math.floor(v.s) !== before && Math.floor(v.s) % 6 === 3 && Math.random() < 0.5) {
      const spot = L.prayerSpots[Math.floor(v.s / 6) % L.prayerSpots.length]!;
      r.root.rotation.y = spot[2];
      v.mode = 'pray';
      v.wait = 5 + Math.random() * 5;
    }
  }

  private remove(i: number): void {
    const v = this.visitors[i]!;
    this.scene.remove(v.rig.root);
    disposeCharacter(v.rig);
    this.visitors.splice(i, 1);
  }

  get count(): number {
    return this.visitors.length;
  }

  dispose(): void {
    for (let i = this.visitors.length - 1; i >= 0; i--) this.remove(i);
  }
}

export { kneelPose } from '../player/Clothes';
