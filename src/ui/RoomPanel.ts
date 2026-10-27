import type {Rooms} from '../systems/Rooms';
import {h,formatDistance} from './dom';
import {byDistance,playerColor,type FindMode,type FoundPlayer} from '../systems/PlayerFinder';
/** Finding other players from the room panel. */
export interface PlayerFinderHooks {list():FoundPlayer[];me():{x:number;z:number};find(id:string,mode:FindMode):void}
export function roomPanel(rooms:Rooms,play:()=>void,finder?:PlayerFinderHooks):HTMLElement {
 const status=h('p.room-status',{'role':'status'},rooms.status);
 const relay=h('p.small.muted',{'role':'status'},rooms.relayStatus);
 const test=h('button.btn',{onclick:()=>void rooms.checkRelay()},'Test relay');
 const code=h('input.room-code',{'aria-label':'Room code',placeholder:'6-character room code',maxlength:'6',autocomplete:'off',autocapitalize:'characters',spellcheck:'false'}) as HTMLInputElement;
 const create=h('button.btn.primary',{onclick:()=>void rooms.create()},'Create room');
 const join=h('button.btn',{onclick:()=>void rooms.join(code.value)},'Join room');
 const copy=h('button.btn',{onclick:()=>{if(rooms.code)void navigator.clipboard?.writeText(rooms.code).catch(()=>{})}},'Copy room code');
 const leave=h('button.btn',{onclick:()=>rooms.leave()},'Leave room');
 const start=h('button.btn.primary',{onclick:play},'Back to game');
 const players=h('ul.player-list');
 const playersBox=h('section.room-players.hidden',{},h('h3',{},'Find players'),players,h('p.small.muted',{},'Navigate shows the road route; Follow keeps re-routing as they move; Go to teleports next to them. Players also appear on the minimap and the map (M).'));
 const node=h('div.rooms',{},h('p',{},'Explore Sittwe with friends. Create a room and share its code, or enter a friend’s code below.'),status,h('div.row.gap',{},create,copy),h('label',{},'Room code',code),h('div.row.gap',{},join,leave,start),playersBox,h('div.row.gap',{},test),relay,h('p.small.muted',{},'Up to 8 players. Keep the host’s tab open. Rooms use an internet connection; some networks may block direct connections. City NPCs and personal homes remain local.'));
 const update=()=>{status.textContent=rooms.status;relay.textContent=rooms.relayStatus;test.disabled=rooms.relayStatus.includes('…');copy.disabled=!rooms.active;leave.textContent=rooms.connecting?'Cancel connection':'Leave room';leave.disabled=!rooms.active&&!rooms.connecting;create.disabled=rooms.active||rooms.connecting;join.disabled=rooms.active||rooms.connecting;};
 let lastKey='';
 const renderPlayers=()=>{
  if(!finder)return;
  const me=finder.me(),list=rooms.active?byDistance(finder.list(),me.x,me.z):[];
  playersBox.classList.toggle('hidden',!list.length);
  const key=list.map(p=>`${p.id}:${p.name}:${Math.round(p.distance/10)}:${p.direction}:${p.inVehicle}`).join('|');if(key===lastKey)return;lastKey=key;
  players.replaceChildren(...list.map(p=>{
   const li=h('li.player-row',{},h('span.player-name',{},p.name+(p.inVehicle?(p.flying?' ✈':' 🚗'):'')),h('span.muted.small',{},`${formatDistance(p.distance)} ${p.direction}`),
    h('span.row.gap',{},...(['navigate','follow','goto'] as const).map(mode=>h('button.btn.small',{onclick:()=>finder.find(p.id,mode)},mode==='navigate'?'Navigate':mode==='follow'?'Follow':'Go to'))));
   li.style.setProperty('--pc',playerColor(p.id));return li;
  }));
 };
 const timer=setInterval(()=>{if(!node.isConnected){clearInterval(timer);return;}renderPlayers();},1000);
 rooms.onPanelChange=()=>{if(node.isConnected){update();renderPlayers();}};update();renderPlayers();
 return node;
}
