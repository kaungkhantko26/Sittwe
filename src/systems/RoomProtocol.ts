export const ROOM_VERSION=1;
export const MAX_ROOM_PLAYERS=8;
export interface PlayerSnapshot {
  seq:number;name:string;character:'boy'|'girl';x:number;y:number;z:number;yaw:number;speed:number;dancing:boolean;
  vehicle:null|{x:number;y:number;z:number;yaw:number;flying:boolean};
}
export function roomCode(raw:string):string|null {const code=raw.trim().toUpperCase();return /^[A-HJ-NP-Z2-9]{6}$/.test(code)?code:null}
export function validSnapshot(raw:unknown):raw is PlayerSnapshot {
  if(!raw||typeof raw!=='object')return false;
  const s=raw as PlayerSnapshot;
  if(!Number.isSafeInteger(s.seq)||s.seq<0||typeof s.name!=='string'||s.name.length>32||!['boy','girl'].includes(s.character))return false;
  if(![s.x,s.y,s.z,s.yaw,s.speed].every(Number.isFinite)||Math.abs(s.x)>50000||Math.abs(s.z)>50000||s.y< -20||s.y>300||s.speed<0||s.speed>200||typeof s.dancing!=='boolean')return false;
  const v=s.vehicle;
  return v===null || !!v&&[v.x,v.y,v.z,v.yaw].every(Number.isFinite)&&Math.abs(v.x)<50000&&Math.abs(v.z)<50000&&v.y>=-20&&v.y<300&&typeof v.flying==='boolean';
}
export function newRoomCode():string {const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.getRandomValues(new Uint8Array(6));return Array.from(bytes,b=>alphabet[b%alphabet.length]).join('')}
