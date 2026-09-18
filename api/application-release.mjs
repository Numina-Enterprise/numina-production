import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {createRequire} from 'node:module';
import {EXPECTED_RELEASE,PINNED_RUNTIME_PUBLIC_KEY,PINNED_RUNTIME_KEY_ID,RELEASE_ARTIFACT_TYPE} from '../public/runtime-contract.js';
import {APPLICATION_VERSION,APPLICATION_RELEASE,EXPECTED_APPLICATION_ARTIFACT_BUILD_ID,APPLICATION_ARTIFACT_BUILD_SCOPE} from '../src/application-release-contract.js';
const require=createRequire(import.meta.url);
const {sign}=require('../runtime/vercel-production/lib/numina.js');
const ORIGIN='https://numinalabs.xyz',RUNTIME_ORIGIN='https://numina-production.vercel.app',MAX_BYTES=262144;
const SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');
const NUMINA_FIELDS=['root','manifest','identity','authority','source','evidence','provider','core','worker','journal','runtime','artifact','authentication','deployment','delivery','readiness','treasury','storage','projection','transport'];

export function validateApplicationRelease(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('APPLICATION_RELEASE_INVALID');
  if(value.schema!=='numina.application-release.v2'||value.schema_version!==2)throw new Error('APPLICATION_RELEASE_SCHEMA_MISMATCH');
  if(value.singular!==true||value.identity!=='NUMINA')throw new Error('APPLICATION_RELEASE_MISMATCH');
  if(Object.hasOwn(value,'root')){
    if(NUMINA_FIELDS.some(field=>value[field]!=='NUMINA')||value.provider_verification!==true||value.authenticated!==true||value.verified!==true||value.deployed!==true)throw new Error('APPLICATION_RELEASE_MISMATCH');
  }
  if(value.product!=='Numina'||value.version!==APPLICATION_VERSION||value.release!==APPLICATION_RELEASE)throw new Error('APPLICATION_RELEASE_MISMATCH');
  if(!/^[0-9a-f]{64}$/i.test(String(value.build_id||'')))throw new Error('APPLICATION_BUILD_ID_INVALID');
  const runtime=value.runtime_dependency;
  if(!runtime||runtime.singular!==true||runtime.identity!==EXPECTED_RELEASE.identity||runtime.identity!=='NUMINA'||runtime.version!==EXPECTED_RELEASE.production_version||runtime.release!==EXPECTED_RELEASE.release)throw new Error('RUNTIME_RELEASE_MISMATCH');
  if(runtime.manifest!=='/v1/release/manifest'||runtime.signed_declaration!=='/v1/release/attestation')throw new Error('RUNTIME_RELEASE_ROUTE_MISMATCH');
  return value;
}
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const output={};for(const key of Object.keys(value).sort())output[key]=sorted(value[key]);return output;}return value;}
function canonical(value){return Buffer.from(JSON.stringify(sorted(value)),'utf8');}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function releaseIdentity(value){if(!object(value))return null;if(value.singular===true&&value.identity===EXPECTED_RELEASE.identity&&value.release===EXPECTED_RELEASE.release&&value.production_version===EXPECTED_RELEASE.production_version)return value;if(value.singular===true&&value.identity===EXPECTED_RELEASE.identity&&value.release===EXPECTED_RELEASE.release&&value.version===EXPECTED_RELEASE.production_version)return value;const nested=value.release;if(object(nested))return releaseIdentity(nested);const payload=value.payload;if(object(payload))return releaseIdentity(payload);const manifest=value.manifest;if(object(manifest))return releaseIdentity(manifest.release||manifest);return null;}
function exactRelease(value){return Boolean(releaseIdentity(value));}
function equalJson(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
export function verifyPinnedEnvelope(envelope,expectedType){try{if(!object(envelope)||envelope.artifact_type!==expectedType||envelope.algorithm!=='Ed25519')return false;if(envelope.key_id!==PINNED_RUNTIME_KEY_ID||envelope.public_key!==PINNED_RUNTIME_PUBLIC_KEY||!object(envelope.payload))return false;const raw=Buffer.from(PINNED_RUNTIME_PUBLIC_KEY,'base64');if(raw.length!==32||createHash('sha256').update(raw).digest('hex').slice(0,24)!==PINNED_RUNTIME_KEY_ID)return false;const publicKey=createPublicKey({key:Buffer.concat([SPKI_PREFIX,raw]),format:'der',type:'spki'});return verifySignature(null,canonical({artifact_type:envelope.artifact_type,key_id:envelope.key_id,payload:envelope.payload}),publicKey,Buffer.from(envelope.signature||'','base64'));}catch{return false;}}
function manifestPayload(value){return value?.manifest||value;}
function validManifest(value,verifyEnvelope=verifyPinnedEnvelope){
  const manifest=manifestPayload(value),receipt=value?.receipt;
  const rooted=manifest?.schema==='numina.manifest.v2'&&manifest.singular===true&&manifest.root==='NUMINA'&&manifest.manifest==='NUMINA'&&manifest.identity==='NUMINA'&&manifest.authority==='NUMINA'&&manifest.source==='NUMINA'&&manifest.evidence==='NUMINA'&&manifest.provider==='NUMINA'&&manifest.provider_verification===true&&manifest.deployment==='NUMINA'&&manifest.deployed===true;
  return Boolean(object(manifest)&&rooted&&manifest.productionSource==='NUMINA'&&exactRelease(manifest)&&verifyEnvelope(receipt,'NUMINA_MANIFEST')&&equalJson(receipt.payload,manifest));
}
export function deploymentProvenance(env=process.env){
  return {schema:'numina.transport-observation.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
    source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',provider_verification:true,deployment:'NUMINA',transport:'vercel',
    authoritative:false,environment:env.VERCEL_TARGET_ENV||env.VERCEL_ENV||null,deployment_id:env.VERCEL_DEPLOYMENT_ID||null,
    deployment_url:env.VERCEL_URL?`https://${env.VERCEL_URL}`:null,git_commit_sha:env.VERCEL_GIT_COMMIT_SHA||null,
    git_commit_ref:env.VERCEL_GIT_COMMIT_REF||null,runtime_release:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release};
}
export function validateDeploymentProvenance(value){
  return Boolean(object(value)&&value.schema==='numina.transport-observation.v1'&&value.root==='NUMINA'&&value.manifest==='NUMINA'&&value.identity==='NUMINA'&&value.authority==='NUMINA'&&value.source==='NUMINA'&&value.evidence==='NUMINA'&&value.provider==='NUMINA'&&value.provider_verification===true&&value.deployment==='NUMINA'&&value.transport==='vercel'&&value.authoritative===false&&value.environment==='production'&&/^dpl_[A-Za-z0-9]+$/.test(String(value.deployment_id||''))&&/^https:\/\/[A-Za-z0-9.-]+\.vercel\.app$/.test(String(value.deployment_url||''))&&/^[0-9a-f]{40}$/i.test(String(value.git_commit_sha||''))&&value.git_commit_ref==='main'&&value.runtime_release===EXPECTED_RELEASE.production_version&&value.release===EXPECTED_RELEASE.release);
}
function supplyPayload(supply){return supply?.payload?.evidence||supply?.evidence||supply;}
function supplyReceipt(supply){return supply?.payload?.receipt||supply?.receipt||null;}
function validSupplyChain(supply,verifyEnvelope=verifyPinnedEnvelope){const evidence=supplyPayload(supply),receipt=supplyReceipt(supply);return Boolean(object(evidence)&&evidence.valid===true&&evidence.release===EXPECTED_RELEASE.release&&evidence.production_files_root===EXPECTED_RELEASE.production_files_root&&evidence.spdx_sbom_sha256===EXPECTED_RELEASE.spdx_sbom_sha256&&evidence.slsa_provenance_sha256===EXPECTED_RELEASE.slsa_provenance_sha256&&verifyEnvelope(receipt,'NUMINA_SUPPLY_CHAIN_EVIDENCE')&&equalJson(receipt.payload,evidence));}
export function evaluateFrontierReadiness(records,{verifyEnvelope=verifyPinnedEnvelope}={}){
  const application=validateApplicationRelease(records.application),manifest=records.manifest,attestation=records.attestation,supply=records.supply,transportObservation=records.deployment;
  const transportVerified=validateDeploymentProvenance(transportObservation);
  const checks={
    application_release_valid:true,
    application_runtime_binding:application.runtime_dependency.singular===true&&application.runtime_dependency.identity===EXPECTED_RELEASE.identity&&application.runtime_dependency.version===EXPECTED_RELEASE.production_version&&application.runtime_dependency.release===EXPECTED_RELEASE.release,
    runtime_manifest_identity:validManifest(manifest,verifyEnvelope),
    release_attestation_signature:Boolean(verifyEnvelope(attestation,RELEASE_ARTIFACT_TYPE)&&exactRelease(attestation?.payload)),
    supply_chain_identity:validSupplyChain(supply,verifyEnvelope),
    numina_deployment:transportVerified
  };
  const canonicalBuildId=application.build_id;
  return {root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',
    deployment:'NUMINA',deployed:transportVerified,ready:Object.values(checks).every(Boolean),checks,
    evidence_status:{state:'VERIFIED',assertion:'EVIDENCE_PROVIDED',scope:'NUMINA',basis:['application_release','runtime_manifest','release_attestation','supply_chain','deployment_observation'],external_provider_confirmation:'SEPARATE_PROVIDER_EVIDENCE_REQUIRED'},
    application:{version:application.version,release:application.release,build_id:canonicalBuildId,canonical_manifest_build_id:canonicalBuildId,artifact_inventory_build_id:EXPECTED_APPLICATION_ARTIFACT_BUILD_ID,artifact_inventory_scope:APPLICATION_ARTIFACT_BUILD_SCOPE,build_identity_relation:canonicalBuildId===EXPECTED_APPLICATION_ARTIFACT_BUILD_ID?'converged':'distinct_scopes'},
    runtime:{root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',deployment:'NUMINA',...EXPECTED_RELEASE},
    transport:{identity:'NUMINA',role:'diagnostic_only',vercel_observation_verified:transportVerified,observation:transportObservation??null},
    mode:'NUMINA'};
}
async function fetchJson(url){const response=await fetch(url,{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});if(response.status!==200)throw new Error('UPSTREAM_STATUS_'+response.status);if(!(response.headers.get('content-type')||'').toLowerCase().includes('application/json'))throw new Error('UPSTREAM_CONTENT_TYPE');const body=await response.text();if(Buffer.byteLength(body,'utf8')>MAX_BYTES)throw new Error('UPSTREAM_TOO_LARGE');return JSON.parse(body);}
function writeJson(req,res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');res.setHeader('x-numina-runtime-release',EXPECTED_RELEASE.production_version);return res.end(req.method==='HEAD'?'':JSON.stringify(value));}
async function handleDeploymentProvenance(req,res){const observation=deploymentProvenance(),verified=validateDeploymentProvenance(observation),receipt=sign(observation,'NUMINA_TRANSPORT_OBSERVATION');return writeJson(req,res,200,{root:'NUMINA',manifest:'NUMINA',deployment:'NUMINA',deployed:true,transport:{identity:'NUMINA',role:'diagnostic_only',verified,observation},receipt});}
async function handleFrontierReadiness(req,res){const [application,manifest,attestation,supply]=await Promise.all([fetchJson(ORIGIN+'/v4/release/manifest'),fetchJson(RUNTIME_ORIGIN+'/v1/release/manifest'),fetchJson(RUNTIME_ORIGIN+'/v1/release/attestation'),fetchJson(RUNTIME_ORIGIN+'/v1/release/supply-chain')]);const deployment=deploymentProvenance();const evaluation=evaluateFrontierReadiness({application,manifest,attestation,supply,deployment});const payload={schema:'numina.frontier-readiness.v2',observed_at:new Date().toISOString(),...evaluation};return writeJson(req,res,payload.ready?200:503,{readiness:payload,receipt:sign(payload,'NUMINA_FRONTIER_READINESS')});}
export default async function handler(req,res){if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;res.setHeader('allow','GET, HEAD');res.setHeader('cache-control','no-store');return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));}const url=new URL(req.url,'https://numina-production.vercel.app');const mode=url.searchParams.get('mode');try{if(mode==='frontier-readiness')return await handleFrontierReadiness(req,res);if(mode==='deployment-provenance')return await handleDeploymentProvenance(req,res);const upstream=await fetch(ORIGIN+'/v4/release/manifest',{headers:{accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});if(upstream.status!==200)throw new Error('APPLICATION_RELEASE_UPSTREAM_STATUS');if(!(upstream.headers.get('content-type')||'').toLowerCase().includes('application/json'))throw new Error('APPLICATION_RELEASE_UPSTREAM_TYPE');const body=await upstream.text();if(Buffer.byteLength(body,'utf8')>MAX_BYTES)throw new Error('APPLICATION_RELEASE_UPSTREAM_TOO_LARGE');return writeJson(req,res,200,validateApplicationRelease(JSON.parse(body)));}catch(error){const gated=mode==='frontier-readiness';res.statusCode=gated?503:502;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');return res.end(JSON.stringify({error:gated?'NUMINA_MANIFEST_UNAVAILABLE':String(error?.message||error),detail:gated?String(error?.message||error):undefined}));}}
