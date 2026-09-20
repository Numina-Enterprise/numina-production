'use strict';

const DEFAULT_NEON_DATA_API_URL='https://ep-wild-mud-au2cn33z.apirest.c-10.us-east-1.aws.neon.tech/numina/rest/v1';
const ALLOWED_RPCS=new Set(['numina_ingest_provider_evidence','numina_mark_trusted_production_release']);

function dataApiBase(env=process.env){
  const value=String(env.NUMINA_NEON_DATA_API_URL||DEFAULT_NEON_DATA_API_URL).trim().replace(/\/+$/,'');
  if(!/^https:\/\/[^/]+\/numina\/rest\/v1$/.test(value))throw new Error('NUMINA_NEON_DATA_API_URL_INVALID');
  return value;
}

async function callEvidenceRpc({token,rpc,manifest,fetchFn=fetch,env=process.env}){
  if(typeof token!=='string'||!token.trim()||/\s/.test(token))throw new Error('GITHUB_OIDC_TOKEN_INVALID');
  if(!ALLOWED_RPCS.has(rpc))throw new Error('NUMINA_NEON_RPC_NOT_ALLOWED');
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('EVIDENCE_MANIFEST_MISSING');

  const response=await fetchFn(`${dataApiBase(env)}/rpc/${rpc}`,{
    method:'POST',
    headers:{
      authorization:`Bearer ${token}`,
      'content-type':'application/json',
      accept:'application/json',
    },
    body:JSON.stringify({manifest}),
    redirect:'error',
    signal:AbortSignal.timeout(10000),
  });

  let result;
  try{result=await response.json();}catch{throw new Error(`DURABLE_EVIDENCE_HTTP_${response.status}_INVALID_JSON`);}
  if(!response.ok){
    const detail=String(result?.message||result?.error||result?.hint||result?.details||'').replace(/\s+/g,' ').slice(0,240);
    throw new Error(`DURABLE_EVIDENCE_HTTP_${response.status}${detail?':'+detail:''}`);
  }
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('DURABLE_EVIDENCE_RESPONSE_INVALID');
  return result;
}

module.exports={DEFAULT_NEON_DATA_API_URL,dataApiBase,callEvidenceRpc};
