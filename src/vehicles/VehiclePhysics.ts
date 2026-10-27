import type RAPIER from '@dimforge/rapier3d-compat';
import { Groups } from '../physics/CollisionLayers';
import { GROUND_Y, type PhysicsWorld } from '../physics/PhysicsWorld';

/**
 * Simplified car physics on Rapier's DynamicRayCastVehicleController:
 * a dynamic chassis rigid body with four raycast wheels (spring/damper
 * suspension, tyre friction), rear-wheel drive, four-wheel brakes and a
 * rear handbrake. This is an arcade-style model — not a realistic
 * drivetrain/tyre simulation (no gearbox, engine torque curve or slip model
 * beyond Rapier's friction-slip parameter).
 *
 * Conventions (verified empirically): chassis faces -Z; with axle = +X,
 * positive engine force accelerates toward -Z and positive steering turns left.
 */

export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 (brake when moving forward, reverse when stopped) */
  brake: number;
  /** -1 (right) .. 1 (left) */
  steer: number;
  handbrake: boolean;
  lift?: boolean;
  descend?: boolean;
  boost?: boolean;
}

export const CAR = {
  mass: 1150,
  halfExtents: { x: 0.9, y: 0.32, z: 2.15 },
  wheelRadius: 0.34,
  suspensionRest: 0.32,
  wheelY: 0.05,
  maxEngineForce: 2600, // per driven wheel, N
  maxReverseSpeed: 7, // m/s
  topSpeed: 27, // m/s ≈ 97 km/h
  brakeForce: 32,
  handbrakeForce: 60,
  maxSteer: 0.6, // rad at low speed
  minSteer: 0.16, // rad at top speed
} as const;

/** Amphibious boat mode: the car floats and is driven by a water jet when it reaches the sea. */
export const BOAT = {
  /** Body origin height while floating (the hull dips below the water surface). */
  floatY: GROUND_Y + 0.5,
  topSpeed: 15, // m/s ≈ 54 km/h
  boostSpeed: 21,
  reverseSpeed: 4,
  /** How quickly the jet reaches the target speed (1/s). */
  accel: 0.75,
  /** Sideways slip decays slowly, so turns drift like a boat. */
  sideGrip: 1.4,
  turnRate: 0.85, // rad/s at full steer and speed
} as const;

export const WHEEL_LAYOUT: Array<[number, number]> = [
  [-0.78, -1.33], // FL
  [0.78, -1.33], // FR
  [-0.78, 1.3], // RL
  [0.78, 1.3], // RR
];

export type Gear = 'P' | 'D' | 'R' | 'N';

export type VehicleKind = 'car' | 'motorbike' | 'bicycle';

/** Size, mass, power and handling of one kind of vehicle. */
export interface VehicleSpec {
  kind: VehicleKind;
  mass: number;
  halfExtents: { x: number; y: number; z: number };
  wheelRadius: number;
  suspensionRest: number;
  wheelY: number;
  maxEngineForce: number;
  maxReverseSpeed: number;
  topSpeed: number;
  brakeForce: number;
  handbrakeForce: number;
  maxSteer: number;
  minSteer: number;
  /** Wheel contact points FL, FR, RL, RR (two-wheelers use a narrow pair per axle). */
  layout: Array<[number, number]>;
  inertia: { x: number; y: number; z: number };
  colliderY: number;
  /** Flying-car rotor pods, flight and boat mode (cars only). */
  amphibious: boolean;
  /** Kept upright by the rider; leans visually instead of rolling. */
  twoWheeler: boolean;
}

export const SPECS: Record<VehicleKind, VehicleSpec> = {
  car: { kind: 'car', ...CAR, layout: WHEEL_LAYOUT, inertia: { x: 1900, y: 2100, z: 900 }, colliderY: 0.25, amphibious: true, twoWheeler: false },
  // Underbone motorbike (the common 110 cc type in Myanmar) with rider, ~230 kg.
  motorbike: {
    kind: 'motorbike', mass: 230, halfExtents: { x: 0.32, y: 0.36, z: 0.95 }, wheelRadius: 0.3, suspensionRest: 0.26, wheelY: 0.05,
    maxEngineForce: 520, maxReverseSpeed: 2.5, topSpeed: 21, brakeForce: 7, handbrakeForce: 12, maxSteer: 0.55, minSteer: 0.12,
    layout: [[-0.13, -0.66], [0.13, -0.66], [-0.13, 0.64], [0.13, 0.64]], inertia: { x: 70, y: 60, z: 28 }, colliderY: 0.3, amphibious: false, twoWheeler: true,
  },
  // City bicycle with rider, ~90 kg, pedalled.
  bicycle: {
    kind: 'bicycle', mass: 90, halfExtents: { x: 0.28, y: 0.32, z: 0.85 }, wheelRadius: 0.34, suspensionRest: 0.22, wheelY: 0.05,
    maxEngineForce: 95, maxReverseSpeed: 1.5, topSpeed: 7.5, brakeForce: 2.6, handbrakeForce: 5, maxSteer: 0.6, minSteer: 0.18,
    layout: [[-0.1, -0.55], [0.1, -0.55], [-0.1, 0.55], [0.1, 0.55]], inertia: { x: 28, y: 24, z: 11 }, colliderY: 0.3, amphibious: false, twoWheeler: true,
  },
};

