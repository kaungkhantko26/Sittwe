import {RideSeats,validRideSeats,type RideSeat,type RoomPlayer} from './RideSeats';
import {loadRoomNetworkResilient,testRelay,relayFallbackServers,type RoomNetwork} from './RoomNetwork';
import type Peer from 'peerjs';
import type {DataConnection} from 'peerjs';
import {MAX_ROOM_PLAYERS,ROOM_VERSION,newRoomCode,roomCode,validEnvironment,validSnapshot,type PlayerSnapshot,type RoomEnvironment} from './RoomProtocol';

/** Browser-hosted rooms: a star topology, 12 Hz snapshots, bounded queues and no microphone/camera access. */
export class Rooms {
  private peer:Peer|null=null;
  private links=new Map<string,DataConnection>();
  private states=new Map<string,{state:PlayerSnapshot;seen:number}>();
  private seq=0;private hosting=false;private generation=0;
  private readonly rideSeats=new RideSeats();
  ride:RideSeat|null=null;
  private leavingRide=false;
  private rideRequestTimer:ReturnType<typeof setTimeout>|null=null;
  onRide:(seat:RideSeat|null)=>void=()=>{};
  onRideMessage:(message:string)=>void=()=>{};
  onSeats:(seats:RideSeat[])=>void=()=>{};
  private roster():RoomPlayer[]{return [{id:this.peer?.id??'',state:this.local()},...[...this.states].map(([id,v])=>({id,state:v.state}))]}
  private publishSeats(seats:RideSeat[]):void{
    const assigned=seats.find(s=>s.playerId===this.peer?.id)??null;
    if(!assigned)this.leavingRide=false;
    const ride=this.leavingRide?null:assigned;
    if(ride&&this.rideRequestTimer){clearTimeout(this.rideRequestTimer);this.rideRequestTimer=null;}
    if(JSON.stringify(ride)!==JSON.stringify(this.ride)){this.ride=ride;this.onRide(ride);}
    this.onSeats(seats);
  }
  requestRide(driverId:string):void {
    if(!this.active||this.ride)return;
    this.leavingRide=false;
    if(this.rideRequestTimer)clearTimeout(this.rideRequestTimer);
    this.rideRequestTimer=setTimeout(()=>{this.rideRequestTimer=null;this.onRideMessage('Seat request timed out. Refresh both games and try again.');},5000);
    if(this.hosting){const error=this.rideSeats.request(this.peer!.id,driverId,this.roster());if(error){if(this.rideRequestTimer)clearTimeout(this.rideRequestTimer);this.rideRequestTimer=null;this.onRideMessage(error);}else this.publishSeats([...this.rideSeats.seats.values()]);}
    else for(const c of this.links.values())this.send(c,{type:'ride-request',driverId});
  }
  leaveRide():void {
    if(this.hosting){this.rideSeats.seats.delete(this.peer!.id);this.publishSeats([...this.rideSeats.seats.values()]);}
    else {for(const c of this.links.values())this.send(c,{type:'ride-leave'});const old=this.ride;this.publishSeats([]);this.leavingRide=!!old;}
  }
  code:string|null=null;
  status='Solo play';
  connecting=false;
  relayStatus='Cross-network relay has not been checked.';
  private heartbeat:ReturnType<typeof setInterval>|null=null;
  private lastSend=0;
  async checkRelay():Promise<void>{
    this.relayStatus='Testing relay…';this.onPanelChange();
    try{const config=await this.cachedNetwork(true);this.relayStatus=config.note&&!config.hasRelay?config.note:!config.hasRelay?'Relay setup is required for blocked Wi-Fi/mobile networks.':await testRelay(config)?'TURN relay reachable — authentication and allocation passed.':'No TURN relay reachable from this network. Check relay credentials, quota and TCP/TLS support.';}
    catch{this.relayStatus='Relay configuration or service could not be reached.';}
    this.onPanelChange();
  }
  private net:{at:number;value:Promise<RoomNetwork>}|null=null;
  /** Relay settings are fetched once and reused for 5 minutes, so creating or joining does not wait on a slow relay every time. */
  private cachedNetwork(fresh=false):Promise<RoomNetwork>{
    if(fresh||!this.net||performance.now()-this.net.at>300_000)this.net={at:performance.now(),value:this.network()};
    return this.net.value;
  }
  /** Starts checking the relay early (when the room panel opens). */
  prefetchNetwork():void{void this.cachedNetwork();}
  private startHeartbeat():void{if(this.heartbeat)clearInterval(this.heartbeat);this.lastSend=0;this.heartbeat=setInterval(()=>this.update(0),1000/12);}
  onChange:()=>void=()=>{};
  onPanelChange:()=>void=()=>{};
  onJoin:(state:PlayerSnapshot)=>void=()=>{};
  onPlayers:(players:Array<{id:string;state:PlayerSnapshot}>)=>void=()=>{};
  /** The host's environment (time, day speed, rain), shared with everyone in the room. */
  environment:()=>RoomEnvironment|null=()=>null;
  /** Called on joiners with the host's environment, and with null when they stop following a host. */
  onEnvironment:(env:RoomEnvironment|null)=>void=()=>{};
  private followingHost=false;
  /** Shared game state the host sends with every update (missions), and guests' requests back to the host. */
  gameState:()=>unknown=()=>null;
  onGameState:(data:unknown)=>void=()=>{};
  onGameMessage:(peerId:string,data:unknown)=>void=()=>{};
  get isHost():boolean{return this.hosting}
  /** Guest → host message (ignored when not in a room or when hosting). */
  sendToHost(data:unknown):void{if(!this.active||this.hosting)return;for(const c of this.links.values())this.send(c,{type:'game',data});}
  /** True while a joined (non-host) player's time and weather come from the host. */
  get followsHost():boolean{return this.followingHost}
  private receiveEnvironment(raw:unknown):void{if(!this.hosting&&validEnvironment(raw)){this.followingHost=true;this.onEnvironment(raw);}}
  constructor(private readonly local:()=>PlayerSnapshot,private readonly network:()=>Promise<RoomNetwork>=loadRoomNetworkResilient){}
  get active():boolean{return this.code!==null}
  /** This player's room id (null when not connected). */
  get selfId():string|null{return this.peer?.id??null}
  get count():number{return this.states.size+1}
  private announce(text:string):void {if(text===this.status)return;this.status=text;this.onChange();this.onPanelChange()}
  async create():Promise<void> {
    this.leave();const generation=this.generation,code=newRoomCode();this.connecting=true;this.announce('Creating room…');
    try{await this.open('sittwe-v1-'+code,generation);if(generation!==this.generation)return;this.hosting=true;this.code=code;this.connecting=false;this.startHeartbeat();this.announce(`Room ${code} · 1/${MAX_ROOM_PLAYERS} players`)}
    catch(e){if(generation===this.generation){this.leave();this.announce((e as Error).message)}}
  }
  async join(raw:string):Promise<void> {
    const code=roomCode(raw);if(!code){this.announce('Enter the six-character room code.');return;}
    for(let attempt=0;attempt<2;attempt++){
      this.leave();const generation=this.generation;this.connecting=true;this.announce(attempt?'Retrying through TURN relay…':'Connecting to room…');
      try{
        await this.open(null,generation,attempt===1);if(generation!==this.generation)return;
        const c=this.peer!.connect('sittwe-v1-'+code,{reliable:true,serialization:'json',metadata:{version:ROOM_VERSION}});
        this.attach(c,false,generation);
        const state=await this.waitForHost(c,generation);
        if(generation!==this.generation)return;
        this.code=code;this.connecting=false;this.startHeartbeat();this.announce(`Room ${code} · connected`);this.onJoin(state);return;
      }catch(e){
        if(generation!==this.generation)return;
        const message=(e as Error).message;
        if(attempt===0&&!message.includes('not online')&&!message.includes('different game version'))continue;
        this.leave();this.announce(message);return;
      }
    }
  }
  private waitForHost(c:DataConnection,generation:number):Promise<PlayerSnapshot>{
    const peer=this.peer!;
    return new Promise((resolve,reject)=>{
      let finished=false;
      const finish=(state:PlayerSnapshot|null,message='Connection closed before the room handshake completed.')=>{
        if(finished)return;finished=true;clearTimeout(timeout);clearInterval(retry);
        c.off('data',data);c.off('close',closed);c.off('error',closed);peer.off('error',peerError);
        if(state)resolve(state);else reject(new Error(message));
      };
      const data=(raw:unknown)=>{
        if(generation!==this.generation){finish(null,'Room connection cancelled.');return;}
        if(!raw||typeof raw!=='object')return;
        const p=raw as {type?:string;version?:number;state?:unknown;players?:Array<{id:string;state:unknown}>};
        if(p.version!==undefined&&p.version!==ROOM_VERSION){finish(null,'The host is using a different game version. Both players should refresh the site.');return;}
        if(p.type==='welcome'&&validSnapshot(p.state))finish(p.state);
        // A full world snapshot also acknowledges a live host if a welcome was delayed.
        if(p.type==='world'&&Array.isArray(p.players)){const host=p.players.find(v=>v&&v.id===c.peer);if(host&&validSnapshot(host.state))finish(host.state);}
      };
      const closed=()=>finish(null);
      const peerError=(error:{type?:string})=>finish(null,error.type==='peer-unavailable'?'This room is not online. Ask the host to create a new room and share its current code.':'The room service connection failed. Please retry.');
      const timeout=setTimeout(()=>finish(null,'The host did not respond, including through TURN. Keep the host’s game open, refresh both devices and create a new room.'),15000);
      const retry=setInterval(()=>{if(generation!==this.generation)finish(null,'Room connection cancelled.');else this.send(c,{type:'hello',version:ROOM_VERSION});},350);
      c.on('data',data);c.on('close',closed);c.on('error',closed);peer.on('error',peerError);
      this.send(c,{type:'hello',version:ROOM_VERSION});
    });
  }
  private async open(id:string|null,generation:number,relayOnly=false):Promise<void> {
    if(typeof RTCPeerConnection==='undefined')throw new Error('This browser does not support multiplayer WebRTC. Solo play is available.');
    const {default:PeerClient}=await import('peerjs');if(generation!==this.generation)return;
    const network=await this.cachedNetwork();if(generation!==this.generation)return;
    this.relayStatus=network.note??(network.hasRelay?'TURN relay configured; direct or relayed connections available.':'Relay setup required for networks that block direct connections.');this.onPanelChange();
    const options={secure:true,debug:0,config:{iceServers:relayOnly?relayFallbackServers(network.iceServers):network.iceServers,iceTransportPolicy:relayOnly&&network.hasRelay?'relay' as const:network.iceTransportPolicy}};
    const peer=id?new PeerClient(id,options):new PeerClient(options);this.peer=peer;
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Room service is unavailable. Try again shortly.')),15000);
      peer.on('open',()=>{clearTimeout(timeout);resolve()});
      peer.on('error',()=>{clearTimeout(timeout);reject(new Error('Could not connect to the room service. Check your internet connection.'))});
    });
    peer.on('connection',c=>{if(!this.hosting||this.links.size>=MAX_ROOM_PLAYERS-1||c.metadata?.version!==ROOM_VERSION){c.on('open',()=>c.close());return;}this.attach(c,true,generation)});
    peer.on('disconnected',()=>{if(this.active&&generation===this.generation){this.announce(`Room ${this.code} · reconnecting room service…`);try{peer.reconnect()}catch{/* Existing player channels can continue. */}}});
  }
  private send(c:DataConnection,payload:unknown):void {if(c.open&&c.dataChannel?.readyState==='open'&&c.dataChannel.bufferedAmount<32_768){try{c.send(payload)}catch{/* A closed channel must not interrupt rendering. */}}}
  private async inspectConnection(c:DataConnection,generation:number):Promise<void>{
    try{
      const stats=await c.peerConnection.getStats();let path='Direct connection';
      stats.forEach(report=>{
        if(report.type==='candidate-pair'&&report.state==='succeeded'&&report.nominated){
          const local=stats.get(report.localCandidateId),remote=stats.get(report.remoteCandidateId);
          if(local?.candidateType==='relay'||remote?.candidateType==='relay')path='Connected through TURN relay'+(local?.relayProtocol?' ('+String(local.relayProtocol).toUpperCase()+')':'');
        }
      });
      if(generation===this.generation&&c.open){this.relayStatus=path;this.onPanelChange();}
    }catch{/* Diagnostics must never interrupt room play. */}
  }
  private attach(c:DataConnection,incoming:boolean,generation:number):void {
    this.links.set(c.peer,c);
    c.on('open',()=>{if(generation!==this.generation){c.close();return;}if(incoming)this.send(c,{type:'welcome',version:ROOM_VERSION,state:this.local(),env:this.environment()});void this.inspectConnection(c,generation)});
    c.on('data',raw=>{
      if(generation!==this.generation||this.links.get(c.peer)!==c||!raw||typeof raw!=='object')return;
      const p=raw as {type?:string;state?:unknown;players?:Array<{id:string;state:unknown}>;driverId?:string;seats?:unknown;message?:string;env?:unknown;game?:unknown;data?:unknown};
      if(p.type==='ride-request'&&this.hosting&&typeof p.driverId==='string'){const error=this.rideSeats.request(c.peer,p.driverId,this.roster());if(error)this.send(c,{type:'ride-error',message:error});return;}
      if(p.type==='game'&&this.hosting){this.onGameMessage(c.peer,p.data);return;}
      if(p.type==='ride-leave'&&this.hosting){this.rideSeats.seats.delete(c.peer);return;}
      if(p.type==='ride-error'&&!this.hosting&&typeof p.message==='string'){if(this.rideRequestTimer)clearTimeout(this.rideRequestTimer);this.rideRequestTimer=null;this.onRideMessage(p.message.slice(0,150));return;}
      if(p.type==='hello'&&this.hosting){this.send(c,{type:'welcome',version:ROOM_VERSION,state:this.local(),env:this.environment()});return;}
      if(p.type==='welcome'){this.receiveEnvironment(p.env);return;}
      if(p.type==='state'&&this.hosting&&validSnapshot(p.state)){
        const last=this.states.get(c.peer);if(last&&p.state.seq<=last.state.seq)return;
        this.states.set(c.peer,{state:p.state,seen:performance.now()});
      }
      if(p.type==='world'&&!this.hosting&&Array.isArray(p.players)&&p.players.length<=MAX_ROOM_PLAYERS){
        const players=p.players.filter(v=>v&&typeof v.id==='string'&&v.id!==this.peer?.id&&v.id.length<100&&validSnapshot(v.state)) as Array<{id:string;state:PlayerSnapshot}>;
        this.states.clear();for(const v of players)this.states.set(v.id,{state:v.state,seen:performance.now()});
        if(validRideSeats(p.seats))this.publishSeats(p.seats);
        this.receiveEnvironment(p.env);
        if(p.game!==undefined)this.onGameState(p.game);
        this.onPlayers(players);this.announce(`Room ${this.code??'joining'} · ${players.length+1}/${MAX_ROOM_PLAYERS} players`);
      }
    });
    const close=()=>{if(generation!==this.generation||this.links.get(c.peer)!==c)return;this.links.delete(c.peer);this.states.delete(c.peer);if(!this.hosting&&this.active){this.leave();this.announce('The host left. You are back in solo play.')}else this.onPlayers([...this.states].map(([id,v])=>({id,state:v.state})))};
    c.on('close',close);c.on('error',close);
  }
  update(_dt:number):void {
    if(!this.active)return;
    const tick=performance.now();if(tick-this.lastSend<1000/12)return;this.lastSend=tick;
    const local={...this.local(),seq:++this.seq};
    if(this.hosting){
      const now=performance.now();for(const [id,v] of this.states)if(now-v.seen>60000){this.states.delete(id);this.links.get(id)?.close()}
      const players=[{id:this.peer!.id,state:local},...[...this.states].map(([id,v])=>({id,state:v.state}))];
      this.rideSeats.reconcile(players);const seats=[...this.rideSeats.seats.values()];this.publishSeats(seats);
      const env=this.environment(),game=this.gameState();for(const c of this.links.values())this.send(c,{type:'world',version:ROOM_VERSION,players,seats,env,game});
      this.onPlayers(players.filter(p=>p.id!==this.peer!.id));
      const text=`Room ${this.code} · ${players.length}/${MAX_ROOM_PLAYERS} players`;if(text!==this.status)this.announce(text);
    }else for(const c of this.links.values())this.send(c,{type:'state',state:local});
  }
  leave():void {
    if(this.rideRequestTimer)clearTimeout(this.rideRequestTimer);this.rideRequestTimer=null;this.leavingRide=false;
    this.rideSeats.seats.clear();this.publishSeats([]);
    this.generation++;this.code=null;this.hosting=false;this.connecting=false;
    if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;
    for(const c of this.links.values())c.close();this.links.clear();this.states.clear();
    this.peer?.destroy();this.peer=null;this.onPlayers([]);
    if(this.followingHost){this.followingHost=false;this.onEnvironment(null);}
    this.announce('Solo play');
  }
}
