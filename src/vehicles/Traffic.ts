import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { DEFAULT_ROAD_WIDTH } from '../geo/OSMParser';
import type { RoadGraph } from '../geo/roadGraph';
import { Groups } from '../physics/CollisionLayers';
import { GROUND_Y, type PhysicsWorld } from '../physics/PhysicsWorld';
import { createVehicleModel, disposeVehicleModel, MODEL_GROUND_OFFSET, type VehicleVisual } from './VehicleModel';
import { CAR } from './VehiclePhysics';

/**
 * Ambient traffic: randomly spawned cars that drive along the real OSM road
 * graph, keep to the right-hand lane (Myanmar drives on the right), respect
 * one-way streets, pick random turns at junctions, slow for curves, and
 * brake for the player, the player's car and each other. Cars are kinematic
 * bodies, so the player and the player's car collide with them. They spawn
 * 70–260 m from the player and despawn beyond 360 m.
 */

const COLORS = [0xd8d3c8, 0xf2f2ee, 0x2f2f33, 0xb52b2b, 0x2a5aa8, 0x8f969c, 0xe7b23a, 0x3e7d5b, 0x5b4a8a];
const CRUISE: Record<string, number> = { primary: 11, secondary: 10, tertiary: 8.5, residential: 6.5, service: 4.5, track: 4 };

interface TrafficCar {
  visual: VehicleVisual;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  from: number;
  to: number;
  edge: number;
  dist: number;
  len: number;
  speed: number;
  yaw: number;
  x: number;
  z: number;
  spin: number;
  color: number;
  stuck: number;
}

