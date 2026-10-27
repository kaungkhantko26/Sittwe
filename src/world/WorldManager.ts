import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ChunkData, PlaceEntry, SeaData, WorldManifest } from '../geo/chunkFormat';
import { chunkKey } from '../geo/chunkFormat';
import { pointInRings, ringBounds, type Pt, type Rect } from '../geo/geometry2d';
import type { MapDataLoader } from '../geo/MapDataLoader';
import { Groups } from '../physics/CollisionLayers';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { homeRect, type HomeLocation } from '../systems/Housing';
import { buildBoundaries, type BoundaryData } from './BoundaryGenerator';
import { buildHome, disposeHome, type HomeObjects } from './HomeGenerator';
import { buildBuildings } from './BuildingGenerator';
import { ChunkManager } from './ChunkManager';
import { buildLandmarks, disposeLandmarks, type LandmarkObjects } from './LandmarkGenerator';
import type { PagodaSite } from './landmarks/LawkanandarPagoda';
import { materials } from './materials';
import { buildRoads, DRIVABLE } from './RoadGenerator';
import { PolygonIndex, SegmentIndex } from './SpatialIndex';
import { buildStreetSigns, disposeStreetSigns } from './StreetSigns';
import { buildStreetLights } from './StreetFurniture';
import { buildLanduse, createGroundPlane } from './TerrainGenerator';
import { buildVegetation, placeCoastalTrees, placeTrees } from './VegetationGenerator';
import { buildSea, buildWater, waterMaterial } from './WaterGenerator';
import { OceanWaves } from './OceanWaves';

export interface WorldOptions {
  /** Chunks kept visible around the player (Chebyshev radius). */
  viewRadius: number;
  /** Chunks with active physics colliders around the player. */
  physicsRadius: number;
  /** Chunks within this radius get full detail (trees, lamps, labels, shadows). */
  detailRadius: number;
  vegetationDensity: number;
  lang: 'en' | 'rki';
}

interface BuiltChunk {
  key: string;
  cx: number;
  cz: number;
  data: ChunkData;
  group: THREE.Group;
  detail: THREE.Group;
  buildingsMesh: THREE.Mesh | null;
  roadIndex: SegmentIndex;
  waterwayIndex: SegmentIndex;
  buildingIndex: PolygonIndex;
  waterRings: Array<{ rings: Pt[][]; bounds: Rect }>;
  collider: { vertices: Float32Array; indices: Uint32Array } | null;
  trunks: number[];
  lamps: number[];
  stupas: number[];
  boxes: number[];
  ramps: number[][];
  sites: PagodaSite[];
  landmarks: LandmarkObjects | null;
  vegetation: THREE.InstancedMesh[];
  signs:THREE.Group;
  physics: { building: RAPIER.Collider | null; bodies: RAPIER.RigidBody[] } | null;
  stats: { triangles: number };
}

type BuildJob = { key: string; data: ChunkData; steps: Generator<void, BuiltChunk | null, void> };

