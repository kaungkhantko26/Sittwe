import * as THREE from 'three';
import { missionById, type MissionState } from '../systems/Missions';

/**
 * What mini-games look like in the world: glowing driftwood or shells to pick
 * up, a red "IT" marker over whoever is IT in tag, and the seeker's
 * blindfold while everyone hides.
 */
export class MissionVisuals {
  private readonly wood: THREE.InstancedMesh;
  private readonly shell: THREE.InstancedMesh;
  private readonly ring: THREE.InstancedMesh;
  private readonly itMarker = new THREE.Group();
  private readonly blindfold: HTMLElement;
  /** Checkpoint race: a light beam over your next checkpoint and the big countdown. */
  private readonly beam: THREE.Mesh;
  private readonly countdown: HTMLElement;
  private goUntil = 0;
  private lastCount: number | null = null;
  private time = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(scene: THREE.Scene, hudRoot: HTMLElement) {
    const max = 30;
    this.wood = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 1.2, 6).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8b6f52, roughness: 0.9, emissive: 0x3a2410, emissiveIntensity: 0.4 }), max);
    this.shell = new THREE.InstancedMesh(new THREE.ConeGeometry(0.22, 0.4, 7).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf6d6c4, roughness: 0.4, emissive: 0x6a3a30, emissiveIntensity: 0.35 }), max);
    this.ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.75, 0.95, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.7, depthWrite: false }), max);
    for (const mesh of [this.wood, this.shell, this.ring]) { mesh.count = 0; mesh.frustumCulled = false; scene.add(mesh); }
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 12).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xff3048 }));
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff3048'; g.beginPath(); g.roundRect(8, 6, 112, 52, 14); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('IT', 64, 34);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    label.scale.set(1.1, 0.55, 1);
    label.position.y = 0.75;
    this.itMarker.add(cone, label);
    this.itMarker.visible = false;
    scene.add(this.itMarker);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 60, 24, 1, true).translate(0, 30, 0), beamMat);
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    scene.add(this.beam);
    this.countdown = document.createElement('div');
    this.countdown.className = 'race-countdown hidden';
    hudRoot.appendChild(this.countdown);
    this.blindfold = document.createElement('div');
    this.blindfold.className = 'seek-blindfold hidden';
    hudRoot.appendChild(this.blindfold);
  }

  /** `where` gives a player's position (you or a friend). */
  update(dt: number, st: MissionState, selfId: string, where: (id: string) => THREE.Vector3 | null): void {
    this.time += dt;
    const step = st.id && !st.done ? missionById(st.id)?.steps[st.step] : undefined;
    // Pickups.
    let w = 0, sh = 0, r = 0;
    if (step?.collect) {
      const mesh = step.collect.item === 'shell' ? this.shell : this.wood;
      for (let i = 0; i < st.pickups.length; i += 3) {
        if (st.pickups[i + 2]! >= 0) continue;
        const x = st.pickups[i]!, z = st.pickups[i + 1]!;
        this.e.set(0, this.time * 1.5 + i, 0);
        this.m.compose(this.v.set(x, 0.35 + Math.sin(this.time * 2.5 + i) * 0.12, z), this.q.setFromEuler(this.e), this.s.set(1, 1, 1));
        mesh.setMatrixAt(mesh === this.shell ? sh++ : w++, this.m);
        const k = 1 + 0.2 * Math.sin(this.time * 3 + i);
        this.m.compose(this.v.set(x, 0.06, z), this.q.identity(), this.s.set(k, 1, k));
        this.ring.setMatrixAt(r++, this.m);
      }
    }
    this.wood.count = w; this.shell.count = sh; this.ring.count = r;
    for (const mesh of [this.wood, this.shell, this.ring]) mesh.instanceMatrix.needsUpdate = true;
    // IT marker.
    const itPos = step?.tag && st.it ? where(st.it) : null;
    this.itMarker.visible = !!itPos;
    if (itPos) this.itMarker.position.set(itPos.x, itPos.y + 2.9 + Math.sin(this.time * 4) * 0.08, itPos.z);
    // Seeker's blindfold while the others hide.
    const blind = !!step?.hide && st.seeker === selfId && st.phase === 'hide';
    this.blindfold.classList.toggle('hidden', !blind);
    if (blind && st.endsAt) this.blindfold.textContent = `🙈 Counting… ${Math.max(0, Math.ceil((st.endsAt - Date.now()) / 1000))}`;
  }

  /** Race overlay: beam on your next checkpoint, 3-2-1-GO in the middle of the screen. */
  race(info: { next: { x: number; z: number } | null; countdown: number | null; finished: boolean } | null, groundY = 0): void {
    this.beam.visible = !!info?.next && !info.finished;
    if (info?.next) {
      this.beam.position.set(info.next.x, groundY, info.next.z);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 + 0.1 * Math.sin(this.time * 4);
    }
    const now = performance.now();
    if (info?.countdown != null) {
      this.countdown.textContent = String(info.countdown);
    } else if (this.lastCount != null && info) {
      this.countdown.textContent = 'GO!';
      this.goUntil = now + 1200;
    }
    this.lastCount = info?.countdown ?? null;
    const show = info?.countdown != null || now < this.goUntil;
    this.countdown.classList.toggle('hidden', !show);
  }

  /** While you are the seeker, friends' name tags and map dots must not give them away. */
  static hidingFrom(st: MissionState, selfId: string): boolean {
    const step = st.id && !st.done ? missionById(st.id)?.steps[st.step] : undefined;
    return !!step?.hide && st.seeker === selfId;
  }
}
