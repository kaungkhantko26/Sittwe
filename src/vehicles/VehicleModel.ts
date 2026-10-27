import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly four-door car built from primitives (no external asset). Faces -Z.
 * Dimensions roughly match a small sedan: 1.8 m wide, 4.3 m long, 1.45 m tall.
 */
export interface VehicleVisual {
  root: THREE.Group;
  /** Wheel pivots: FL, FR, RL, RR. Each contains a spinning child. */
  wheels: Array<{ pivot: THREE.Group; spin: THREE.Group }>;
  brakeMat: THREE.MeshStandardMaterial;
  headMat: THREE.MeshStandardMaterial;
  rotors: THREE.Group[];
  thrustMat: THREE.MeshStandardMaterial | null;
  thrusts:THREE.Mesh[];
  /** Bicycle pedal crank (spun while pedalling). */
  crank?: THREE.Group;
  /** Seat top in body space, for placing the rider. */
  seat?: THREE.Vector3;
  /** Motorbike exhaust pipe tip (smoke comes out here). */
  exhaust?: THREE.Object3D;
}

const WHEEL_RADIUS = 0.34;
/** Distance from the physics body origin down to the ground when at rest. */
export const MODEL_GROUND_OFFSET = 0.54;
export const WHEEL_POSITIONS: Array<[number, number, number]> = [
  [-0.78, 0, -1.33],
  [0.78, 0, -1.33],
  [-0.78, 0, 1.3],
  [0.78, 0, 1.3],
];

export const BODY_COLORS = [0xd8d3c8, 0xb52b2b, 0x2a5aa8, 0x2f2f33, 0xe7b23a, 0x3e7d5b];

/** Merges the body parts into one mesh per material (≈6 draw calls instead of ≈17). */
function mergeShell(shell: THREE.Group): void {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  shell.updateMatrixWorld(true);
  for (const child of [...shell.children]) {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) continue;
    mesh.updateMatrix();
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrix);
    // Vehicle materials are untextured; custom shell and primitive parts must share attributes.
    g.deleteAttribute('uv');
    const list = byMat.get(mesh.material as THREE.Material) ?? [];
    if(g.index){list.push(g.toNonIndexed());g.dispose()}else list.push(g);
    byMat.set(mesh.material as THREE.Material, list);
    shell.remove(mesh);
    mesh.geometry.dispose();
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    shell.add(m);
  }
}

