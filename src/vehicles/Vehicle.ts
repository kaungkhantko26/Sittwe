import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createVehicleModel, type VehicleVisual } from './VehicleModel';
import { CAR, VehiclePhysics, WHEEL_LAYOUT, type DriveInput } from './VehiclePhysics';

/** A drivable car: physics + visuals + light state, with render interpolation. */
export class Vehicle {
  readonly physics: VehiclePhysics;
  readonly visual: VehicleVisual;
  headlightsOn = false;
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();
  private readonly wheelSpin = [0, 0, 0, 0];

  constructor(
    world: PhysicsWorld,
    readonly id: number,
    x: number,
    z: number,
    yaw: number,
    color: number,
  ) {
    this.physics = new VehiclePhysics(world, x, z, yaw);
    this.visual = createVehicleModel(color);
    this.syncFromBody();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  get position(): THREE.Vector3 {
    return this.currPos;
  }

  get quaternion(): THREE.Quaternion {
    return this.currQuat;
  }

  get speedKmh(): number {
    return Math.abs(this.physics.forwardSpeed()) * 3.6;
  }

  fixedUpdate(dt: number, input: DriveInput, driven: boolean): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.physics.drive(input, dt, driven);
  }

  /** Call after the physics step. */
  syncFromBody(): void {
    const t = this.physics.body.translation();
    const r = this.physics.body.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
  }

  update(dt: number, alpha: number): void {
    const root = this.visual.root;
    root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const c = this.physics.controller;
    for (let i = 0; i < 4; i++) {
      const w = this.visual.wheels[i]!;
      const susp = c.wheelSuspensionLength(i) ?? CAR.suspensionRest;
      // Wheel centre in body space: connection point minus suspension length (down).
      w.pivot.position.set(WHEEL_LAYOUT[i]![0], CAR.wheelY - susp, WHEEL_LAYOUT[i]![1]);
      w.pivot.rotation.y = i < 2 ? (c.wheelSteering(i) ?? 0) : 0;
      // Spin from forward speed (visual only).
      this.wheelSpin[i]! -= (this.physics.forwardSpeed() / CAR.wheelRadius) * dt;
      w.spin.rotation.x = this.wheelSpin[i]!;
    }
    this.visual.brakeMat.emissiveIntensity = this.physics.braking ? 2.6 : this.headlightsOn ? 0.8 : 0.15;
    this.visual.headMat.emissiveIntensity = this.headlightsOn ? 2.5 : 0;
  }

  get yaw(): number {
    return this.physics.yaw();
  }

  forward(target = new THREE.Vector3()): THREE.Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.currQuat);
  }

  reset(x: number, z: number, yaw: number): void {
    this.physics.reset(x, z, yaw);
    this.syncFromBody();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  dispose(): void {
    this.physics.dispose();
  }
}

export type { DriveInput };
