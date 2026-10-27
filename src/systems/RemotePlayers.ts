import type {RideSeat} from './RideSeats';
import * as THREE from 'three';
import {MotionTrack} from './MotionTrack';
import {createCharacter,disposeCharacter} from '../player/CharacterModels';
import {PlayerAnimations} from '../player/PlayerAnimations';
import type {PlayerRig} from '../player/PlayerModel';
import {createVehicleModel,disposeVehicleModel,type VehicleVisual} from '../vehicles/VehicleModel';
import type {PlayerSnapshot} from './RoomProtocol';
import type {FoundPlayer} from './PlayerFinder';
import {SWIM_SINK} from '../player/PlayerController';
import {createHeadlightBeams,type HeadlightBeams} from '../vehicles/HeadlightBeams';
import {BoatLook} from '../vehicles/BoatLook';
import {createTwoWheelerModel} from '../vehicles/VehicleModel';
import {seatRider} from '../vehicles/Rider';
import {applySitPose,resetPose} from '../player/Clothes';
/** Real spotlights shared by the nearest remote cars with headlights on (fixed count: no shader recompiles). */
const REMOTE_LIGHTS=3;
interface Remote {sat?:boolean;swimBlend?:number;rig:PlayerRig;anim:PlayerAnimations;car:VehicleVisual|null;kind?:'car'|'motorbike'|'bicycle';pedal?:number;beams?:HeadlightBeams;boat?:BoatLook;color?:number;state:PlayerSnapshot;seq:number;track:MotionTrack}
export class RemotePlayers {
 private players=new Map<string,Remote>();
 private seats:RideSeat[]=[];
 setSeats(seats:RideSeat[]):void{this.seats=seats}
 /** Hide friends' name tags (you are the seeker in hide and seek). */
 hideTags=false;
 positionOf(id:string):THREE.Vector3|null{return this.players.get(id)?.rig.root.position??null}
 /** This player's own car while driving in a room, so passengers riding with us sit inside it. */
 localDriver:{id:string;root:THREE.Object3D}|null=null;
 ridePose(driverId:string):{position:THREE.Vector3;yaw:number;state:PlayerSnapshot}|null {
  const p=this.players.get(driverId);if(!p?.state.vehicle)return null;
  return {position:p.car?.root.position??p.rig.root.position,yaw:p.rig.root.rotation.y,state:p.state};
 }
 /** Everyone else in the room at their smoothed on-screen position (for the maps and the finder). */
 list():FoundPlayer[] {
  return [...this.players].map(([id,p])=>{const pos=p.car&&p.state.vehicle?p.car.root.position:p.rig.root.position;return {id,name:p.state.name,x:pos.x,z:pos.z,inVehicle:!!p.state.vehicle,flying:!!p.state.vehicle?.flying};});
 }
 nearestRide(position:THREE.Vector3):{id:string;name:string}|null {
  for(const [id,p] of this.players){const v=p.state.vehicle;if(v&&(v.kind??'car')==='car'&&!v.flying&&p.state.speed<=2&&Math.abs(position.y-v.y)<2.5&&Math.hypot(position.x-v.x,position.z-v.z)<5&&this.seats.filter(s=>s.driverId===id).length<3)return {id,name:p.state.name};}return null;
 }
 private readonly lights:THREE.SpotLight[]=[];
 private readonly tmp=new THREE.Vector3();
 constructor(private readonly scene:THREE.Scene){
  for(let i=0;i<REMOTE_LIGHTS;i++){const l=new THREE.SpotLight(0xfff0d0,0,50,.6,.55,1.3);scene.add(l,l.target);this.lights.push(l);}
 }
 receive(list:Array<{id:string;state:PlayerSnapshot}>):void {
  const keep=new Set(list.map(p=>p.id));
  for(const [id,p] of this.players)if(!keep.has(id)){this.remove(p);this.players.delete(id)}
  for(const {id,state} of list){
   let p=this.players.get(id);
   if(p&&state.seq<=p.seq)continue;
   if(p&&p.state.character!==state.character){this.remove(p);this.players.delete(id);p=undefined}
   if(!p){const rig=createCharacter(state.character,state.name);rig.root.position.set(state.x,state.y,state.z);this.scene.add(rig.root);p={rig,anim:new PlayerAnimations(rig),car:null,state,seq:state.seq,track:new MotionTrack()};this.players.set(id,p)}
   p.state=state;p.seq=state.seq;p.track.push(state,performance.now()/1000);
  }
 }
 /** night: 0 by day → 1 at night; headlight beams fade with it. */
 update(dt:number,px:number,pz:number,night=1):void {
  const now=performance.now()/1000;
  const lit:Array<{car:VehicleVisual;d:number}>=[];
  for(const p of this.players.values()){
   const s=p.state,root=p.rig.root;
   root.visible=Math.hypot(s.x-px,s.z-pz)<220;
   const pose=p.track.sample(now);if(pose){root.position.set(pose.x,pose.y,pose.z);root.rotation.y=pose.yaw;}
   p.rig.body.visible=!s.vehicle;p.rig.nameTag.visible=root.visible&&!this.hideTags;
   if(s.vehicle){
    const kind=s.vehicle.kind??'car';
    if(p.car&&(p.color!==(s.vehicle.color??0xf2f3f4)||p.kind!==kind)){p.car.root.removeFromParent();disposeVehicleModel(p.car);p.car=null;}
    if(!p.car){p.color=s.vehicle.color??0xf2f3f4;p.kind=kind;p.car=kind==='car'?createVehicleModel(p.color,true):createTwoWheelerModel(kind,p.color);p.beams=createHeadlightBeams(p.car);p.boat=new BoatLook(p.car,p.color);p.car.root.position.set(s.vehicle.x,s.vehicle.y,s.vehicle.z);this.scene.add(p.car.root)}
    const v=s.vehicle;p.car.root.visible=root.visible;
    p.car.root.position.copy(root.position);if(v.qw===undefined)p.car.root.rotation.y=root.rotation.y;
    if(v.qw!==undefined)p.car.root.quaternion.slerp(new THREE.Quaternion(v.qx!,v.qy!,v.qz!,v.qw).normalize(),1-Math.exp(-16*dt));
    p.car.headMat.emissiveIntensity=v.headlights?2.5:0;p.beams?.set(!!v.headlights&&root.visible,Math.max(.12,night),v.flying);
    if(v.headlights&&root.visible&&night>.05)lit.push({car:p.car,d:Math.hypot(s.x-px,s.z-pz)});
    p.car.brakeMat.emissiveIntensity=v.braking?2.6:v.headlights?.8:.15;
    for(const thrust of p.car.thrusts)thrust.visible=v.flying;
    p.boat?.update(dt,!!v.boat,s.speed);
    // A friend on a motorbike or bicycle is shown riding it.
    if(kind!=='car'){p.pedal=(p.pedal??0)+dt*s.speed*1.6;p.rig.body.visible=true;seatRider(p.rig,p.car,kind,p.pedal);}
    for(const rotor of p.car.rotors)rotor.rotation.y+=dt*(v.flying?75:12);
   }else {
    if(p.car)p.car.root.visible=false;
    if(s.dancing&&!p.anim.dancing)p.anim.startDance();if(!s.dancing&&p.anim.dancing)p.anim.stopDance();
    // Swimming friends sink to their shoulders and swim, as they do on their own screen.
    const blend=p.swimBlend=(p.swimBlend??0)+((s.swim?1:0)-(p.swimBlend??0))*Math.min(1,dt*4);
    if(pose)root.position.y-=SWIM_SINK*blend;p.rig.nameTag.position.y=2.42-.75*blend;
    if(blend>.5&&p.anim.dancing)p.anim.stopDance();
    p.anim.update(dt,s.speed,true,0,blend);
    // Sitting or praying friends hold the same pose they see on their screen.
    if(s.sit&&!s.dancing)applySitPose(p.rig,s.sit,performance.now()/1000);else if(p.sat)resetPose(p.rig);
    p.sat=!!s.sit&&!s.dancing;
   }
  }
  // Real spotlights for the nearest lit cars, so their beams light the road and buildings.
  lit.sort((a,b)=>a.d-b.d);
  this.lights.forEach((l,i)=>{
   const c=lit[i];if(!c||c.d>140){l.intensity=0;return;}
   c.car.root.updateMatrixWorld();
   l.position.copy(this.tmp.set(0,.7,-2.3).applyMatrix4(c.car.root.matrixWorld));
   l.target.position.copy(this.tmp.set(0,-1.2,-16).applyMatrix4(c.car.root.matrixWorld));l.target.updateMatrixWorld();
   l.intensity=70*Math.min(1,night*1.5);
  });
  for(const seat of this.seats){
   const p=this.players.get(seat.playerId);if(!p)continue;
   // The driver may be another player or this player (local car), so look up both.
   const car=this.players.get(seat.driverId)?.car?.root??(this.localDriver?.id===seat.driverId?this.localDriver.root:null);if(!car)continue;
   p.rig.body.visible=false;p.rig.root.position.copy(car.position).add(new THREE.Vector3(seat.seat===1?.55:-.55,.15,seat.seat===1?-.3:.6).applyQuaternion(car.quaternion));p.rig.root.rotation.y=new THREE.Euler().setFromQuaternion(car.quaternion,'YXZ').y;
   if(p.car)p.car.root.visible=false;
  }
 }
 private remove(p:Remote):void {p.rig.root.removeFromParent();disposeCharacter(p.rig);if(p.car){p.car.root.removeFromParent();disposeVehicleModel(p.car);p.beams=undefined;p.boat=undefined;}}
 clear():void {for(const p of this.players.values())this.remove(p);this.players.clear()}
}
