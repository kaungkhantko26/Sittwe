import {describe,it,expect,vi} from 'vitest';
vi.mock('../src/player/CharacterModels',async()=>{const THREE=await import('three');return {createCharacter:()=>Object.fromEntries(['root','body','head','leftArm','rightArm','leftLeg','rightLeg','nameTag'].map(k=>[k,new THREE.Group()])),disposeCharacter:()=>{}}});
import {PhysicsWorld} from '../src/physics/PhysicsWorld';
import {Groups} from '../src/physics/CollisionLayers';
import {PlayerController} from '../src/player/PlayerController';
const idle={moveX:0,moveZ:0,sprint:false,jump:false};
describe('settled player support',()=>{
 it('rests without contact-height shake on a raised floor and still jumps',async()=>{
  const physics=await PhysicsWorld.create({minX:-30,maxX:30,minZ:-30,maxZ:30});
  physics.createStaticBoxes([0,1.8,0,10,.1,10,0],Groups.building);
  const player=new PlayerController(physics,'Test',0,0);player.teleport(0,0,0,1.9);
  const heights=[];
  for(let i=0;i<240;i++){player.fixedUpdate(1/60,idle);physics.step();player.update(1/60,1);if(i>120)heights.push(player.renderPos.y)}
  expect(Math.max(...heights)-Math.min(...heights)).toBeLessThan(.001);expect(player.renderPos.y).toBeCloseTo(1.92,1);
  const rest=player.position.y;let high=rest;
  for(let i=0;i<30;i++){player.fixedUpdate(1/60,{...idle,jump:i===0});physics.step();high=Math.max(high,player.position.y)}
  expect(high-rest).toBeGreaterThan(.5);physics.world.free();
 });
});
