import * as THREE from 'three';
import {MotionTrack} from './MotionTrack';
import {createCharacter,disposeCharacter} from '../player/CharacterModels';
import {PlayerAnimations} from '../player/PlayerAnimations';
import type {PlayerRig} from '../player/PlayerModel';
import {createVehicleModel,disposeVehicleModel,type VehicleVisual} from '../vehicles/VehicleModel';
import type {PlayerSnapshot} from './RoomProtocol';
interface Remote {rig:PlayerRig;anim:PlayerAnimations;car:VehicleVisual|null;state:PlayerSnapshot;seq:number;track:MotionTrack}
export class RemotePlayers {
 private players=new Map<string,Remote>();
 constructor(private readonly scene:THREE.Scene){}
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
 update(dt:number,px:number,pz:number):void {
  const now=performance.now()/1000;
  for(const p of this.players.values()){
   const s=p.state,root=p.rig.root;
   root.visible=Math.hypot(s.x-px,s.z-pz)<220;
   const pose=p.track.sample(now);if(pose){root.position.set(pose.x,pose.y,pose.z);root.rotation.y=pose.yaw;}
   p.rig.body.visible=!s.vehicle;p.rig.nameTag.visible=root.visible;
   if(s.vehicle){
    if(!p.car){p.car=createVehicleModel(0xf2f3f4,true);p.car.root.position.set(s.vehicle.x,s.vehicle.y,s.vehicle.z);this.scene.add(p.car.root)}
    const v=s.vehicle;p.car.root.visible=root.visible;
    p.car.root.position.copy(root.position);p.car.root.rotation.y=root.rotation.y;
    for(const thrust of p.car.thrusts)thrust.visible=v.flying;
    for(const rotor of p.car.rotors)rotor.rotation.y+=dt*(v.flying?75:12);
   }else {
    if(p.car)p.car.root.visible=false;
    if(s.dancing&&!p.anim.dancing)p.anim.startDance();if(!s.dancing&&p.anim.dancing)p.anim.stopDance();
    p.anim.update(dt,s.speed,true,0);
   }
  }
 }
 private remove(p:Remote):void {p.rig.root.removeFromParent();disposeCharacter(p.rig);if(p.car){p.car.root.removeFromParent();disposeVehicleModel(p.car)}}
 clear():void {for(const p of this.players.values())this.remove(p);this.players.clear()}
}
