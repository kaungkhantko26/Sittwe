import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {syncedHours,validEnvironment,type RoomEnvironment} from '../src/systems/RoomProtocol';

const env:RoomEnvironment={hours:19.5,dayLengthMinutes:30,rain:true};
vi.mock('peerjs',async()=>{
  const {EventEmitter}=await import('node:events');
  const snapshot={seq:1,name:'Host',character:'boy',x:1,y:1,z:1,yaw:0,speed:0,dancing:false,vehicle:null};
  class FakePeer extends EventEmitter {
    id:string;
    constructor(id:unknown){super();this.id=typeof id==='string'?id:'guest';queueMicrotask(()=>this.emit('open',this.id));}
    connect(id:string){
      const c=Object.assign(new EventEmitter(),{peer:id,open:false,metadata:{version:1},dataChannel:{readyState:'connecting',bufferedAmount:0},peerConnection:{getStats:async()=>new Map()},
        close:()=>{c.open=false;c.emit('close');},
        send:(p:{type:string})=>{if(p.type==='hello')queueMicrotask(()=>c.emit('data',{type:'welcome',version:1,state:snapshot,env:{hours:19.5,dayLengthMinutes:30,rain:true}}));}});
      queueMicrotask(()=>{c.open=true;c.dataChannel.readyState='open';c.emit('open');});
      (globalThis as {lastLink?:unknown}).lastLink=c;
      return c;
    }
    destroy(){}reconnect(){}
  }
  return {default:FakePeer};
});
import {Rooms} from '../src/systems/Rooms';

describe('shared room environment',()=>{
  it('accepts bounded environments and rejects malformed ones',()=>{
    expect(validEnvironment(env)).toBe(true);
    for(const patch of [{hours:24},{hours:-1},{hours:NaN},{dayLengthMinutes:-1},{dayLengthMinutes:1e6},{rain:'yes'}])expect(validEnvironment({...env,...patch})).toBe(false);
    expect(validEnvironment(null)).toBe(false);
  });
  it('keeps the local clock smooth unless it drifts from the host, including across midnight',()=>{
    expect(syncedHours(12,12.005)).toBe(12);
    expect(syncedHours(12,15)).toBe(15);
    expect(syncedHours(23.995,0.002)).toBe(23.995);
    expect(syncedHours(23.5,0.5)).toBe(0.5);
  });

  let rooms:Rooms;
  const state={seq:0,name:'Guest',character:'girl' as const,x:2,y:1,z:2,yaw:0,speed:0,dancing:false,vehicle:null};
  beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('RTCPeerConnection',function(){});rooms=new Rooms(()=>state,async()=>({iceServers:[],iceTransportPolicy:'all',hasRelay:true}));});
  afterEach(()=>{rooms.leave();vi.useRealTimers();vi.unstubAllGlobals();});

  it('makes a joiner follow the host environment and releases it on leaving',async()=>{
    const seen:Array<RoomEnvironment|null>=[];rooms.onEnvironment=e=>seen.push(e);
    const task=rooms.join('ABC234');await vi.advanceTimersByTimeAsync(500);await task;
    expect(rooms.followsHost).toBe(true);expect(seen[0]).toEqual(env);
    // Live world updates carry later host changes.
    const link=(globalThis as unknown as {lastLink:{emit:(e:string,d:unknown)=>void}}).lastLink;
    link.emit('data',{type:'world',version:1,players:[],seats:[],env:{...env,rain:false}});
    expect(seen.at(-1)).toEqual({...env,rain:false});
    // Malformed environments are ignored.
    link.emit('data',{type:'world',version:1,players:[],seats:[],env:{hours:99}});
    expect(seen.at(-1)).toEqual({...env,rain:false});
    rooms.leave();
    expect(rooms.followsHost).toBe(false);expect(seen.at(-1)).toBeNull();
  });
  it('does not follow anyone while hosting',async()=>{
    rooms.environment=()=>env;await rooms.create();
    expect(rooms.followsHost).toBe(false);
  });
});
