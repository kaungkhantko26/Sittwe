import * as THREE from 'three';
import { attachSkirt } from './Clothes';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createNameTag,type PlayerRig} from './PlayerModel';
import {NPC_PROFILES} from './NpcProfiles';

/** Articulated, block-built citizens inspired by the supplied NPC reference sheet. */
export function createNpc(role:number,name:string,variant:number):PlayerRig {
  const spec=NPC_PROFILES[role%NPC_PROFILES.length]!,kind:string=spec.outfit;
  const female=['woman','elderWoman','schoolgirl','nurse','vendor'].includes(kind);
  const child=['student','schoolgirl','child'].includes(kind),elder=kind==='elder'||kind==='elderWoman';
  const longyi=['resident','woman','elder','elderWoman','vendor','food','boatman','fisher','performer','monk'].includes(kind);
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);body.position.y=.92;
  root.userData['npcOutfit']=kind;
  const cache=new Map<number,THREE.MeshStandardMaterial>();
  const mat=(c:number)=>{let m=cache.get(c);if(!m){m=new THREE.MeshStandardMaterial({color:c,roughness:.88});cache.set(c,m)}return m};
  const skin=[0xbc865f,0xd7a27a,0xa9714e,0xc9936c][variant%4]!;
  const shirt=spec.shirt,lower=spec.lower,hair=elder?0xb0aaa3:0x28201d,dark=0x252c33,gold=0xd5ae53;
  const mesh=(geo:THREE.BufferGeometry,c:number,parent:THREE.Object3D,x:number,y:number,z:number)=>{const m=new THREE.Mesh(geo,mat(c));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m};
  const box=(w:number,h:number,d:number,c:number,p:THREE.Object3D,x:number,y:number,z:number)=>mesh(new THREE.BoxGeometry(w,h,d),c,p,x,y,z);
  box(.44,.59,.28,shirt,body,0,.28,0);
  box(.045,.48,.025,0xe8d4aa,body,0,.29,-.153);
  for(let i=0;i<3;i++)box(.025,.025,.025,gold,body,.045,.43-i*.13,-.157);
  const head=new THREE.Group();head.position.set(0,.79,0);body.add(head);
  box(.42,.42,.36,skin,head,0,0,0);
  for(const x of [-.226,.226])box(.045,.1,.1,skin,head,x,-.02,0);
  for(const x of [-.085,.085]){box(.045,.055,.02,0x231f20,head,x,-.015,-.19);box(.02,.018,.022,0xf8efdc,head,x-.009,0,-.201);box(.08,.025,.02,hair,head,x,.063,-.19)}
  box(.04,.055,.04,skin,head,0,-.055,-.2);box(.075,.018,.02,0x75483a,head,0,-.115,-.19);
  if(kind!=='monk'){
    box(.45,.12,.39,hair,head,0,.2,0);
    for(let i=0;i<5;i++)box(.085,.08+(i%2)*.055,.055,hair,head,-.18+i*.09,.12,-.19);
    for(const side of [-1,1])box(.065,female?.4:.17,.32,hair,head,side*.21,female?-.035:.07,.015);
    if(female)box(.37,.39,.12,hair,head,0,-.025,.2);
    if(kind==='elderWoman')mesh(new THREE.BoxGeometry(.2,.18,.18),hair,head,0,.2,.22);
  }
  const leftArm=new THREE.Group(),rightArm=new THREE.Group(),leftLeg=new THREE.Group(),rightLeg=new THREE.Group();
  leftArm.position.set(-.3,.52,0);rightArm.position.set(.3,.52,0);leftLeg.position.set(-.115,0,0);rightLeg.position.set(.115,0,0);body.add(leftArm,rightArm,leftLeg,rightLeg);
  for(const arm of [leftArm,rightArm]){box(.15,.3,.2,shirt,arm,0,-.15,0);box(.12,.24,.15,skin,arm,0,-.42,0);box(.14,.13,.17,skin,arm,0,-.58,-.005)}
  for(const leg of [leftLeg,rightLeg]){box(.18,.7,.2,lower,leg,0,-.35,0);box(.19,.1,.29,0x493a2b,leg,0,-.76,-.045)}
  if(longyi){
    const first=body.children.length;
    box(.46,.62,.32,lower,body,0,-.29,0);
    if(kind!=='monk')for(let j=0;j<5;j++){
      box(.465,.018,.335,j%2?gold:0xd7b69b,body,0,-.08-j*.12,-.002);
      for(let i=0;i<4;i++){const motif=box(.035,.035,.015,gold,body,-.15+i*.1,-.13-j*.12,-.17);motif.rotation.z=Math.PI/4;}
    }
    attachSkirt(body,leftLeg,rightLeg,body.children.slice(first));
  }
  if(['resident','performer','woman'].includes(kind)){
    box(.46,.065,.4,0xeee2c5,head,0,.11,0);
    for(let i=0;i<5;i++)box(.055,.045,.018,gold,head,-.16+i*.08,.11,-.21);
    const sash=box(.075,.65,.025,kind==='woman'?0xa33936:gold,body,0,.27,-.17);sash.rotation.z=.48;
  }
  const straw=()=>{mesh(new THREE.CylinderGeometry(.34,.34,.045,8),0xc99c62,head,0,.27,0);mesh(new THREE.ConeGeometry(.28,.17,8),0xe0b578,head,0,.36,0);};
  if(['fisher','boatman','food','vendor','gardener','tourist'].includes(kind))straw();
  if(['police','security','worker','nurse'].includes(kind)){
    const c=kind==='worker'?0xf0b827:kind==='nurse'?0xf6f1e7:0x253e59;
    box(.46,.13,.41,c,head,0,.24,0);box(.44,.035,.18,c,head,0,.18,-.22);
    if(kind==='nurse'){box(.07,.1,.02,0xb63b40,head,0,.25,-.217);box(.12,.04,.022,0xb63b40,head,0,.25,-.22)}else box(.055,.065,.025,gold,head,0,.25,-.22);
  }
  if(['student','schoolgirl','child','tourist'].includes(kind)){
    box(.3,.35,.14,kind==='tourist'?0x786645:0x315579,body,0,.3,.22);
    for(const x of [-.15,.15])box(.04,.5,.03,0x775c38,body,x,.3,-.16);
    if(kind==='schoolgirl')box(.47,.35,.33,lower,body,0,-.16,0);
  }
  if(kind==='worker'){
    for(const x of [-.15,.15])box(.08,.5,.035,0xee9a28,body,x,.29,-.165);
    box(.44,.055,.035,0xe2ecb3,body,0,.18,-.19);box(.4,.29,.29,0x9b794d,body,0,.07,-.36);box(.045,.3,.3,0xd6b77c,body,0,.07,-.365);
  }
  if(kind==='monk'){
    const robe=box(.27,.6,.035,0xbe3741,body,-.075,.28,-.17);robe.rotation.z=.12;
    mesh(new THREE.CylinderGeometry(.16,.13,.16,8),dark,leftArm,0,-.56,-.18);mesh(new THREE.CylinderGeometry(.17,.17,.035,8),gold,leftArm,0,-.47,-.18);
  }
  if(kind==='vendor'){
    mesh(new THREE.CylinderGeometry(.2,.15,.22,8),0xa27b47,leftArm,0,-.57,-.12);
    for(let i=0;i<5;i++)box(.09,.09,.09,i%2?0x699044:0xc45c3c,leftArm,(i%3-1)*.095,-.43,-.12-Math.floor(i/3)*.08);
  }
  if(kind==='food'){box(.32,.56,.025,0x94663e,body,0,.15,-.17);mesh(new THREE.CylinderGeometry(.16,.14,.19,8),0xa4adb2,leftArm,0,-.6,-.15);}
  if(kind==='gardener'||kind==='boatman'||kind==='fisher'){
    box(.035,1.05,.035,0x8e663d,rightArm,0,-.72,0);
    if(kind==='boatman')box(.16,.35,.035,0xa8814d,rightArm,0,-1.13,0);
    if(kind==='gardener')box(.2,.045,.14,0x536064,rightArm,0,-1.22,-.04);
  }
  if(elder){
    for(const x of [-.085,.085]){box(.12,.015,.025,dark,head,x,.025,-.21);box(.12,.015,.025,dark,head,x,-.055,-.21);for(const dx of [-.055,.055])box(.012,.08,.025,dark,head,x+dx,-.015,-.21)}
    box(.035,.91,.035,0x745039,rightArm,0,-.75,-.04);
  }
  if(kind==='tourist'){box(.2,.14,.11,dark,rightArm,0,-.54,-.12);mesh(new THREE.CylinderGeometry(.05,.05,.07,8).rotateX(Math.PI/2),0x677988,rightArm,0,-.54,-.2);}
  if(['teacher','city','shopkeeper'].includes(kind)){box(.18,.26,.035,0x846143,leftArm,0,-.53,-.14);box(.15,.22,.015,0xe9dfc8,leftArm,0,-.53,-.165);}
  if(kind==='business'){box(.055,.22,.025,0x983d38,body,0,.34,-.17);box(.075,.14,.025,dark,rightArm,0,-.54,-.11);}
  if(kind==='mechanic'){box(.055,.26,.035,0xaaaead,rightArm,0,-.52,-.1);box(.13,.055,.04,0xb8bdba,rightArm,0,-.37,-.1);}
  if(kind==='performer'){const shield=mesh(new THREE.CylinderGeometry(.21,.21,.045,10),0x8a3b2e,leftArm,0,-.48,-.15);shield.rotation.x=Math.PI/2;box(.025,.8,.025,0x755534,rightArm,0,-.57,0);}
  if(['police','security','city','mechanic'].includes(kind)){box(.12,.12,.025,gold,body,-.12,.37,-.17);box(.45,.045,.3,dark,body,0,.005,0);}
  const tag=createNameTag(name);tag.position.y=2.1;root.add(tag);root.scale.setScalar(child?.72:elder?.94:1+(variant%3-1)*.035);
  // Merge static details by material within each moving joint to bound draw calls.
  const pivots:THREE.Group[]=[];root.traverse(o=>{if(o instanceof THREE.Group)pivots.push(o)});
  for(const pivot of pivots){const buckets=new Map<THREE.Material,THREE.BufferGeometry[]>();for(const child of [...pivot.children]){const m=child as THREE.Mesh;if(!m.isMesh)continue;m.updateMatrix();const g=m.geometry.clone().applyMatrix4(m.matrix);g.deleteAttribute('uv');const list=buckets.get(m.material as THREE.Material)??[];list.push(g);buckets.set(m.material as THREE.Material,list);pivot.remove(m);m.geometry.dispose();}for(const [material,geos] of buckets){const geo=mergeGeometries(geos,false);geos.forEach(g=>g.dispose());if(geo){const m=new THREE.Mesh(geo,material);m.castShadow=true;m.receiveShadow=true;pivot.add(m)}}}
  return {root,body,head,leftArm,rightArm,leftLeg,rightLeg,nameTag:tag,legAmp:.8};
}
