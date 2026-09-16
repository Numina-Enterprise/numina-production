import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {createRequire} from 'node:module';
import {EXPECTED_RELEASE,PINNED_RUNTIME_PUBLIC_KEY,PINNED_RUNTIME_KEY_ID,RELEASE_ARTIFACT_TYPE} from '../public/runtime-contract.js';
import {validateApplicationRelease} from './application-release.mjs';

const require=createRequire(import.meta.url);
const {sign}=require('../runtime/vercel-production/lib/numina.js');
const APPLICATION_ORIGIN='https://numinalabs.xyz';
const RUNTIME_ORIGIN='https://numina-production.vercel.app';
const MAX_BYTES=262144;
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');

function sorted(value){
  if(Array.isArray(value))return value.map(sorted);
  if(value&&typeof value==='object'){
    const output={};
    for(const key of Object.keys(value).sort())output[key]=sorted(value[key]);
    return output;
  }
  return value;
}
function canonical(value){return Buffer.from(JSON.stringify(sorted(value)),'utf8');}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function exactRelease(value){return object(value)&&Object.entries(EXPECTED_RELEASE).every(([field,expected])=>value[field]===expected);}

export function verifyPinnedEnvelope(envelope,expectedType){
  try{
    if(!object(envelope)||envelope.artifact_type!==expectedType||envelope.algorithm!=='Ed25519')return false;
    if(envelope.key_id!==PINNED_RUNTIME_KEY_ID||envelope.public_key!==PINNED_RUNTIME_PUBLIC_KEY||!object(envelope.payload))return false;
    const raw=Buffer.from(PINNED_RUNTIME_PUBLIC_KEY,'base64');
    if(raw.length!==32||createHash('sha256').update(raw).digest('hex').slice(0,24)!==PINNED_RUNTIME_KEY_ID)return false;
    const publicKey=createPublicKey({key:Buffer.concat([SPKI_PREFIX,raw]),format:'der',type:'spki'});
    const preimage={artifact_type:envelope.artifact_type,key_id:envelope.key_id,payload:envelope.payload};
    return verifySignature(null,canonical(preimage),publicKey,Buffer.from(envelope.signature||'','base64'));
  }catch{return false;}
}

export function evaluateFrontierReadiness(records,{verifyEnvelope=verifyPinnedEnvelope}={}){
  const application=validateApplicationRelease(records.application);
  const manifest=records.manifest;
  const attestation=records.attestation;
  const supply=records.supply;
  const control=records.control;
  const manifestIdentity=exactRelease(manifest);
  const releaseSignature=Boolean(verifyEnvelope(attestation,RELEASE_ARTIFACT_TYPE)&&exactRelease(attestation?.payload)&&attestation.payload.environment==='production'&&attestation.payload.role==='public-verifier');
  const supplyIdentity=Boolean(object(supply)&&supply.valid===true&&supply.release===EXPECTED_RELEASE.release&&supply.production_files_root===EXPECTED_RELEASE.production_files_root&&supply.spdx_sbom_sha256===EXPECTED_RELEASE.spdx_sbom_sha256&&supply.slsa_provenance_sha256===EXPECTED_RELEASE.slsa_provenance_sha256);
  const controlState=control?.state;
  const controlSignature=Boolean(verifyEnvelope(control?.receipt,'NUMINA_CONTROL_STATE')&&object(controlState)&&JSON.stringify(sorted(controlState))===JSON.stringify(sorted(control.receipt.payload)));
  const executionClosed=Boolean(object(controlState)&&controlState.release===EXPECTED_RELEASE.production_version&&controlState.runtime_controls_configurable===true&&controlState.real_funds_enabled===false&&controlState.employer_ip_enabled===false&&controlState.public_execution_api_enabled===false&&controlState.public_execution_route_exposed===false);
  const applicationBinding=application.runtime_dependency.version===EXPECTED_RELEASE.production_version&&application.runtime_dependency.release===EXPECTED_RELEASE.release;
  const checks={application_release_valid:true,application_runtime_binding:applicationBinding,runtime_manifest_identity:manifestIdentity,release_attestation_signature:releaseSignature,supply_chain_identity:supplyIdentity,control_state_signature:controlSignature,execution_boundary_closed:executionClosed};
  return {ready:Object.values(checks).every(Boolean),checks,application:{version:application.version,release:application.release,build_id:application.build_id??null},runtime:{...EXPECTED_RELEASE},mode:'public-verifier-no-financial-execution'};
}

async function fetchJson(url){
  const response=await fetch(url,{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(response.status!==200)throw new Error('UPSTREAM_STATUS_'+response.status);
  if(!(response.headers.get('content-type')||'').toLowerCase().includes('application/json'))throw new Error('UPSTREAM_CONTENT_TYPE');
  const body=await response.text();
  if(Buffer.byteLength(body,'utf8')>MAX_BYTES)throw new Error('UPSTREAM_TOO_LARGE');
  return JSON.parse(body);
}

export default async function handler(req,res){
  if(!['GET','HEAD'].includes(req.method)){
    res.statusCode=405;res.setHeader('allow','GET, HEAD');res.setHeader('cache-control','no-store');return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  try{
    const [application,manifest,attestation,supply,control]=await Promise.all([
      fetchJson(APPLICATION_ORIGIN+'/v4/release/manifest'),
      fetchJson(RUNTIME_ORIGIN+'/v1/release/manifest'),
      fetchJson(RUNTIME_ORIGIN+'/v1/release/attestation'),
      fetchJson(RUNTIME_ORIGIN+'/v1/release/supply-chain'),
      fetchJson(RUNTIME_ORIGIN+'/v1/control/state')
    ]);
    const evaluation=evaluateFrontierReadiness({application,manifest,attestation,supply,control});
    const payload={schema:'numina.frontier-readiness.v1',observed_at:new Date().toISOString(),...evaluation};
    const body={readiness:payload,receipt:sign(payload,'NUMINA_FRONTIER_READINESS')};
    res.statusCode=payload.ready?200:503;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    res.setHeader('x-content-type-options','nosniff');
    res.setHeader('x-numina-runtime-release',EXPECTED_RELEASE.production_version);
    return res.end(req.method==='HEAD'?'':JSON.stringify(body));
  }catch(error){
    res.statusCode=503;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');return res.end(JSON.stringify({error:'FRONTIER_NOT_READY',detail:String(error?.message||error)}));
  }
}
