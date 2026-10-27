import {describe,it,expect} from 'vitest';
import {validSnapshot,roomCode,type PlayerSnapshot} from '../src/systems/RoomProtocol';
const sample:PlayerSnapshot={seq:1,name:'Friend',character:'girl',x:10,y:.1,z:20,yaw:0,speed:2,dancing:false,vehicle:null};
describe('multiplayer protocol',()=>{
 it('normalises valid room codes and rejects unusable codes',()=>{expect(roomCode(' abc234 ')).toBe('ABC234');expect(roomCode('AAAA')).toBeNull();expect(roomCode('<script>')).toBeNull()});
 it('carries the swimming state and rejects a malformed one',()=>{expect(validSnapshot({...sample,swim:true})).toBe(true);expect(validSnapshot({...sample,swim:'yes'})).toBe(false)});
 it('accepts bounded player and flying-car snapshots',()=>{expect(validSnapshot(sample)).toBe(true);expect(validSnapshot({...sample,vehicle:{x:5,y:40,z:8,yaw:1,flying:true}})).toBe(true)});
 it('rejects malformed or unbounded network state before rendering it',()=>{
  for(const patch of [{seq:-1},{seq:1.5},{x:Infinity},{y:10000},{speed:-1},{name:'a'.repeat(1000)},{character:'unknown'},{dancing:1},{vehicle:{x:NaN,y:1,z:2,yaw:0,flying:true}}])expect(validSnapshot({...sample,...patch})).toBe(false);
  expect(validSnapshot(null)).toBe(false);
 });
});
