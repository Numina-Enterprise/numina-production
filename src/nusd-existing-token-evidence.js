// Read-only collection of the exact on-chain bundle consumed by the existing
// NUSD token verifier. No caller input can select the RPC, chain, transaction,
// token, block, method, or call data.
export const {NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE,collectExistingTokenEvidence,existingTokenEvidenceHttp}=(()=>{
const NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE='/api/nusd/v1/evidence';
const RPC_URL='https://u0yth28mgh-u0vtj8pzdz-rpc.us0-aws.kaleido.io/';
const CHAIN_ID='962421430';
const GENESIS_HASH='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
const SIGNER='0x1a45671ae2ee3e52264116151924faacb80fc02e';
const TOKEN='0x491c1df1b5ca77af797f052c2310ca17039c931b';
const TRANSACTION='0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b';
const DECIMALS='18';
const CONFIRMATIONS=12n;
const TIMEOUT_MS=8000;
const MAX_BYTES=524288;
const MAX_ITEMS=4096;
const METHODS=new Set(['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber','eth_getCode','eth_call']);
const HASH=/^0x[0-9a-fA-F]{64}$/;
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
const WORD=/^0x[0-9a-fA-F]{64}$/;
const BYTECODE=/^0x(?:[0-9a-fA-F]{2})+$/;
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','CDN-Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const same=(left,right)=>typeof left==='string'&&typeof right==='string'&&left.toLowerCase()===right.toLowerCase();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function evidenceError(code,status=502){return Object.assign(new Error(code),{code,status});}
function requireEvidence(condition,code='RPC_RESPONSE_INVALID',status=502){if(!condition)throw evidenceError(code,status);}
function quantity(value){requireEvidence(typeof value==='string'&&QUANTITY.test(value));return BigInt(value);}
function configuration(env){
 requireEvidence(env&&env.NUMINA_RPC_URL===RPC_URL&&env.NUMINA_EXPECTED_CHAIN_ID===CHAIN_ID&&same(env.NUMINA_DEPLOYER_ADDRESS,SIGNER),'CONFIGURATION_MISMATCH',503);
 const authorization=env.NUMINA_RPC_AUTHORIZATION;
 requireEvidence(typeof authorization==='string'&&authorization.length<=8192&&/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(authorization),'CONFIGURATION_MISMATCH',503);
 return authorization;
}
async function limitedJson(response,signal){
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||BigInt(declared)>BigInt(MAX_BYTES))){void response.body?.cancel().catch(()=>{});throw evidenceError('RPC_RESPONSE_TOO_LARGE');}
 requireEvidence(/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(response.headers.get('content-type')||'')&&response.body?.getReader);
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{
  for(;;){if(signal.aborted)throw evidenceError('RPC_TIMEOUT',504);const {done,value}=await reader.read();if(done)break;requireEvidence(value instanceof Uint8Array);bytes+=value.byteLength;if(bytes>MAX_BYTES){void reader.cancel().catch(()=>{});throw evidenceError('RPC_RESPONSE_TOO_LARGE');}chunks.push(value);}
  const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));}catch{throw evidenceError('RPC_RESPONSE_INVALID');}
 }finally{reader.releaseLock();}
}
function block(value,{genesis=false,transactions=false}={}){
 requireEvidence(object(value)&&HASH.test(value.hash)&&!/^0x0{64}$/i.test(value.hash)&&QUANTITY.test(value.number)&&QUANTITY.test(value.timestamp));
 if(genesis)requireEvidence(quantity(value.number)===0n);
 if(transactions)requireEvidence(Array.isArray(value.transactions)&&value.transactions.length<=MAX_ITEMS&&value.transactions.every(item=>typeof item==='string'&&HASH.test(item)));
 return {number:value.number,hash:value.hash.toLowerCase(),timestamp:value.timestamp,...(transactions?{transactions:value.transactions.map(item=>item.toLowerCase())}:{})};
}
function receipt(value){
 requireEvidence(object(value)&&value.status==='0x1'&&value.to===null&&same(value.transactionHash,TRANSACTION)&&same(value.contractAddress,TOKEN)&&same(value.from,SIGNER)&&HASH.test(value.blockHash)&&QUANTITY.test(value.blockNumber)&&Array.isArray(value.logs)&&value.logs.length>0&&value.logs.length<=MAX_ITEMS,'EVIDENCE_MISMATCH');
 for(const field of ['type','transactionIndex','cumulativeGasUsed','gasUsed','effectiveGasPrice'])quantity(value[field]);
 const receiptNumber=quantity(value.blockNumber),logs=[],logIndices=new Set();
 for(const log of value.logs){
  requireEvidence(object(log)&&log.removed===false&&same(log.transactionHash,value.transactionHash)&&same(log.blockHash,value.blockHash)&&quantity(log.blockNumber)===receiptNumber&&log.transactionIndex===value.transactionIndex&&ADDRESS.test(log.address)&&QUANTITY.test(log.transactionIndex)&&QUANTITY.test(log.logIndex)&&!logIndices.has(log.logIndex)&&Array.isArray(log.topics)&&log.topics.length<=MAX_ITEMS&&log.topics.every(topic=>typeof topic==='string'&&HASH.test(topic))&&typeof log.data==='string'&&/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data),'EVIDENCE_MISMATCH');
  logIndices.add(log.logIndex);
  logs.push({address:log.address.toLowerCase(),topics:log.topics.map(topic=>topic.toLowerCase()),data:log.data.toLowerCase(),blockNumber:log.blockNumber,transactionHash:log.transactionHash.toLowerCase(),transactionIndex:log.transactionIndex,blockHash:log.blockHash.toLowerCase(),logIndex:log.logIndex,removed:false});
 }
 return {status:value.status,type:value.type,transactionHash:value.transactionHash.toLowerCase(),transactionIndex:value.transactionIndex,blockHash:value.blockHash.toLowerCase(),blockNumber:value.blockNumber,from:value.from.toLowerCase(),to:null,contractAddress:value.contractAddress.toLowerCase(),cumulativeGasUsed:value.cumulativeGasUsed,gasUsed:value.gasUsed,effectiveGasPrice:value.effectiveGasPrice,logs};
}

