import * as THREE from 'three';
import { disposeCharacter } from '../player/CharacterModels';
import { createNpc } from '../player/NpcModels';
import { PlayerAnimations } from '../player/PlayerAnimations';
import type { PlayerRig } from '../player/PlayerModel';
import type { WorldManager } from '../world/WorldManager';

const ROLES = [
  {name:'Market vendor',activity:'arranging produce',color:0xbb7556},
  {name:'Neighbour',activity:'taking a walk',color:0x7aab9d},
  {name:'Student',activity:'walking to class',color:0xe4e0c9},
  {name:'Gardener',activity:'tending the garden',color:0x6b8953},
  {name:'Visitor',activity:'looking around',color:0x708fb4},
  {name:'Elder',activity:'watching the neighbourhood',color:0x9885ab},
  {name:'Worker',activity:'carrying a basket',color:0xc59b53},
  {name:'Dancer',activity:'practising a dance',color:0xe5bb62},
] as const;
interface Person {rig:PlayerRig;anim:PlayerAnimations;role:number;anchor:THREE.Vector2;target:THREE.Vector2;wait:number;phase:number;age:number}

/** Decorative single-player city routines. Spawn only on checked, loaded, dry walking space. */
export class Pedestrians {
  private people:Person[]=[];
  private timer=0;
  private sequence=0;
  maxPeople=18;
  constructor(private readonly scene:THREE.Scene,private readonly world:WorldManager){}
  private clear(x:number,z:number):boolean {
    return this.world.hasChunkAt(x,z) && !this.world.isOccupied(x,z,.65) && !this.world.isOnRoad(x,z,1.8);
  }
  update(dt:number,px:number,pz:number,hour:number):void {
    this.timer-=dt;
    const night=hour<6 || hour>20;
    const limit=night?Math.min(5,this.maxPeople):this.maxPeople;
    for(let i=this.people.length-1;i>=0;i--){const p=this.people[i]!;if(Math.hypot(p.rig.root.position.x-px,p.rig.root.position.z-pz)>190 || i>=limit){this.scene.remove(p.rig.root);disposeCharacter(p.rig);this.people.splice(i,1)}}
    if(this.timer<=0 && this.people.length<limit){this.timer=.3;this.spawn(px,pz)}
    for(const p of this.people){
      p.age+=dt;p.wait-=dt;const root=p.rig.root,role=ROLES[p.role]!;
      const moving=p.role===1||p.role===2||p.role===4||p.role===6;
      let speed=0;
      if(moving){
        const dx=p.target.x-root.position.x,dz=p.target.y-root.position.z,d=Math.hypot(dx,dz);
        if(p.wait<=0 && d>.3){
          const step=Math.min(d,dt*(p.role===2?1.5:1));const x=root.position.x+dx/d*step,z=root.position.z+dz/d*step;
          const occupiedByPerson=this.people.some(other=>other!==p&&Math.hypot(other.rig.root.position.x-x,other.rig.root.position.z-z)<.9);
          if(this.clear(x,z) && !occupiedByPerson && Math.hypot(x-px,z-pz)>1.2){root.position.x=x;root.position.z=z;root.rotation.y=Math.atan2(-dx,-dz);speed=step/Math.max(dt,.001)}
          else p.wait=1;
        }
        if(d<.4 || p.wait>0){
          if(p.wait<=0)p.wait=2+Math.random()*5;
          const a=p.phase+p.age*.3,x=p.anchor.x+Math.cos(a)*7,z=p.anchor.y+Math.sin(a)*7;
          if(this.clear(x,z))p.target.set(x,z);
        }
      }
      p.anim.update(dt,speed,true,0);
      if(!moving){
        if(p.role===5){p.rig.body.rotation.x=.08;p.rig.head.rotation.y=Math.sin(p.age*.4)*.25}
        else if(p.role===3){p.rig.body.rotation.x=-.35;p.rig.rightArm.rotation.x=-.8+Math.sin(p.age*2)*.3}
        else if(p.role===0){p.rig.rightArm.rotation.x=-.9+Math.sin(p.age*1.4)*.25;p.rig.head.rotation.y=Math.sin(p.age*.6)*.3}
        else if(p.role===7){p.rig.leftArm.rotation.z=-1.1+Math.sin(p.age*2)*.3;p.rig.rightArm.rotation.x=1.8+Math.sin(p.age*2)*.3;p.rig.body.rotation.y=Math.sin(p.age*.7)*.5}
      }
      if(p.role===6){p.rig.leftArm.rotation.x=-.8;p.rig.rightArm.rotation.x=-.8}
      root.visible=Math.hypot(root.position.x-px,root.position.z-pz)<145;
      p.rig.nameTag.visible=Math.hypot(root.position.x-px,root.position.z-pz)<15;
      root.userData['activity']=role.activity;
    }
  }
  private spawn(px:number,pz:number):void {
    for(let attempt=0;attempt<8;attempt++){
      const a=Math.random()*Math.PI*2,r=16+Math.random()*85,x=px+Math.cos(a)*r,z=pz+Math.sin(a)*r;
      if(!this.clear(x,z)||this.people.some(p=>Math.hypot(x-p.rig.root.position.x,z-p.rig.root.position.z)<3))continue;
      const role=this.sequence++%ROLES.length, spec=ROLES[role]!;
      const rig=createNpc(role,spec.name,this.sequence);
      rig.root.position.set(x,.08,z);rig.root.rotation.y=a;
      this.scene.add(rig.root);
      this.people.push({rig,anim:new PlayerAnimations(rig),role,anchor:new THREE.Vector2(x,z),target:new THREE.Vector2(x,z),wait:1,phase:a,age:Math.random()*20});return;
    }
  }
  nearby(x:number,z:number):string|null {
    const p=this.people.find(p=>Math.hypot(p.rig.root.position.x-x,p.rig.root.position.z-z)<2.5);
    return p?`${ROLES[p.role]!.name} — ${ROLES[p.role]!.activity}`:null;
  }
  dispose():void {for(const p of this.people){this.scene.remove(p.rig.root);disposeCharacter(p.rig)}this.people=[]}
}
