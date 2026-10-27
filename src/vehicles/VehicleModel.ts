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
  /** Rotor pods that fold out of the body only while flying (flying tuktuk). */
  pods?: THREE.Object3D[];
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

  const rotors:THREE.Group[]=[],thrusts:THREE.Mesh[]=[],pods:THREE.Object3D[]=[];
  const thrustMat=flying?new THREE.MeshStandardMaterial({color:0x4ed9ff,emissive:0x0c9eff,emissiveIntensity:2,transparent:true,opacity:.8}):null;
  if(flying) {
    // Rotor pods fold out from the body sides only while flying (see deployPods).
    for(const sx of [-1,1]) for(const z of [-1.4,1.4]) {
      const pod=new THREE.Group();pod.position.set(sx*.85,.65-MODEL_GROUND_OFFSET,z);
      const part=(geo:THREE.BufferGeometry,m:THREE.Material,x:number,y:number)=>{const mesh=new THREE.Mesh(geo,m);mesh.position.set(x,y,0);mesh.castShadow=true;pod.add(mesh);return mesh;};
      const x=sx*1.2;
      part(new THREE.BoxGeometry(1.1,.13,.22),dark,sx*.55,0);
      part(new THREE.CylinderGeometry(.44,.4,.25,16),dark,x,0);
      const ring=part(new THREE.TorusGeometry(.43,.035,6,18),thrustMat!,x,.07);ring.rotation.x=Math.PI/2;
      part(new THREE.CylinderGeometry(.13,.13,.2,10),chrome,x,.2).name='rotor-hub';
      const fan=new THREE.Group();fan.position.set(x,.22,0);
      for(const angle of [0,Math.PI/2]){const blade=new THREE.Mesh(new THREE.BoxGeometry(.67,.025,.07),chrome);blade.rotation.y=angle;fan.add(blade)}
      pod.add(fan);rotors.push(fan);
      const glowMat=thrustMat!.clone();glowMat.opacity=.25;glowMat.depthWrite=false;
      const glow=new THREE.Mesh(new THREE.ConeGeometry(.24,.65,10),glowMat);glow.position.set(x,-.48,0);glow.rotation.x=Math.PI;glow.visible=false;pod.add(glow);thrusts.push(glow);
      pod.scale.setScalar(.001);pod.visible=false;root.add(pod);pods.push(pod);
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

  return { root, wheels, brakeMat, headMat, rotors, thrustMat, thrusts, ...(pods.length ? { pods } : {}) };
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

/** Ground level in a tuktuk's body space (wheelY - suspension rest - wheel radius). */
export const TUKTUK_GROUND = -0.37;
/** Tuktuk passenger bench seat tops in body space, left to right (seat 1..3). */
export const TUKTUK_BENCH: Array<[number, number, number]> = [[-0.36, TUKTUK_GROUND + 0.95, 0.5], [0, TUKTUK_GROUND + 0.95, 0.5], [0.36, TUKTUK_GROUND + 0.95, 0.5]];

/**
 * Auto-rickshaw (tuktuk), as seen on Sittwe's streets: painted body, dark
 * canvas canopy, front cowl with one headlight, handlebar steering, driver
 * up front and a bench for three behind. Faces -Z; one front wheel (entry 0;
 * entry 1 is an empty placeholder) and two rear wheels.
 */
export function createTuktukModel(color: number): VehicleVisual {
  const root = new THREE.Group();
  root.name = 'tuktuk';
  const shell = new THREE.Group();
  shell.position.y = TUKTUK_GROUND;
  root.add(shell);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.25 });
  const canopy = new THREE.MeshStandardMaterial({ color: 0x3a3330, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1e2022, roughness: 0.75 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, roughness: 0.25, metalness: 0.9 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x4a2f25, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfd8e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf6f3e8, emissive: new THREE.Color(0xfff2c8), emissiveIntensity: 0 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x7a1010, emissive: new THREE.Color(0xff2020), emissiveIntensity: 0.15 });
  const amber = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 0.4 });
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.rotation.x = rx;
    b.castShadow = true;
    shell.add(b);
    return b;
  };
  // Floor and the enclosed rear body over the engine and back wheels.
  box(1.16, 0.1, 2.1, dark, 0, 0.36, 0.05);
  box(1.28, 0.42, 0.95, paint, 0, 0.6, 0.72);
  box(1.3, 0.1, 0.98, paint, 0, 0.84, 0.72); // rounded-looking top edge
  box(1.0, 0.36, 0.06, paint, 0, 0.6, -0.2); // step in front of the bench
  // Front cowl, mudguard and the single headlight.
  box(0.62, 0.95, 0.32, paint, 0, 0.88, -0.92, -0.12);
  box(1.02, 0.42, 0.22, paint, 0, 0.62, -0.78);
  box(0.26, 0.07, 0.5, paint, 0, 0.5, -1.04);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.08, 14).rotateX(Math.PI / 2), headMat);
  lamp.position.set(0, 1.0, -1.1);
  shell.add(lamp);
  for (const sx of [-1, 1]) box(0.06, 0.05, 0.03, amber, sx * 0.24, 1.16, -1.06);
  // Windscreen, front pillars and mirrors.
  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.56, 0.025), glass);
  screen.scale.y = 1.25;
  screen.position.set(0, 1.6, -0.85);
  screen.rotation.x = 0.12;
  shell.add(screen);
  for (const sx of [-1, 1]) {
    shell.add(tube(V(sx * 0.6, 1.0, -0.8), V(sx * 0.6, 2.0, -0.88), 0.025, dark));
    shell.add(tube(V(sx * 0.62, 0.9, 1.16), V(sx * 0.62, 2.0, 1.16), 0.025, dark));
    shell.add(tube(V(sx * 0.52, 1.38, -0.86), V(sx * 0.72, 1.46, -0.92), 0.012, dark));
    box(0.1, 0.08, 0.02, chrome, sx * 0.74, 1.48, -0.92);
  }
  // Canvas canopy: roof, back and the rear side panels (the sides are open).
  box(1.34, 0.08, 2.14, canopy, 0, 2.04, 0.14);
  box(1.2, 0.08, 1.92, canopy, 0, 2.1, 0.16);
  box(1.3, 1.1, 0.04, canopy, 0, 1.48, 1.2);
  for (const sx of [-1, 1]) box(0.04, 1.1, 0.46, canopy, sx * 0.64, 1.48, 0.96);
  // Driver's seat, handlebar and the passenger bench with a backrest.
  box(0.46, 0.1, 0.36, seatMat, 0, 0.88, -0.34);
  box(0.3, 0.42, 0.3, dark, 0, 0.62, -0.34);
  shell.add(tube(V(0, 0.95, -0.82), V(0, 1.2, -0.7), 0.03, dark), tube(V(-0.32, 1.22, -0.68), V(0.32, 1.22, -0.68), 0.022, chrome));
  box(1.14, 0.12, 0.44, seatMat, 0, 0.9, 0.5);
  box(1.14, 0.46, 0.1, seatMat, 0, 1.18, 0.76);
  // Rear lamps and the exhaust under the back.
  for (const sx of [-1, 1]) box(0.14, 0.08, 0.03, brakeMat, sx * 0.5, 0.78, 1.21);
  shell.add(tube(V(0.4, 0.3, 0.7), V(0.42, 0.3, 1.24), 0.035, chrome));
  const exhaust = new THREE.Object3D();
  exhaust.name = 'exhaust';
  exhaust.position.set(0.42, 0.3, 1.27);
  shell.add(exhaust);
  // Wheels: one in front, two behind.
  const r = 0.22;
  const front = bikeWheel(r, 0.07, chrome, 4);
  const rl = bikeWheel(r, 0.07, chrome, 4);
  const rr = bikeWheel(r, 0.07, chrome, 4);
  front.pivot.position.set(0, r + TUKTUK_GROUND, -1.0);
  rl.pivot.position.set(-0.56, r + TUKTUK_GROUND, 0.82);
  rr.pivot.position.set(0.56, r + TUKTUK_GROUND, 0.82);
  root.add(front.pivot, rl.pivot, rr.pivot);
  // Flying kit: four rotor pods fold out from the roof corners when it takes off.
  const thrustMat = new THREE.MeshStandardMaterial({ color: 0x4ed9ff, emissive: 0x0c9eff, emissiveIntensity: 0.6, transparent: true, opacity: 0.8 });
  const rotors: THREE.Group[] = [], thrusts: THREE.Mesh[] = [], pods: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) for (const z of [-0.7, 1.0]) {
    const pod = new THREE.Group();
    pod.position.set(sx * 0.62, 2.04 + TUKTUK_GROUND, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.12), dark);
    arm.position.x = sx * 0.25;
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.31, 0.14, 16, 1, true), dark);
    duct.position.x = sx * 0.62;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.025, 6, 18).rotateX(Math.PI / 2), thrustMat);
    ring.position.set(sx * 0.62, 0.06, 0);
    const fan = new THREE.Group();
    fan.position.set(sx * 0.62, 0.02, 0);
    for (const a of [0, Math.PI / 2]) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.02, 0.06), chrome); blade.rotation.y = a; fan.add(blade); }
    fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), chrome));
    const glowMat = thrustMat.clone();
    glowMat.opacity = 0.25;
    glowMat.depthWrite = false;
    const glow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 10), glowMat);
    glow.position.set(sx * 0.62, -0.36, 0);
    glow.rotation.x = Math.PI;
    glow.visible = false;
    pod.add(arm, duct, ring, fan, glow);
    pod.scale.setScalar(0.001);
    root.add(pod);
    rotors.push(fan);
    thrusts.push(glow);
    pods.push(pod);
  }
  const empty = { pivot: new THREE.Group(), spin: new THREE.Group() };
  return { root, wheels: [front, empty, rl, rr], brakeMat, headMat, rotors, thrustMat, thrusts, pods, exhaust, seat: V(0, 0.93 + TUKTUK_GROUND, -0.34) };
}

/**
 * Motorbike (underbone, the common 110 cc type in Myanmar) or bicycle, built
 * from primitives. Faces -Z; same VehicleVisual shape as cars, with two real
 * wheels (entries 1 and 3 are empty placeholders for the right-hand pair).
 */
/** Folds rotor pods out while flying and back in after landing (eased). */
export function deployPods(visual: VehicleVisual, flying: boolean, dt: number): void {
  if (!visual.pods) return;
  const ud = visual.root.userData as { deploy?: number };
  const d = (ud.deploy = (ud.deploy ?? 0) + ((flying ? 1 : 0) - (ud.deploy ?? 0)) * Math.min(1, dt * 3));
  for (const p of visual.pods) { p.scale.setScalar(Math.max(0.001, d)); p.visible = d > 0.01; }
}

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
