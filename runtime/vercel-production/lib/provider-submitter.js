'use strict';

const crypto=require('crypto');
const {ARC_RPC_URL,ARC_TESTNET_CHAIN_ID}=require('./provider-observations');

const MAX_RAW_TRANSACTION_BYTES=131072;
const MAX_AUTH_WINDOW_MS=15*60*1000;

function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort())out[key]=sorted(value[key]);return out;}return value;}
function canonical(value){return JSON.stringify(sorted(value));}
function digest(value){return crypto.createHash('sha256').update(Buffer.from(canonical(value),'utf8')).digest('hex');}
function assert(condition,message){if(!condition)throw new Error(message);}
function timeoutSignal(ms){return typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(ms):undefined;}
function safeHex(value,bytes){return typeof value==='string'&&new RegExp(`^0x[0-9a-fA-F]{${bytes*2}}$`).test(value);}
async function loadEthersDefault(){return import('../../../public/vendor/ethers-6.15.0.min.js');}
async function jsonResponse(response){const text=await response.text();if(Buffer.byteLength(text,'utf8')>65536)throw new Error('PROVIDER_RESPONSE_TOO_LARGE');try{return JSON.parse(text);}catch{throw new Error('PROVIDER_RESPONSE_INVALID_JSON');}}
async function rpc(fetchFn,method,params,id){
  const response=await fetchFn(ARC_RPC_URL,{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'manual',signal:timeoutSignal(10000)});
  const body=await jsonResponse(response);
  if(response.status!==200||body?.jsonrpc!=='2.0'||body?.id!==id)throw new Error('ARC_RPC_INVALID_RESPONSE');
  return body;
}
function authorizationPayload({handoff,transactionHash,from,idempotencyKey,expiresAt}){
  return {
    schema:'numina.owner-execution-authorization.v1',
    provider:'arc',
    network:'Arc Testnet',
    chain_id:ARC_TESTNET_CHAIN_ID,
    handoff_id:handoff.handoff_id,
    intent_root:handoff.intent_root,
    transaction_hash:transactionHash.toLowerCase(),
    from,
    idempotency_key:idempotencyKey,
    expires_at:expiresAt
  };
}
function authorizationMessage(payload){return `NUMINA OWNER EXECUTION AUTHORIZATION\n${canonical(payload)}`;}

