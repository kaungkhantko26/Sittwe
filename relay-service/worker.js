/** Cloudflare Worker: keep the Metered credential API key in a Worker secret. */
export default {
 async fetch(request,env){
  const allowed=env.ALLOWED_ORIGIN||'https://kaungkhantko26.github.io';
  if(request.headers.get('Origin')!==allowed)return new Response('Forbidden',{status:403});
  const headers={'Access-Control-Allow-Origin':allowed,'Vary':'Origin','Cache-Control':'no-store','Content-Type':'application/json'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, OPTIONS'}});
  if(request.method!=='GET')return new Response('{}',{status:405,headers});
  if(new URL(request.url).pathname!=='/ice')return new Response('{}',{status:404,headers});
  if(!env.TURN_ICE_SERVERS&&(!/^[a-z0-9-]+\.metered\.live$/i.test(env.METERED_DOMAIN||'')||!env.TURN_CREDENTIAL_API_KEY))return new Response('{"error":"Relay is not configured"}',{status:503,headers});
  try{
   let servers;
   if(env.TURN_ICE_SERVERS)servers=JSON.parse(env.TURN_ICE_SERVERS);
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
