export const ROOM_VERSION=1;
export const MAX_ROOM_PLAYERS=8;
export interface PlayerSnapshot {
  seq:number;name:string;character:'boy'|'girl';x:number;y:number;z:number;yaw:number;speed:number;dancing:boolean;
  /** Swimming (older clients omit it). */
  swim?:boolean;
  /** Sitting: kneeling to pray, or on a bench (older clients omit it). */
  sit?:'kneel'|'bench';
  vehicle:null|{x:number;y:number;z:number;yaw:number;flying:boolean;boat?:boolean;kind?:'car'|'motorbike'|'bicycle';wheelie?:number;id?:number;color?:number;headlights?:boolean;braking?:boolean;qx?:number;qy?:number;qz?:number;qw?:number};
}
export function roomCode(raw:string):string|null {const code=raw.trim().toUpperCase();return /^[A-HJ-NP-Z2-9]{6}$/.test(code)?code:null}
export function validSnapshot(raw:unknown):raw is PlayerSnapshot {
  if(!raw||typeof raw!=='object')return false;
  const s=raw as PlayerSnapshot;
  if(!Number.isSafeInteger(s.seq)||s.seq<0||typeof s.name!=='string'||s.name.length>32||!['boy','girl'].includes(s.character))return false;
  if(![s.x,s.y,s.z,s.yaw,s.speed].every(Number.isFinite)||Math.abs(s.x)>50000||Math.abs(s.z)>50000||s.y< -20||s.y>300||s.speed<0||s.speed>200||typeof s.dancing!=='boolean'||(s.swim!==undefined&&typeof s.swim!=='boolean')||(s.sit!==undefined&&s.sit!=='kneel'&&s.sit!=='bench'))return false;
  const v=s.vehicle;
  return v===null || !!v&&[v.x,v.y,v.z,v.yaw].every(Number.isFinite)&&Math.abs(v.x)<50000&&Math.abs(v.z)<50000&&v.y>=-20&&v.y<300&&typeof v.flying==='boolean' && (v.id===undefined||Number.isSafeInteger(v.id)&&v.id>=0) && (v.color===undefined||Number.isInteger(v.color)&&v.color>=0&&v.color<=0xffffff) && (v.headlights===undefined||typeof v.headlights==='boolean') && (v.braking===undefined||typeof v.braking==='boolean') && (v.boat===undefined||typeof v.boat==='boolean') && (v.kind===undefined||['car','motorbike','bicycle'].includes(v.kind)) && (v.wheelie===undefined||typeof v.wheelie==='number'&&v.wheelie>=0&&v.wheelie<=0.8) && ([v.qx,v.qy,v.qz,v.qw].every(n=>n===undefined)||[v.qx,v.qy,v.qz,v.qw].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1.001));
}
export function newRoomCode():string {const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(6));return Array.from(bytes,b=>alphabet[b%alphabet.length]).join('')}
/** Shared world environment: the host's clock, day speed and weather, sent with every room update. */
export interface RoomEnvironment {hours:number;dayLengthMinutes:number;rain:boolean}
export function validEnvironment(raw:unknown):raw is RoomEnvironment {
  if(!raw||typeof raw!=='object')return false;
  const e=raw as RoomEnvironment;
  return Number.isFinite(e.hours)&&e.hours>=0&&e.hours<24&&Number.isFinite(e.dayLengthMinutes)&&e.dayLengthMinutes>=0&&e.dayLengthMinutes<=240&&typeof e.rain==='boolean';
}
/** Keeps the local clock running smoothly; jumps to the host's time only when they drift apart by more than ~1 game minute. */
export function syncedHours(local:number,host:number):number {
  const d=((host-local+36)%24)-12;
  return Math.abs(d)>1/60?host:local;
}
