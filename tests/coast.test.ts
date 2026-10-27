import {describe,it,expect} from 'vitest';
import {placeCoastalTrees,type PlacementContext} from '../src/world/VegetationGenerator';

// Straight coastline along z = 0: sea to the north (z < 0), land to the south.
const coast=[0,0,256,0];
const bounds={minX:0,maxX:256,minZ:-128,maxZ:128};
const ctx=(opts:{townFromX?:number}={}):PlacementContext=>({
  isWater:(_x,z)=>z<0,
  // Buildings fill the land east of townFromX (a built-up shore); west is wild.
  buildings:{hit:(x:number,z:number,m=0)=>opts.townFromX!==undefined&&x+m>=opts.townFromX&&z>8} as never,
  roads:{hit:()=>false} as never,
});

describe('coastal palms and mangroves',()=>{
  it('puts mangroves in the shallows on wild shores',()=>{
    const t=placeCoastalTrees('c',coast,bounds,ctx(),1);
    expect(t.length).toBeGreaterThan(10);
    expect(t.every(v=>v.type===3&&v.z<=0&&v.z>-5)).toBe(true);
  });
  it('puts palms a few metres inland on built-up shores, never in the water',()=>{
    const t=placeCoastalTrees('c',coast,bounds,ctx({townFromX:-1000}),1);
    expect(t.length).toBeGreaterThan(5);
    expect(t.every(v=>v.type===0&&v.z>=3&&v.z<=9)).toBe(true);
  });
  it('is deterministic per chunk and adds nothing when vegetation is off',()=>{
    expect(placeCoastalTrees('c',coast,bounds,ctx(),1)).toEqual(placeCoastalTrees('c',coast,bounds,ctx(),1));
    expect(placeCoastalTrees('c',coast,bounds,ctx(),0)).toEqual([]);
  });
});