export function createVehicleModel(color: number, flying = false): VehicleVisual {
  const root = new THREE.Group();
  root.name = flying ? 'reference-flying-sedan' : 'vehicle';
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.45 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c2a38, roughness: 0.1, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf6f3e8, emissive: new THREE.Color(0xfff2c8), emissiveIntensity: 0 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x7a1010, emissive: new THREE.Color(0xff2020), emissiveIntensity: 0.15 });

  // The root follows the physics body; the shell is shifted so that the
  // model's ground level (y = 0) sits at the wheels' contact height.
  const shell = new THREE.Group();
  shell.position.y = -MODEL_GROUND_OFFSET;
  root.add(shell);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    shell.add(mesh);
    return mesh;
  };

  // Sculpted nose, shoulders and tail for the reference-inspired electric sedan.
  if(flying) {
    const positions:number[]=[],indices:number[]=[];
    const zs=[-2.25,-1.95,-1.72,-1.58,-1.33,-1.08,-.9,-.5,.6,.92,1.05,1.3,1.55,1.72,2.2];
    const sections=zs.map(z=>[z,Math.abs(z)>2?.74:Math.abs(z)>1.8?.87:.93,Math.abs(z)>2?.65:Math.abs(z)>1.8?.76:.88]);
    for(const [z,w,h] of sections){
      let low=.28;for(const axle of [-1.33,1.3]){const d=Math.abs(z!-axle);if(d<.43)low=Math.max(low,.34+Math.sqrt(.43*.43-d*d));}
      const corner=Math.min(.08,(h!-low)*.35);
      for(const [x,y] of [[-w!*.86,low],[w!*.86,low],[w!,low+corner],[w!,h!-corner],[w!*.8,h!],[-w!*.8,h!],[-w!,h!-corner],[-w!,low+corner]])positions.push(x!,y!,z!);
    }
    for(let j=0;j<sections.length-1;j++)for(let i=0;i<8;i++){const a=j*8+i,b=j*8+(i+1)%8,c=b+8,d=a+8;indices.push(a,b,c,a,c,d)}
    for(let i=1;i<7;i++){indices.push(0,i+1,i);const n=(sections.length-1)*8;indices.push(n,n+i,n+i+1)}
    const body=new THREE.BufferGeometry();body.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));body.setIndex(indices);body.computeVertexNormals();add(body,paint,0,0,0);
  } else add(new THREE.BoxGeometry(1.78, 0.5, 4.3), paint, 0, 0.55, 0);
  // Bonnet slope + boot.
  if(!flying){const hood=add(new THREE.BoxGeometry(1.7,.16,1.2),paint,0,.84,-1.45);hood.rotation.x=.08;add(new THREE.BoxGeometry(1.7,.14,.8),paint,0,.84,1.68);}
  // Cabin (tapered).
  const cabinGeo = new THREE.BoxGeometry(1.6, 0.56, 2.2, 1, 1, 1);
  const pos = cabinGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, pos.getX(i) * 0.88);
      pos.setZ(i, pos.getZ(i) * 0.78);
    }
  }
  cabinGeo.computeVertexNormals();
  if(flying) {
    cabinGeo.dispose();
    const A=[-.76,.86,-1.22],B=[.76,.86,-1.22],C=[.65,1.36,-.48],D=[-.65,1.36,-.48],E=[-.65,1.39,.55],F=[.65,1.39,.55],G=[.78,.85,1.5],H=[-.78,.85,1.5];
    const v:number[]=[];
    for(const quad of [[A,B,C,D],[D,C,F,E],[E,F,G,H],[A,D,E,H],[B,G,F,C]])for(const i of [0,1,2,0,2,3])v.push(...quad[i]!);
    const canopy=new THREE.BufferGeometry();canopy.setAttribute('position',new THREE.Float32BufferAttribute(v,3));canopy.computeVertexNormals();glass.side=THREE.DoubleSide;add(canopy,glass,0,0,0);
    for(const sx of [-1,1]){
      const pillar=add(new THREE.BoxGeometry(.035,.48,.07),dark,sx*.76,1.08,.18);pillar.rotation.z=sx*.18;
      for(const z of [-.5,.85])add(new THREE.BoxGeometry(.025,.026,.17),chrome,sx*.936,.82,z);
      const sill=add(new THREE.BoxGeometry(.035,.035,2.7),chrome,sx*.91,.3,.1);sill.rotation.x=0;
      for(const z of [-.1,1.15])add(new THREE.BoxGeometry(.012,.4,.012),dark,sx*.937,.56,z);
    }
  } else add(cabinGeo, glass, 0, 1.08, 0.12);
  if(!flying) add(new THREE.BoxGeometry(1.36, 0.06, 1.66), paint, 0, 1.38, 0.12); // roof
  // Bumpers and grille.
  if(flying){add(new THREE.BoxGeometry(.85,.09,.04),dark,0,.43,-2.26);add(new THREE.BoxGeometry(1.4,.06,.08),paint,0,.32,-2.2);add(new THREE.BoxGeometry(1.3,.08,.06),dark,0,.35,2.18);}
  else {add(new THREE.BoxGeometry(1.82,.18,.16),dark,0,.36,-2.18);add(new THREE.BoxGeometry(1.82,.18,.16),dark,0,.36,2.18);add(new THREE.BoxGeometry(.8,.14,.04),chrome,0,.62,-2.16);}
  // Lights.
  for (const sx of [-0.62, 0.62]) {
    const light=add(new THREE.BoxGeometry(.34,flying?.055:.12,.05),headMat,sx,flying?.73:.66,flying?-2.07:-2.16);if(flying)light.rotation.z=sx>0?-.12:.12;
    add(new THREE.BoxGeometry(0.36, 0.12, 0.05), brakeMat, sx, 0.66, 2.16);
  }
  // Mirrors.
  for (const sx of [-0.95, 0.95]) add(new THREE.BoxGeometry(0.12, 0.1, 0.18), paint, sx, 0.98, -0.55);

  const rotors:THREE.Group[]=[],thrusts:THREE.Mesh[]=[];
  const thrustMat=flying?new THREE.MeshStandardMaterial({color:0x4ed9ff,emissive:0x0c9eff,emissiveIntensity:2,transparent:true,opacity:.8}):null;
  if(flying) {
    for(const sx of [-1,1]) for(const z of [-1.4,1.4]) {
      const x=sx*2.05;
      add(new THREE.BoxGeometry(1.1,.13,.22),dark,sx*1.4,.65,z);
      add(new THREE.CylinderGeometry(.44,.4,.25,16),dark,x,.65,z);
      const ring=add(new THREE.TorusGeometry(.43,.035,6,18),thrustMat!,x,.72,z);ring.rotation.x=Math.PI/2;
      const hub=add(new THREE.CylinderGeometry(.13,.13,.2,10),chrome,x,.85,z);
      hub.name='rotor-hub';
      const fan=new THREE.Group();fan.position.set(x,.87-MODEL_GROUND_OFFSET,z);
      for(const angle of [0,Math.PI/2]){const blade=new THREE.Mesh(new THREE.BoxGeometry(.67,.025,.07),chrome);blade.rotation.y=angle;fan.add(blade)}
      root.add(fan);rotors.push(fan);
      const glowMat=thrustMat!.clone();glowMat.opacity=.25;glowMat.depthWrite=false;
      const glow=new THREE.Mesh(new THREE.ConeGeometry(.24,.65,10),glowMat);glow.position.set(x,.17-MODEL_GROUND_OFFSET,z);glow.rotation.x=Math.PI;glow.visible=false;root.add(glow);thrusts.push(glow);
    }
    add(new THREE.BoxGeometry(.85,.035,.04),thrustMat!,0,.37,-2.27);
    add(new THREE.BoxGeometry(1.1,.035,.04),brakeMat,0,.7,2.21);
  }
  mergeShell(shell);

  // Wheels.
  const tire = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.95 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xa3a8ad, roughness: 0.4, metalness: 0.7 });
  const tireGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.24, 14).rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.58, WHEEL_RADIUS * 0.58, 0.25, 8).rotateZ(Math.PI / 2);
  const wheels: VehicleVisual['wheels'] = [];
  for (const [x, y, z] of WHEEL_POSITIONS) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const spin = new THREE.Group();
    const t = new THREE.Mesh(tireGeo, tire);
    t.castShadow = true;
    const r = new THREE.Mesh(rimGeo, rim);
    spin.add(t, r);
    pivot.add(spin);
    root.add(pivot);
    wheels.push({ pivot, spin });
  }

  return { root, wheels, brakeMat, headMat, rotors, thrustMat, thrusts };
}

