import {describe,it,expect,vi} from 'vitest';
import {loadRoomNetwork,loadRoomNetworkResilient,parseIceServers,relayFallbackServers} from '../src/systems/RoomNetwork';
const turn={urls:['turn:relay.example.com:3478?transport=udp','turns:relay.example.com:443?transport=tcp'],username:'temporary-user',credential:'temporary-password'};
describe('cross-network room configuration',()=>{
 it('loads the runtime relay and passes authenticated TCP/TLS routes into RTC configuration',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({iceServersUrl:'https://relay.example.com/ice',relayOnly:true}))).mockResolvedValueOnce(new Response(JSON.stringify({iceServers:[turn]})));
  const config=await loadRoomNetwork(fetcher);expect(config.hasRelay).toBe(true);expect(config.iceTransportPolicy).toBe('relay');expect(config.iceServers).toContainEqual(turn);
 });
 it('does not silently pretend to have TURN when no service is configured',async()=>{const config=await loadRoomNetwork(vi.fn().mockResolvedValue(new Response('{}')));expect(config.hasRelay).toBe(false)});
 it('rejects malformed relay replies and API secrets in public endpoint URLs',async()=>{
  for(const value of [null,[{urls:'https://malicious.example'}],[{urls:'turn:relay.example.com:3478'}],Array(17).fill(turn)])expect(()=>parseIceServers(value)).toThrow();
  await expect(loadRoomNetwork(vi.fn().mockResolvedValue(new Response(JSON.stringify({iceServersUrl:'https://relay.example.com/ice?apiKey=secret'}))))).rejects.toThrow('without API keys');
 });
 it('fails explicitly when an advertised relay endpoint returns only STUN',async()=>{
  const f=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({iceServersUrl:'https://relay.example.com/ice'}))).mockResolvedValueOnce(new Response(JSON.stringify([{urls:'stun:stun.example.com:3478'}])));
  await expect(loadRoomNetwork(f)).rejects.toThrow('no TURN');
 });
});

it('prefers authenticated TLS relay routes during a network fallback',()=>{
 const source=[{urls:'stun:stun.example.com:3478'},{urls:['turn:relay.example.com:80','turns:relay.example.com:443?transport=tcp'],username:'user',credential:'password'}];
 expect(relayFallbackServers(source)).toEqual([{urls:['turns:relay.example.com:443?transport=tcp'],username:'user',credential:'password'}]);
});

describe('rooms when the relay service is unreachable',()=>{
 const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}};
 const config=()=>new Response(JSON.stringify({iceServersUrl:'https://relay.example.com/ice'}));
 it('falls back to direct connections instead of failing the room (e.g. "Fetch is aborted")',async()=>{
  const f=vi.fn().mockResolvedValueOnce(config()).mockRejectedValueOnce(new DOMException('Fetch is aborted','AbortError'));
  const net=await loadRoomNetworkResilient(f,memory());
  expect(net.hasRelay).toBe(false);expect(net.iceServers.length).toBeGreaterThan(0);expect(net.note).toContain('direct connections');
 });
 it('remembers working relay settings and reuses them when the relay later cannot be reached',async()=>{
  const store=memory();
  const ok=vi.fn().mockResolvedValueOnce(config()).mockResolvedValueOnce(new Response(JSON.stringify({iceServers:[turn]})));
  expect((await loadRoomNetworkResilient(ok,store,1000)).hasRelay).toBe(true);
  const down=vi.fn().mockResolvedValueOnce(config()).mockRejectedValueOnce(new Error('timeout'));
  const net=await loadRoomNetworkResilient(down,store,2000);
  expect(net.hasRelay).toBe(true);expect(net.iceServers).toContainEqual(turn);expect(net.note).toContain('saved relay');
  // Saved settings expire after a week.
  const later=vi.fn().mockRejectedValue(new Error('offline'));
  expect((await loadRoomNetworkResilient(later,store,1000+8*864e5)).hasRelay).toBe(false);
 });
 it('ignores a damaged saved copy',async()=>{
  const store=memory();store.setItem('sittwe3d.relayIce','{not json');
  expect((await loadRoomNetworkResilient(vi.fn().mockRejectedValue(new Error('x')),store)).hasRelay).toBe(false);
 });
});
