import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {PhysicsWorld} from '../src/physics/PhysicsWorld';
import {VehiclePhysics,SPECS,type DriveInput} from '../src/vehicles/VehiclePhysics';
import {VehicleSystem} from '../src/vehicles/VehicleInteraction';

const bounds={minX:-400,maxX:400,minZ:-400,maxZ:400};
const idle:DriveInput={throttle:0,brake:0,steer:0,handbrake:false};
async function ride(kind:'motorbike'|'bicycle'){
  const p=await PhysicsWorld.create(bounds),b=new VehiclePhysics(p,0,0,0,kind);
  const step=(input:DriveInput,n:number)=>{for(let i=0;i<n;i++){b.drive(input,1/60,true);p.step()}};
  return {p,b,step};
}
const upright=(b:VehiclePhysics)=>{const q=b.body.rotation();return 1-2*(q.x*q.x+q.z*q.z);};

describe('motorbikes and bicycles',()=>{
  it('a motorbike accelerates to city speed, turns, and never tips over',async()=>{
    const {p,b,step}=await ride('motorbike');
    step(idle,60);step({...idle,throttle:1},420);
    const kmh=b.forwardSpeed()*3.6;expect(kmh).toBeGreaterThan(50);expect(kmh).toBeLessThan(SPECS.motorbike.topSpeed*3.6+3);
    const yaw=b.yaw();step({...idle,throttle:.6,steer:1},180);
    expect(Math.abs(Math.atan2(Math.sin(b.yaw()-yaw),Math.cos(b.yaw()-yaw)))).toBeGreaterThan(.5);
    expect(upright(b)).toBeGreaterThan(.98);
    const y=b.body.translation().y;expect(y).toBeGreaterThan(.2);expect(y).toBeLessThan(1);
    b.dispose();p.world.free();
  });
  it('a bicycle is slower than a motorbike and stays upright when braking hard',async()=>{
    const {p,b,step}=await ride('bicycle');
    step({...idle,throttle:1},600);
    const kmh=b.forwardSpeed()*3.6;expect(kmh).toBeGreaterThan(18);expect(kmh).toBeLessThan(30);
    step({...idle,brake:1,steer:-1},120);
    expect(upright(b)).toBeGreaterThan(.98);expect(Math.abs(b.forwardSpeed())).toBeLessThan(2.5);
    b.dispose();p.world.free();
  });
  it('bikes cannot fly or turn into boats, and are pushed back at the shore',async()=>{
    const p=await PhysicsWorld.create(bounds),system=new VehicleSystem(new THREE.Scene(),p,[]);
    const bike=system.spawnAt(0,0,0,0xff0000,'motorbike');system.enter(bike,false);
    const sea=(_x:number,z:number)=>z< -15;
    for(let i=0;i<500;i++){bike.fixedUpdate(1/60,{...idle,throttle:1,lift:true},true);p.step();system.postStep(1/60,sea);}
    expect(bike.physics.flying).toBe(false);expect(bike.physics.boat).toBe(false);expect(bike.position.z).toBeGreaterThan(-16);
    bike.dispose();p.world.free();
  });
});