export class VehiclePhysics {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  private steer = 0;
  gear: Gear = 'P';
  braking = false;
  throttle = 0;
  flying = false;
  landing = false;
  /** Floating on water (amphibious mode). */
  boat = false;
  private boatYaw = 0;
  private boatTime = 0;

  readonly spec: VehicleSpec;

  constructor(
    private readonly physics: PhysicsWorld,
    x: number,
    z: number,
    yaw: number,
    kind: VehicleKind = 'car',
  ) {
    this.spec = SPECS[kind];
    const S = this.spec;
    const R = physics.R;
    const half = Math.sin(yaw / 2);
    const y = GROUND_Y + S.suspensionRest + S.wheelRadius + 0.15;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: half, z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.08)
        .setAngularDamping(0.9)
        .setCanSleep(true)
        .setCcdEnabled(true),
    );
    const he = S.halfExtents;
    // Lowered centre of mass and generous roll inertia for stability.
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(he.x, he.y, he.z)
        .setTranslation(0, S.colliderY, 0)
        .setMassProperties(S.mass, { x: 0, y: S.twoWheeler ? -0.2 : -0.15, z: 0 }, S.inertia, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4)
        .setRestitution(0.05)
        .setCollisionGroups(Groups.vehicle),
      this.body,
    );
    // Rotor pods are physical too, so the wide flying design cannot pass through walls or cars.
    if(S.amphibious)for(const x of [-2.05,2.05])for(const z of [-1.4,1.4])physics.world.createCollider(R.ColliderDesc.ball(.43).setTranslation(x,.1,z).setDensity(0).setCollisionGroups(Groups.vehicle),this.body);
    this.controller = physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    S.layout.forEach(([wx, wz], i) => {
      this.controller.addWheel({ x: wx, y: S.wheelY, z: wz }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, S.suspensionRest, S.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, 32);
      this.controller.setWheelSuspensionCompression(i, 2.6);
      this.controller.setWheelSuspensionRelaxation(i, 3.4);
      this.controller.setWheelMaxSuspensionTravel(i, 0.3);
      this.controller.setWheelMaxSuspensionForce(i, 60000);
      this.controller.setWheelFrictionSlip(i, i < 2 ? 3.2 : 3.0);
      this.controller.setWheelSideFrictionStiffness(i, 1.0);
    });
  }

  /** Signed speed along the car's forward (-Z) axis, m/s. */
  forwardSpeed(): number {
    const v = this.body.linvel();
    const q = this.body.rotation();
    // Forward = rotate (0,0,-1) by q.
    const fx = -(2 * (q.x * q.z + q.w * q.y));
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    return v.x * fx + v.z * fz;
  }

  /** Switches to floating on water; the wheels stop driving and a water jet takes over. */
  enterBoat(): void {
    if (this.boat || this.flying) return;
    this.boat = true;
    this.boatYaw = this.yaw();
    this.body.setGravityScale(0, true);
    const v = this.body.linvel();
    // A splash-down slows the car.
    this.body.setLinvel({ x: v.x * 0.6, y: 0, z: v.z * 0.6 }, true);
    for (let i = 0; i < 4; i++) { this.controller.setWheelEngineForce(i, 0); this.controller.setWheelBrake(i, 0); }
  }

  /** Back on land: gravity and the wheels take over again. */
  leaveBoat(): void {
    if (!this.boat) return;
    this.boat = false;
    this.body.setGravityScale(1, true);
    const p = this.body.translation();
    this.body.setTranslation({ x: p.x, y: Math.max(p.y, GROUND_Y + this.spec.suspensionRest + this.spec.wheelRadius), z: p.z }, true);
  }

  private sail(input: DriveInput, dt: number, active: boolean): void {
    this.boatTime += dt;
    const v = this.body.linvel();
    const fwd = this.forwardSpeed();
    let target = 0;
    this.braking = false;
    if (active) {
      if (input.throttle > 0) { target = (input.boost ? BOAT.boostSpeed : BOAT.topSpeed) * input.throttle; this.gear = 'D'; }
      else if (input.brake > 0) { target = fwd > 1 ? 0 : -BOAT.reverseSpeed * input.brake; this.gear = fwd > 1 ? this.gear : 'R'; this.braking = fwd > 1; }
      else this.gear = 'N';
      this.throttle = input.throttle;
    } else this.gear = 'P';
    // Rudder works with water flow: little turning when stopped, reversed when going backwards.
    const flow = Math.max(-1, Math.min(1, fwd / 5));
    const steer = active ? input.steer : 0;
    this.steer += (steer * 0.5 - this.steer) * Math.min(1, dt * 4);
    this.boatYaw += steer * BOAT.turnRate * (Math.abs(flow) < 0.15 ? 0.15 * Math.sign(flow || 1) : flow) * dt;
    const yaw = this.boatYaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    // Split velocity into forward and sideways parts; ease each toward its target.
    const along = v.x * fx + v.z * fz;
    const side = v.x * -fz + v.z * fx;
    const newAlong = along + (target - along) * (1 - Math.exp(-dt * (target === 0 && active ? 1.6 : BOAT.accel)));
    const newSide = side * Math.exp(-dt * BOAT.sideGrip);
    const p = this.body.translation();
    // Gentle swell; the bow lifts with speed and the hull leans into turns.
    const bob = Math.sin(this.boatTime * 1.7) * 0.045 + Math.sin(this.boatTime * 2.9 + 1) * 0.02;
    const vy = (BOAT.floatY + bob - p.y) * 4;
    this.body.setLinvel({ x: fx * newAlong - fz * newSide, y: vy, z: fz * newAlong + fx * newSide }, true);
    const speedT = Math.min(1, Math.abs(newAlong) / BOAT.topSpeed);
    const pitch = 0.07 * speedT + Math.sin(this.boatTime * 1.3) * 0.015;
    const roll = -steer * 0.09 * speedT + Math.sin(this.boatTime * 1.1 + 2) * 0.02;
    const q = eulerYXZ(pitch, yaw, roll);
    this.body.setRotation(q, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  toggleFlight(): void {
    if(this.flying){this.landing=!this.landing;return;}
    this.flying=true;this.landing=false;this.body.setGravityScale(0,true);
    this.body.setLinvel({x:0,y:2,z:0},true);
  }

  private fly(input:DriveInput,dt:number,active:boolean):void {
    const pos=this.body.translation(),v=this.body.linvel();
    const yaw=this.yaw()+input.steer*1.15*dt;
    this.body.setRotation({x:0,y:Math.sin(yaw/2),z:0,w:Math.cos(yaw/2)},true);
    this.body.setAngvel({x:0,y:0,z:0},true);
    const speed=input.boost?32:18,forward=active?(input.throttle-input.brake)*speed:0;
    let vy=(this.landing||!active)?-1.8:input.lift?5:input.descend?-4:0;
    if(pos.y>=120)vy=Math.min(vy,0);
    const ray=new this.physics.R.Ray(pos,{x:0,y:-1,z:0});
    const hit=this.physics.world.castRay(ray,3,true,undefined,Groups.wheelRay,this.collider,undefined,col=>col!==this.collider);
    if(vy<0 && hit && hit.timeOfImpact<.9){
      if(hit.collider.handle===this.physics.groundCollider.handle && Math.abs(v.y)<6){
        this.flying=false;this.landing=false;this.body.setGravityScale(1,true);this.body.setLinvel({x:v.x*.5,y:0,z:v.z*.5},true);return;
      }
      vy=0;this.landing=false;
    }
    const k=1-Math.exp(-dt*3);
    this.body.setLinvel({x:v.x+(-Math.sin(yaw)*forward-v.x)*k,y:v.y+(vy-v.y)*Math.min(1,dt*5),z:v.z+(-Math.cos(yaw)*forward-v.z)*k},true);
    this.gear='D';this.throttle=input.throttle;this.braking=!!input.descend;
  }

  /** Applies driver input; call once per fixed step before world.step(). */
  drive(input: DriveInput, dt: number, active: boolean): void {
    if(active && input.lift && !this.flying && this.spec.amphibious){this.leaveBoat();this.toggleFlight();}
    if(this.flying){this.fly(input,dt,active);return;}
    if(this.boat){this.sail(input,dt,active);return;}
    const c = this.controller;
    const v = this.forwardSpeed();
    let engine = 0;
    let brake = 0;
    this.braking = false;
    if (!active) {
      // Parked: hold with brakes.
      this.gear = 'P';
      brake = this.spec.brakeForce * 0.6;
    } else {
      const thr = input.throttle;
      const brk = input.brake;
      if (thr > 0 && v > -0.5) {
        this.gear = 'D';
        const f = Math.max(0, 1 - (v / this.spec.topSpeed) ** 2);
        engine = this.spec.maxEngineForce * thr * f;
      } else if (thr > 0 && v <= -0.5) {
        // Throttle while rolling backwards = brake.
        brake = this.spec.brakeForce * thr;
        this.braking = true;
      }
      if (brk > 0) {
        if (v > 0.8) {
          brake = this.spec.brakeForce * brk;
          this.braking = true;
        } else {
          this.gear = 'R';
          const f = Math.max(0, 1 - (-v / this.spec.maxReverseSpeed) ** 2);
          engine = -this.spec.maxEngineForce * 0.7 * brk * f;
        }
      }
      if (thr === 0 && brk === 0) {
        if (this.gear === 'P') this.gear = 'N';
        // Light engine braking / rolling resistance.
        brake = Math.abs(v) < 0.3 ? 2 : 0.6;
      }
      this.throttle = thr;
    }
    // Speed-sensitive steering with smoothing.
    const speedT = Math.min(1, Math.abs(v) / 22);
    const maxSteer = this.spec.maxSteer + (this.spec.minSteer - this.spec.maxSteer) * speedT;
    const target = input.steer * maxSteer;
    const rate = (input.steer === 0 ? 3.5 : 2.4) * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    c.setWheelSteering(0, this.steer);
    c.setWheelSteering(1, this.steer);
    for (let i = 0; i < 4; i++) {
      c.setWheelEngineForce(i, i >= 2 ? engine : 0);
      let b = brake;
      if (active && input.handbrake && i >= 2) b = this.spec.handbrakeForce;
      c.setWheelBrake(i, b);
      // Handbrake lets the rear slide.
      c.setWheelFrictionSlip(i, active && input.handbrake && i >= 2 ? 1.1 : i < 2 ? 3.2 : 3.0);
    }
    if (active && input.handbrake) this.braking = true;
    c.updateVehicle(dt, this.physics.R.QueryFilterFlags.EXCLUDE_DYNAMIC | this.physics.R.QueryFilterFlags.EXCLUDE_KINEMATIC, Groups.wheelRay);
    if (this.spec.twoWheeler) this.keepUpright();
  }

  /** Two-wheelers: the rider balances, so roll is removed (the model leans visually instead). */
  private keepUpright(): void {
    const q = this.body.rotation();
    const fy = 2 * (q.y * q.z - q.w * q.x); // y of the -Z forward vector
    const pitch = Math.asin(Math.max(-1, Math.min(1, -fy)));
    this.body.setRotation(eulerYXZ(pitch, this.yaw(), 0), true);
    const av = this.body.angvel();
    this.body.setAngvel({ x: 0, y: av.y, z: 0 }, true);
  }

  get steering(): number {
    return this.steer;
  }

  /** True when the car has rolled more than ~70° from upright. */
  isUpsideDown(): boolean {
    const q = this.body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return upY < 0.35;
  }

  /** Puts the car upright at (x, z) facing `yaw`, at rest. */
  reset(x: number, z: number, yaw: number): void {
    this.flying=false;this.landing=false;this.boat=false;this.body.setGravityScale(1,true);
    const y = GROUND_Y + this.spec.suspensionRest + this.spec.wheelRadius + 0.3;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
  }

  yaw(): number {
    const q = this.body.rotation();
    // Heading of the -Z forward vector.
    const fx = -(2 * (q.x * q.z + q.w * q.y));
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    return Math.atan2(-fx, -fz);
  }

  dispose(): void {
    this.physics.world.removeVehicleController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}

/** Quaternion for pitch (about X), then yaw (about Y), then roll (about Z), in YXZ order. */
function eulerYXZ(pitch: number, yaw: number, roll: number): { x: number; y: number; z: number; w: number } {
  const c1 = Math.cos(pitch / 2), s1 = Math.sin(pitch / 2);
  const c2 = Math.cos(yaw / 2), s2 = Math.sin(yaw / 2);
  const c3 = Math.cos(roll / 2), s3 = Math.sin(roll / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
}
