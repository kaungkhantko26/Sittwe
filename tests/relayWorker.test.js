import {describe,it,expect,vi,afterEach} from 'vitest';
import worker from '../relay-service/worker.js';
const origin='https://kaungkhantko26.github.io';
const request=(path='/ice',method='GET',site=origin)=>new Request(`https://relay.example${path}`,{method,headers:{Origin:site}});
const ice=[{urls:'turns:relay.example:443?transport=tcp',username:'test-user',credential:'test-password'}];
afterEach(()=>vi.unstubAllGlobals());
describe('relay credential proxy',()=>{
 it('returns the game credential without caching it',async()=>{const r=await worker.fetch(request(),{TURN_ICE_SERVERS:JSON.stringify(ice)});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(await r.json()).toEqual({iceServers:ice})});
 it('rejects other origins and unsupported paths/methods',async()=>{const env={TURN_ICE_SERVERS:JSON.stringify(ice)};expect((await worker.fetch(request('/ice','GET','https://other.example'),env)).status).toBe(403);expect((await worker.fetch(request('/wrong'),env)).status).toBe(404);expect((await worker.fetch(request('/ice','POST'),env)).status).toBe(405)});
 it('does not disclose upstream API keys or error bodies',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-provider-error',{status:401})));const r=await worker.fetch(request(),{METERED_DOMAIN:'test.metered.live',TURN_CREDENTIAL_API_KEY:'test-secret-key'});expect(r.status).toBe(502);const text=await r.text();expect(text).not.toContain('test-secret-key');expect(text).not.toContain('private-provider-error')});
 it('refuses missing configuration and malformed stored credentials',async()=>{expect((await worker.fetch(request(),{})).status).toBe(503);expect((await worker.fetch(request(),{TURN_ICE_SERVERS:'invalid'})).status).toBe(502)});
});
