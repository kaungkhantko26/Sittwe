import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Groups } from '../physics/CollisionLayers';
import { GROUND_Y, type PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerAnimations } from './PlayerAnimations';
import { createCharacter, disposeCharacter, type CharacterKind } from './CharacterModels';
import { setNameTagText, type PlayerRig } from './PlayerModel';

const RADIUS = 0.32;
const HALF_HEIGHT = 0.53; // capsule total height = 2*(0.53+0.32) = 1.7 m
const CENTER_OFFSET = HALF_HEIGHT + RADIUS;
const WALK_SPEED = 2.8;
const SPRINT_SPEED = 6.6;
const ACCEL = 14;
const GRAVITY = 22;
const JUMP_SPEED = 7;
const SWIM_SPEED = 1.7;
const SWIM_SPRINT_SPEED = 3.0;
/** How far the model sinks when swimming so only head and shoulders show above the surface. */
export const SWIM_SINK = 1.02;

export interface PlayerInput {
  /** Desired horizontal direction in world space (length 0..1). */
  moveX: number;
  moveZ: number;
  sprint: boolean;
  jump: boolean;
}

/**
 * Third-person character using Rapier's KinematicCharacterController:
 * capsule collider, gravity, jumping, auto-step over small obstacles (curbs),
 * snap-to-ground, sliding along walls, and collision with buildings,
 * vehicles, trees and poles. Deep water is blocked via a world query.
 */
export class PlayerController {
  rig: PlayerRig;
  anim: PlayerAnimations;
  character: CharacterKind;
  private readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly kcc: RAPIER.KinematicCharacterController;
  private readonly prev = new THREE.Vector3();
  private readonly curr = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private grounded = true;
  private idleSupportFrames=0;
  /** Facing yaw (radians, 0 = -Z/north). */
  yaw = 0;
  private targetYaw = 0;
  private active = true;
  /** Optional predicate: returns true if (x, z) must not be entered. */
  blocked: ((x: number, z: number) => boolean) | null = null;
  /** Optional predicate: returns true if (x, z) is swimmable water. */
  water: ((x: number, z: number) => boolean) | null = null;
  groundSpeed = 0;
  /** True while in water. */
  swimming = false;
  private swimBlend = 0;
  onSwimChange: ((swimming: boolean) => void) | null = null;

  constructor(
    private readonly physics: PhysicsWorld,
    name: string,
    x: number,
    z: number,
    character: CharacterKind = 'boy',
  ) {
    const R = physics.R;
    const y = GROUND_Y + CENTER_OFFSET + 0.02;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(HALF_HEIGHT, RADIUS).setCollisionGroups(Groups.player).setFriction(0), this.body);
    this.kcc = physics.world.createCharacterController(0.02);
    this.kcc.enableAutostep(0.4, 0.15, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(75);
    this.character = character;
    this.rig = createCharacter(character, name);
    this.anim = new PlayerAnimations(this.rig);
    this.curr.set(x, y, z);
    this.prev.copy(this.curr);
  }

  get position(): THREE.Vector3 {
    return this.curr;
  }

  /** Feet position (render-interpolated). */
  readonly renderPos = new THREE.Vector3();

  get isGrounded(): boolean {
    return this.grounded;
  }

  get isActive(): boolean {
    return this.active;
  }

  setName(name: string): void {
    setNameTagText(this.rig, name);
  }

  /** Swaps the visible character model (boy / girl), keeping state and callbacks. */
  setCharacter(kind: CharacterKind, name: string): void {
    if (kind === this.character) return;
    const old = this.rig;
    const parent = old.root.parent;
    const footstep = this.anim.onFootstep;
    const stroke = this.anim.onStroke;
    this.rig = createCharacter(kind, name);
    this.rig.root.visible = old.root.visible;
    this.rig.root.position.copy(old.root.position);
    this.rig.root.rotation.copy(old.root.rotation);
    parent?.remove(old.root);
    parent?.add(this.rig.root);
    disposeCharacter(old);
    this.anim = new PlayerAnimations(this.rig);
    this.anim.onFootstep = footstep;
    this.anim.onStroke = stroke;
    this.character = kind;
  }

