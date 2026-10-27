import {describe,it,expect} from 'vitest';
import type {ChunkBuilding} from '../src/geo/chunkFormat';
import {overlapShare,resolveCoplanarRoofs} from '../src/world/BuildingGenerator';

const rect=(id:string,x0:number,z0:number,x1:number,z1:number,h:number,st?:ChunkBuilding['st']):ChunkBuilding=>({id,k:'yes',p:[x0,z0,x1,z0,x1,z1,x0,z1],h,mh:0,...(st?{st}:{})} as ChunkBuilding);

describe('overlapping building roofs',()=>{
  it('measures how much of one footprint lies inside another',()=>{
    expect(overlapShare(rect('a',0,0,10,10,5).p,rect('b',-5,-5,20,20,5).p)).toBe(1);
    expect(overlapShare(rect('a',0,0,10,10,5).p,rect('b',5,0,20,10,5).p)).toBeCloseTo(.5,1);
    expect(overlapShare(rect('a',0,0,10,10,5).p,rect('b',10,0,20,10,5).p)).toBe(0);
  });
  it('drops a same-height duplicate outline mostly inside a styled landmark (Government Office case)',()=>{
    const out=resolveCoplanarRoofs([rect('office',0,0,60,40,9.6,'civic'),rect('dup',1,8,59,39,9.6)]);
    expect(out.map(o=>o.b.id)).toEqual(['office']);
  });
  it('lowers the smaller roof when two same-height buildings only partly overlap',()=>{
    const out=resolveCoplanarRoofs([rect('big',0,0,20,20,6.4),rect('small',15,0,25,10,6.4)]);
    expect(out.find(o=>o.b.id==='big')!.h).toBe(6.4);
    expect(out.find(o=>o.b.id==='small')!.h).toBeCloseTo(6.1);
  });
  it('leaves neighbours that only share a wall, and taller parts, unchanged',()=>{
    const row=resolveCoplanarRoofs([rect('a',0,0,10,10,6.4),rect('b',10,0,20,10,6.4),rect('tower',2,2,6,6,14)]);
    expect(row.map(o=>[o.b.id,o.h])).toEqual([['a',6.4],['b',6.4],['tower',14]]);
  });
});
