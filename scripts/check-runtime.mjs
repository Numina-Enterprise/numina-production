import {RUNTIME_ORIGIN,RUNTIME_VERSION} from '../public/runtime-contract.js';
import {assessRuntimeEvidence,verifyRuntimeReceipt} from '../public/runtime-release-model.js';
const paths={manifest:'/v1/release/manifest',status:'/v1/status',attestation:'/v1/release/attestation',control:'/v1/control/state',supply:'/v1/release/supply-chain',ready:'/readyz',bootstrap:'/v1/bootstrap/attestation'};
const records=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,path])=>{
  try{const r=await fetch(RUNTIME_ORIGIN+path,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('HTTP '+r.status);return [name,{state:'ok',data:await r.json()}]}
  catch(error){return [name,{state:'error',error:error.message}]}
})));
const evidence=await assessRuntimeEvidence(records);
const bootstrap=await verifyRuntimeReceipt(records.bootstrap?.data);
const checks={release:evidence.manifestMatches,signature:evidence.releaseDeclarationVerified,status:evidence.runtimeStatusMatches,control:evidence.controlStateBound,ready:records.ready?.data?.status==='ready',durable:bootstrap.valid && bootstrap.envelope.artifact_type==='NUMINA_BOOTSTRAP_ATTESTATION' && bootstrap.envelope.payload.release===RUNTIME_VERSION && bootstrap.envelope.payload.evidence_store_durable===true};
const report={checkedAt:new Date().toISOString(),origin:RUNTIME_ORIGIN,expected:RUNTIME_VERSION,observed:records.manifest?.data?.production_version??null,checks,errors:Object.fromEntries(Object.entries(records).filter(([,r])=>r.state==='error').map(([k,r])=>[k,r.error])),passed:Object.values(checks).every(Boolean)};
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
