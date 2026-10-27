import type {Rooms} from '../systems/Rooms';
import {h} from './dom';
export function roomPanel(rooms:Rooms,play:()=>void):HTMLElement {
 const status=h('p.room-status',{'role':'status'},rooms.status);
 const relay=h('p.small.muted',{'role':'status'},rooms.relayStatus);
 const test=h('button.btn',{onclick:()=>void rooms.checkRelay()},'Test relay');
 const code=h('input.room-code',{'aria-label':'Room code',placeholder:'6-character room code',maxlength:'6',autocomplete:'off',autocapitalize:'characters',spellcheck:'false'}) as HTMLInputElement;
 const create=h('button.btn.primary',{onclick:()=>void rooms.create()},'Create room');
 const join=h('button.btn',{onclick:()=>void rooms.join(code.value)},'Join room');
 const copy=h('button.btn',{onclick:()=>{if(rooms.code)void navigator.clipboard?.writeText(rooms.code).catch(()=>{})}},'Copy room code');
 const leave=h('button.btn',{onclick:()=>rooms.leave()},'Leave room');
 const start=h('button.btn.primary',{onclick:play},'Back to game');
 const node=h('div.rooms',{},h('p',{},'Explore Sittwe with friends. Create a room and share its code, or enter a friend’s code below.'),status,h('div.row.gap',{},create,copy),h('label',{},'Room code',code),h('div.row.gap',{},join,leave,start),h('div.row.gap',{},test),relay,h('p.small.muted',{},'Up to 8 players. Keep the host’s tab open. Rooms use an internet connection; some networks may block direct connections. City NPCs and personal homes remain local.'));
 const update=()=>{status.textContent=rooms.status;relay.textContent=rooms.relayStatus;test.disabled=rooms.relayStatus.includes('…');copy.disabled=!rooms.active;leave.textContent=rooms.connecting?'Cancel connection':'Leave room';leave.disabled=!rooms.active&&!rooms.connecting;create.disabled=rooms.active||rooms.connecting;join.disabled=rooms.active||rooms.connecting;};
 rooms.onPanelChange=()=>{if(node.isConnected)update()};update();
 return node;
}
