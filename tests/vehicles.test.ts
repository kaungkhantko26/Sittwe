import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {PhysicsWorld} from '../src/physics/PhysicsWorld';
import {VehiclePhysics, type DriveInput} from '../src/vehicles/VehiclePhysics';
import {VehicleSystem} from '../src/vehicles/VehicleInteraction';
import {createVehicleModel,disposeVehicleModel,deployPods} from '../src/vehicles/VehicleModel';
const bounds={minX:-200,maxX:200,minZ:-200,maxZ:200};
const idle:DriveInput={throttle:0,brake:0,steer:0,handbrake:false};
describe('reference flying sedan and vehicle safety',()=>{
  it('builds four animated rotor pods for player cars while traffic remains a ground car',()=>{
    const errors=vi.spyOn(console,'error');
    const a=createVehicleModel(0xffffff,true),b=createVehicleModel(0x444444);
    expect(errors).not.toHaveBeenCalled();errors.mockRestore();
    expect(a.rotors).toHaveLength(4);expect(a.thrustMat).not.toBeNull();expect(b.rotors).toHaveLength(0);
    // Fans are folded away on land and spread out once flying.
    const width=()=>new THREE.Box3().setFromObject(a.root,true).getSize(new THREE.Vector3()).x;
    expect(a.pods).toHaveLength(4);expect(width()).toBeLessThan(2.5);
    for(let i=0;i<60;i++)deployPods(a,true,1/30);
    expect(width()).toBeGreaterThan(4.5);
    for(let i=0;i<60;i++)deployPods(a,false,1/30);
    expect(a.pods!.every(p=>!p.visible)).toBe(true);
    disposeVehicleModel(a);disposeVehicleModel(b);
  });
  it('takes off, holds altitude and lands without falling through the ground',async()=>{
    const p=await PhysicsWorld.create(bounds),car=new VehiclePhysics(p,0,0,0);
    const step=(input:DriveInput,count:number)=>{for(let i=0;i<count;i++){car.drive(input,1/60,true);p.step()}};
    step(idle,90);step({...idle,lift:true},100);expect(car.flying).toBe(true);expect(car.body.translation().y).toBeGreaterThan(5);
    step(idle,120);const h=car.body.translation().y;step(idle,120);expect(Math.abs(car.body.translation().y-h)).toBeLessThan(.1);
    car.toggleFlight();step(idle,600);expect(car.flying).toBe(false);expect(car.body.translation().y).toBeGreaterThan(.4);expect(car.body.translation().y).toBeLessThan(1.2);
    car.dispose();p.world.free();
  });
  it('rejects spawning a full car in or immediately beside another car',async()=>{
    const p=await PhysicsWorld.create(bounds),system=new VehicleSystem(new THREE.Scene(),p,[{x:0,z:0,yaw:0}]);
    for(let i=0;i<2;i++)p.step();
    expect(system.canPlace(0,0,0)).toBe(false);expect(system.canPlace(0,3,0)).toBe(false);expect(system.canPlace(0,12,0)).toBe(true);
    for(const v of system.vehicles)v.dispose();p.world.free();
  });
});
