import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { BoatLook } from './BoatLook';
import { createTwoWheelerModel, createVehicleModel, disposeVehicleModel, type VehicleVisual } from './VehicleModel';
import { VehiclePhysics, type DriveInput, type VehicleKind } from './VehiclePhysics';

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
  private readonly boatLook: BoatLook;
  /** Visual lean of two-wheelers, radians. */
  lean = 0;
  private readonly leanQ = new THREE.Quaternion();
  /** +Z: a positive angle leans the top of the bike to the left. */
  private static readonly ROLL_AXIS = new THREE.Vector3(0, 0, 1);

  constructor(
    world: PhysicsWorld,
    readonly id: number,
    x: number,
    z: number,
    yaw: number,
    readonly color: number,
    readonly kind: VehicleKind = 'car',
  ) {
    this.physics = new VehiclePhysics(world, x, z, yaw, kind);
    this.visual = kind === 'car' ? createVehicleModel(color, true) : createTwoWheelerModel(kind, color);
    this.boatLook = new BoatLook(this.visual, color);
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
    for(const thrust of this.visual.thrusts)thrust.visible=this.physics.flying;
    for(const rotor of this.visual.rotors)rotor.rotation.y+=dt*(this.physics.flying?75:12);
    if(this.visual.thrustMat)this.visual.thrustMat.emissiveIntensity=this.physics.flying?3:.6;
    const c = this.physics.controller;
    const S = this.physics.spec;
    const speed = this.physics.forwardSpeed();
    for (let i = 0; i < 4; i++) {
      const w = this.visual.wheels[i]!;
      const susp = c.wheelSuspensionLength(i) ?? S.suspensionRest;
      // Wheel centre in body space: connection point minus suspension length (down).
      w.pivot.position.set(S.twoWheeler ? 0 : S.layout[i]![0], S.wheelY - susp, S.layout[i]![1]);
      w.pivot.rotation.y = i < 2 ? (c.wheelSteering(i) ?? 0) : 0;
      // Spin from forward speed (visual only).
      this.wheelSpin[i]! -= (speed / S.wheelRadius) * dt;
      w.spin.rotation.x = this.wheelSpin[i]!;
    }
    if (S.twoWheeler) {
      // Lean into turns (visual: the physics body stays upright).
      const target = this.physics.steering * Math.min(1, Math.abs(speed) / 6) * 0.55 * Math.sign(speed || 1);
      this.lean += (target - this.lean) * Math.min(1, dt * 6);
      root.quaternion.multiply(this.leanQ.setFromAxisAngle(Vehicle.ROLL_AXIS, this.lean));
      if (this.visual.crank && this.physics.throttle > 0) this.visual.crank.rotation.x -= dt * (2 + Math.abs(speed) * 1.4);
    }
    this.boatLook.update(dt, this.physics.boat, this.physics.forwardSpeed());
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
    disposeVehicleModel(this.visual);
    this.physics.dispose();
  }
}

export type { DriveInput };
