import RAPIER from '@dimforge/rapier3d-compat';
import type { Bounds } from '../config';
import { Groups } from './CollisionLayers';

export type Rapier = typeof RAPIER;

/** Height of the physical ground surface (top of the ground collider), meters. */
export const GROUND_Y = 0.08;

/**
 * Owns the Rapier world. Rapier is loaded as WASM, so creation is async.
 */
export class PhysicsWorld {
  readonly R: Rapier;
  readonly world: RAPIER.World;
  private readonly ground: RAPIER.Collider;

  private constructor(R: Rapier, bounds: Bounds) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    // A single large flat ground slab. Sittwe is flat, low-lying land: no
    // elevation model is used (see README "Known limitations").
    const groundBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const hx = (bounds.maxX - bounds.minX) / 2 + 3000;
    const hz = (bounds.maxZ - bounds.minZ) / 2 + 3000;
    this.ground = this.world.createCollider(
      R.ColliderDesc.cuboid(hx, 2, hz).setTranslation(cx, GROUND_Y - 2, cz).setFriction(1.0).setCollisionGroups(Groups.ground),
      groundBody,
    );
    // Soft boundary just outside the mapped area.
    const pad = 24;
    const wx = (bounds.maxX - bounds.minX) / 2 + pad;
    const wz = (bounds.maxZ - bounds.minZ) / 2 + pad;
    const wallBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const [x, z, ex, ez] of [
      [bounds.maxX + pad, cz, 1, wz],
      [bounds.minX - pad, cz, 1, wz],
      [cx, bounds.maxZ + pad, wx, 1],
      [cx, bounds.minZ - pad, wx, 1],
    ] as const) {
      this.world.createCollider(R.ColliderDesc.cuboid(ex, 20, ez).setTranslation(x, 10, z).setCollisionGroups(Groups.boundary), wallBody);
    }
  }

  static async create(bounds: Bounds): Promise<PhysicsWorld> {
    await RAPIER.init();
    return new PhysicsWorld(RAPIER, bounds);
  }

  get groundCollider(): RAPIER.Collider {
    return this.ground;
  }

  step(): void {
    this.world.step();
  }

  /** Creates a fixed trimesh collider (used for merged building geometry). */
  createStaticTrimesh(vertices: Float32Array, indices: Uint32Array, group: number): RAPIER.Collider | null {
    if (vertices.length < 9 || indices.length < 3) return null;
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    return this.world.createCollider(this.R.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(group).setFriction(0.6), body);
  }

  /** Creates many fixed vertical cylinders on a single fixed body (tree trunks, lamp posts). */
  createStaticCylinders(points: ArrayLike<number>, radius: number, height: number, group: number): RAPIER.RigidBody | null {
    if (points.length < 2) return null;
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    for (let i = 0; i < points.length; i += 2) {
      this.world.createCollider(
        this.R.ColliderDesc.cylinder(height / 2, radius).setTranslation(points[i]!, GROUND_Y + height / 2, points[i + 1]!).setCollisionGroups(group),
        body,
      );
    }
    return body;
  }

  /** Fixed boxes: flat list of [x, y, z, halfX, halfY, halfZ, yaw] per box. */
  createStaticBoxes(boxes: ArrayLike<number>, group: number): RAPIER.RigidBody | null {
    if (boxes.length < 7) return null;
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    for (let i = 0; i < boxes.length; i += 7) {
      const yaw = boxes[i + 6]!;
      this.world.createCollider(
        this.R.ColliderDesc.cuboid(boxes[i + 3]!, boxes[i + 4]!, boxes[i + 5]!)
          .setTranslation(boxes[i]!, boxes[i + 1]!, boxes[i + 2]!)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
          .setCollisionGroups(group),
        body,
      );
    }
    return body;
  }

  /** Fixed convex hulls (e.g. stair ramps): each entry is a flat x,y,z point list. */
  createStaticHulls(hulls: number[][], group: number): RAPIER.RigidBody | null {
    if (!hulls.length) return null;
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    for (const pts of hulls) {
      const desc = this.R.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) this.world.createCollider(desc.setCollisionGroups(group), body);
    }
    return body;
  }

  removeCollider(c: RAPIER.Collider): void {
    const body = c.parent();
    if (body) this.world.removeRigidBody(body);
    else this.world.removeCollider(c, false);
  }

  removeBody(b: RAPIER.RigidBody): void {
    this.world.removeRigidBody(b);
  }
}
