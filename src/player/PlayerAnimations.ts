import * as THREE from 'three';
import type { PlayerRig } from './PlayerModel';

/** One key pose of the Si Mee dance. Arm rotations: [x (forward/up), z (sideways)]. */
interface DancePose {
  name: string;
  la: [number, number];
  ra: [number, number];
  body: [number, number, number];
  y: number;
  bx: number;
  ll: number;
  rl: number;
  head: number;
  happy: boolean;
  spin?: boolean;
}

/**
 * Rakhine Si Mee (ဆီမီး) oil-lamp dance, following the reference pose sheet:
 * start → raise lamp → step right → step left → raise both hands → spin →
 * kneel & offer → graceful lean → final pose, then loop.
 */
const SI_MEE: DancePose[] = [
  { name: 'start', la: [1.15, -0.35], ra: [1.15, 0.35], body: [0, 0, 0], y: 0.92, bx: 0, ll: 0, rl: 0, head: 0, happy: false },
  { name: 'raise lamp', la: [0.95, -0.95], ra: [2.75, 0.45], body: [0, 0.25, 0.08], y: 0.92, bx: 0, ll: 0, rl: 0, head: -0.12, happy: true },
  { name: 'step right', la: [1.0, -1.35], ra: [1.0, 1.35], body: [-0.04, -0.3, -0.12], y: 0.9, bx: 0.14, ll: 0.15, rl: -0.25, head: 0.05, happy: false },
  { name: 'step left', la: [1.0, -1.35], ra: [1.0, 1.35], body: [-0.04, 0.3, 0.12], y: 0.9, bx: -0.14, ll: -0.25, rl: 0.15, head: 0.05, happy: false },
  { name: 'raise hands', la: [2.65, -0.6], ra: [2.65, 0.6], body: [0.06, 0, 0], y: 0.94, bx: 0, ll: 0, rl: 0, head: -0.2, happy: true },
  { name: 'spin', la: [0.45, -1.45], ra: [0.45, 1.45], body: [0, 0, 0], y: 0.92, bx: 0, ll: 0.1, rl: -0.1, head: 0, happy: true, spin: true },
  { name: 'kneel & offer', la: [1.55, -0.25], ra: [1.55, 0.25], body: [-0.25, 0, 0], y: 0.46, bx: 0, ll: 1.45, rl: -1.15, head: 0.22, happy: true },
  { name: 'graceful lean', la: [2.25, -1.0], ra: [0.9, 0.6], body: [0, -0.4, 0.2], y: 0.9, bx: 0.05, ll: 0.1, rl: -0.15, head: -0.08, happy: false },
  { name: 'final pose', la: [2.0, -1.2], ra: [1.2, 0.4], body: [0, 0.2, -0.05], y: 0.92, bx: 0, ll: 0, rl: 0.1, head: 0.1, happy: true },
];
const KYIN:DancePose[]=[
 {name:'ready',la:[.5,-.5],ra:[1.9,.5],body:[0,0,0],y:.92,bx:0,ll:0,rl:0,head:0,happy:false},
 {name:'step forward',la:[.8,-.7],ra:[2.6,.8],body:[-.1,.2,.06],y:.95,bx:.08,ll:-.45,rl:.3,head:0,happy:true},
 {name:'turn',la:[.7,-1],ra:[2.3,.7],body:[0,0,0],y:.92,bx:0,ll:.2,rl:-.2,head:-.1,happy:false,spin:true},
 {name:'low strike',la:[1,-.6],ra:[1.2,.5],body:[-.25,.2,.15],y:.62,bx:-.12,ll:1.1,rl:-.8,head:.1,happy:false},
 {name:'shield up',la:[1.6,-.9],ra:[2.5,.7],body:[0,-.25,0],y:.92,bx:0,ll:.2,rl:-.2,head:0,happy:false},
 {name:'high step',la:[.8,-.8],ra:[2.9,.5],body:[0,.2,-.1],y:1.08,bx:.05,ll:-.9,rl:.2,head:-.1,happy:true},
 {name:'final pose',la:[.7,-.7],ra:[2.4,.6],body:[0,0,0],y:.92,bx:0,ll:0,rl:0,head:0,happy:true},
];
const POSE_SECONDS = 2.2;
const HAND = new THREE.Vector3(0, -0.66, 0);
const tmpV = new THREE.Vector3();

export type AnimState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'swim' | 'tread';

/**
 * Procedural animation for the primitive rig: idle breathing, walk and run
 * cycles (stride rate follows actual ground speed), and an airborne pose.
 * Emits a footstep callback at each foot plant.
 */
export class PlayerAnimations {
  private phase = 0;
  private blend = 0; // 0 = idle pose, 1 = full locomotion
  private air = 0;
  private time = 0;
  private lastSign = 1;
  state: AnimState = 'idle';
  onFootstep: ((running: boolean) => void) | null = null;

