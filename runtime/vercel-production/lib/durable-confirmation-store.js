'use strict';

const crypto=require('crypto');

function root(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function databaseUrl(){const value=process.env.NUMINA_DATABASE_URL||process.env.DATABASE_URL;if(!value)throw new Error('NUMINA_DATABASE_URL_REQUIRED');return value;}

async function persistConfirmation({expected,provider,providerResponse,verification,receipt}){
  const {neon}=await import('@neondatabase/serverless');
  const sql=neon(databaseUrl(),{fullResults:true});
  const now=Date.now();
  const eventId=String(verification.event_id);
  const handoffId=String(expected?.handoff_id||expected?.handoffId||eventId);
  const recordId=`confirmation:${provider}:${eventId}:${root(verification).slice(0,24)}`;
  const jobId=`verification:${provider}:${eventId}`;
  const artifact={schema:'numina.durable-confirmation.v1',expected,provider,providerResponse,verification,receipt};
  const artifactRoot=root(artifact);
  const state=verification.verification_status;
  await sql.transaction([
    sql`INSERT INTO numina_verification_jobs (job_id,tx_hash,handoff_id,request_json,status,attempts,next_attempt_at,expires_at,last_error,result_record_id,lease_owner,lease_expires_at,created_at,updated_at)
        VALUES (${jobId},${eventId},${handoffId},${JSON.stringify({expected,provider})}::jsonb,${state},1,${now},${now},NULL,${recordId},NULL,NULL,${now},${now})
        ON CONFLICT (job_id) DO UPDATE SET status=EXCLUDED.status,attempts=numina_verification_jobs.attempts+1,last_error=NULL,result_record_id=EXCLUDED.result_record_id,updated_at=EXCLUDED.updated_at`,
    sql`INSERT INTO numina_evidence_records (record_id,tx_hash,handoff_id,state,artifact_type,artifact_root,artifact_json,created_at,revoked,revocation_json)
        VALUES (${recordId},${eventId},${handoffId},${state},'NUMINA_EXTERNAL_CONFIRMATION',${artifactRoot},${JSON.stringify(artifact)}::jsonb,${now},false,NULL)
        ON CONFLICT (record_id) DO NOTHING`
  ]);
  return {durable:true,record_id:recordId,job_id:jobId,artifact_root:artifactRoot,state};
}

module.exports={persistConfirmation};