export class TrafficSystem {
  private readonly cars: TrafficCar[] = [];
  maxCars = 10;
  private spawnTimer = 0;
  private readonly rand = Math.random;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    private readonly graph: RoadGraph,
  ) {}

  get count(): number {
    return this.cars.length;
  }

  colliders(): RAPIER.Collider[] {
    return this.cars.map((c) => c.collider);
  }

  private laneOffset(edge: number): number {
    const w = DEFAULT_ROAD_WIDTH[this.graph.edgeClass(edge)] ?? 5;
    return Math.max(1.0, w / 4);
  }

  /** Lane position for a car on edge from→to at distance d. */
  private pose(c: TrafficCar): void {
    const g = this.graph;
    const ax = g.x(c.from);
    const az = g.z(c.from);
    const bx = g.x(c.to);
    const bz = g.z(c.to);
    const t = c.len > 0 ? c.dist / c.len : 0;
    const dx = (bx - ax) / (c.len || 1);
    const dz = (bz - az) / (c.len || 1);
    const off = this.laneOffset(c.edge);
    // Right-hand normal of the travel direction (X = east, Z = south).
    c.x = ax + (bx - ax) * t + -dz * off;
    c.z = az + (bz - az) * t + dx * off;
    const targetYaw = Math.atan2(-dx, -dz);
    let d = targetYaw - c.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    c.yaw += d * 0.18;
  }

  private nextNode(c: TrafficCar): boolean {
    const options = this.graph.neighbors(c.to, 'drive').filter(([n]) => n !== c.from);
    const all = options.length ? options : this.graph.neighbors(c.to, 'drive');
    if (!all.length) return false;
    const [n, e] = all[Math.floor(this.rand() * all.length)]!;
    c.from = c.to;
    c.to = n;
    c.edge = e;
    c.dist = 0;
    c.len = Math.hypot(this.graph.x(n) - this.graph.x(c.from), this.graph.z(n) - this.graph.z(c.from));
    return true;
  }

  private spawn(px: number, pz: number, isFree: (x: number, z: number) => boolean): void {
    const g = this.graph;
    for (let attempt = 0; attempt < 12; attempt++) {
      const a = this.rand() * Math.PI * 2;
      const r = 70 + this.rand() * 190;
      const node = g.nearestNode(px + Math.cos(a) * r, pz + Math.sin(a) * r, 'drive', 120);
      if (node < 0) continue;
      const nb = g.neighbors(node, 'drive');
      if (!nb.length) continue;
      const [to, edge] = nb[Math.floor(this.rand() * nb.length)]!;
      const dist = Math.hypot(g.x(node) - px, g.z(node) - pz);
      if (dist < 60) continue;
      if (this.cars.some((c) => Math.hypot(c.x - g.x(node), c.z - g.z(node)) < 18)) continue;
      if (!isFree(g.x(node), g.z(node))) continue;
      const color = COLORS[Math.floor(this.rand() * COLORS.length)]!;
      const visual = createVehicleModel(color);
      const y = GROUND_Y + MODEL_GROUND_OFFSET;
      const body = this.physics.world.createRigidBody(this.physics.R.RigidBodyDesc.kinematicPositionBased().setTranslation(g.x(node), y, g.z(node)));
      const he = CAR.halfExtents;
      const collider = this.physics.world.createCollider(this.physics.R.ColliderDesc.cuboid(he.x, he.y, he.z).setTranslation(0, 0.25, 0).setCollisionGroups(Groups.vehicle), body);
      const len = Math.hypot(g.x(to) - g.x(node), g.z(to) - g.z(node));
      const c: TrafficCar = { visual, body, collider, from: node, to, edge, dist: 0, len, speed: 0, yaw: Math.atan2(-(g.x(to) - g.x(node)), -(g.z(to) - g.z(node))), x: 0, z: 0, spin: 0, color, stuck:0 };
      this.pose(c);
      if(this.physics.world.intersectionWithShape({x:c.x,y:y+.25,z:c.z},{x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)},new this.physics.R.Cuboid(1.1,.4,2.6),undefined,Groups.vehicle,collider,body)||this.cars.some(o=>Math.hypot(o.x-c.x,o.z-c.z)<9)) {
        disposeVehicleModel(visual);this.physics.world.removeRigidBody(body);continue;
      }
      body.setTranslation({x:c.x,y,z:c.z},true);
      body.setRotation({x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)},true);
      this.scene.add(visual.root);
      this.cars.push(c);
      return;
    }
  }

  private despawn(i: number): void {
    const c = this.cars[i]!;
    this.scene.remove(c.visual.root);
    disposeVehicleModel(c.visual);
    this.physics.world.removeRigidBody(c.body);
    this.cars.splice(i, 1);
  }

  /** Removes a traffic car and returns its pose/colour (used when the player takes it over). */
  takeOver(i: number): { x: number; z: number; yaw: number; color: number } {
    const c = this.cars[i]!;
    const out = { x: c.x, z: c.z, yaw: c.yaw, color: c.color };
    this.despawn(i);
    return out;
  }

  /** Index of a traffic car within `maxDist` of (x, z), or -1. */
  nearest(x: number, z: number, maxDist: number): number {
    let best = -1;
    let bd = maxDist;
    this.cars.forEach((c, i) => {
      const d = Math.hypot(c.x - x, c.z - z) - 1.2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /**
   * Fixed-step update. `obstacles` are points cars must not drive into
   * (the player and the player's car).
   */
  fixedUpdate(dt: number, px: number, pz: number, obstacles: Array<[number, number]>, isFree: (x: number, z: number) => boolean): void {
    // Spawn / despawn around the player.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]!;
      if (Math.hypot(c.x - px, c.z - pz) > 360 || (c.stuck>10 && Math.hypot(c.x-px,c.z-pz)>25)) this.despawn(i);
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.cars.length < this.maxCars) {
      this.spawnTimer = 0.4;
      this.spawn(px, pz, isFree);
    }
    while (this.cars.length > this.maxCars) this.despawn(this.cars.length - 1);

    for (const c of this.cars) {
      const previous={from:c.from,to:c.to,edge:c.edge,dist:c.dist,len:c.len,x:c.x,z:c.z,yaw:c.yaw};
      const cls = this.graph.edgeClass(c.edge);
      let target = CRUISE[cls] ?? 6;
      // Look ahead for obstacles in a cone in front of the car.
      const fx = -Math.sin(c.yaw);
      const fz = -Math.cos(c.yaw);
      const blockers: Array<[number, number]> = [...obstacles];
      for (const o of this.cars) if (o !== c) blockers.push([o.x, o.z]);
      for (const [ox, oz] of blockers) {
        const rx = ox - c.x;
        const rz = oz - c.z;
        const ahead = rx * fx + rz * fz;
        const side = Math.abs(rx * -fz + rz * fx);
        if (ahead > 0 && ahead < 14 && side < 2.2) target = Math.min(target, Math.max(0, (ahead - 6) * 1.2));
      }
      // Slow down before sharp turns at the end of the edge.
      if (c.len - c.dist < 10) target = Math.min(target, 5);
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), (target < c.speed ? 7 : 2.5) * dt);
      c.dist += c.speed * dt;
      let guard = 0;
      while (c.dist >= c.len && guard++ < 4) {
        const over = c.dist - c.len;
        if (!this.nextNode(c)) {
          c.speed = 0;
          c.dist = c.len;
          break;
        }
        c.dist = over;
      }
      this.pose(c);
      const move=Math.hypot(c.x-previous.x,c.z-previous.z),samples=Math.max(1,Math.ceil(move/.4));
      let blocked=false;
      for(let i=1;i<=samples;i++) {
        const x=previous.x+(c.x-previous.x)*i/samples,z=previous.z+(c.z-previous.z)*i/samples;
        const hit=this.physics.world.intersectionWithShape({x,y:GROUND_Y+MODEL_GROUND_OFFSET+.25,z},{x:0,y:Math.sin(c.yaw/2),z:0,w:Math.cos(c.yaw/2)},new this.physics.R.Cuboid(1.02,.36,2.45),undefined,Groups.vehicle,c.collider,c.body);
        if(hit){blocked=true;break;}
      }
      if(blocked){Object.assign(c,previous);c.speed=0;c.stuck+=dt}else c.stuck=c.speed<.1?c.stuck+dt:0;
      const y = GROUND_Y + MODEL_GROUND_OFFSET;
      c.body.setNextKinematicTranslation({ x: c.x, y, z: c.z });
      c.body.setNextKinematicRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) });
    }
  }

  update(dt: number, night: boolean): void {
    for (const c of this.cars) {
      const root = c.visual.root;
      root.position.set(c.x, GROUND_Y + MODEL_GROUND_OFFSET, c.z);
      root.rotation.set(0, c.yaw, 0);
      c.spin -= (c.speed / CAR.wheelRadius) * dt;
      for (const w of c.visual.wheels) {
        w.pivot.position.y = CAR.wheelY - CAR.suspensionRest * 0.8;
        w.spin.rotation.x = c.spin;
      }
      c.visual.headMat.emissiveIntensity = night ? 2.2 : 0;
      c.visual.brakeMat.emissiveIntensity = c.speed < 2 ? 2 : night ? 0.8 : 0.15;
    }
  }

  clear(): void {
    for (let i = this.cars.length - 1; i >= 0; i--) this.despawn(i);
  }
}
