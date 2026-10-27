export const DIRECT_ICE:RTCIceServer[]=[{urls:['stun:stun.l.google.com:19302','stun:stun.cloudflare.com:3478']}];
export interface RoomNetwork {iceServers:RTCIceServer[];iceTransportPolicy:RTCIceTransportPolicy;hasRelay:boolean}
/** Treat remote configuration as data and never display provider credentials in error text. */
export function parseIceServers(raw:unknown):RTCIceServer[] {
 if(!Array.isArray(raw)||raw.length>16)throw new Error('Invalid relay configuration.');
 return raw.map(item=>{
  if(!item||typeof item!=='object')throw new Error('Invalid relay configuration.');
  const r=item as Record<string,unknown>,urls=typeof r['urls']==='string'?[r['urls']]:r['urls'];
  if(!Array.isArray(urls)||!urls.length||urls.length>8||!urls.every(u=>typeof u==='string'&&u.length<512&&/^(stun|stuns|turn|turns):[a-z0-9.-]+(?::\d{1,5})?(?:\?transport=(udp|tcp))?$/i.test(u)))throw new Error('Invalid relay server address.');
  const relay=urls.some(u=>/^turns?:/i.test(u));
  if(relay&&(typeof r['username']!=='string'||!r['username']||r['username'].length>512||typeof r['credential']!=='string'||!r['credential']||r['credential'].length>2048))throw new Error('Relay credentials are missing.');
  return relay?{urls,username:r['username'] as string,credential:r['credential'] as string}:{urls};
 });
}
export async function loadRoomNetwork(fetcher:typeof fetch=fetch):Promise<RoomNetwork> {
 const configResponse=await fetcher(`${import.meta.env.BASE_URL}multiplayer.json`,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!configResponse.ok)throw new Error('Room network configuration could not be loaded.');
 const config=await configResponse.json() as {iceServersUrl?:unknown;relayOnly?:unknown};
 if(!config.iceServersUrl)return {iceServers:DIRECT_ICE,iceTransportPolicy:'all',hasRelay:false};
 if(typeof config.iceServersUrl!=='string')throw new Error('Invalid relay endpoint.');
 const url=new URL(config.iceServersUrl);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Use an HTTPS relay endpoint without API keys in its URL.');
 const response=await fetcher(url.href,{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('The relay service is unavailable.');
 const data=await response.json(),servers=parseIceServers(Array.isArray(data)?data:data.iceServers);
 const hasRelay=servers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u)));
 if(!hasRelay)throw new Error('The relay service returned no TURN servers.');
 return {iceServers:[...DIRECT_ICE,...servers],iceTransportPolicy:config.relayOnly===true?'relay':'all',hasRelay};
}
/** A relay candidate proves TURN authentication and allocation, without exposing IPs in the UI. */
export async function testRelay(network:RoomNetwork):Promise<boolean> {
 if(!network.hasRelay)return false;
 const pc=new RTCPeerConnection({iceServers:network.iceServers,iceTransportPolicy:'relay'});
 try{return await new Promise<boolean>((resolve,reject)=>{
  const finish=(ok:boolean)=>{clearTimeout(timeout);resolve(ok)};
  const timeout=setTimeout(()=>finish(false),15000);
  pc.onicecandidate=e=>{if(e.candidate?.type==='relay'||e.candidate?.candidate.includes(' typ relay '))finish(true)};
  pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete')finish(false)};
  pc.createDataChannel('relay-test');
  void pc.createOffer().then(offer=>pc.setLocalDescription(offer)).catch(()=>{clearTimeout(timeout);reject(new Error('Relay test could not start.'))});
 });}finally{pc.close()}
}

/** Prefer TURN over TLS/TCP on retry; UDP candidates may stall on restrictive mobile networks. */
export function relayFallbackServers(servers:RTCIceServer[]):RTCIceServer[]{
 const select=(pattern:RegExp)=>servers.flatMap(server=>{const urls=(Array.isArray(server.urls)?server.urls:[server.urls]).filter(url=>pattern.test(url));return urls.length?[{...server,urls}]:[]});
 const tls=select(/^turns:/i);if(tls.length)return tls;
 const tcp=select(/^turn:.*[?&]transport=tcp/i);return tcp.length?tcp:servers;
}
