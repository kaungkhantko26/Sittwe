import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Housing, STARTER_HOME, validateHomePlot, validHome } from '../src/systems/Housing';
import type { ChunkData, SeaData, WorldManifest } from '../src/geo/chunkFormat';
import type { MapDataLoader } from '../src/geo/MapDataLoader';
import { roundaboutSite } from '../src/geo/landmarkSite';
import { buildHome, disposeHome } from '../src/world/HomeGenerator';
import { PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Groups } from '../src/physics/CollisionLayers';
const bounds={minX:-512,maxX:512,minZ:-512,maxZ:512};
const chunk=():ChunkData=>({v:1,key:'0_0',cx:0,cz:0,roads:[{id:'r',c:'residential',w:4,s:true,e:true,p:[15,-100,15,100]}],buildings:[],water:[],waterways:[],landuse:[{id:'res',k:'residential',r:[[-500,-500,500,-500,500,500,-500,500]]}],trees:[],lamps:[],landmarks:[]});
const sea:SeaData={polygons:[]};

describe('safe home placement',()=>{
  it('accepts a clear residential yard with nearby road access',()=>expect(validateHomePlot({x:0,z:0},[chunk()],sea,bounds)).toBeNull());
  it('rejects an existing structure anywhere in the yard, including a thin edge crossing',()=>{
    const c=chunk();c.buildings.push({id:'b',k:'yes',h:4,mh:0,hs:'e',p:[-9,5,9,5,9,5.2,-9,5.2]});
    expect(validateHomePlot({x:0,z:0},[c],sea,bounds)).toContain('building');
  });
  it('rejects roads, water and restricted land rather than removing mapped features',()=>{
    const c=chunk();c.roads[0]!.p=[0,-100,0,100];expect(validateHomePlot({x:0,z:0},[c],sea,bounds)).toContain('roads');
    const water=chunk();water.water=[{id:'w',k:'water',r:[[-2,-2,2,-2,2,2,-2,2]]}];expect(validateHomePlot({x:0,z:0},[water],sea,bounds)).toContain('water');
    const land=chunk();land.landuse.push({id:'school',k:'institutional',r:[[-1,-20,1,-20,1,20,-1,20]]});expect(validateHomePlot({x:0,z:0},[land],sea,bounds)).toContain('non-residential');
  });
  it('rejects a sea edge crossing the yard even when all corners are dry',()=>{
    expect(validateHomePlot({x:0,z:0},[chunk()],{polygons:[[[ -20,-1,20,-1,20,1,-20,1 ]]]},bounds)).toContain('sea');
  });
  it('rejects unmapped residential land, out of bounds and invalid stored coordinates',()=>{
    const c=chunk();c.landuse=[];expect(validateHomePlot({x:0,z:0},[c],sea,bounds)).toContain('residential');
    expect(validateHomePlot({x:510,z:0},[chunk()],sea,bounds)).toContain('inside');
    expect(validHome({x:NaN,z:0})).toBe(false);expect(validHome(null)).toBe(false);
  });
  it('validates the real starter plot against surrounding map chunks and sea',()=>{
    const read=(p:string)=>JSON.parse(readFileSync(new URL('../public/data/'+p,import.meta.url),'utf8'));
    const m=read('manifest.json') as WorldManifest;
    const chunks:ChunkData[]=[];for(let x=-1;x<=1;x++)for(let z=-2;z<=0;z++)chunks.push(read(`chunks/c_${x}_${z}.json`));
    expect(validateHomePlot(STARTER_HOME,chunks,read('sea.json'),m.bounds)).toBeNull();
  });
  it('restores the saved home and reports storage failures without changing ownership',async()=>{
    const c=chunk();const manifest={chunkSize:256,chunks:[{cx:0,cz:0}],bounds} as WorldManifest;
    const loader={chunk:async()=>c} as unknown as MapDataLoader;
    const values=new Map<string,string>();const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)}} as Storage;
    const h=new Housing(loader,manifest,sea,storage);expect(h.commit({x:0,z:0})).toBe(true);
    const restored=new Housing(loader,manifest,sea,storage);await restored.init();expect(restored.home).toEqual({x:0,z:0});
    const unavailable=new Housing(loader,manifest,sea,null);expect(unavailable.commit({x:0,z:0})).toBe(false);expect(unavailable.home).toEqual(STARTER_HOME);
  });
});

describe('home collision traversal',()=>{
  it('allows the player to spawn inside, pass the open doorway and descend the stairs',async()=>{
    const physics=await PhysicsWorld.create(bounds),R=physics.R;
    const home=buildHome({x:0,z:0});
    physics.createStaticBoxes(home.boxes,Groups.building);physics.createStaticHulls(home.ramps,Groups.building);
    const body=physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0,2.8,0));
    const collider=physics.world.createCollider(R.ColliderDesc.capsule(.53,.32).setCollisionGroups(Groups.player),body);
    const kcc=physics.world.createCharacterController(.02);kcc.enableAutostep(.4,.15,false);kcc.enableSnapToGround(.35);
    for(let i=0;i<350;i++){
      kcc.computeColliderMovement(collider,{x:0,y:-.06,z:.035});const delta=kcc.computedMovement(),pos=body.translation();body.setNextKinematicTranslation({x:pos.x+delta.x,y:pos.y+delta.y,z:pos.z+delta.z});physics.step();
    }
    const p=body.translation();expect(p.z).toBeGreaterThan(10);expect(p.y).toBeLessThan(1.1);
    physics.world.free();disposeHome(home);
  });
});

describe('clock tower placement',()=>{
  it('centres the model in the mapped roundabout despite uneven vertex spacing',()=>{
    const p=[0,0,2,0,10,0,10,10,0,10,0,0];const site=roundaboutSite(7,4,[{p,w:2}]);expect(site?.x).toBeCloseTo(5);expect(site?.z).toBeCloseTo(5);
  });
  it('does not treat open roads or enormous closed city boundaries as roundabouts',()=>{
    expect(roundaboutSite(1,1,[{p:[0,0,10,0,10,10,0,10],w:3}])).toBeNull();
    expect(roundaboutSite(1,1,[{p:[0,0,100,0,100,100,0,100,0,0],w:3}])).toBeNull();
  });
});
