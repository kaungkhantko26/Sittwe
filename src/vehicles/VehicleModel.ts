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