  fixedUpdate(dt: number, input: PlayerInput): void {
    if (!this.active) return;
    this.prev.copy(this.curr);
    const t0 = this.body.translation();
    const inWater = !!this.water && this.water(t0.x, t0.z);
    if (inWater !== this.swimming) {
      this.swimming = inWater;
      this.onSwimChange?.(inWater);
    }
    const speed = this.swimming ? (input.sprint ? SWIM_SPRINT_SPEED : SWIM_SPEED) : input.sprint ? SPRINT_SPEED : WALK_SPEED;
    const len = Math.hypot(input.moveX, input.moveZ);
    const tx = len > 0 ? (input.moveX / Math.max(1, len)) * speed : 0;
    const tz = len > 0 ? (input.moveZ / Math.max(1, len)) * speed : 0;
    const k = Math.min(1, ACCEL * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    if (len > 0.05) this.targetYaw = Math.atan2(-input.moveX, -input.moveZ);

    if (this.grounded) {
      this.vel.y = -1; // keep contact
      if (input.jump && !this.swimming) {
        this.vel.y = JUMP_SPEED;
        this.grounded = false;
      }
    } else {
      this.vel.y -= GRAVITY * dt;
      this.vel.y = Math.max(this.vel.y, -40);
    }

    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired, undefined, Groups.player);
    const m = this.kcc.computedMovement();
    const t = this.body.translation();
    let nx = t.x + m.x;
    let nz = t.z + m.z;
    if (this.blocked) {
      // Block entering deep water, while still allowing sliding along the shore.
      if (this.blocked(nx, nz)) {
        if (!this.blocked(nx, t.z)) nz = t.z;
        else if (!this.blocked(t.x, nz)) nx = t.x;
        else {
          nx = t.x;
          nz = t.z;
        }
      }
    }
    let ny = t.y + m.y;
    // Hard floor safety net: never fall through the ground slab.
    const minY = GROUND_Y + CENTER_OFFSET;
    const restY = minY + 0.02; // capsule rests one controller offset above the ground
    if (ny < minY - 0.05) ny = restY;
    const wasGrounded=this.grounded;
    this.grounded = this.kcc.computedGrounded() || ny <= minY + 0.03;
    // On the (flat) ground, hold a constant resting height. Without this the
    // controller's push-down / snap-up alternates every step and the character
    // visibly trembles by 1–2 cm.
    // Only inside the tiny jitter band and never while the controller is lifting
    // the character (ramps, steps), or climbing would be undone every step.
    if (this.grounded && this.vel.y <= 0 && m.y <= 0.0005 && Math.abs(ny - restY) < 0.03) ny = restY;
    // Hold still on any settled support, including raised home floors. Never clamp a jump or stairs.
    const settled=wasGrounded&&this.grounded&&!input.jump&&Math.hypot(this.vel.x,this.vel.z)<.03;
    this.idleSupportFrames=settled?this.idleSupportFrames+1:0;
    if(this.idleSupportFrames>8&&Math.abs(ny-t.y)<.035)ny=t.y;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    if (this.grounded && this.vel.y < 0) this.vel.y = 0;
    this.groundSpeed = Math.hypot(nx - t.x, nz - t.z) / dt;
    this.curr.set(nx, ny, nz);
  }

  /** Per-frame visual update: interpolation, rotation smoothing, animation. */
  update(dt: number, alpha: number): void {
    this.renderPos.lerpVectors(this.prev, this.curr, alpha);
    this.renderPos.y -= CENTER_OFFSET;
    this.swimBlend += ((this.swimming ? 1 : 0) - this.swimBlend) * Math.min(1, dt * 4);
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * 12);
    this.rig.root.position.copy(this.renderPos);
    this.rig.root.position.y -= SWIM_SINK * this.swimBlend;
    this.rig.root.rotation.y = this.yaw;
    this.rig.nameTag.position.y = 2.42 - 0.75 * this.swimBlend;
    this.anim.update(dt, this.active ? this.groundSpeed : 0, this.grounded, this.vel.y, this.swimBlend);
  }

  /** Forces facing (e.g. first-person camera). */
  faceYaw(yaw: number): void {
    this.targetYaw = yaw;
    this.yaw = yaw;
  }

  teleport(x: number, z: number, yaw?: number, y = 0): void {
    this.idleSupportFrames=0;
    const ty = GROUND_Y + CENTER_OFFSET + 0.05 + y;
    this.body.setTranslation({ x, y: ty, z }, true);
    this.body.setNextKinematicTranslation({ x, y: ty, z });
    this.curr.set(x, ty, z);
    this.prev.copy(this.curr);
    this.vel.set(0, 0, 0);
    this.groundSpeed = 0;
    if (yaw !== undefined) this.faceYaw(yaw);
  }

  /** Enables/disables the character (disabled while driving). */
  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.swimming = false;
    this.collider.setEnabled(active);
    this.rig.root.visible = active;
    this.vel.set(0, 0, 0);
    this.groundSpeed = 0;
  }

  setVisible(v: boolean): void {
    this.rig.root.visible = v && this.active;
  }

  get headHeight(): number {
    return 1.62 - 1.2 * this.swimBlend;
  }

  /** Camera pivot height above the feet (lower while swimming). */
  get pivotHeight(): number {
    return 1.55 - 0.85 * this.swimBlend;
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.kcc);
    this.physics.world.removeRigidBody(this.body);
  }
}
