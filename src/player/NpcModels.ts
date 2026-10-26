import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNameTag, type PlayerRig } from './PlayerModel';

/** NPCs use rounded, articulated silhouettes and occupational props, distinct from the player avatars. */
export function createNpc(role:number,name:string,variant:number):PlayerRig {
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);body.position.y=.92;
  const skin=[0xb27b55,0xc38a61,0x986345,0xd5a27b][variant%4]!;
  const colors=[0x98533c,0x428c8c,0xf3efdf,0x607c3e,0x526fa6,0x80637c,0xc18d3f,0xf2d694];
  const material=(color:number)=>new THREE.MeshStandardMaterial({color,roughness:.9});
  const skinMat=material(skin),cloth=material(colors[role%8]!),dark=material(0x29353b),hair=material(0x241e1a),cream=material(0xe7d5b2);
  const mesh=(geo:THREE.BufferGeometry,mat:THREE.Material,parent:THREE.Object3D,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m};
  mesh(new THREE.CylinderGeometry(.23,.27,.58,8),cloth,body,0,.28,0);
  const head=new THREE.Group();head.position.set(0,.78,0);body.add(head);
  mesh(new THREE.SphereGeometry(.205,10,8),skinMat,head,0,0,0);
  const cap=mesh(new THREE.SphereGeometry(.211,10,6,0,Math.PI*2,0,Math.PI*.53),hair,head,0,.025,0);cap.rotation.x=-.08;
  for(const x of [-.074,.074])mesh(new THREE.SphereGeometry(.022,6,4),dark,head,x,.01,-.185);
  mesh(new THREE.BoxGeometry(.065,.015,.02),dark,head,0,-.08,-.192);
  const leftArm=new THREE.Group(),rightArm=new THREE.Group(),leftLeg=new THREE.Group(),rightLeg=new THREE.Group();
  leftArm.position.set(-.3,.52,0);rightArm.position.set(.3,.52,0);leftLeg.position.set(-.13,0,0);rightLeg.position.set(.13,0,0);
  body.add(leftArm,rightArm,leftLeg,rightLeg);
  for(const arm of [leftArm,rightArm]){
    mesh(new THREE.CylinderGeometry(.085,.07,.26,7),cloth,arm,0,-.12,0);
    mesh(new THREE.CylinderGeometry(.065,.055,.29,7),skinMat,arm,0,-.39,0);
    mesh(new THREE.SphereGeometry(.068,7,5),skinMat,arm,0,-.56,0);
  }
  for(const leg of [leftLeg,rightLeg]){
    mesh(new THREE.CylinderGeometry(.1,.075,.73,7),role===2||role===6?dark:cloth,leg,0,-.36,0);
    mesh(new THREE.BoxGeometry(.18,.1,.3),dark,leg,0,-.76,-.06);
  }
  if([0,1,5,7].includes(role))mesh(new THREE.CylinderGeometry(.26,.32,.59,10),role===0?cream:cloth,body,0,-.28,0);
  if(role===0){ // Vendor apron and hand-held produce basket.
    mesh(new THREE.BoxGeometry(.34,.61,.04),cream,body,0,.12,-.26);
    mesh(new THREE.CylinderGeometry(.19,.14,.19,10),material(0x966938),leftArm,0,-.58,-.12);
    for(let i=0;i<4;i++)mesh(new THREE.SphereGeometry(.065,6,4),material(i%2?0x8f9e42:0xbd4938),leftArm,(i%2-.5)*.12,-.47,-.1-Math.floor(i/2)*.09);
  }
  if(role===2){ // Student uniform, satchel and shoulder straps.
    mesh(new THREE.BoxGeometry(.32,.4,.16),material(variant%2?0x325f8a:0x8a4640),body,0,.26,.24);
    for(const x of [-.16,.16])mesh(new THREE.BoxGeometry(.04,.5,.045),dark,body,x,.28,-.235);
  }
  if(role===3){ // Gardener's wide straw hat and small hoe.
    mesh(new THREE.CylinderGeometry(.35,.35,.035,14),cream,head,0,.14,0);
    mesh(new THREE.ConeGeometry(.25,.19,12),cream,head,0,.24,0);
    mesh(new THREE.CylinderGeometry(.023,.023,.85,6),material(0x795034),rightArm,0,-.68,0);
    mesh(new THREE.BoxGeometry(.22,.035,.12),dark,rightArm,0,-1.08,-.05);
  }
  if(role===4){ // Visitor's brimmed hat and camera.
    mesh(new THREE.CylinderGeometry(.29,.29,.035,12),material(0x718d9c),head,0,.16,0);
    mesh(new THREE.CylinderGeometry(.2,.2,.12,10),material(0x718d9c),head,0,.22,0);
    mesh(new THREE.BoxGeometry(.18,.13,.1),dark,body,0,.22,-.3);
  }
  if(role===5){ // Elder: grey hair, spectacles and cane.
    (cap.material as THREE.MeshStandardMaterial).color.setHex(0xaaa59b);
    for(const x of [-.075,.075]) {const glasses=mesh(new THREE.TorusGeometry(.054,.007,4,10),dark,head,x,.01,-.198);glasses.rotation.y=0}
    mesh(new THREE.CylinderGeometry(.022,.022,.9,6),material(0x704a30),rightArm,0,-.65,-.05);
  }
  if(role===6){ // Worker: safety cap, vest and parcel.
    mesh(new THREE.SphereGeometry(.224,10,6,0,Math.PI*2,0,Math.PI*.5),material(0xd9ab39),head,0,.025,0);
    for(const x of [-.15,.15])mesh(new THREE.BoxGeometry(.06,.5,.045),cream,body,x,.29,-.24);
    mesh(new THREE.BoxGeometry(.42,.3,.28),material(0x9d794e),body,0,.08,-.4);
  }
  if(role===7){ // Performer sash, headband and shield.
    const sash=mesh(new THREE.BoxGeometry(.075,.63,.035),material(0xb78b32),body,0,.3,-.255);sash.rotation.z=.45;
    mesh(new THREE.CylinderGeometry(.214,.214,.055,10),cream,head,0,.1,0);
    const shield=mesh(new THREE.CylinderGeometry(.21,.21,.045,12),material(0x8a3b2e),leftArm,0,-.48,-.15);shield.rotation.x=Math.PI/2;
    const rim=mesh(new THREE.TorusGeometry(.2,.018,5,14),material(0xd8b55b),leftArm,0,-.48,-.18);rim.rotation.x=0;
  }
  const tag=createNameTag(name);tag.position.y=2.1;root.add(tag);
  root.scale.setScalar(role===2?.84:role===5?.94:1+(variant%3-1)*.05);
  // Batch static parts within each articulated pivot; keep arms/legs/head independently animated.
  const pivots:THREE.Group[]=[];root.traverse(o=>{if(o instanceof THREE.Group)pivots.push(o)});
  for(const pivot of pivots){
    const buckets=new Map<THREE.Material,THREE.BufferGeometry[]>();
    for(const child of [...pivot.children]){const m=child as THREE.Mesh;if(!m.isMesh)continue;m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);g.deleteAttribute('uv');const list=buckets.get(m.material as THREE.Material)??[];list.push(g);buckets.set(m.material as THREE.Material,list);pivot.remove(m);m.geometry.dispose();}
    for(const [mat,geos] of buckets){const geo=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());if(geo){const m=new THREE.Mesh(geo,mat);m.castShadow=true;m.receiveShadow=true;pivot.add(m)}}
  }
  return {root,body,head,leftArm,rightArm,leftLeg,rightLeg,nameTag:tag,legAmp:.8};
}
