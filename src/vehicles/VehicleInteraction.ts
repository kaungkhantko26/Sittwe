import * as THREE from 'three';
import type { SpawnPoint } from '../geo/chunkFormat';
import { Layer, groups } from '../physics/CollisionLayers';
import { GROUND_Y, type PhysicsWorld } from '../physics/PhysicsWorld';
import { Vehicle, type DriveInput } from './Vehicle';
import { BODY_COLORS } from './VehicleModel';
import { CAR } from './VehiclePhysics';

const ENTER_DISTANCE = 2.2; // meters from the car's body surface

/**
 * Owns all vehicles: spawning on real roads (from the manifest), proximity
 * checks for the "enter vehicle" prompt, entering/exiting with a free-space
 * check for the exit position, headlights, and upright-reset.
 */
export class VehicleSystem {
  readonly vehicles: Vehicle[] = [];
  driving: Vehicle | null = null;
  private readonly headlights: THREE.SpotLight[] = [];
  private readonly tmp = new THREE.Vector3();
  private upsideDownTime = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    spawns: SpawnPoint[],
  ) {
    spawns.forEach((s, i) => this.add(s.x, s.z, s.yaw, BODY_COLORS[i % BODY_COLORS.length]!));
    this.baseCount = this.vehicles.length;
    // One pair of headlight spotlights, moved to whichever car is being driven.
    // The scene's light count stays constant, avoiding shader recompiles.
    for (const sx of [-0.6, 0.6]) {
      const l = new THREE.SpotLight(0xfff0d0, 0, 55, 0.48, 0.5, 1.3);
      l.position.set(sx, 0.15, -2.15);
      l.target.position.set(sx * 1.6, -1.2, -16);
      scene.add(l, l.target);
      this.headlights.push(l);
    }
  }

  private nextId = 0;
  /** Number of cars placed by the map (not spawned by the player). */
  baseCount = 0;

  /** Adds a drivable car (used for map spawns, player spawns and taken-over traffic). */
  spawnAt(x: number, z: number, yaw: number, color: number): Vehicle {
    return this.add(x, z, yaw, color);
  }

  /** Removes a car that is not being driven. */
  remove(v: Vehicle): void {
    if (v === this.driving) return;
    const i = this.vehicles.indexOf(v);
    if (i < 0) return;
    this.vehicles.splice(i, 1);
    this.scene.remove(v.visual.root);
    v.dispose();
  }

  private add(x: number, z: number, yaw: number, color: number): Vehicle {
    const v = new Vehicle(this.physics, this.nextId++, x, z, yaw, color);
    this.vehicles.push(v);
    this.scene.add(v.visual.root);
    return v;
  }

  /** Distance from point to the car's box (in its local frame), meters. */
  distanceTo(v: Vehicle, p: THREE.Vector3): number {
    const local = this.tmp.copy(p).sub(v.position).applyQuaternion(v.quaternion.clone().invert());
    const he = CAR.halfExtents;
    const dx = Math.max(Math.abs(local.x) - he.x, 0);
    const dz = Math.max(Math.abs(local.z) - he.z, 0);
    return Math.hypot(dx, dz);
  }

  nearest(p: THREE.Vector3): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = ENTER_DISTANCE;
    for (const v of this.vehicles) {
      const d = this.distanceTo(v, p);
      if (d < bd && Math.abs(p.y - v.position.y) < 2.5) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  enter(v: Vehicle, night: boolean): void {
    this.driving = v;
    v.headlightsOn = night;
    for (const l of this.headlights) {
      v.visual.root.add(l, l.target);
    }
  }

  /**
   * Leaves the car. Returns a free exit position next to the driver's door
   * (tries left, right, behind, front, then roof).
   */
  exit(blocked: (x: number, z: number) => boolean): { x: number; z: number; y: number; yaw: number } {
    const v = this.driving!;
    this.driving = null;
    for (const l of this.headlights) {
      this.scene.add(l, l.target);
      l.intensity = 0;
    }
    const q = v.quaternion;
    const he = CAR.halfExtents;
    const candidates: Array<[number, number]> = [
      [-(he.x + 0.7), -0.3],
      [he.x + 0.7, -0.3],
      [0, he.z + 1.0],
      [0, -(he.z + 1.0)],
    ];
    const R = this.physics.R;
    const shape = new R.Capsule(0.5, 0.32);
    const filter = groups(Layer.Player, Layer.Building | Layer.Prop | Layer.Vehicle | Layer.Boundary);
    for (const [lx, lz] of candidates) {
      const p = this.tmp.set(lx, 0, lz).applyQuaternion(q).add(v.position);
      const y = GROUND_Y + 0.88;
      const hit = this.physics.world.intersectionWithShape({ x: p.x, y, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, undefined, filter);
      if (!hit && !blocked(p.x, p.z)) return { x: p.x, z: p.z, y: 0, yaw: v.yaw };
    }
    // Fallback: on the roof.
    return { x: v.position.x, z: v.position.z, y: 1.6, yaw: v.yaw };
  }

  fixedUpdate(dt: number, input: DriveInput): void {
    const idle: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    for (const v of this.vehicles) v.fixedUpdate(dt, v === this.driving ? input : idle, v === this.driving);
  }

  /** Called after physics step. Keeps cars out of deep water. */
  postStep(dt: number, blocked: (x: number, z: number) => boolean): void {
    for (const v of this.vehicles) {
      const prev = v.position.clone();
      v.syncFromBody();
      const p = v.position;
      if (blocked(p.x, p.z)) {
        // Push back to the last dry position and kill velocity.
        const body = v.physics.body;
        body.setTranslation({ x: prev.x, y: Math.max(prev.y, p.y), z: prev.z }, true);
        const lv = body.linvel();
        body.setLinvel({ x: -lv.x * 0.2, y: lv.y, z: -lv.z * 0.2 }, true);
        v.syncFromBody();
      }
    }
    const d = this.driving;
    if (d && d.physics.isUpsideDown()) this.upsideDownTime += dt;
    else this.upsideDownTime = 0;
  }

  /** True when the driven car has been on its roof/side for a while. */
  get needsReset(): boolean {
    return this.upsideDownTime > 2.5;
  }

  resetDriven(): void {
    const v = this.driving;
    if (!v) return;
    v.reset(v.position.x, v.position.z, v.yaw);
    this.upsideDownTime = 0;
  }

  update(dt: number, alpha: number): void {
    for (const v of this.vehicles) v.update(dt, alpha);
    const on = !!this.driving?.headlightsOn;
    for (const l of this.headlights) l.intensity = on ? 60 : 0;
  }

  toggleHeadlights(): boolean {
    if (!this.driving) return false;
    this.driving.headlightsOn = !this.driving.headlightsOn;
    return this.driving.headlightsOn;
  }

  get colliders(): Array<import('@dimforge/rapier3d-compat').Collider> {
    return this.vehicles.map((v) => v.physics.collider);
  }

  /** Serializable state for saving. */
  snapshot(): Array<{ x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }> {
    return this.vehicles.map((v) => {
      const p = v.position;
      const q = v.quaternion;
      return { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
    });
  }

  restore(states: Array<{ x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }>): void {
    // Drop player-spawned extras, then recreate as many cars as were saved.
    while (this.vehicles.length > this.baseCount) this.remove(this.vehicles[this.vehicles.length - 1]!);
    states.forEach((s, i) => {
      const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(s.qx, s.qy, s.qz, s.qw), 'YXZ').y;
      const v = this.vehicles[i] ?? this.add(s.x, s.z, yaw, BODY_COLORS[i % BODY_COLORS.length]!);
      v.reset(s.x, s.z, yaw);
    });
  }
}
