import {RUNTIME_ORIGIN} from '../public/runtime-contract.js';

const revocationPath='/v1/evidence/revoke';
const revocationHeaders={'Cache-Control':'private, no-store','Vary':'Authorization, Origin','Content-Type':'application/json'};
const revocationError=(status,code)=>Response.json({error:code},{status,headers:revocationHeaders});
export function validRevocationInput(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['record_id','reason','evidence'].includes(key)))return false;
  if(typeof value.record_id!=='string'||! /^[0-9a-f]{64}$/.test(value.record_id))return false;
  if(typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>1000)return false;
  if(Object.hasOwn(value,'evidence')&&(!value.evidence||typeof value.evidence!=='object'||Array.isArray(value.evidence)))return false;
  return true;
}
async function revocationBoundedBytes(stream,maximum,signal){
  if(!stream)return new Uint8Array();
  const reader=stream.getReader(),chunks=[];let size=0;
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  try{
    for(;;){
      if(signal.aborted)throw Object.assign(Error(),{status:504});
      const part=await reader.read();
      if(signal.aborted)throw Object.assign(Error(),{status:504});
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>maximum){cancel();throw Object.assign(Error(),{status:413});}
      chunks.push(part.value);
    }
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return bytes;
  }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}

export async function routeRuntimeRevocation(request,upstreamFetch=fetch){
  const requestUrl=new URL(request.url);
  if(requestUrl.pathname!==revocationPath)return null;
  if(request.method!=='POST')return new Response(null,{status:405,headers:{...revocationHeaders,Allow:'POST'}});
  if(requestUrl.origin===new URL(RUNTIME_ORIGIN).origin)return revocationError(410,'RUNTIME_REVOCATION_ROUTE_RETIRED');
  const bearer=request.headers.get('authorization')??'';
  if(!/^Bearer [^\s]{1,4096}$/.test(bearer))return revocationError(401,'OWNER_BEARER_REQUIRED');
  const origin=request.headers.get('origin');
  if(origin&&!['https://numinalabs.xyz',RUNTIME_ORIGIN].includes(origin))return revocationError(403,'ORIGIN_DENIED');
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json'||request.headers.has('content-encoding'))return revocationError(415,'JSON_REQUIRED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const body=await revocationBoundedBytes(request.body,16384,controller.signal);
    let input;
    try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{return revocationError(422,'SPECIFIC_RECORD_AND_REASON_REQUIRED');}
    if(!validRevocationInput(input))return revocationError(422,'SPECIFIC_RECORD_AND_REASON_REQUIRED');
    const upstream=await upstreamFetch(RUNTIME_ORIGIN+revocationPath,{method:'POST',body,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:bearer,...(origin?{Origin:origin}:{})},redirect:'manual',signal:controller.signal});
    if(upstream.status>=300&&upstream.status<400){void upstream.body?.cancel().catch(()=>{});return revocationError(502,'RUNTIME_UPSTREAM_REDIRECT');}
    if(!upstream.headers.get('content-type')?.toLowerCase().includes('application/json'))return revocationError(502,'RUNTIME_INVALID_RESPONSE');
    let responseBody;
    try{responseBody=await revocationBoundedBytes(upstream.body,262144,controller.signal);}catch(e){if(e.status===413)return revocationError(502,'RUNTIME_RESPONSE_TOO_LARGE');throw e;}
    return new Response(responseBody,{status:upstream.status,headers:revocationHeaders});
  }catch(e){return revocationError(e.status===413?413:controller.signal.aborted?504:502,e.status===413?'REVOCATION_REQUEST_TOO_LARGE':'RUNTIME_SERVICE_UNAVAILABLE');}
  finally{clearTimeout(timer);controller.abort();}
}
