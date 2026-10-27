/** Issue expiring Coturn credentials; keep the signing secret in Cloudflare secrets. */
export default {
 async fetch(request,env){
  const allowed=env.ALLOWED_ORIGIN||'https://kaungkhantko26.github.io';
  if(request.headers.get('Origin')!==allowed)return new Response('Forbidden',{status:403});
  const headers={'Access-Control-Allow-Origin':allowed,'Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS'}});
  if(request.method!=='GET')return new Response('{}',{status:405,headers});
  if(new URL(request.url).pathname!=='/ice')return new Response('{}',{status:404,headers});
  if(!(env.TURN_SHARED_SECRET&&env.TURN_HOST)&&!env.TURN_ICE_SERVERS&&(!/^[a-z0-9-]+\.metered\.live$/i.test(env.METERED_DOMAIN||'')||!env.TURN_CREDENTIAL_API_KEY))return new Response('{"error":"Relay is not configured"}',{status:503,headers});
  try{
   let servers;
   if(env.TURN_SHARED_SECRET&&env.TURN_HOST){
    if(!/^[a-z0-9.-]+$/i.test(env.TURN_HOST))throw new Error('host');
    const username=`${Math.floor(Date.now()/1000)+21600}:${crypto.randomUUID()}`;
    const encoder=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',encoder.encode(env.TURN_SHARED_SECRET),{name:'HMAC',hash:'SHA-1'},false,['sign']);
    const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(username)));
    const credential=btoa(String.fromCharCode(...signature));
    servers=[{urls:[`turn:${env.TURN_HOST}:3478?transport=udp`,`turn:${env.TURN_HOST}:3478?transport=tcp`,`turns:${env.TURN_HOST}:5349?transport=tcp`],username,credential}];
   }
   else if(env.TURN_ICE_SERVERS)servers=JSON.parse(env.TURN_ICE_SERVERS);
   else{
    const url=new URL(`https://${env.METERED_DOMAIN}/api/v1/turn/credentials`);url.searchParams.set('apiKey',env.TURN_CREDENTIAL_API_KEY);
    const response=await fetch(url,{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('upstream');
    servers=await response.json();
   }
   if(!Array.isArray(servers)||!servers.length||servers.length>16)throw new Error('format');
   return new Response(JSON.stringify({iceServers:servers}),{headers});
  }catch{return new Response('{"error":"Relay temporarily unavailable"}',{status:502,headers});}
 }
};