export { WHEEL_RADIUS };

export function disposeVehicleModel(visual:VehicleVisual):void {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  visual.root.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;geometries.add(m.geometry);for(const mat of Array.isArray(m.material)?m.material:[m.material])materials.add(mat)});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
}

/** Ground level below the body origin for two-wheelers (wheel contact at rest). */
export const BIKE_GROUND = -0.51;
/** Rear tyre contact point along the bike (body space Z), the pivot for wheelies. */
export const REAR_WHEEL_Z = { motorbike: 0.64, bicycle: 0.55 } as const;
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);
const pitchQ = new THREE.Quaternion();
const pivotA = new THREE.Vector3();
const pivotB = new THREE.Vector3();

/**
 * Wheelie: tips a two-wheeler's model up about the rear tyre's contact point,
 * lifting the front wheel. Call after the model's base position and rotation
 * are set for this frame. angle in radians (positive = front up).
 */
export function liftFrontWheel(root: THREE.Object3D, kind: 'motorbike' | 'bicycle', angle: number): void {
  if (angle <= 1e-4) return;
  pivotA.set(0, BIKE_GROUND, REAR_WHEEL_Z[kind]);
  pitchQ.setFromAxisAngle(PITCH_AXIS, angle);
  // Keep the pivot fixed: shift by (P - R·P) in the model's frame.
  pivotB.copy(pivotA).applyQuaternion(pitchQ);
  pivotA.sub(pivotB).applyQuaternion(root.quaternion);
  root.position.add(pivotA);
  root.quaternion.multiply(pitchQ);
}

