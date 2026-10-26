import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Groups } from '../physics/CollisionLayers';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

export type CameraMode = 'third' | 'first' | 'cinematic';
export type VehicleCameraMode = 'chase' | 'far' | 'hood' | 'cinematic';

export interface CameraTarget {
  /** Point the camera orbits/looks at. */
  pivot: THREE.Vector3;
  /** Heading of the followed object (radians, 0 = -Z). Used for auto-follow. */
  heading: number;
  speed: number;
  inVehicle: boolean;
  /** Colliders the occlusion ray must ignore (player/vehicle). */
  ignore: RAPIER.Collider[];
}

/**
 * Smooth orbit camera.
 *  - Mouse orbit (yaw/pitch), wheel zoom, adjustable sensitivity and invert-Y.
 *  - Collision avoidance: a ray from the pivot to the desired position pulls
 *    the camera in front of buildings; it eases back out (auto-recovery).
 *  - Modes on foot: third-person, first-person, cinematic slow orbit.
 *  - Modes in a vehicle: chase (auto-aligns behind the car), far, hood, cinematic.
 */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.32;
  distance = 5.5;
  sensitivity = 1;
  invertY = false;
  mode: CameraMode = 'third';
  vehicleMode: VehicleCameraMode = 'chase';
  private currentDist = 5.5;
  private readonly smoothPivot = new THREE.Vector3();
  private idleTime = 0;
  private cinematicT = 0;
  private initialized = false;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld,
  ) {}

  cycleMode(inVehicle: boolean): string {
    if (inVehicle) {
      const order: VehicleCameraMode[] = ['chase', 'far', 'hood', 'cinematic'];
      this.vehicleMode = order[(order.indexOf(this.vehicleMode) + 1) % order.length]!;
      return this.vehicleMode;
    }
    const order: CameraMode[] = ['third', 'first', 'cinematic'];
    this.mode = order[(order.indexOf(this.mode) + 1) % order.length]!;
    return this.mode;
  }

  get isFirstPerson(): boolean {
    return this.mode === 'first';
  }

  /** Applies raw mouse movement (pixels) and wheel steps. */
  input(dx: number, dy: number, wheel: number): void {
    const s = 0.0024 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += (this.invertY ? -dy : dy) * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.9, 1.25);
    if (wheel) this.distance = THREE.MathUtils.clamp(this.distance + wheel * 0.6, 2.2, 16);
    if (dx !== 0 || dy !== 0) this.idleTime = 0;
  }

  /** Puts the camera behind a heading immediately. */
  snapBehind(heading: number): void {
    this.yaw = heading;
    this.initialized = false;
  }

  update(dt: number, t: CameraTarget): void {
    this.idleTime += dt;
    const cam = this.camera;
    if (!this.initialized) {
      this.smoothPivot.copy(t.pivot);
      this.currentDist = this.distance;
      this.initialized = true;
    }
    // Pivot smoothing (a bit looser in vehicles to soften bumps).
    const pivotLerp = 1 - Math.exp(-dt * (t.inVehicle ? 14 : 22));
    this.smoothPivot.lerp(t.pivot, pivotLerp);

    let dist = this.distance;
    let pitch = this.pitch;
    let lookAhead = 0;

    if (t.inVehicle) {
      if (this.vehicleMode === 'hood') {
        this.placeFirstPerson(t.pivot, t.heading, 0.05, 0.9);
        return;
      }
      if (this.vehicleMode === 'cinematic') {
        this.cinematic(dt, t.pivot, 14, 0.18);
        return;
      }
      dist = this.vehicleMode === 'far' ? Math.max(this.distance + 6, 12) : Math.max(this.distance + 1.5, 6.5);
      // Auto-align behind the car after the mouse has been idle for a moment.
      if (this.idleTime > 1.2 && t.speed > 2) {
        let d = t.heading - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 2.5);
        this.pitch += (0.28 - this.pitch) * Math.min(1, dt * 1.5);
      }
      pitch = this.pitch;
      lookAhead = Math.min(t.speed * 0.08, 2.5);
    } else if (this.mode === 'first') {
      this.placeFirstPerson(t.pivot, this.yaw, 0, this.pitch);
      return;
    } else if (this.mode === 'cinematic') {
      this.cinematic(dt, t.pivot, 9, 0.12);
      return;
    }

    // Desired orbit position.
    const cp = Math.cos(pitch);
    const dir = this.tmp.set(Math.sin(this.yaw) * cp, Math.sin(pitch), Math.cos(this.yaw) * cp).normalize();
    // Collision: cast from pivot toward the camera.
    const hit = this.castFrom(this.smoothPivot, dir, dist + 0.3, t.ignore);
    const allowed = hit !== null ? Math.max(0.6, hit - 0.35) : dist;
    // Pull in fast, recover slowly.
    const k = allowed < this.currentDist ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 3);
    this.currentDist += (allowed - this.currentDist) * k;
    cam.position.copy(this.smoothPivot).addScaledVector(dir, this.currentDist);
    if (cam.position.y < 0.35) cam.position.y = 0.35;
    const look = this.smoothPivot.clone();
    if (lookAhead > 0) look.add(new THREE.Vector3(-Math.sin(t.heading) * lookAhead, 0, -Math.cos(t.heading) * lookAhead));
    cam.lookAt(look);
  }

  private placeFirstPerson(pivot: THREE.Vector3, yaw: number, forwardOffset: number, pitch: number): void {
    const cam = this.camera;
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    cam.position.set(pivot.x + fwdX * forwardOffset, pivot.y, pivot.z + fwdZ * forwardOffset);
    // In first person, positive pitch looks down (mouse down).
    const p = THREE.MathUtils.clamp(-pitch + 0.3, -1.3, 1.3);
    cam.lookAt(cam.position.x + fwdX * Math.cos(p), cam.position.y + Math.sin(p), cam.position.z + fwdZ * Math.cos(p));
  }

  private cinematic(dt: number, pivot: THREE.Vector3, radius: number, speed: number): void {
    this.cinematicT += dt * speed;
    const a = this.yaw + this.cinematicT;
    const cam = this.camera;
    cam.position.set(pivot.x + Math.sin(a) * radius, pivot.y + 2.2 + Math.sin(this.cinematicT * 0.7) * 1.2, pivot.z + Math.cos(a) * radius);
    cam.lookAt(pivot);
  }

  /** Orbit used behind the main menu: wide, slow, high. */
  menuOrbit(dt: number, center: THREE.Vector3): void {
    this.cinematicT += dt * 0.035;
    const cam = this.camera;
    const r = 150;
    cam.position.set(center.x + Math.sin(this.cinematicT) * r, 70, center.z + Math.cos(this.cinematicT) * r);
    cam.lookAt(center.x, 0, center.z);
    this.initialized = false;
  }

  private castFrom(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, ignore: RAPIER.Collider[]): number | null {
    const R = this.physics.R;
    const ray = new R.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.physics.world.castRay(ray, maxDist, true, undefined, Groups.cameraRay, undefined, undefined, (c) => !ignore.includes(c));
    return hit ? hit.timeOfImpact : null;
  }
}
