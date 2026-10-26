import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOME_FLOOR, type HomeLocation } from '../systems/Housing';
import { palmGeometry } from './VegetationGenerator';

/** Reference-inspired Het Laung, authored from primitives; not a surveyed building. Front faces south. */
export function buildHome(at: HomeLocation, preview = false) {
  const group = new THREE.Group();
  group.name = preview ? 'home-preview' : 'rakhine-home';
  group.position.set(at.x, 0, at.z);
  const mats = [0x68432c, 0x93603b, 0xb9854e, 0xad382a, 0xd2ab61, 0x385548, 0xb37443, 0xe8dcc0].map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.88, transparent: preview, opacity: preview ? 0.5 : 1 }));
  const bins: THREE.BufferGeometry[][] = mats.map(() => []);
  const boxes: number[] = [];
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat = 0, collision = false, rz = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0,0,rz)), new THREE.Vector3(1,1,1)));
    bins[mat]!.push(geo);
    if (collision) boxes.push(at.x+x,y,at.z+z,w/2,h/2,d/2,0);
  };
  const beam = (a: number[], b: number[], w: number, mat: number) => {
    const av=new THREE.Vector3(...a as [number,number,number]), bv=new THREE.Vector3(...b as [number,number,number]);
    const geo=new THREE.CylinderGeometry(w,w,av.distanceTo(bv),6);
    geo.applyMatrix4(new THREE.Matrix4().compose(av.clone().add(bv).multiplyScalar(.5),new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),bv.sub(av).normalize()),new THREE.Vector3(1,1,1)));
    bins[mat]!.push(geo);
  };
  // Raised timber structure, individual floorboards and stone footings.
  for (const x of [-4,0,4]) for (const z of [-4,0,4]) {
    if(x===0 && z>=0)continue;
    box(x,.22,z,.65,.3,.65,7);
    box(x,2.7,z,.25,5.2,.25,0,true);
  }
  box(0,1.76,0,8.5,.25,8.6,0,true);
  for(let i=0;i<28;i++) box(-4.1+i*.3,HOME_FLOOR-.025,0,.285,.08,8.5,1+i%2);
  // Plank walls; front doorway and open barred windows on each side.
  for(let row=0;row<12;row++) {
    const y=2.08+row*.255;
    box(0,y,-4,8,.24,.14,row%2);
    for(const x of [-4,4]) {
      if(y>2.65 && y<4.2) {box(x,y,-2.8,.14,.24,2.4,row%2);box(x,y,1.1,.14,.24,1.4,row%2)}
      else box(x,y,-1,.14,.24,6,row%2);
    }
    // Interior wall at the back of the porch; the 1.6 m opening remains clear.
    box(-2.4,y,2,3.2,.24,.14,row%2);box(2.4,y,2,3.2,.24,.14,row%2);
  }
  // Simple continuous collision walls, window openings are too narrow to climb through.
  boxes.push(at.x,3.4,at.z-4,4,1.5,.08,0,at.x-4,3.4,at.z-1,.08,1.5,3,0,at.x+4,3.4,at.z-1,.08,1.5,3,0,at.x-2.4,3.4,at.z+2,1.6,1.5,.08,0,at.x+2.4,3.4,at.z+2,1.6,1.5,.08,0);
  for(const x of [-4.1,4.1]) {
    for(let z=-1.4;z<=.4;z+=.22) box(x,3.4,z,.09,1.5,.065,4);
    for(const y of [2.62,4.2]) box(x,y,-.5,.2,.12,2.2,2);
  }
  // Porch rail, carved diamond lattice with a central opening for the stair.
  for(const side of [-1,1]) {
    box(side*2.6,2.93,4,2.8,.13,.14,2);
    box(side*2.6,2.15,4,2.8,.13,.14,2);
    box(side*2.6,2.52,4,2.8,.7,.09,0,true);
    for(let x=1.25;x<3.8;x+=.38) {
      beam([side*x,2.18,4.08],[side*(x+.35),2.88,4.08],.025,4);
      beam([side*x,2.88,4.08],[side*(x+.35),2.18,4.08],.025,4);
    }
    box(side*4,2.93,3,.14,.13,2,2);box(side*4,2.52,3,.1,.7,2,0,true);
  }
  // Eight shallow treads and side rails. Physics uses a continuous ramp.
  for(let i=0;i<8;i++) box(0,.2+i*.23,8-i*.5,2.15,.18,.52,1);
  for(const x of [-1.14,1.14]) {beam([x,.22,8.3],[x,2,4.1],.09,3);beam([x,1.15,8.3],[x,2.95,4.1],.055,2)}
  const ramps=[[at.x-1.05,.08,at.z+8.5, at.x+1.05,.08,at.z+8.5, at.x-1.05,.08,at.z+4, at.x+1.05,.08,at.z+4, at.x-1.05,HOME_FLOOR,at.z+4, at.x+1.05,HOME_FLOOR,at.z+4]];
  // Steep red corrugated gable and golden sunburst fretwork.
  const roof = new THREE.Group();roof.name='roof';
  const pitch=Math.atan2(2.9,4.8), slope=Math.hypot(4.8,2.9);
  for(const side of [-1,1]) {
    const panel=new THREE.Mesh(new THREE.BoxGeometry(slope,.12,10.2),mats[3]);
    panel.position.set(side*2.4,6.15,0);panel.rotation.z=-side*pitch;roof.add(panel);
    for(let z=-5;z<=5;z+=.25) {
      const rib=new THREE.Mesh(new THREE.BoxGeometry(slope,.045,.035),mats[3]);rib.position.set(side*2.4,6.24,z);rib.rotation.z=-side*pitch;roof.add(rib);
    }
    beam([0,7.65,4.95],[side*4.8,4.75,4.95],.09,4);
  }
  for(const z of [-4.96,4.96]) {
    for(let a=0;a<9;a++) {const t=a*Math.PI/8;beam([0,5.65,z],[Math.cos(t)*.85,5.65+Math.sin(t)*.85,z],.045,4)}
    for(const side of [-1,1]) for(let x=.9;x<4.2;x+=.4) beam([side*x,4.94,z],[side*(x-.4),7.4-x*.6,z],.023,4);
  }
  group.add(roof);
  // Open door, bed, woven mat, shelf and table make the interior usable.
  const door = new THREE.Group();door.position.set(-.78,HOME_FLOOR,2.12);door.rotation.y=-Math.PI*.48;
  const leaf=new THREE.Mesh(new THREE.BoxGeometry(1.5,2.45,.1),mats[1]);leaf.position.set(.75,1.22,0);door.add(leaf);group.add(door);
  box(-2.4,2.17,-2.35,2.2,.45,2.7,0,true);box(-2.4,2.45,-2.35,2.1,.16,2.6,7);box(-2.4,2.56,-1.9,2.08,.08,1.65,5);
  box(-2.4,2.59,-3.25,1.3,.16,.55,7);
  box(1.8,1.96,-.5,2.4,.035,2.7,4);
  box(2.8,2.5,-3.6,1.8,1.1,.5,0,true);
  for(const y of [2.2,2.65,3.1]) box(2.8,y,-3.55,1.9,.08,.65,2);
  box(2.3,2.5,.1,1.2,.12,.8,1,true);
  // Lantern and pottery.
  const lantern=new THREE.Mesh(new THREE.SphereGeometry(.22,10,8),new THREE.MeshStandardMaterial({color:0xd5a15c,emissive:0xffba5a,emissiveIntensity:.25}));lantern.position.set(0,4.5,3.2);group.add(lantern);
  for(const [x,z] of [[-5,5],[5,3],[3.5,3.4]]) {
    const jar=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.17,0),new THREE.Vector2(.33,.2),new THREE.Vector2(.36,.55),new THREE.Vector2(.19,.75),new THREE.Vector2(.22,.8)],12),mats[6]);jar.position.set(x,z===3.4?HOME_FLOOR:.1,z);group.add(jar);
  }
  // Yard fencing with a 3 m entrance gap. The plot remains within 14 x 20 m.
  for(let x=-6.5;x<=6.5;x+=1.3) for(const z of [-9,9]) if(z<0 || Math.abs(x)>1.6) box(x,.7,z,.12,1.3,.12,0,true);
  for(const side of [-1,1]) {
    for(let z=-9;z<=9;z+=1.5) box(side*6.5,.7,z,.12,1.3,.12,0,true);
    for(const y of [.4,1]) {box(side*6.5,y,0,.08,.1,18,1,true);box(side*4.1,y,9,4.8,.1,.08,1,true)}
  }
  for(const y of [.4,1]) box(0,y,-9,13,.1,.08,1,true);
  const palm=new THREE.Mesh(palmGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}));palm.position.set(-5.5,0,-6);palm.scale.setScalar(.72);group.add(palm);
  for(let i=0;i<bins.length;i++) if(bins[i]!.length) {
    const geo=mergeGeometries(bins[i]!,false)!;bins[i]!.forEach(g=>g.dispose());
    const mesh=new THREE.Mesh(geo,mats[i]);mesh.castShadow=!preview;mesh.receiveShadow=true;group.add(mesh);
  }
  group.traverse(o=>{if((o as THREE.Mesh).isMesh){o.castShadow=!preview;o.receiveShadow=true}});
  return {group,boxes,ramps,door,roof};
}
export type HomeObjects = ReturnType<typeof buildHome>;
export function disposeHome(home: HomeObjects): void {
  const mats=new Set<THREE.Material>();
  home.group.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;if(m.geometry!==palmGeometry())m.geometry.dispose();for(const mat of Array.isArray(m.material)?m.material:[m.material])mats.add(mat)});
  mats.forEach(m=>m.dispose());home.group.removeFromParent();
}