async function collectExistingTokenEvidence(env,{fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=TIMEOUT_MS,now=()=>new Date().toISOString()}={}){
 requireEvidence(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=TIMEOUT_MS,'CONFIGURATION_MISMATCH',503);
 const authorization=configuration(env),controller=new AbortController(),methods=[];let id=0,timer;
 const rpc=async(method,params)=>{
  requireEvidence(METHODS.has(method),'RPC_METHOD_NOT_ALLOWED');
  if(controller.signal.aborted)throw evidenceError('RPC_TIMEOUT',504);
  const requestId=++id;
  let response;
  try{response=await fetcher(RPC_URL,{method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/json','Cache-Control':'no-store',Authorization:authorization},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})});}
  catch{throw controller.signal.aborted?evidenceError('RPC_TIMEOUT',504):evidenceError('RPC_UNAVAILABLE',502);}
  if(!response.ok||response.redirected){void response.body?.cancel().catch(()=>{});throw evidenceError(response.status===401||response.status===403?'RPC_AUTHENTICATION_REJECTED':'RPC_UNAVAILABLE',502);}
  const value=await limitedJson(response,controller.signal);
  requireEvidence(object(value)&&value.jsonrpc==='2.0'&&value.id===requestId&&Object.keys(value).length===3);
  if(Object.hasOwn(value,'error'))throw evidenceError('RPC_METHOD_FAILED');
  requireEvidence(Object.hasOwn(value,'result'));
  methods.push(method);return value.result;
 };
 try{return await Promise.race([
  new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(evidenceError('RPC_TIMEOUT',504));},timeoutMs);}),
  (async()=>{
   const observedChainId=quantity(await rpc('eth_chainId',[])).toString();
   requireEvidence(observedChainId===CHAIN_ID,'CHAIN_MISMATCH');
   const genesis=block(await rpc('eth_getBlockByNumber',['0x0',false]),{genesis:true});
   requireEvidence(same(genesis.hash,GENESIS_HASH),'CHAIN_MISMATCH');
   const transactionReceipt=receipt(await rpc('eth_getTransactionReceipt',[TRANSACTION]));
   const receiptNumber=quantity(transactionReceipt.blockNumber);
   const canonicalBlock=block(await rpc('eth_getBlockByNumber',[transactionReceipt.blockNumber,false]),{transactions:true});
   const transactionIndex=quantity(transactionReceipt.transactionIndex);
   requireEvidence(quantity(canonicalBlock.number)===receiptNumber&&same(canonicalBlock.hash,transactionReceipt.blockHash)&&transactionIndex<BigInt(canonicalBlock.transactions.length)&&same(canonicalBlock.transactions[Number(transactionIndex)],TRANSACTION),'EVIDENCE_MISMATCH');
   const initialHead=block(await rpc('eth_getBlockByNumber',['latest',false]));
   const initialHeadNumber=quantity(initialHead.number);
   requireEvidence(initialHeadNumber>=receiptNumber&&initialHeadNumber-receiptNumber+1n>=CONFIRMATIONS&&initialHeadNumber+1n>=CONFIRMATIONS,'EVIDENCE_NOT_FINAL');
   const stateNumber=initialHeadNumber-CONFIRMATIONS+1n;
   requireEvidence(stateNumber>=receiptNumber,'EVIDENCE_NOT_FINAL');
   const stateBlock=block(await rpc('eth_getBlockByNumber',['0x'+stateNumber.toString(16),false]));
   requireEvidence(quantity(stateBlock.number)===stateNumber,'EVIDENCE_MISMATCH');
   const stateReference={blockHash:stateBlock.hash,requireCanonical:true};
   const code=await rpc('eth_getCode',[TOKEN,stateReference]);
   requireEvidence(typeof code==='string'&&BYTECODE.test(code)&&!/^0x(?:00)+$/i.test(code),'NUSD_STATE_MISMATCH');
   const calls=[];
   // Supply and pause are mutable observations, not historical identity pins.
   // Keep strict ABI types and the immutable token decimals; downstream
   // authorization, settlement and role-control verification remain separate.
   for(const [name,data]of [['decimals','0x313ce567'],['totalSupply','0x18160ddd'],['paused','0x5c975abb']]){
    const result=await rpc('eth_call',[{to:TOKEN,data},stateReference]);
    requireEvidence(typeof result==='string'&&WORD.test(result),'NUSD_STATE_MISMATCH');
    const value=BigInt(result);
    requireEvidence(name==='decimals'?value.toString()===DECIMALS:name==='paused'?value===0n||value===1n:true,'NUSD_STATE_MISMATCH');
    calls.push({name,to:TOKEN,blockHash:stateBlock.hash,data,result});
   }
   const observed={decimals:Number(DECIMALS),totalSupplyBaseUnits:BigInt(calls.find(call=>call.name==='totalSupply').result).toString(),paused:BigInt(calls.find(call=>call.name==='paused').result)===1n,scope:'READ_ONLY_CHAIN_OBSERVATION',settlementVerified:false,approvalVerified:false,currentRoleControlVerified:false,activationAuthorized:false};
   const stateReread=block(await rpc('eth_getBlockByNumber',[stateBlock.number,false]));
   requireEvidence(stateReread.number===stateBlock.number&&same(stateReread.hash,stateBlock.hash),'EVIDENCE_MISMATCH');
   const finalBlockReread=block(await rpc('eth_getBlockByNumber',[transactionReceipt.blockNumber,false]));
   requireEvidence(quantity(finalBlockReread.number)===receiptNumber&&same(finalBlockReread.hash,canonicalBlock.hash),'EVIDENCE_MISMATCH');
   const headBlock=block(await rpc('eth_getBlockByNumber',['latest',false]));
   const headNumber=quantity(headBlock.number);
   requireEvidence(headNumber>=stateNumber&&headNumber-receiptNumber+1n>=CONFIRMATIONS&&headNumber-stateNumber+1n>=CONFIRMATIONS,'EVIDENCE_NOT_FINAL');
   return {schema:'numina.nusd.existing-token-supplied-evidence.v1',classification:'single_authenticated_rpc_read_only_observation_not_independent_provider_or_reserve_verification',collectedAt:now(),collection:{source:'numina_worker_read_only',rpcOrigin:new URL(RPC_URL).origin,authorizationEnvironmentVariable:'NUMINA_RPC_AUTHORIZATION',authorizationPersisted:false,methods,signed:false,broadcast:false,executionPerformed:false},network:{chainId:observedChainId,genesisHash:genesis.hash},receipt:transactionReceipt,canonicalBlock,headBlock,finalBlockReread,runtime:{address:TOKEN,blockHash:stateBlock.hash,code},calls,currentState:{block:stateBlock,headBlock,finalBlockReread:stateReread,runtime:{address:TOKEN,blockHash:stateBlock.hash,code},calls,observed},providerSourceReference:{type:'authenticated_rpc',origin:new URL(RPC_URL).origin,authorizationEnvironmentVariable:'NUMINA_RPC_AUTHORIZATION',authorizationStored:false},productionReceiptCreated:false,signed:false,broadcast:false,executionPerformed:false};
  })()
 ]);}finally{clearTimeout(timer);controller.abort();}
}

async function existingTokenEvidenceHttp(req,env,options){
 const url=new URL(req.url);
 if(req.method!=='GET')return new Response(JSON.stringify({schema:'numina.nusd.existing-token-supplied-evidence.v1',error:{code:'METHOD_NOT_ALLOWED'}}),{status:405,headers:{...HEADERS,Allow:'GET'}});
 if(url.pathname!==NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE||url.search)return new Response(JSON.stringify({schema:'numina.nusd.existing-token-supplied-evidence.v1',error:{code:'INVALID_REQUEST'}}),{status:400,headers:HEADERS});
 try{return new Response(JSON.stringify(await collectExistingTokenEvidence(env,options)),{status:200,headers:HEADERS});}
 catch(error){const code=typeof error?.code==='string'&&/^[A-Z_]{3,64}$/.test(error.code)?error.code:'RPC_UNAVAILABLE',status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:502;return new Response(JSON.stringify({schema:'numina.nusd.existing-token-supplied-evidence.v1',status:'unavailable',observedAt:new Date().toISOString(),error:{code},signed:false,broadcast:false,executionPerformed:false}),{status,headers:HEADERS});}
}
return {NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE,collectExistingTokenEvidence,existingTokenEvidenceHttp};
})();
