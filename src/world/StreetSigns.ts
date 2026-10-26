import * as THREE from 'three';
import type {ChunkRoad} from '../geo/chunkFormat';
import {LABEL_FONT} from './LandmarkGenerator';

/** Decorative bilingual signposts derive names and alignment from mapped roads. */
export function buildStreetSigns(roads:ChunkRoad[],clear:(x:number,z:number)=>boolean):THREE.Group {
 const group=new THREE.Group();group.name='street-signs';
 if(typeof document==='undefined')return group;
 const used=new Set<string>();
 for(const r of roads){
  if(!r.n||used.has(r.n)||r.p.length<4)continue;
  const ax=r.p[0]!,az=r.p[1]!,bx=r.p[2]!,bz=r.p[3]!,len=Math.hypot(bx-ax,bz-az);if(len<8)continue;
  const x=ax+(bx-ax)*.4-(bz-az)/len*(r.w/2+1.3),z=az+(bz-az)*.4+(bx-ax)/len*(r.w/2+1.3);
  if(!clear(x,z))continue;used.add(r.n);
  const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d')!;
  g.fillStyle='#214f49';g.fillRect(0,0,512,128);g.strokeStyle='#eadfc1';g.lineWidth=6;g.strokeRect(5,5,502,118);g.textAlign='center';g.textBaseline='middle';g.fillStyle='#fff5d9';
  const names=r.n.split(' · ');g.font=`600 ${names.length>1?30:36}px ${LABEL_FONT}`;
  if(names.length>1){g.fillText(names[0]!,256,42,480);g.font=`26px ${LABEL_FONT}`;g.fillText(names.slice(1).join(' · '),256,88,480)}else g.fillText(r.n,256,64,480);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.045,.055,2.8,6),new THREE.MeshStandardMaterial({color:0x59655d,roughness:.9}));pole.position.set(x,1.4,z);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(2.8,.7),new THREE.MeshStandardMaterial({map:tex,side:THREE.DoubleSide,roughness:.9}));sign.position.set(x,2.5,z);sign.rotation.y=Math.atan2((bz-az)/len,-(bx-ax)/len);
  pole.castShadow=true;sign.castShadow=true;group.add(pole,sign);
  if(used.size>=5)break;
 }
 return group;
}
export function disposeStreetSigns(group:THREE.Group):void {
 group.traverse(o=>{const m=o as THREE.Mesh;if(!m.isMesh)return;m.geometry.dispose();const mat=m.material as THREE.MeshStandardMaterial;mat.map?.dispose();mat.dispose()});
}
