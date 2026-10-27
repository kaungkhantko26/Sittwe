import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
const mock=vi.hoisted(()=>({mode:'drop-first',hellos:0,policies:[]}));
vi.mock('peerjs',async()=>{
 const {EventEmitter}=await import('node:events');
 class FakePeer extends EventEmitter {
  constructor(id,options){super();this.id=typeof id==='string'?id:'guest';this.options=typeof id==='object'?id:options;mock.policies.push(this.options.config.iceTransportPolicy);queueMicrotask(()=>this.emit('open',this.id))}
  connect(id){const c=new EventEmitter();c.peer=id;c.open=false;c.metadata={version:1};c.dataChannel={readyState:'connecting',bufferedAmount:0};c.peerConnection={getStats:async()=>new Map()};
   c.close=()=>{if(c.closed)return;c.closed=true;c.open=false;c.emit('close')};
   c.send=p=>{if(p.type!=='hello')return;mock.hellos++;if(mock.mode==='drop-first'&&mock.hellos<2)return;if(mock.mode==='fallback'&&this.options.config.iceTransportPolicy!=='relay')return;if(mock.mode==='silent')return;queueMicrotask(()=>c.emit('data',mock.mode==='world-only'?{type:'world',version:1,players:[{id,state:snapshot}]}:{type:'welcome',version:1,state:snapshot}))};
   queueMicrotask(()=>{if(mock.mode==='offline'){this.emit('error',{type:'peer-unavailable'});return;}c.open=true;c.dataChannel.readyState='open';c.emit('open')});return c;
  }
  destroy(){}reconnect(){}
 }
 const snapshot={seq:1,name:'Host',character:'boy',x:1,y:1,z:1,yaw:0,speed:0,dancing:false,vehicle:null};
 return {default:FakePeer};
});
import {Rooms} from '../src/systems/Rooms';
const state={seq:0,name:'Guest',character:'girl',x:2,y:1,z:2,yaw:0,speed:0,dancing:false,vehicle:null};
let rooms;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('RTCPeerConnection',function(){});mock.mode='drop-first';mock.hellos=0;mock.policies=[];rooms=new Rooms(()=>state,async()=>({iceServers:[],iceTransportPolicy:'all',hasRelay:true}))});
afterEach(()=>{rooms.leave();vi.useRealTimers();vi.unstubAllGlobals()});
describe('room handshake recovery',()=>{
 it('retries hello until a delayed welcome arrives and installs the room before entering play',async()=>{const joined=vi.fn(()=>expect(rooms.active).toBe(true));rooms.onJoin=joined;const task=rooms.join('ABC234');await vi.advanceTimersByTimeAsync(1200);await task;expect(mock.hellos).toBeGreaterThanOrEqual(2);expect(joined).toHaveBeenCalledOnce();expect(rooms.connecting).toBe(false)});
 it('accepts a live host world update as an acknowledgment',async()=>{mock.mode='world-only';const task=rooms.join('ABC234');await vi.advanceTimersByTimeAsync(800);await task;expect(rooms.code).toBe('ABC234')});
 it('reports an offline host immediately instead of waiting for a connection timeout',async()=>{mock.mode='offline';const task=rooms.join('ABC234');await vi.advanceTimersByTimeAsync(500);await task;expect(rooms.status).toContain('not online');expect(mock.policies).toEqual(['all']);expect(rooms.connecting).toBe(false)});
 it('retries a stalled direct connection with relay-only ICE',async()=>{mock.mode='fallback';const task=rooms.join('ABC234');await vi.advanceTimersByTimeAsync(17000);await task;expect(mock.policies).toEqual(['all','relay']);expect(rooms.active).toBe(true)});
 it('allows cancelling a pending connection without a late join',async()=>{mock.mode='silent';const joined=vi.fn();rooms.onJoin=joined;const task=rooms.join('ABC234');await vi.advanceTimersByTimeAsync(500);rooms.leave();await vi.advanceTimersByTimeAsync(500);await task;expect(rooms.connecting).toBe(false);expect(joined).not.toHaveBeenCalled()});
});