/** Motorbike rider's seat in body space (the passenger sits just behind). */
export const MOTORBIKE_SEAT = new THREE.Vector3(0, 0.85 + BIKE_GROUND, 0.22);

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true;
  return m;
}

function bikeWheel(radius: number, tyre: number, rimMat: THREE.Material, spokes: number): { pivot: THREE.Group; spin: THREE.Group } {
  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius - tyre, tyre, 6, 20).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.9 }));
  tire.castShadow = true;
  spin.add(tire);
  for (let i = 0; i < spokes; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, (radius - tyre) * 2, 0.012), rimMat);
    s.rotation.x = (i / spokes) * Math.PI;
    spin.add(s);
  }
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 8).rotateZ(Math.PI / 2), rimMat));
  pivot.add(spin);
  return { pivot, spin };
}

/**
 * Motorbike (underbone, the common 110 cc type in Myanmar) or bicycle, built
 * from primitives. Faces -Z; same VehicleVisual shape as cars, with two real
 * wheels (entries 1 and 3 are empty placeholders for the right-hand pair).
 */
export function createTwoWheelerModel(kind: 'motorbike' | 'bicycle', color: number): VehicleVisual {
  const root = new THREE.Group();
  root.name = kind;
  const shell = new THREE.Group();
  shell.position.y = BIKE_GROUND;
  root.add(shell);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.25, metalness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf6f3e8, emissive: new THREE.Color(0xfff2c8), emissiveIntensity: 0 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x7a1010, emissive: new THREE.Color(0xff2020), emissiveIntensity: 0.15 });
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.x = rx;
    b.castShadow = true;
    shell.add(b);
    return b;
  };
  let crank: THREE.Group | undefined;
  let exhaust: THREE.Object3D | undefined;
  let seat: THREE.Vector3;
  const wheelPositions: Array<[number, number]> = [];
  if (kind === 'motorbike') {
    const r = 0.3;
    wheelPositions.push([-0.66, r], [0.64, r]);
    // Underbone frame and body panels.
    shell.add(tube(V(0, 0.95, -0.5), V(0, 0.4, -0.08), 0.045, dark), tube(V(0, 0.4, -0.08), V(0, 0.55, 0.5), 0.045, dark));
    box(0.44, 0.5, 0.1, paint, 0, 0.58, -0.4, 0.25); // leg shield
    box(0.3, 0.3, 0.66, paint, 0, 0.62, 0.36); // rear body
    box(0.28, 0.09, 0.64, new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.85 }), 0, 0.8, 0.26); // seat
    box(0.2, 0.22, 0.32, dark, 0, 0.36, 0.04); // engine
    shell.add(tube(V(0.14, 0.3, 0.1), V(0.15, 0.36, 0.72), 0.04, chrome)); // exhaust
    exhaust = new THREE.Object3D();
    exhaust.name = 'exhaust';
    exhaust.position.set(0.15, 0.36, 0.76);
    shell.add(exhaust);
    box(0.16, 0.04, 0.5, paint, 0, r + 0.33, 0.66); // rear mudguard
    box(0.12, 0.04, 0.32, paint, 0, r + 0.32, -0.7, -0.3); // front mudguard
    // Fork, handlebars and lights.
    shell.add(tube(V(0.07, r, -0.66), V(0.06, 0.98, -0.52), 0.025, chrome), tube(V(-0.07, r, -0.66), V(-0.06, 0.98, -0.52), 0.025, chrome));
    shell.add(tube(V(-0.36, 1.03, -0.48), V(0.36, 1.03, -0.48), 0.022, chrome));
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.08, 12).rotateX(Math.PI / 2), headMat);
    lamp.position.set(0, 0.95, -0.6);
    shell.add(lamp);
    box(0.16, 0.06, 0.04, brakeMat, 0, 0.66, 0.7);
    for (const sx of [-1, 1]) box(0.05, 0.04, 0.03, new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 0.4 }), sx * 0.12, 0.72, 0.7);
    seat = MOTORBIKE_SEAT.clone();
  } else {
    const r = 0.34;
    wheelPositions.push([-0.55, r], [0.55, r]);
    const R = V(0, r, 0.55), F = V(0, r, -0.55), BB = V(0, 0.3, 0.05), S = V(0, 0.86, 0.17), H = V(0, 0.9, -0.4);
    shell.add(tube(S, BB, 0.02, paint), tube(BB, R, 0.016, paint), tube(S, R, 0.014, paint), tube(H, BB, 0.022, paint), tube(S.clone().setY(0.82), H.clone().setY(0.84), 0.018, paint), tube(H, F, 0.016, chrome));
    shell.add(tube(V(-0.27, 1.02, -0.36), V(0.27, 1.02, -0.36), 0.015, chrome), tube(H, V(0, 1.02, -0.36), 0.016, chrome));
    box(0.14, 0.05, 0.24, new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.8 }), 0, 0.92, 0.17); // saddle
    // Front basket (common on Sittwe city bikes).
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.26), new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 0.9, wireframe: true }));
    basket.position.set(0, 0.92, -0.62);
    shell.add(basket);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.06, 10).rotateX(Math.PI / 2), headMat);
    lamp.position.set(0, 0.84, -0.5);
    shell.add(lamp);
    box(0.06, 0.04, 0.02, brakeMat, 0, 0.72, 0.42);
    // Pedal crank: spun while pedalling.
    crank = new THREE.Group();
    crank.position.copy(BB).add(V(0, BIKE_GROUND, 0));
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.03), chrome);
      arm.position.set(side * 0.09, side * 0.085, 0);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.06), dark);
      pedal.position.set(side * 0.12, side * 0.17, 0);
      crank.add(arm, pedal);
    }
    root.add(crank);
    seat = V(0, 0.95 + BIKE_GROUND, 0.15);
  }
  const rim = kind === 'motorbike' ? dark : chrome;
  const front = bikeWheel(wheelPositions[0]![1], kind === 'motorbike' ? 0.06 : 0.025, rim, kind === 'motorbike' ? 3 : 8);
  const rear = bikeWheel(wheelPositions[1]![1], kind === 'motorbike' ? 0.065 : 0.025, rim, kind === 'motorbike' ? 3 : 8);
  front.pivot.position.set(0, wheelPositions[0]![1] + BIKE_GROUND, wheelPositions[0]![0]);
  rear.pivot.position.set(0, wheelPositions[1]![1] + BIKE_GROUND, wheelPositions[1]![0]);
  root.add(front.pivot, rear.pivot);
  const empty = () => ({ pivot: new THREE.Group(), spin: new THREE.Group() });
  return { root, wheels: [front, empty(), rear, empty()], brakeMat, headMat, rotors: [], thrustMat: null, thrusts: [], ...(crank ? { crank } : {}), ...(exhaust ? { exhaust } : {}), seat };
}
