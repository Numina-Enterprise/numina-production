'use strict';

const crypto=require('crypto');
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=canonical(v[k]);return o;}return v;}
function root(v){return crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');}
function requiredEnv(name){const v=process.env[name];if(!v)throw new Error(`${name}_REQUIRED`);return v;}

async function persistConfirmation({expected,provider,providerResponse,verification,receipt}){
  const now=Date.now(),eventId=String(verification.event_id),handoffId=String(expected?.handoff_id||expected?.handoffId||eventId);
  const recordId=`confirmation:${provider}:${eventId}:${root(verification).slice(0,24)}`,jobId=`verification:${provider}:${eventId}`;
  const artifact={schema:'numina.durable-confirmation.v1',expected,provider,providerResponse,verification,receipt};
  const artifactRoot=root(artifact),state=verification.verification_status;
  const request={schema:'numina.durable-evidence.commit.v1',operation:'WRITE_COMMIT_READ_BACK',job:{job_id:jobId,tx_hash:eventId,handoff_id:handoffId,request_json:{expected,provider},status:state,attempts:1,next_attempt_at:now,expires_at:now,result_record_id:recordId,created_at:now,updated_at:now},evidence:{record_id:recordId,tx_hash:eventId,handoff_id:handoffId,state,artifact_type:'NUMINA_EXTERNAL_CONFIRMATION',artifact_root:artifactRoot,artifact_json:artifact,created_at:now,revoked:false}};
  const response=await fetch(requiredEnv('NUMINA_DURABLE_EVIDENCE_URL'),{method:'POST',headers:{authorization:`Bearer ${requiredEnv('NUMINA_DURABLE_EVIDENCE_TOKEN')}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(request),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error(`DURABLE_EVIDENCE_HTTP_${response.status}`);
  const result=await response.json();
  if(result?.committed!==true||result?.read_back!==true)throw new Error('DURABLE_CONFIRMATION_COMMIT_NOT_PROVEN');
  if(result?.record_id!==recordId||result?.job_id!==jobId)throw new Error('DURABLE_CONFIRMATION_ID_MISMATCH');
  if(result?.artifact_root!==artifactRoot)throw new Error('DURABLE_CONFIRMATION_ARTIFACT_ROOT_MISMATCH');
  if(root(result?.artifact_json)!==artifactRoot)throw new Error('DURABLE_CONFIRMATION_READ_BACK_MISMATCH');
  if(JSON.stringify(canonical(result?.artifact_json?.verification))!==JSON.stringify(canonical(verification))||JSON.stringify(canonical(result?.artifact_json?.receipt))!==JSON.stringify(canonical(receipt)))throw new Error('DURABLE_CONFIRMATION_SIGNED_VERIFICATION_MISMATCH');
  return {durable:true,verified:true,record_id:recordId,job_id:jobId,artifact_root:artifactRoot,state};
}
module.exports={persistConfirmation};
