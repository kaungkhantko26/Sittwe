import * as THREE from 'three';
import {addBeam,GeometryBuilder} from './GeometryBuilder';
import {materials} from './materials';
export interface BoundaryData {version:number;lines:Array<{id:string;kind:string;p:number[];height:number}>}
export function buildBoundaries(data:BoundaryData){
 const geo=new GeometryBuilder(),boxes:number[]=[];
 for(const line of data.lines)for(let i=0;i<line.p.length-2;i+=2){
  const ax=line.p[i]!,az=line.p[i+1]!,bx=line.p[i+2]!,bz=line.p[i+3]!,len=Math.hypot(bx-ax,bz-az),h=line.height;
  if(len<.05)continue;
  geo.setColor(line.kind==='wall'?0xc9bda6:0x64776c);
  if(line.kind==='wall')addBeam(geo,ax,h/2,az,bx,h/2,bz,.2,h);
  else {
   for(const y of [h*.35,h*.75])addBeam(geo,ax,y,az,bx,y,bz,.045,.045);
   const n=Math.max(1,Math.ceil(len/2.5));for(let k=0;k<=n;k++){const x=ax+(bx-ax)*k/n,z=az+(bz-az)*k/n;addBeam(geo,x,0,z,x,h,z,.08,.08)}
  }
  boxes.push((ax+bx)/2,h/2,(az+bz)/2,len/2,h/2,.1,-Math.atan2(bz-az,bx-ax));
 }
 const group=new THREE.Group();group.name='mapped-boundaries';
 if(!geo.isEmpty()){const mesh=new THREE.Mesh(geo.build(),materials().solid);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh)}
 return {group,boxes};
}
