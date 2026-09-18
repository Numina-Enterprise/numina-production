import {privateBankRouteConfiguration} from './bank-route-model.js';
import {verifyTreasuryRecord} from '../public/treasury-proof.js';

// Private configuration read only; no ACH debit, credit, or bank API submission.
export async function readPrivateBankRoute(req,{env=process.env,fetcher=fetch,verify=verifyTreasuryRecord}={}){
  const authorization=req.headers?.authorization;
  const cookie=req.headers?.cookie;
  if(!authorization&&!cookie)throw Object.assign(Error('OWNER_AUTH_REQUIRED'),{status:401});
  const headers={Accept:'application/json'};
  if(typeof authorization==='string')headers.Authorization=authorization;
  if(typeof cookie==='string')headers.Cookie=cookie;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetcher('https://personal-space-m7q9.skott34.chatgpt.site/api/control/v1/treasury',{method:'GET',headers,redirect:'manual',signal:controller.signal});
    if(!response.ok||response.redirected)throw Object.assign(Error('OWNER_AUTH_UNAVAILABLE'),{status:[401,403].includes(response.status)?response.status:503});
    if(!response.body)throw Error('OWNER_AUTH_UNAVAILABLE');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>1048576){await reader.cancel();throw Error('OWNER_AUTH_UNAVAILABLE');}chunks.push(chunk.value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const treasury=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!await verify(treasury,{allowUninitialized:true}))throw Error('OWNER_AUTH_UNAVAILABLE');
    return privateBankRouteConfiguration(env);
  }catch(error){
    throw Object.assign(Error([401,403].includes(error.status)?'OWNER_AUTH_REQUIRED':'BANK_ROUTE_UNAVAILABLE'),{status:[401,403].includes(error.status)?error.status:503});
  }finally{clearTimeout(timer);controller.abort();}
}
