import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {PhysicsWorld} from '../src/physics/PhysicsWorld';
import {BOAT,type DriveInput} from '../src/vehicles/VehiclePhysics';
import {VehicleSystem} from '../src/vehicles/VehicleInteraction';

const bounds={minX:-300,maxX:300,minZ:-300,maxZ:300};
const idle:DriveInput={throttle:0,brake:0,steer:0,handbrake:false};
// The sea starts 20 m north of the start (−Z is forward for a car facing yaw 0).
const sea=(_x:number,z:number)=>z< -20;

async function setup(){
  const p=await PhysicsWorld.create(bounds),system=new VehicleSystem(new THREE.Scene(),p,[{x:0,z:0,yaw:0},{x:12,z:-15,yaw:0}]);
  const car=system.vehicles[0]!,parked=system.vehicles[1]!;
  system.enter(car,false);
  const changes:boolean[]=[];system.onBoatChange=(_v,b)=>changes.push(b);
  const step=(input:DriveInput,n:number)=>{for(let i=0;i<n;i++){for(const v of system.vehicles)v.fixedUpdate(1/60,v===car?input:idle,v===car);p.step();system.postStep(1/60,sea);}};
  return {p,system,car,parked,changes,step};
}

describe('amphibious car',()=>{
  it('turns into a floating boat on the sea, keeps going, and becomes a car again on land',async()=>{
    const {p,system,car,changes,step}=await setup();
    step(idle,60);
    step({...idle,throttle:1},600);
    expect(car.physics.boat).toBe(true);expect(changes[0]).toBe(true);
    expect(car.position.z).toBeLessThan(-60);
    // Floats at the waterline, upright.
    expect(Math.abs(car.position.y-BOAT.floatY)).toBeLessThan(.15);
    expect(car.physics.isUpsideDown()).toBe(false);
    expect(car.speedKmh).toBeGreaterThan(30);expect(car.speedKmh).toBeLessThan(BOAT.boostSpeed*3.6+5);
    // Steering turns the boat while moving.
    const yaw=car.yaw;step({...idle,throttle:1,steer:1},120);
    expect(Math.abs(Math.atan2(Math.sin(car.yaw-yaw),Math.cos(car.yaw-yaw)))).toBeGreaterThan(.8);
    // Head back south to the shore: car mode again on land.
    step({...idle,throttle:1,steer:1},200);
    // Heading π faces south (+Z); steer toward it until ashore.
    for(let i=0;i<1500&&car.physics.boat;i++){const d=Math.atan2(Math.sin(Math.PI-car.yaw),Math.cos(Math.PI-car.yaw));step({...idle,throttle:1,steer:Math.max(-1,Math.min(1,d*2))},1);}
    expect(car.physics.boat).toBe(false);expect(changes.at(-1)).toBe(false);
    step(idle,120);
    expect(car.position.y).toBeGreaterThan(.4);expect(car.position.y).toBeLessThan(1.2);
    for(const v of system.vehicles)v.dispose();p.world.free();
  });
  it('can take off from the water and is reset to a normal car',async()=>{
    const {p,system,car,step}=await setup();
    step({...idle,throttle:1},500);expect(car.physics.boat).toBe(true);
    step({...idle,lift:true},60);expect(car.physics.flying).toBe(true);expect(car.physics.boat).toBe(false);
    car.reset(0,0,0);expect(car.physics.boat).toBe(false);expect(car.physics.flying).toBe(false);
    for(const v of system.vehicles)v.dispose();p.world.free();
  });
  it('still keeps parked cars that nobody drives out of the water',async()=>{
    const {p,system,parked,step}=await setup();
    parked.physics.body.setLinvel({x:0,y:0,z:-12},true);
    step(idle,90);
    expect(parked.physics.boat).toBe(false);expect(parked.position.z).toBeGreaterThan(-21.5);
    for(const v of system.vehicles)v.dispose();p.world.free();
  });
});
