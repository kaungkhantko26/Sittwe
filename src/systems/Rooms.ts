import {loadRoomNetwork,testRelay,type RoomNetwork} from './RoomNetwork';
import type Peer from 'peerjs';
import type {DataConnection} from 'peerjs';
import {MAX_ROOM_PLAYERS,ROOM_VERSION,newRoomCode,roomCode,validSnapshot,type PlayerSnapshot} from './RoomProtocol';

/** Browser-hosted rooms: a star topology, 12 Hz snapshots, bounded queues and no microphone/camera access. */
export class Rooms {
  private peer:Peer|null=null;
  private links=new Map<string,DataConnection>();
  private states=new Map<string,{state:PlayerSnapshot;seen:number}>();
  private seq=0;private hosting=false;private generation=0;
  code:string|null=null;
  status='Solo play';
  relayStatus='Cross-network relay has not been checked.';
  private heartbeat:ReturnType<typeof setInterval>|null=null;
  private lastSend=0;
  async checkRelay():Promise<void>{
    this.relayStatus='Testing relay…';this.onPanelChange();
    try{const config=await this.network();this.relayStatus=!config.hasRelay?'Relay setup is required for blocked Wi-Fi/mobile networks.':await testRelay(config)?'TURN relay reachable — authentication and allocation passed.':'No TURN relay reachable from this network. Check relay credentials, quota and TCP/TLS support.';}
    catch{this.relayStatus='Relay configuration or service could not be reached.';}
    this.onPanelChange();
  }
  private startHeartbeat():void{if(this.heartbeat)clearInterval(this.heartbeat);this.lastSend=0;this.heartbeat=setInterval(()=>this.update(0),1000/12);}
  onChange:()=>void=()=>{};
  onPanelChange:()=>void=()=>{};
  onJoin:(state:PlayerSnapshot)=>void=()=>{};
  onPlayers:(players:Array<{id:string;state:PlayerSnapshot}>)=>void=()=>{};
  constructor(private readonly local:()=>PlayerSnapshot,private readonly network:()=>Promise<RoomNetwork>=loadRoomNetwork){}
  get active():boolean{return this.code!==null}
  get count():number{return this.states.size+1}
  private announce(text:string):void {this.status=text;this.onChange();this.onPanelChange()}
  async create():Promise<void> {this.leave();const generation=this.generation;const code=newRoomCode();this.announce('Creating room…');try{await this.open('sittwe-v1-'+code,generation);if(generation!==this.generation)return;this.hosting=true;this.code=code;this.startHeartbeat();this.announce(`Room ${code} · 1/${MAX_ROOM_PLAYERS} players`)}catch(e){if(generation===this.generation){this.leave();this.announce((e as Error).message)}}}
  async join(raw:string):Promise<void> {
    const code=roomCode(raw);if(!code){this.announce('Enter the six-character room code.');return;}
    this.leave();const generation=this.generation;this.announce('Connecting to room…');
    try {
      await this.open(null,generation);if(generation!==this.generation)return;
      const connection=this.peer!.connect('sittwe-v1-'+code,{reliable:false,serialization:'json',metadata:{version:ROOM_VERSION}});
      this.attach(connection,false,generation);
      await new Promise<void>((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Could not reach this room. Check the code, keep the host online, and run Test relay for different Wi-Fi/mobile networks.')),35000);
        connection.on('data',raw=>{if(generation!==this.generation)return;const p=raw as {type?:string;state?:unknown};if(p?.type==='welcome'&&(p as {version?:number}).version===ROOM_VERSION&&validSnapshot(p.state)){clearTimeout(timeout);this.onJoin(p.state);resolve()}});
        connection.on('error',()=>{clearTimeout(timeout);reject(new Error('The room connection failed. Try another network.'))});
      });
      if(generation!==this.generation)return;this.code=code;this.startHeartbeat();this.announce(`Room ${code} · connected`);
    }catch(e){if(generation===this.generation){this.leave();this.announce((e as Error).message)}}
  }
  private async open(id:string|null,generation:number):Promise<void> {
    if(typeof RTCPeerConnection==='undefined')throw new Error('This browser does not support multiplayer WebRTC. Solo play is available.');
    const {default:PeerClient}=await import('peerjs');if(generation!==this.generation)return;
    const network=await this.network();if(generation!==this.generation)return;
    this.relayStatus=network.hasRelay?'TURN relay configured; direct or relayed connections available.':'Relay setup required for networks that block direct connections.';this.onPanelChange();
    const options={secure:true,debug:0,config:{iceServers:network.iceServers,iceTransportPolicy:network.iceTransportPolicy}};
    const peer=id?new PeerClient(id,options):new PeerClient(options);this.peer=peer;
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Room service is unavailable. Try again shortly.')),15000);
      peer.on('open',()=>{clearTimeout(timeout);resolve()});
      peer.on('error',()=>{clearTimeout(timeout);reject(new Error('Could not connect to the room service. Check your internet connection.'))});
    });
    peer.on('connection',c=>{if(!this.hosting||this.links.size>=MAX_ROOM_PLAYERS-1||c.metadata?.version!==ROOM_VERSION){c.on('open',()=>c.close());return;}this.attach(c,true,generation)});
    peer.on('disconnected',()=>{if(this.active)this.announce(`Room ${this.code} · signaling disconnected; existing players can continue`)});
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
    c.on('open',()=>{if(generation!==this.generation){c.close();return;}if(incoming)this.send(c,{type:'welcome',version:ROOM_VERSION,state:this.local()});void this.inspectConnection(c,generation)});
    c.on('data',raw=>{
      if(generation!==this.generation||!raw||typeof raw!=='object')return;
      const p=raw as {type?:string;state?:unknown;players?:Array<{id:string;state:unknown}>};
      if(p.type==='welcome')return;
      if(p.type==='state'&&this.hosting&&validSnapshot(p.state)){
        const last=this.states.get(c.peer);if(last&&p.state.seq<=last.state.seq)return;
        this.states.set(c.peer,{state:p.state,seen:performance.now()});
      }
      if(p.type==='world'&&!this.hosting&&Array.isArray(p.players)&&p.players.length<=MAX_ROOM_PLAYERS){
        const players=p.players.filter(v=>v&&typeof v.id==='string'&&v.id!==this.peer?.id&&v.id.length<100&&validSnapshot(v.state)) as Array<{id:string;state:PlayerSnapshot}>;
        this.states.clear();for(const v of players)this.states.set(v.id,{state:v.state,seen:performance.now()});
        this.onPlayers(players);this.announce(`Room ${this.code??'joining'} · ${players.length+1}/${MAX_ROOM_PLAYERS} players`);
      }
    });
    const close=()=>{if(generation!==this.generation)return;this.links.delete(c.peer);this.states.delete(c.peer);if(!this.hosting){this.leave();this.announce('The host left. You are back in solo play.')}else this.onPlayers([...this.states].map(([id,v])=>({id,state:v.state})))};
    c.on('close',close);c.on('error',close);
  }
  update(_dt:number):void {
    if(!this.active)return;
    const tick=performance.now();if(tick-this.lastSend<1000/12)return;this.lastSend=tick;
    const local={...this.local(),seq:++this.seq};
    if(this.hosting){
      const now=performance.now();for(const [id,v] of this.states)if(now-v.seen>60000){this.states.delete(id);this.links.get(id)?.close()}
      const players=[{id:this.peer!.id,state:local},...[...this.states].map(([id,v])=>({id,state:v.state}))];
      for(const c of this.links.values())this.send(c,{type:'world',version:ROOM_VERSION,players});
      this.onPlayers(players.filter(p=>p.id!==this.peer!.id));
      const text=`Room ${this.code} · ${players.length}/${MAX_ROOM_PLAYERS} players`;if(text!==this.status)this.announce(text);
    }else for(const c of this.links.values())this.send(c,{type:'state',state:local});
  }
  leave():void {
    this.generation++;this.code=null;this.hosting=false;
    if(this.heartbeat)clearInterval(this.heartbeat);this.heartbeat=null;
    for(const c of this.links.values())c.close();this.links.clear();this.states.clear();
    this.peer?.destroy();this.peer=null;this.onPlayers([]);this.announce('Solo play');
  }
}
