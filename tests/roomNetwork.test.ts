import {describe,it,expect,vi} from 'vitest';
import {loadRoomNetwork,parseIceServers,relayFallbackServers} from '../src/systems/RoomNetwork';
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
