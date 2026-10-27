import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {MotionTrack} from '../src/systems/MotionTrack';
import {ThirdPersonCamera} from '../src/player/ThirdPersonCamera';
import type {PhysicsWorld} from '../src/physics/PhysicsWorld';
describe('movement stability',()=>{
 it('interpolates remote movement between packets and freezes cleanly during a gap',()=>{const m=new MotionTrack(.1);m.push({x:0,y:0,z:0,yaw:0},0);m.push({x:1,y:0,z:0,yaw:0},.1);expect(m.sample(.15)!.x).toBeCloseTo(.5);expect(m.sample(.18)!.x).toBeCloseTo(.8);expect(m.sample(5)!.x).toBe(1)});
 it('turns across north by the short arc and snaps actual teleports',()=>{const m=new MotionTrack(0);m.push({x:0,y:0,z:0,yaw:Math.PI-.1},0);m.push({x:1,y:0,z:0,yaw:-Math.PI+.1},1);expect(m.sample(.5)!.yaw).toBeCloseTo(Math.PI);m.push({x:100,y:0,z:0,yaw:0},2);expect(m.sample(2)!.x).toBe(100)});
 it('filters contact-height jitter from first-person camera position',()=>{const camera=new THREE.PerspectiveCamera();const orbit=new ThirdPersonCamera(camera,{} as PhysicsWorld);orbit.mode='first';const pivot=new THREE.Vector3(0,1.6,0);const target={pivot,heading:0,speed:0,inVehicle:false,ignore:[]};orbit.update(1/60,target);let worst=0,last=camera.position.y;for(let i=0;i<120;i++){pivot.y=1.6+(i%2?.02:-.02);orbit.update(1/60,target);worst=Math.max(worst,Math.abs(camera.position.y-last));last=camera.position.y}expect(worst).toBeLessThan(.012)});
});
