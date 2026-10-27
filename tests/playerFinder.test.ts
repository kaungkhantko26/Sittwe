import {describe,it,expect} from 'vitest';
import {byDistance,compassDirection,playerColor,rimPosition,shouldReroute} from '../src/systems/PlayerFinder';

describe('player finder',()=>{
  it('gives each player a stable colour',()=>{
    expect(playerColor('abc')).toBe(playerColor('abc'));
    expect(playerColor('abc')).not.toBe(playerColor('abd'));
  });
  it('names compass directions with X = east and Z = south',()=>{
    expect(compassDirection(0,0,0,-100)).toBe('N');
    expect(compassDirection(0,0,100,0)).toBe('E');
    expect(compassDirection(0,0,0,100)).toBe('S');
    expect(compassDirection(0,0,-100,-100)).toBe('NW');
  });
  it('keeps nearby markers in place and pins far ones to the minimap rim',()=>{
    expect(rimPosition(10,-20,80)).toMatchObject({x:10,y:-20,outside:false});
    const far=rimPosition(0,-400,80);
    expect(far.outside).toBe(true);expect(far.y).toBeCloseTo(-80);expect(far.angle).toBeCloseTo(0);
    expect(rimPosition(300,0,80).angle).toBeCloseTo(90);
  });
  it('re-routes a follow only after the friend moves away from the target',()=>{
    expect(shouldReroute(null,{x:0,z:0})).toBe(true);
    expect(shouldReroute({x:0,z:0},{x:5,z:5})).toBe(false);
    expect(shouldReroute({x:0,z:0},{x:30,z:0})).toBe(true);
  });
  it('sorts players nearest first with distance and direction',()=>{
    const list=byDistance([{id:'a',name:'Far',x:0,z:-500,inVehicle:false,flying:false},{id:'b',name:'Near',x:50,z:0,inVehicle:true,flying:false}],0,0);
    expect(list.map(p=>p.name)).toEqual(['Near','Far']);
    expect(list[0]).toMatchObject({distance:50,direction:'E'});
    expect(list[1]!.direction).toBe('N');
  });
});
