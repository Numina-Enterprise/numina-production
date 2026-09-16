import {EXPECTED_RELEASE} from '../public/runtime-contract.js';

const ORIGIN='https://numinalabs.xyz';
const MAX_BYTES=262144;

export function validateApplicationRelease(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('APPLICATION_RELEASE_INVALID');
  if(value.schema!=='numina.application-release.v2'||value.schema_version!==2)throw new Error('APPLICATION_RELEASE_SCHEMA_MISMATCH');
  if(value.product!=='Numina'||value.version!=='4.0.0'||value.release!=='numina-v4.0.0')throw new Error('APPLICATION_RELEASE_MISMATCH');
  const runtime=value.runtime_dependency;
  if(!runtime||runtime.version!==EXPECTED_RELEASE.production_version||runtime.release!==EXPECTED_RELEASE.release)throw new Error('RUNTIME_RELEASE_MISMATCH');
  if(runtime.manifest!=='/v1/release/manifest'||runtime.signed_declaration!=='/v1/release/attestation')throw new Error('RUNTIME_RELEASE_ROUTE_MISMATCH');
  return value;
}

export default async function handler(req,res){
  if(!['GET','HEAD'].includes(req.method)){
    res.statusCode=405;res.setHeader('allow','GET, HEAD');res.setHeader('cache-control','no-store');return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  try{
    const upstream=await fetch(ORIGIN+'/v4/release/manifest',{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(upstream.status!==200)throw new Error('APPLICATION_RELEASE_UPSTREAM_STATUS');
    if(!(upstream.headers.get('content-type')||'').toLowerCase().includes('application/json'))throw new Error('APPLICATION_RELEASE_UPSTREAM_TYPE');
    const body=await upstream.text();
    if(Buffer.byteLength(body,'utf8')>MAX_BYTES)throw new Error('APPLICATION_RELEASE_UPSTREAM_TOO_LARGE');
    const value=validateApplicationRelease(JSON.parse(body));
    res.statusCode=200;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('x-numina-runtime-release',EXPECTED_RELEASE.production_version);
    return res.end(req.method==='HEAD'?'':JSON.stringify(value));
  }catch(error){
    res.statusCode=502;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');return res.end(JSON.stringify({error:String(error?.message||error)}));
  }
}