  constructor(private readonly rig: PlayerRig) {}

  private blinkTimer = 3;
  private danceT = 0;
  dancing = false;
  /** Called with the current pose name when the dance moves to a new pose. */
  onDancePose: ((name: string) => void) | null = null;
  private lastPose = -1;

  startDance(): void {
    this.dancing = true;
    this.danceT = 0;
    this.lastPose = -1;
    for (const l of [...this.rig.lamps??[],...this.rig.danceProps??[]]) l.visible = true;
  }

  stopDance(): void {
    if (!this.dancing) return;
    this.dancing = false;
    for (const l of [...this.rig.lamps??[],...this.rig.danceProps??[]]) l.visible = false;
    const r = this.rig;
    r.body.position.x = 0;
    r.body.rotation.set(0, 0, 0);
    r.leftArm.rotation.set(0, 0, 0);
    r.rightArm.rotation.set(0, 0, 0);
    r.head.rotation.set(0, 0, 0);
    r.expression?.('neutral');
  }

  private dance(dt: number): void {
    this.danceT += dt;
    const poses=this.rig.danceProps?.length?KYIN:SI_MEE;
    const n = poses.length;
    const total = n * POSE_SECONDS;
    const t = this.danceT % total;
    const i = Math.floor(t / POSE_SECONDS);
    const local = (t - i * POSE_SECONDS) / POSE_SECONDS; // 0..1 within this pose
    const prev = poses[(i + n - 1) % n]!;
    const cur = poses[i]!;
    if (i !== this.lastPose) {
      this.lastPose = i;
      this.rig.expression?.(cur.happy ? 'happy' : 'neutral');
      this.onDancePose?.(cur.name);
    }
    // Ease into the pose over the first 45% of the segment, then hold with a gentle sway.
    const k = Math.min(1, local / 0.45);
    const e = k * k * (3 - 2 * k);
    const mix = (a: number, b: number) => a + (b - a) * e;
    const sway = Math.sin(this.danceT * 2.4) * 0.05;
    const r = this.rig;
    r.leftArm.rotation.set(mix(prev.la[0], cur.la[0]) + sway, 0, mix(prev.la[1], cur.la[1]));
    r.rightArm.rotation.set(mix(prev.ra[0], cur.ra[0]) - sway, 0, mix(prev.ra[1], cur.ra[1]));
    r.leftLeg.rotation.x = mix(prev.ll, cur.ll);
    r.rightLeg.rotation.x = mix(prev.rl, cur.rl);
    const spin = cur.spin ? local * Math.PI * 2 : 0;
    r.body.rotation.set(mix(prev.body[0], cur.body[0]), mix(prev.body[1], cur.body[1]) + spin + sway * 0.6, mix(prev.body[2], cur.body[2]));
    r.body.position.set(mix(prev.bx, cur.bx), mix(prev.y, cur.y) + Math.abs(Math.sin(this.danceT * 2.4)) * 0.02, 0);
    r.head.rotation.set(mix(prev.head, cur.head), 0, sway * 0.8);
    // Keep the lamps in the hands and upright, with flickering flames.
    if (r.lamps) {
      r.root.updateMatrixWorld(true);
      [r.leftArm, r.rightArm].forEach((arm, j) => {
        const lamp = r.lamps![j]!;
        arm.localToWorld(tmpV.copy(HAND));
        r.root.worldToLocal(tmpV);
        lamp.position.copy(tmpV);
        const flame = lamp.getObjectByName('flame');
        const glow = lamp.getObjectByName('glow');
        const f = 0.85 + Math.random() * 0.3;
        if (flame) flame.scale.set(1, f, 1);
        if (glow) glow.scale.setScalar(0.6 + f * 0.15);
      });
    }
  }

