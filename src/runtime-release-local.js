import {EXPECTED_RELEASE,RUNTIME_VERSION,PINNED_RUNTIME_PUBLIC_KEY,PINNED_RUNTIME_KEY_ID,RELEASE_ARTIFACT_TYPE} from '../public/runtime-contract.js';

const selfHostedRuntimeEncoder=new TextEncoder();
const SELF_HOSTED_SIGNER_PATHS=new Set([
  '/v1/status','/v1/control/state','/v1/release/manifest','/v1/release/attestation',
  '/v1/release/supply-chain','/readyz','/v1/bootstrap/attestation','/v1/release/core-binding'
]);
function selfHostedRuntimeObject(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function selfHostedRuntimeCanonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(selfHostedRuntimeCanonical).join(',')+']';
  if(selfHostedRuntimeObject(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+selfHostedRuntimeCanonical(value[key])).join(',')+'}';
  throw new TypeError('Unsupported canonical JSON value');
}
function selfHostedRuntimeDecodeBase64(value){
  if(typeof value!=='string')return null;
  const clean=value.trim();
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)||clean.length%4!==0)return null;
  try{return Uint8Array.from(atob(clean),character=>character.charCodeAt(0));}catch{return null;}
}
function selfHostedRuntimeEncodeBase64(value){
  let binary='';for(const byte of new Uint8Array(value))binary+=String.fromCharCode(byte);
  return btoa(binary);
}
async function selfHostedRuntimeSigner(env={},pins={}){
  const privateBytes=selfHostedRuntimeDecodeBase64(env.NUMINA_RUNTIME_SIGNING_KEY_DER_B64);
  if(!privateBytes)throw new Error('RUNTIME_SIGNER_UNAVAILABLE');
  const publicKeyB64=pins.publicKey??PINNED_RUNTIME_PUBLIC_KEY;
  const keyId=pins.keyId??PINNED_RUNTIME_KEY_ID;
  const publicBytes=selfHostedRuntimeDecodeBase64(publicKeyB64);
  if(publicBytes?.length!==32)throw new Error('RUNTIME_SIGNING_IDENTITY_UNAVAILABLE');
  try{
    const privateKey=await crypto.subtle.importKey('pkcs8',privateBytes,{name:'Ed25519'},false,['sign']);
    const publicKey=await crypto.subtle.importKey('raw',publicBytes,{name:'Ed25519'},false,['verify']);
    const probe=selfHostedRuntimeEncoder.encode('NUMINA_RUNTIME_SIGNER_PROBE_V1');
    const probeSignature=await crypto.subtle.sign('Ed25519',privateKey,probe);
    if(!await crypto.subtle.verify('Ed25519',publicKey,probeSignature,probe))throw new Error('RUNTIME_SIGNING_IDENTITY_MISMATCH');
    return {privateKey,publicKeyB64,keyId};
  }catch(error){
    if(error?.message==='RUNTIME_SIGNING_IDENTITY_MISMATCH')throw error;
    throw new Error('RUNTIME_SIGNING_IDENTITY_UNAVAILABLE');
  }
}
async function selfHostedRuntimeSign(signer,payload,artifact_type){
  const body={artifact_type,key_id:signer.keyId,payload};
  const signature=await crypto.subtle.sign('Ed25519',signer.privateKey,selfHostedRuntimeEncoder.encode(selfHostedRuntimeCanonical(body)));
  return {...body,algorithm:'Ed25519',public_key:signer.publicKeyB64,signature:selfHostedRuntimeEncodeBase64(signature)};
}
function selfHostedRuntimeResponse(request,body,status=200,extra={}){
  return new Response(request.method==='HEAD'?null:JSON.stringify(body),{status,headers:{
    'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'X-Numina-Runtime-Release':RUNTIME_VERSION,'X-Numina-Root':'NUMINA','X-Numina-Identity':'NUMINA',...extra
  }});
}
function selfHostedRuntimeManifest(){
  return {schema:'numina.manifest.v2',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
    source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',provider_verification:true,environment:EXPECTED_RELEASE.environment,
    runtime_surface:'numina-self-hosted-worker',release:structuredClone(EXPECTED_RELEASE)};
}
async function selfHostedRuntimeSignedPayload(path,signer){
  const manifest=selfHostedRuntimeManifest();
  if(path==='/v1/release/manifest')return {manifest,receipt:await selfHostedRuntimeSign(signer,manifest,'NUMINA_MANIFEST')};
  if(path==='/v1/status'){
    const status={schema:'numina.production-status.v1',root:'NUMINA',identity:'NUMINA',authority:'NUMINA',
      release:structuredClone(EXPECTED_RELEASE),environment:EXPECTED_RELEASE.environment,
      frozen_core:{valid:true,manifest_root:EXPECTED_RELEASE.compatibility.frozen_core_manifest_root},
      external_execution_performed:false,runtime_surface:'numina-self-hosted-worker'};
    return {status,receipt:await selfHostedRuntimeSign(signer,status,'NUMINA_PRODUCTION_STATUS')};
  }
  if(path==='/v1/control/state'){
    const control={schema:'numina.control-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
      release:RUNTIME_VERSION,external_execution_performed:false,public_execution_route_exposed:false};
    return {manifest:control,receipt:await selfHostedRuntimeSign(signer,control,'NUMINA_CONTROL_MANIFEST')};
  }
  if(path==='/v1/release/supply-chain'){
    const evidence={valid:true,release:RUNTIME_VERSION,production_files_root:EXPECTED_RELEASE.production_files_root,
      spdx_sbom_sha256:EXPECTED_RELEASE.spdx_sbom_sha256,slsa_provenance_sha256:EXPECTED_RELEASE.slsa_provenance_sha256,
      slsa_level_claimed:null};
    return {payload:{evidence,receipt:await selfHostedRuntimeSign(signer,evidence,'NUMINA_SUPPLY_CHAIN_EVIDENCE')}};
  }
  if(path==='/v1/release/attestation'){
    const declaration={schema:'numina.release-attestation.v1',root:'NUMINA',identity:'NUMINA',authority:'NUMINA',
      environment:EXPECTED_RELEASE.environment,release:structuredClone(EXPECTED_RELEASE),manifest};
    return selfHostedRuntimeSign(signer,declaration,RELEASE_ARTIFACT_TYPE);
  }
  if(path==='/v1/bootstrap/attestation'){
    const bootstrap={schema:'numina.bootstrap-attestation.v1',identity:'NUMINA',release:RUNTIME_VERSION,
      evidence_store_durable:true,external_financial_evidence_verified:false,runtime_surface:'numina-self-hosted-worker'};
    return {bootstrap,receipt:await selfHostedRuntimeSign(signer,bootstrap,'NUMINA_BOOTSTRAP_ATTESTATION')};
  }
  if(path==='/v1/release/core-binding'){
    const binding={schema:'numina.core-binding.v1',root:'NUMINA',identity:'NUMINA',core:'NUMINA',core_version:'1.8.0',
      runtime_version:RUNTIME_VERSION,frozen_core_manifest_root:EXPECTED_RELEASE.compatibility.frozen_core_manifest_root,
      release:structuredClone(EXPECTED_RELEASE),historical_predecessor:'1.9.0-rc27'};
    return {binding,receipt:await selfHostedRuntimeSign(signer,binding,'NUMINA_CORE_BINDING')};
  }
  if(path==='/readyz')return {status:'ready',identity:'NUMINA',release:RUNTIME_VERSION,signer:'pinned'};
  return null;
}
export async function routeLocalRuntime(request,env={},pins={}){
  const path=new URL(request.url).pathname;
  if(!['GET','HEAD'].includes(request.method))return selfHostedRuntimeResponse(request,{error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, HEAD'});
  if(path==='/v1/execution/providers')return selfHostedRuntimeResponse(request,{schema:'numina.execution-provider-catalog.v1',
    release:RUNTIME_VERSION,providers:[],live_submission_route_exposed:false,external_execution_performed:false});
  if(path==='/v2/network/status')return selfHostedRuntimeResponse(request,{schema:'numina.network-status.v2',identity:'NUMINA',
    release:RUNTIME_VERSION,currentChainStateVerified:false,operationalState:'UNVERIFIED'});
  if(path==='/v2/network/deployment-estimate')return selfHostedRuntimeResponse(request,{error:'NETWORK_ESTIMATE_UNAVAILABLE',release:RUNTIME_VERSION},503);
  if(!SELF_HOSTED_SIGNER_PATHS.has(path))return selfHostedRuntimeResponse(request,{error:'RUNTIME_LOCAL_ROUTE_UNAVAILABLE',release:RUNTIME_VERSION},503);
  try{
    const signer=await selfHostedRuntimeSigner(env,pins);
    const payload=await selfHostedRuntimeSignedPayload(path,signer);
    return payload?selfHostedRuntimeResponse(request,payload):selfHostedRuntimeResponse(request,{error:'RUNTIME_LOCAL_ROUTE_UNAVAILABLE'},503);
  }catch(error){
    const code=error?.message==='RUNTIME_SIGNER_UNAVAILABLE'?'RUNTIME_SIGNER_UNAVAILABLE':'RUNTIME_SIGNING_IDENTITY_UNAVAILABLE';
    return selfHostedRuntimeResponse(request,{error:code,release:RUNTIME_VERSION,productionReady:false},503);
  }
}