async function submitArc({body,fetchFn=globalThis.fetch,now=()=>new Date(),verifyEnvelope,sign,controls={},loadEthers=loadEthersDefault}={}){
  assert(typeof fetchFn==='function','FETCH_UNAVAILABLE');
  assert(typeof verifyEnvelope==='function','VERIFY_ENVELOPE_REQUIRED');
  assert(typeof sign==='function','SIGNER_REQUIRED');
  assert(controls.real_funds_enabled===true&&controls.public_execution_api_enabled===true&&controls.live_provider_submitter_enabled===true,'LIVE_SUBMISSION_CONTROL_GATE_CLOSED');
  assert(controls.owner_authorization_required===true&&controls.pre_signed_payload_required===true,'LIVE_SUBMISSION_GOVERNANCE_INVALID');

  const request=body&&typeof body==='object'?body:{};
  const handoffReceipt=request.handoff_receipt;
  assert(verifyEnvelope(handoffReceipt,'NUMINA_EXECUTION_HANDOFF')===true,'EXECUTION_HANDOFF_RECEIPT_INVALID');
  const handoff=handoffReceipt.payload||{};
  assert(handoff.provider==='arc','LIVE_SUBMISSION_PROVIDER_UNSUPPORTED');
  assert(handoff.execution_permitted===true&&handoff.status==='READY_FOR_PROVIDER_SUBMISSION','EXECUTION_HANDOFF_NOT_PERMITTED');
  assert(handoff.external_execution_performed===false,'EXECUTION_HANDOFF_ALREADY_EXECUTED');

  const raw=String(request.raw_transaction||'');
  assert(/^0x[0-9a-fA-F]+$/.test(raw)&&raw.length%2===0,'SIGNED_RAW_TRANSACTION_INVALID');
  assert((raw.length-2)/2<=MAX_RAW_TRANSACTION_BYTES,'SIGNED_RAW_TRANSACTION_TOO_LARGE');
  const expectedHash=String(request.expected_transaction_hash||'').toLowerCase();
  assert(safeHex(expectedHash,32),'EXPECTED_TRANSACTION_HASH_INVALID');
  const idempotencyKey=String(request.idempotency_key||'');
  assert(/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey),'IDEMPOTENCY_KEY_INVALID');

  const ethers=await loadEthers();
  const tx=ethers.Transaction.from(raw);
  assert(typeof tx.isSigned==='function'&&tx.isSigned(),'TRANSACTION_NOT_SIGNED');
  assert(tx.chainId===BigInt(ARC_TESTNET_CHAIN_ID),'ARC_CHAIN_ID_MISMATCH');
  const transactionHash=String(tx.hash||'').toLowerCase();
  assert(safeHex(transactionHash,32),'SIGNED_TRANSACTION_HASH_INVALID');
  assert(transactionHash===expectedHash,'SIGNED_TRANSACTION_HASH_MISMATCH');
  const from=ethers.getAddress(tx.from);
  const intentSender=handoff.intent?.from||handoff.intent?.sender||null;
  if(intentSender)assert(ethers.getAddress(intentSender)===from,'HANDOFF_SENDER_MISMATCH');

  const auth=request.owner_authorization&&typeof request.owner_authorization==='object'?request.owner_authorization:{};
  const expiresAt=String(auth.expires_at||'');
  const expiresMs=Date.parse(expiresAt),nowMs=now().getTime();
  assert(Number.isFinite(expiresMs)&&expiresMs>nowMs&&expiresMs-nowMs<=MAX_AUTH_WINDOW_MS,'OWNER_AUTHORIZATION_EXPIRED_OR_TOO_LONG');
  const authPayload=authorizationPayload({handoff,transactionHash,from,idempotencyKey,expiresAt:new Date(expiresMs).toISOString()});
  const signature=String(auth.signature||'');
  assert(/^0x[0-9a-fA-F]{130}$/.test(signature),'OWNER_AUTHORIZATION_SIGNATURE_INVALID');
  const recovered=ethers.getAddress(ethers.verifyMessage(authorizationMessage(authPayload),signature));
  assert(recovered===from,'OWNER_AUTHORIZATION_SIGNER_MISMATCH');

  const existing=await rpc(fetchFn,'eth_getTransactionByHash',[transactionHash],1);
  let submissionState='ALREADY_SUBMITTED',rpcResult=transactionHash,networkObserved=existing.result||null;
  if(existing.error)throw new Error('ARC_TRANSACTION_LOOKUP_FAILED');
  if(!existing.result){
    const sent=await rpc(fetchFn,'eth_sendRawTransaction',[raw],2);
    if(sent.error){
      const race=await rpc(fetchFn,'eth_getTransactionByHash',[transactionHash],3);
      if(race.error||!race.result)throw new Error(`ARC_SUBMISSION_REJECTED_${String(sent.error.code||'UNKNOWN')}`);
      networkObserved=race.result;
      submissionState='ALREADY_SUBMITTED';
    }else{
      rpcResult=String(sent.result||'').toLowerCase();
      assert(rpcResult===transactionHash,'ARC_SUBMISSION_HASH_MISMATCH');
      const observed=await rpc(fetchFn,'eth_getTransactionByHash',[transactionHash],3);
      if(observed.error)throw new Error('ARC_POST_SUBMISSION_LOOKUP_FAILED');
      networkObserved=observed.result||null;
      submissionState='SUBMITTED';
    }
  }

  const submittedAt=now().toISOString();
  const submission={
    schema:'numina.provider-submission.v1',
    provider:'arc',
    network:'Arc Testnet',
    chain_id:ARC_TESTNET_CHAIN_ID,
    endpoint:ARC_RPC_URL,
    status:submissionState,
    handoff_id:handoff.handoff_id,
    intent_root:handoff.intent_root,
    handoff_receipt_root:digest(handoffReceipt),
    transaction_hash:transactionHash,
    from,
    idempotency_key:idempotencyKey,
    owner_authorization:authPayload,
    owner_authorization_verified:true,
    pre_signed_payload:true,
    embedded_private_key:false,
    partnership_status:'not_asserted',
    external_execution_performed:true,
    provider_result:rpcResult,
    network_observation:networkObserved,
    submitted_at:submittedAt
  };
  const receipt=sign(submission,'NUMINA_PROVIDER_SUBMISSION_RECEIPT');
  assert(receipt?.payload&&canonical(receipt.payload)===canonical(submission),'PROVIDER_SUBMISSION_RECEIPT_MISMATCH');
  return {submission,receipt};
}

module.exports={submitArc,authorizationPayload,authorizationMessage,ARC_RPC_URL,ARC_TESTNET_CHAIN_ID};