  update(dt: number, groundSpeed: number, grounded: boolean, verticalVel: number, swim = 0): void {
    this.time += dt;
    if (this.dancing) {
      this.dance(dt);
      return;
    }
    // Occasional blink (pixel-face characters).
    this.blinkTimer -= dt;
    if (this.rig.blink) {
      if (this.blinkTimer <= 0) {
        this.rig.blink(true);
        if (this.blinkTimer < -0.13) {
          this.rig.blink(false);
          this.blinkTimer = 2.5 + Math.random() * 3.5;
        }
      }
    }
    if (swim > 0.02) {
      this.swim(dt, groundSpeed, swim);
      if (swim > 0.98) return;
    }
    const running = groundSpeed > 4.2;
    this.state = !grounded ? (verticalVel > 0 ? 'jump' : 'fall') : groundSpeed < 0.25 ? 'idle' : running ? 'run' : 'walk';

    const targetBlend = grounded ? Math.min(1, groundSpeed / 2.4) : 0.3;
    this.blend += (targetBlend - this.blend) * Math.min(1, dt * 10);
    this.air += ((grounded ? 0 : 1) - this.air) * Math.min(1, dt * 12);

    // Stride frequency (cycles per meter) shortens slightly when running.
    const strideLen = running ? 2.1 : 1.35;
    this.phase += (groundSpeed / strideLen) * Math.PI * 2 * dt;
    const s = Math.sin(this.phase);
    const sign = s >= 0 ? 1 : -1;
    if (grounded && groundSpeed > 0.5 && sign !== this.lastSign) this.onFootstep?.(running);
    this.lastSign = sign;

    const legAmp = (running ? 0.85 : 0.5) * this.blend * (this.rig.legAmp ?? 1);
    const armAmp = (running ? 1.0 : 0.45) * this.blend;
    const r = this.rig;
    // Airborne pose: knees up, arms raised.
    r.leftLeg.rotation.z = r.rightLeg.rotation.z = 0; // riding splays the legs
    r.body.position.z = 0;
    r.leftLeg.rotation.x = s * legAmp * (1 - this.air) + this.air * -0.5;
    r.rightLeg.rotation.x = -s * legAmp * (1 - this.air) + this.air * 0.2;
    r.leftArm.rotation.x = -s * armAmp * (1 - this.air) + this.air * -1.2;
    r.rightArm.rotation.x = s * armAmp * (1 - this.air) + this.air * -1.2;
    r.leftArm.rotation.z = -0.08 - this.air * 0.3;
    r.rightArm.rotation.z = 0.08 + this.air * 0.3;

    const breathe = Math.sin(this.time * 2.2) * 0.012 * (1 - this.blend);
    const bob = Math.abs(Math.cos(this.phase)) * (running ? 0.07 : 0.035) * this.blend;
    r.body.position.y = 0.92 + bob + breathe;
    r.body.rotation.x = (running ? -0.18 : -0.04) * this.blend;
    r.head.rotation.y = Math.sin(this.time * 0.4) * 0.15 * (1 - this.blend);
    r.head.rotation.x = 0;
  }

  private swimPhase = 0;
  private lastStroke = 1;

  /** Front crawl when moving, treading water when still. `w` blends from walking (0) to swimming (1). */
  private swim(dt: number, speed: number, w: number): void {
    const moving = speed > 0.3;
    this.state = moving ? 'swim' : 'tread';
    this.swimPhase += dt * (moving ? 2.2 + speed * 0.9 : 1.6) * Math.PI;
    const p = this.swimPhase;
    const r = this.rig;
    const lerp = (a: number, b: number) => a + (b - a) * w;
    if (moving) {
      // Body nearly horizontal, head lifted, alternating overarm strokes, flutter kick.
      r.body.rotation.x = lerp(r.body.rotation.x, -1.25);
      r.head.rotation.x = lerp(0, 1.0);
      r.leftArm.rotation.x = lerp(r.leftArm.rotation.x, -(p % (Math.PI * 2)));
      r.rightArm.rotation.x = lerp(r.rightArm.rotation.x, -((p + Math.PI) % (Math.PI * 2)));
      r.leftLeg.rotation.x = lerp(r.leftLeg.rotation.x, Math.sin(p * 3) * 0.35);
      r.rightLeg.rotation.x = lerp(r.rightLeg.rotation.x, -Math.sin(p * 3) * 0.35);
      r.leftArm.rotation.z = lerp(r.leftArm.rotation.z, -0.15);
      r.rightArm.rotation.z = lerp(r.rightArm.rotation.z, 0.15);
    } else {
      // Treading water: upright, slow sculling arms.
      r.body.rotation.x = lerp(r.body.rotation.x, -0.15);
      r.head.rotation.x = lerp(0, 0.1);
      r.leftArm.rotation.x = lerp(r.leftArm.rotation.x, -0.6 + Math.sin(p) * 0.4);
      r.rightArm.rotation.x = lerp(r.rightArm.rotation.x, -0.6 - Math.sin(p) * 0.4);
      r.leftArm.rotation.z = lerp(r.leftArm.rotation.z, -0.9 + Math.sin(p) * 0.3);
      r.rightArm.rotation.z = lerp(r.rightArm.rotation.z, 0.9 - Math.sin(p) * 0.3);
      r.leftLeg.rotation.x = lerp(r.leftLeg.rotation.x, Math.sin(p * 1.3) * 0.3);
      r.rightLeg.rotation.x = lerp(r.rightLeg.rotation.x, -Math.sin(p * 1.3) * 0.3);
    }
    r.body.position.y = 0.92 + Math.sin(this.time * 2.4) * 0.04 * w;
    const stroke = Math.sin(p) >= 0 ? 1 : -1;
    if (moving && stroke !== this.lastStroke && w > 0.9) this.onStroke?.();
    this.lastStroke = stroke;
  }

  onStroke: (() => void) | null = null;
}
