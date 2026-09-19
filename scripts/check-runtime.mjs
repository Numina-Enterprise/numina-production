import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RUNTIME_ORIGIN,RUNTIME_VERSION,PINNED_RUNTIME_PUBLIC_KEY} from '../public/runtime-contract.js';
import {assessRuntimeEvidence,verifyRuntimeReceipt,canonical} from '../public/runtime-release-model.js';
const paths={manifest:'/v1/release/manifest',status:'/v1/status',attestation:'/v1/release/attestation',control:'/v1/control/state',supply:'/v1/release/supply-chain',ready:'/readyz',bootstrap:'/v1/bootstrap/attestation'};
export async function checkRuntime({fetch:fetcher=globalThis.fetch,pinnedKey=PINNED_RUNTIME_PUBLIC_KEY,now=()=>new Date()}={}){
  const records=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,route])=>{
    try{
      const response=await fetcher(RUNTIME_ORIGIN+route,{method:'GET',credentials:'omit',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok||response.redirected)throw Error('HTTP '+response.status);
      const data=await response.json();
      if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid runtime response');
      return [name,{phase:'ok',data}];
    }catch(error){return [name,{phase:'error',error:error.message}];}
  })));
  const evidence=await assessRuntimeEvidence(records,{pinnedKey});
  const bootstrapResponse=records.bootstrap?.phase==='ok'?records.bootstrap.data:null;
  const bootstrap=await verifyRuntimeReceipt(bootstrapResponse,pinnedKey);
  const bootstrapBound=!Object.hasOwn(bootstrapResponse??{},'bootstrap')||
    (bootstrap.valid&&canonical(bootstrapResponse.bootstrap)===canonical(bootstrap.envelope.payload));
  // Readiness and durability remain required by the treasury initialization gate.
  // Missing endpoints are failures, even when the signed release identity matches.
  const checks={
    release:evidence.manifestMatches,signature:evidence.releaseDeclarationVerified,
    status:evidence.runtimeStatusMatches,supply:evidence.supplyIdentityMatches,
    control:evidence.controlManifestBound,
    ready:records.ready?.phase==='ok'&&records.ready.data.status==='ready',
    durable:Boolean(bootstrap.valid&&bootstrapBound&&bootstrap.envelope.artifact_type==='NUMINA_BOOTSTRAP_ATTESTATION'&&
      bootstrap.envelope.payload.release===RUNTIME_VERSION&&bootstrap.envelope.payload.evidence_store_durable===true)
  };
  return {checkedAt:now().toISOString(),origin:RUNTIME_ORIGIN,expected:RUNTIME_VERSION,
    observed:evidence.release?.production_version??null,checks,
    errors:Object.fromEntries(Object.entries(records).filter(([,record])=>record.phase==='error').map(([name,record])=>[name,record.error])),
    passed:Object.values(checks).every(value=>value===true)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await checkRuntime();
  console.log(JSON.stringify(report,null,2));
  if(!report.passed)process.exitCode=1;
}