export class WorldManager {
  readonly root = new THREE.Group();
  readonly chunks: ChunkManager<ChunkData>;
  readonly manifest: WorldManifest;
  private readonly built = new Map<string, BuiltChunk>();
  private readonly jobs: BuildJob[] = [];
  private readonly available: Set<string>;
  private readonly seaPolys: Array<{ rings: Pt[][]; bounds: Rect }>;
  /** Sea coastline segments [x1,z1,x2,z2,…], for coastal palms and mangroves. */
  private readonly coastSegments: Float32Array;
  /** Rolling waves and shore foam near the player (browser only). */
  private readonly ocean: OceanWaves | null;
  private readonly seaMesh: THREE.Mesh | null;
  private readonly ground: THREE.Mesh;
  private home: HomeObjects | null = null;
  private homeLocation: HomeLocation | null = null;
  private homeBodies: RAPIER.RigidBody[] = [];
  private doorBody: RAPIER.RigidBody | null = null;
  private doorOpen = true;
  private preview: HomeObjects | null = null;
  private boundaryBody:RAPIER.RigidBody|null=null;
  private time = 0;
  private playerX = 0;
  private playerZ = 0;
  opts: WorldOptions;
  /** Milliseconds per frame the chunk builder may use. */
  buildBudgetMs = 6;
  lastBuildMs = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly physics: PhysicsWorld,
    loader: MapDataLoader,
    manifest: WorldManifest,
    sea: SeaData,
    opts: WorldOptions,
  ) {
    this.manifest = manifest;
    this.opts = { ...opts };
    this.root.name = 'world';
    scene.add(this.root);
    this.available = new Set(manifest.chunks.map((c) => c.key));
    const b = manifest.bounds;
    this.ground = createGroundPlane(Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 12000);
    this.ground.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    this.ground.updateMatrix();
    this.root.add(this.ground);
    this.seaPolys = sea.polygons.map((poly) => {
      const rings = poly.map(flatToPts);
      return { rings, bounds: ringBounds(rings[0]!) };
    });
    const seg: number[] = [];
    // Skip the artificial edges where the sea polygon is cut at the map border.
    const onEdge = (q: Pt) => Math.abs(q[0] - b.minX) < 1 || Math.abs(q[0] - b.maxX) < 1 || Math.abs(q[1] - b.minZ) < 1 || Math.abs(q[1] - b.maxZ) < 1;
    for (const p of this.seaPolys) for (const r of p.rings) for (let i = 0; i < r.length; i++) {
      const a = r[i]!, c = r[(i + 1) % r.length]!;
      if (onEdge(a) && onEdge(c)) continue;
      seg.push(a[0], a[1], c[0], c[1]);
    }
    this.coastSegments = Float32Array.from(seg);
    this.seaMesh = buildSea(sea);
    if (this.seaMesh) this.root.add(this.seaMesh);
    this.ocean = typeof document !== 'undefined' && this.seaPolys.length ? new OceanWaves(this.seaPolys) : null;
    if (this.ocean) this.root.add(this.ocean.mesh);

    this.chunks = new ChunkManager<ChunkData>({
      chunkSize: manifest.chunkSize,
      available: (cx, cz) => this.available.has(chunkKey(cx, cz)),
      load: (cx, cz, signal) => loader.chunk(cx, cz, manifest.chunkSize, signal),
      onLoaded: (key, _cx, _cz, data) => this.jobs.push({ key, data, steps: this.buildSteps(key, data) }),
      onUnloaded: (key) => this.unbuild(key),
      onError: (key, err) => console.warn(`[World] chunk ${key} failed to load`, err),
      maxConcurrent: 3,
    });
    this.chunks.viewRadius = opts.viewRadius;
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  update(dt: number, playerX: number, playerZ: number): void {
    this.time += dt;
    this.playerX = playerX;
    this.playerZ = playerZ;
    waterMaterial().uniforms['uTime']!.value = this.time;
    this.ocean?.update(playerX, playerZ, 0);
    this.chunks.update(playerX, playerZ);
    this.runJobs();
    if (this.home && this.homeLocation) {
      const inside = Math.abs(playerX-this.homeLocation.x)<4.3 && playerZ>this.homeLocation.z-4.3 && playerZ<this.homeLocation.z+4.3;
      this.home.roof.visible = !inside;
    }
    this.updateActivation();
  }

  /** Runs pending chunk builds within the frame budget (at least one step). */
  private runJobs(budgetMs = this.buildBudgetMs): void {
    const t0 = performance.now();
    while (this.jobs.length) {
      // Build nearest chunk first.
      this.jobs.sort((a, b) => this.distTo(a.data) - this.distTo(b.data));
      const job = this.jobs[0]!;
      const r = job.steps.next();
      if (r.done) {
        this.jobs.shift();
        if (r.value) this.built.set(job.key, r.value);
      }
      if (performance.now() - t0 > budgetMs) break;
    }
    this.lastBuildMs = performance.now() - t0;
  }

  /** Builds everything currently queued, ignoring the frame budget (used on loading screens). */
  flushJobs(): void {
    this.runJobs(Number.POSITIVE_INFINITY);
  }

  private distTo(d: ChunkData): number {
    const s = this.manifest.chunkSize;
    return Math.hypot((d.cx + 0.5) * s - this.playerX, (d.cz + 0.5) * s - this.playerZ);
  }

  private chebyshev(c: { cx: number; cz: number }): number {
    const s = this.manifest.chunkSize;
    return Math.max(Math.abs(c.cx - Math.floor(this.playerX / s)), Math.abs(c.cz - Math.floor(this.playerZ / s)));
  }

  /** Activates physics and detail for nearby chunks; deactivates far ones. */
  private updateActivation(): void {
    for (const c of this.built.values()) {
      const d = this.chebyshev(c);
      const wantPhysics = d <= this.opts.physicsRadius;
      if (wantPhysics && !c.physics) this.activatePhysics(c);
      else if (!wantPhysics && c.physics) this.deactivatePhysics(c);
      const detail = d <= this.opts.detailRadius;
      c.detail.visible = detail;
      for (const site of c.sites) site.update(this.playerX, this.playerZ);
      if (c.buildingsMesh) c.buildingsMesh.castShadow = d <= 1;
      if (c.landmarks) {
        for (const l of c.landmarks.labels) {
          const dist = Math.hypot(l.landmark.x - this.playerX, l.landmark.z - this.playerZ);
          l.sprite.visible = dist < 260;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Chunk construction (staged across frames)
  // -------------------------------------------------------------------------

  private *buildSteps(key: string, data: ChunkData): Generator<void, BuiltChunk | null, void> {
    const m = materials();
    const group = new THREE.Group();
    group.name = `chunk_${key}`;
    const detail = new THREE.Group();
    detail.name = 'detail';
    group.add(detail);
    let triangles = 0;
    const add = (geo: THREE.BufferGeometry | null, mat: THREE.Material | THREE.Material[], parent: THREE.Object3D = group, receive = true, cast = false): THREE.Mesh | null => {
      if (!geo) return null;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = receive;
      mesh.castShadow = cast;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      triangles += (geo.index?.count ?? geo.getAttribute('position').count) / 3;
      return mesh;
    };

    // Stage 1: ground surfaces.
    add(buildLanduse(data.landuse), m.landuse);
    const wet = buildWater(data.water, data.waterways);
    add(wet.water, waterMaterial(), group, false);
    add(wet.banks, m.solid);
    const roads = buildRoads(data.roads);
    add(roads.asphalt, m.asphalt);
    add(roads.sidewalk, m.sidewalk);
    add(roads.path, m.path);
    add(roads.marking, m.marking);
    add(roads.wood, m.wood, group, true, true);
    add(roads.rail, m.metal, group, true, true);
    add(roads.steel, m.steel, group, true, true);
    add(roads.solid, m.solid, group, true, true);
    const roadIndex = new SegmentIndex();
    for (const r of data.roads) roadIndex.addLine(r.p, r.w / 2 + (DRIVABLE.has(r.c) ? 0 : 0.2), r.n);
    const waterwayIndex = new SegmentIndex();
    for (const w of data.waterways) waterwayIndex.addLine(w.p, w.w / 2);
    const waterRings = data.water.map((w) => {
      const rings = w.r.map(flatToPts);
      return { rings, bounds: ringBounds(rings[0]!) };
    });
    yield;

    // Stage 2: buildings.
    const b = buildBuildings(data.buildings);
    const buildingsMesh = add(b.geometry, [m.buildingWall, m.buildingRoof], group, true, true);
    const buildingIndex = new PolygonIndex(b.footprints);
    yield;

    // Stage 3: detail (vegetation, streetlights, landmarks).
    const chunk: BuiltChunk = {
      key,
      cx: data.cx,
      cz: data.cz,
      data,
      group,
      detail,
      buildingsMesh,
      roadIndex,
      waterwayIndex,
      buildingIndex,
      waterRings,
      collider: b.collider,
      trunks: [],
      lamps: [],
      stupas: [],
      boxes: [],
      ramps: [],
      sites: [],
      landmarks: null,
      vegetation: [],
      signs:buildStreetSigns(data.roads,(x,z)=>!buildingIndex.hit(x,z,1)&&!this.landmarkReserved(x,z)&&!this.inHomePlot(x,z)&&!this.isBlocked(x,z)),
      physics: null,
      stats: { triangles: 0 },
    };
    detail.add(chunk.signs);
    this.buildVegetation(chunk);
    const clearLamps=(p:number[])=>{const out:number[]=[];for(let i=0;i<p.length;i+=2)if(!this.landmarkReserved(p[i]!,p[i+1]!)&&!this.inHomePlot(p[i]!,p[i+1]!))out.push(p[i]!,p[i+1]!);return out;};
    const lights = buildStreetLights(clearLamps(roads.lampCandidates), clearLamps(data.lamps), buildingIndex);
    if (lights.pole) detail.add(lights.pole);
    if (lights.head) detail.add(lights.head);
    chunk.lamps = lights.positions;
    yield;
    this.buildLandmarkObjects(chunk);
    chunk.stats.triangles = triangles;

    if (!this.chunks.state(key) || this.chunks.state(key) !== 'loaded') {
      // Unloaded while we were building.
      disposeGroup(group);
      return null;
    }
    this.root.add(group);
    return chunk;
  }

  private landmarkReserved(x:number,z:number):boolean {
    for(const lm of this.manifest.landmarks) {
      if(lm.pg) {
        const bounds=ringBounds(flatToPts(lm.pg));
        if(x>bounds.minX-6 && x<bounds.maxX+6 && z>bounds.minY-6 && z<bounds.maxY+6)return true;
      }
      if(lm.pr) {
        const st=lm.pr.stations;
        for(let i=0;i<st.length;i+=4)if(Math.hypot(x-st[i]!,z-st[i+1]!)<Math.max(st[i+2]!,st[i+3]!)+4)return true;
      }
      if(['clock','monument','memorial','statue','artwork'].includes(lm.k) && Math.hypot(x-lm.x,z-lm.z)<12)return true;
      if(lm.sx!==undefined && lm.sz!==undefined && Math.hypot(x-lm.sx,z-lm.sz)<(lm.ss??.8)*4+3)return true;
    }
    return false;
  }

  private buildVegetation(c: BuiltChunk): void {
    for (const v of c.vegetation) {
      c.detail.remove(v);
      v.dispose();
    }
    const trees = placeTrees(c.key, c.data.trees, c.data.landuse, { buildings: c.buildingIndex, roads: c.roadIndex, isReserved: (x,z)=>this.inHomePlot(x,z)||this.landmarkReserved(x,z), isWater: (x, z) => this.inHomePlot(x,z) || this.landmarkReserved(x,z) || this.isWater(x, z, c) }, this.opts.vegetationDensity);
    const size = this.manifest.chunkSize, bounds = { minX: c.cx * size, maxX: (c.cx + 1) * size, minZ: c.cz * size, maxZ: (c.cz + 1) * size };
    const coast: number[] = [];
    const cs = this.coastSegments;
    for (let i = 0; i < cs.length; i += 4) {
      if (Math.max(cs[i]!, cs[i + 2]!) < bounds.minX || Math.min(cs[i]!, cs[i + 2]!) > bounds.maxX || Math.max(cs[i + 1]!, cs[i + 3]!) < bounds.minZ || Math.min(cs[i + 1]!, cs[i + 3]!) > bounds.maxZ) continue;
      coast.push(cs[i]!, cs[i + 1]!, cs[i + 2]!, cs[i + 3]!);
    }
    if (coast.length) trees.push(...placeCoastalTrees(c.key, coast, bounds, { buildings: c.buildingIndex, roads: c.roadIndex, isReserved: (x, z) => this.inHomePlot(x, z) || this.landmarkReserved(x, z), isWater: (x, z) => this.isWater(x, z, c) }, this.opts.vegetationDensity));
    const veg = buildVegetation(trees);
    c.vegetation = veg.meshes;
    for (const mesh of veg.meshes) c.detail.add(mesh);
    c.trunks = veg.trunks;
  }

  private buildLandmarkObjects(c: BuiltChunk): void {
    if (c.landmarks) {
      c.detail.remove(c.landmarks.group);
      disposeLandmarks(c.landmarks);
      c.landmarks = null;
    }
    if (c.data.landmarks.length === 0 || typeof document === 'undefined') return;
    c.landmarks = buildLandmarks(c.data.landmarks, this.opts.lang, c.buildingIndex, c.roadIndex, c.data.roads);
    c.group.add(c.landmarks.group);
    c.stupas = c.landmarks.stupas;
    c.boxes = c.landmarks.boxes;
    c.ramps = c.landmarks.ramps;
    c.sites = c.landmarks.sites;
  }

  private unbuild(key: string): void {
    const idx = this.jobs.findIndex((j) => j.key === key);
    if (idx >= 0) this.jobs.splice(idx, 1);
    const c = this.built.get(key);
    if (!c) return;
    this.built.delete(key);
    if (c.physics) this.deactivatePhysics(c);
    if (c.landmarks) disposeLandmarks(c.landmarks);
    c.signs.removeFromParent();disposeStreetSigns(c.signs);
    this.root.remove(c.group);
    disposeGroup(c.group);
  }

  private activatePhysics(c: BuiltChunk): void {
    const bodies: RAPIER.RigidBody[] = [];
    const building = c.collider ? this.physics.createStaticTrimesh(c.collider.vertices, c.collider.indices, Groups.building) : null;
    const trunks = this.physics.createStaticCylinders(c.trunks, 0.28, 3, Groups.prop);
    if (trunks) bodies.push(trunks);
    const lamps = this.physics.createStaticCylinders(c.lamps, 0.12, 6, Groups.prop);
    if (lamps) bodies.push(lamps);
    for (let i = 0; i < c.stupas.length; i += 3) {
      const s = this.physics.createStaticCylinders([c.stupas[i]!, c.stupas[i + 1]!], c.stupas[i + 2]!, 3, Groups.prop);
      if (s) bodies.push(s);
    }
    const boxBody = this.physics.createStaticBoxes(c.boxes, Groups.building);
    if (boxBody) bodies.push(boxBody);
    const rampBody = this.physics.createStaticHulls(c.ramps, Groups.walkway);
    if (rampBody) bodies.push(rampBody);
    c.physics = { building, bodies };
  }

  private deactivatePhysics(c: BuiltChunk): void {
    if (!c.physics) return;
    if (c.physics.building) this.physics.removeCollider(c.physics.building);
    for (const b of c.physics.bodies) this.physics.removeBody(b);
    c.physics = null;
  }

  // -------------------------------------------------------------------------
  // Loading helpers
  // -------------------------------------------------------------------------

  /**
   * Loads and fully builds every chunk within `radius` of (x, z) and activates
   * physics there. Used before spawning so the player never falls through.
   */
  async prepareArea(x: number, z: number, radius: number, onProgress?: (done: number, total: number) => void): Promise<void> {
    this.playerX = x;
    this.playerZ = z;
    this.chunks.invalidate();
    this.chunks.update(x, z);
    const keys = this.chunks.keysAround(x, z, radius).map((k) => k.key);
    const total = keys.length;
    const tick = () => onProgress?.(keys.filter((k) => this.built.has(k)).length, total);
    tick();
    const waitAll = this.chunks.waitForArea(x, z, radius);
    let done = false;
    void waitAll.then(() => (done = true));
    while (!done || this.jobs.length) {
      this.runJobs(30);
      tick();
      await new Promise((r) => setTimeout(r, 0));
    }
    this.updateActivation();
    tick();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  private chunkAt(x: number, z: number): BuiltChunk | undefined {
    const s = this.manifest.chunkSize;
    return this.built.get(chunkKey(Math.floor(x / s), Math.floor(z / s)));
  }

  /** Interactive landmark sites (pagoda complexes) in built chunks. */
  pagodaSites(): PagodaSite[] {
    const out: PagodaSite[] = [];
    for (const c of this.built.values()) out.push(...c.sites);
    return out;
  }

  /** True if (x, z) is inside the sea or a mapped water body. */
  isWater(x: number, z: number, hint?: BuiltChunk): boolean {
    for (const p of this.seaPolys) {
      const b = p.bounds;
      if (x < b.minX || x > b.maxX || z < b.minY || z > b.maxY) continue;
      if (pointInRings(x, z, p.rings)) return true;
    }
    const c = hint ?? this.chunkAt(x, z);
    if (c) {
      if (c.waterwayIndex.hit(x, z, 0)) return true;
      for (const w of c.waterRings) {
        const b = w.bounds;
        if (x < b.minX || x > b.maxX || z < b.minY || z > b.maxY) continue;
        if (pointInRings(x, z, w.rings)) return true;
      }
    }
    return false;
  }

  /** True if (x, z) is on a mapped road/path/pier (incl. bridges over water). */
  hasChunkAt(x: number,z: number): boolean { return this.built.has(chunkKey(Math.floor(x/this.manifest.chunkSize),Math.floor(z/this.manifest.chunkSize))); }

  isOnRoad(x: number, z: number, margin = 0.5): boolean {
    const c = this.chunkAt(x, z);
    return !!c && c.roadIndex.hit(x, z, margin);
  }

  /** Water that the player or a car must not enter (water not crossed by a road or pier). */
  isBlocked(x: number, z: number): boolean {
    return this.isWater(x, z) && !this.isOnRoad(x, z, 1.0);
  }

  /** Name of the nearest named road within 40 m. */
  roadNameAt(x: number, z: number): string | undefined {
    let best: { name: string; dist: number } | undefined;
    const s = this.manifest.chunkSize;
    const cx = Math.floor(x / s);
    const cz = Math.floor(z / s);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.built.get(chunkKey(cx + dx, cz + dz));
        if (!c) continue;
        const near = c.roadIndex.nearest(x, z, 40);
        if (!near) continue;
        const name = c.roadIndex.names[near.index];
        if (name && (!best || near.dist < best.dist)) best = { name, dist: near.dist };
      }
    }
    return best?.name;
  }

  nearestPlace(x: number, z: number, maxDist = 900): PlaceEntry | undefined {
    let best: PlaceEntry | undefined;
    let bd = maxDist;
    for (const p of this.manifest.places) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Lamp positions within `radius` of (x, z), nearest first (max `limit`). */
  lampsNear(x: number, z: number, radius: number, limit: number): Array<[number, number]> {
    const out: Array<[number, number, number]> = [];
    for (const c of this.built.values()) {
      if (this.chebyshev(c) > 1) continue;
      for (let i = 0; i < c.lamps.length; i += 2) {
        const d = Math.hypot(c.lamps[i]! - x, c.lamps[i + 1]! - z);
        if (d < radius) out.push([c.lamps[i]!, c.lamps[i + 1]!, d]);
      }
    }
    out.sort((a, b) => a[2] - b[2]);
    return out.slice(0, limit).map(([lx, lz]) => [lx, lz]);
  }

  /** True if a person-sized capsule at (x, z) would overlap a building, prop or water. */
  isOccupied(x: number, z: number, clearance = 0.6): boolean {
    if (this.isBlocked(x, z)) return true;
    const s = this.manifest.chunkSize;
    const cx = Math.floor(x / s);
    const cz = Math.floor(z / s);
    // Footprint test (buildings are stored in the chunk holding their centroid, so check neighbours).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.built.get(chunkKey(cx + dx, cz + dz));
        if (c?.buildingIndex.hit(x, z, clearance)) return true;
      }
    }
    // Physics test catches trees, poles, statues and anything else with a collider.
    const R = this.physics.R;
    const hit = this.physics.world.intersectionWithShape(
      { x, y: 0.08 + 0.9, z },
      { x: 0, y: 0, z: 0, w: 1 },
      new R.Capsule(0.55, clearance),
      undefined,
      Groups.cameraRay,
      this.physics.groundCollider,
    );
    return hit !== null;
  }

  /**
   * Nearest free standing spot to (x, z). If the requested point is clear it
   * is used as-is; otherwise searches outward in rings, preferring a point on
   * a mapped road/path within 30 m, then any clear point.
   */
  findFreeSpot(x: number, z: number, maxRadius = 60): { x: number; z: number } {
    if (!this.isOccupied(x, z)) return { x, z };
    let fallback: { x: number; z: number } | null = null;
    for (let r = 1.5; r <= maxRadius; r += 1.5) {
      const n = Math.max(8, Math.round(r * 2.5));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.isOccupied(px, pz)) continue;
        if (this.isOnRoad(px, pz, 0)) return { x: px, z: pz };
        fallback ??= { x: px, z: pz };
      }
      if (fallback && r >= 30) return fallback;
    }
    return fallback ?? { x, z };
  }

  /** Raycast-free ground height (flat world). */
  groundHeight(): number {
    return 0;
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  setOptions(opts: Partial<WorldOptions>): void {
    const prev = this.opts;
    this.opts = { ...prev, ...opts };
    if (opts.viewRadius !== undefined && opts.viewRadius !== prev.viewRadius) {
      this.chunks.viewRadius = opts.viewRadius;
      this.chunks.invalidate();
    }
    if (opts.vegetationDensity !== undefined && opts.vegetationDensity !== prev.vegetationDensity) {
      for (const c of this.built.values()) {
        const hadPhysics = !!c.physics;
        if (hadPhysics) this.deactivatePhysics(c);
        this.buildVegetation(c);
        if (hadPhysics) this.activatePhysics(c);
      }
    }
    if (opts.lang !== undefined && opts.lang !== prev.lang) {
      for (const c of this.built.values()) this.buildLandmarkObjects(c);
    }
  }

  private inHomePlot(x: number, z: number): boolean {
    if (!this.homeLocation) return false;
    const r=homeRect(this.homeLocation);
    return x>=r.minX && x<=r.maxX && z>=r.minY && z<=r.maxY;
  }

  setBoundaries(data:BoundaryData):void {
    const b=buildBoundaries(data);this.root.add(b.group);
    this.boundaryBody=this.physics.createStaticBoxes(b.boxes,Groups.building);
  }

  setHome(p: HomeLocation): void {
    for(const b of this.homeBodies) this.physics.removeBody(b);
    this.homeBodies=[];
    if(this.doorBody) this.physics.removeBody(this.doorBody);
    if(this.home) disposeHome(this.home);
    this.homeLocation={...p};this.home=buildHome(p);this.root.add(this.home.group);
    const boxes=this.physics.createStaticBoxes(this.home.boxes,Groups.building);
    const ramps=this.physics.createStaticHulls(this.home.ramps,Groups.building);
    if(boxes)this.homeBodies.push(boxes);if(ramps)this.homeBodies.push(ramps);
    this.doorBody=this.physics.createStaticBoxes([p.x,3.14,p.z+2.12,.75,1.22,.05,0],Groups.building);
    this.doorOpen=true;this.doorBody?.setEnabled(false);
    for(const c of this.built.values()) {
      const active=!!c.physics;if(active)this.deactivatePhysics(c);
      this.buildVegetation(c);if(active)this.activatePhysics(c);
    }
  }

  previewHome(p: HomeLocation | null): void {
    if(this.preview) disposeHome(this.preview);
    this.preview=p?buildHome(p,true):null;
    if(this.preview)this.root.add(this.preview.group);
  }

  nearHomeDoor(x: number,z: number): boolean {
    return !!this.homeLocation && Math.hypot(x-this.homeLocation.x,z-this.homeLocation.z-2.1)<2.2;
  }

  toggleHomeDoor(): void {
    if(!this.home)return;
    this.doorOpen=!this.doorOpen;
    this.home.door.rotation.y=this.doorOpen?-Math.PI*.48:0;
    this.doorBody?.setEnabled(!this.doorOpen);
  }

  stats(): { loaded: number; built: number; pending: number; triangles: number } {
    let triangles = 0;
    for (const c of this.built.values()) triangles += c.stats.triangles;
    return { loaded: this.chunks.loadedCount, built: this.built.size, pending: this.chunks.pendingCount + this.jobs.length, triangles };
  }

  dispose(): void {
    this.previewHome(null);
    if(this.boundaryBody)this.physics.removeBody(this.boundaryBody);
    if(this.home)disposeHome(this.home);
    for(const b of this.homeBodies)this.physics.removeBody(b);
    if(this.doorBody)this.physics.removeBody(this.doorBody);
    this.chunks.dispose();
    this.scene.remove(this.root);
    this.ground.geometry.dispose();
    this.seaMesh?.geometry.dispose();
  }
}

function flatToPts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
}

/** Disposes geometries (materials are shared and kept). */
function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      // Shared tree/lamp geometries are cached module-wide; only dispose per-chunk ones.
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
      else if (!mesh.userData['sharedGeometry']) mesh.geometry.dispose();
    }
  });
}
