import type {Rooms} from '../systems/Rooms';
import {h} from './dom';
export function roomPanel(rooms:Rooms,play:()=>void):HTMLElement {
 const status=h('p.room-status',{'role':'status'},rooms.status);
 const code=h('input.room-code',{'aria-label':'Room code',placeholder:'6-character room code',maxlength:'6',autocomplete:'off',autocapitalize:'characters',spellcheck:'false'}) as HTMLInputElement;
 const create=h('button.btn.primary',{onclick:()=>void rooms.create()},'Create room');
 const join=h('button.btn',{onclick:()=>void rooms.join(code.value)},'Join room');
 const copy=h('button.btn',{onclick:()=>{if(rooms.code)void navigator.clipboard?.writeText(rooms.code).catch(()=>{})}},'Copy room code');
 const leave=h('button.btn',{onclick:()=>rooms.leave()},'Leave room');
 const start=h('button.btn.primary',{onclick:play},'Back to game');
 const node=h('div.rooms',{},h('p',{},'Explore Sittwe with friends. Create a room and share its code, or enter a friend’s code below.'),status,h('div.row.gap',{},create,copy),h('label',{},'Room code',code),h('div.row.gap',{},join,leave,start),h('p.small.muted',{},'Up to 8 players. Keep the host’s tab open. Rooms use an internet connection; some networks may block direct connections. City NPCs and personal homes remain local.'));
 const update=()=>{status.textContent=rooms.status;copy.disabled=!rooms.active;leave.disabled=!rooms.active;create.disabled=rooms.active||rooms.status.includes('…');join.disabled=rooms.active||rooms.status.includes('…');};
 rooms.onPanelChange=()=>{if(node.isConnected)update()};update();
 return node;
}
