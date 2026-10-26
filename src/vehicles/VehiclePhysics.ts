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

export const WHEEL_LAYOUT: Array<[number, number]> = [
  [-0.78, -1.33], // FL
  [0.78, -1.33], // FR
  [-0.78, 1.3], // RL
  [0.78, 1.3], // RR
];

export type Gear = 'P' | 'D' | 'R' | 'N';

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

  constructor(
    private readonly physics: PhysicsWorld,
    x: number,
    z: number,
    yaw: number,
  ) {
    const R = physics.R;
    const half = Math.sin(yaw / 2);
    const y = GROUND_Y + CAR.suspensionRest + CAR.wheelRadius + 0.15;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation({ x: 0, y: half, z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.08)
        .setAngularDamping(0.9)
        .setCanSleep(true)
        .setCcdEnabled(true),
    );
    const he = CAR.halfExtents;
    // Lowered centre of mass and generous roll inertia for stability.
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(he.x, he.y, he.z)
        .setTranslation(0, 0.25, 0)
        .setMassProperties(CAR.mass, { x: 0, y: -0.15, z: 0 }, { x: 1900, y: 2100, z: 900 }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(0.4)
        .setRestitution(0.05)
        .setCollisionGroups(Groups.vehicle),
      this.body,
    );
    // Rotor pods are physical too, so the wide flying design cannot pass through walls or cars.
    for(const x of [-2.05,2.05])for(const z of [-1.4,1.4])physics.world.createCollider(R.ColliderDesc.ball(.43).setTranslation(x,.1,z).setDensity(0).setCollisionGroups(Groups.vehicle),this.body);
    this.controller = physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    WHEEL_LAYOUT.forEach(([wx, wz], i) => {
      this.controller.addWheel({ x: wx, y: CAR.wheelY, z: wz }, { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, CAR.suspensionRest, CAR.wheelRadius);
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
    if(active && input.lift && !this.flying)this.toggleFlight();
    if(this.flying){this.fly(input,dt,active);return;}
    const c = this.controller;
    const v = this.forwardSpeed();
    let engine = 0;
    let brake = 0;
    this.braking = false;
    if (!active) {
      // Parked: hold with brakes.
      this.gear = 'P';
      brake = CAR.brakeForce * 0.6;
    } else {
      const thr = input.throttle;
      const brk = input.brake;
      if (thr > 0 && v > -0.5) {
        this.gear = 'D';
        const f = Math.max(0, 1 - (v / CAR.topSpeed) ** 2);
        engine = CAR.maxEngineForce * thr * f;
      } else if (thr > 0 && v <= -0.5) {
        // Throttle while rolling backwards = brake.
        brake = CAR.brakeForce * thr;
        this.braking = true;
      }
      if (brk > 0) {
        if (v > 0.8) {
          brake = CAR.brakeForce * brk;
          this.braking = true;
        } else {
          this.gear = 'R';
          const f = Math.max(0, 1 - (-v / CAR.maxReverseSpeed) ** 2);
          engine = -CAR.maxEngineForce * 0.7 * brk * f;
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
    const maxSteer = CAR.maxSteer + (CAR.minSteer - CAR.maxSteer) * speedT;
    const target = input.steer * maxSteer;
    const rate = (input.steer === 0 ? 3.5 : 2.4) * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    c.setWheelSteering(0, this.steer);
    c.setWheelSteering(1, this.steer);
    for (let i = 0; i < 4; i++) {
      c.setWheelEngineForce(i, i >= 2 ? engine : 0);
      let b = brake;
      if (active && input.handbrake && i >= 2) b = CAR.handbrakeForce;
      c.setWheelBrake(i, b);
      // Handbrake lets the rear slide.
      c.setWheelFrictionSlip(i, active && input.handbrake && i >= 2 ? 1.1 : i < 2 ? 3.2 : 3.0);
    }
    if (active && input.handbrake) this.braking = true;
    c.updateVehicle(dt, this.physics.R.QueryFilterFlags.EXCLUDE_DYNAMIC | this.physics.R.QueryFilterFlags.EXCLUDE_KINEMATIC, Groups.wheelRay);
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
    this.flying=false;this.landing=false;this.body.setGravityScale(1,true);
    const y = GROUND_Y + CAR.suspensionRest + CAR.wheelRadius + 0.3;
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
