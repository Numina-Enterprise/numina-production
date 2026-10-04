import built from '../dist/server/index.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {collectExistingTokenEvidence,existingTokenEvidenceHttp,NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE} from '../src/nusd-existing-token-evidence.js';

const RPC_URL='https://u0yth28mgh-u0vtj8pzdz-rpc.us0-aws.kaleido.io/';
const CHAIN_ID='962421430';
const GENESIS_HASH='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
const SIGNER='0x1a45671ae2ee3e52264116151924faacb80fc02e';
const TOKEN='0x491c1df1b5ca77af797f052c2310ca17039c931b';
const TRANSACTION='0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b';
const RECEIPT_HASH='0x'+'32'.repeat(32),HEAD_HASH='0x'+'64'.repeat(32),STATE_HASH='0x'+'59'.repeat(32);
const word=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
const quantity=value=>'0x'+BigInt(value).toString(16);
const env={NUMINA_RPC_URL:RPC_URL,NUMINA_RPC_AUTHORIZATION:'Bearer private-test-credential',NUMINA_EXPECTED_CHAIN_ID:CHAIN_ID,NUMINA_DEPLOYER_ADDRESS:SIGNER,NUMINA_TELEMETRY_LOGS:'false'};
function block(number,hash,transactions=[]){return {number:quantity(number),hash,timestamp:quantity(1800000000n+BigInt(number)),transactions,providerPrivateField:'must-not-leave-the-worker'};}
function fixture(){
 const receiptBlock=block(16,RECEIPT_HASH,[TRANSACTION]),head=block(100,HEAD_HASH),state=block(89,STATE_HASH);
 const log={address:TOKEN,blockHash:RECEIPT_HASH,blockNumber:'0x10',transactionHash:TRANSACTION,transactionIndex:'0x0',logIndex:'0x0',removed:false,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+'00'.repeat(32),'0x'+'00'.repeat(12)+SIGNER.slice(2)],data:word('1500000000000000000000000000000000'),providerPrivateField:'must-not-leave-the-worker'};
 const receipt={status:'0x1',type:'0x0',transactionHash:TRANSACTION,transactionIndex:'0x0',blockHash:RECEIPT_HASH,blockNumber:'0x10',from:SIGNER,to:null,contractAddress:TOKEN,cumulativeGasUsed:'0x20f806',gasUsed:'0x20f806',effectiveGasPrice:'0x0',logs:[log],providerPrivateField:'must-not-leave-the-worker'};
 return {receipt,receiptBlock,head,state};
}
function mockRpc(data=fixture()){
 const calls=[];
 const fetcher=async(url,options)=>{
  assert.equal(url,RPC_URL);assert.equal(options.method,'POST');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,env.NUMINA_RPC_AUTHORIZATION);
  const request=JSON.parse(options.body);calls.push(request);let result;
  if(request.method==='eth_chainId')result=quantity(CHAIN_ID);
  else if(request.method==='eth_getTransactionReceipt'){assert.deepEqual(request.params,[TRANSACTION]);result=data.receipt;}
  else if(request.method==='eth_getBlockByNumber'){const tag=request.params[0];result=tag==='0x0'?block(0,GENESIS_HASH):tag==='0x10'?data.receiptBlock:tag==='0x59'?data.state:tag==='latest'?data.head:null;}
  else if(request.method==='eth_getCode'){assert.deepEqual(request.params,[TOKEN,{blockHash:STATE_HASH,requireCanonical:true}]);result='0x60016000';}
  else if(request.method==='eth_call'){assert.deepEqual(request.params[1],{blockHash:STATE_HASH,requireCanonical:true});assert.equal(request.params[0].to,TOKEN);const selector=request.params[0].data;result=selector==='0x313ce567'?word(18):selector==='0x18160ddd'?word('1500000000000000000000000000000000'):selector==='0x5c975abb'?word(1):null;}
  else assert.fail('Unexpected RPC method '+request.method);
  return Response.json({jsonrpc:'2.0',id:request.id,result:structuredClone(result)});
 };
 return {fetcher,calls};
}

test('collector returns the complete verifier bundle using only fixed read methods and block-hash state calls',async()=>{
 const rpc=mockRpc(),evidence=await collectExistingTokenEvidence(env,{fetcher:rpc.fetcher,now:()=> '2026-09-23T00:00:00.000Z'});
 assert.equal(evidence.schema,'numina.nusd.existing-token-supplied-evidence.v1');
 assert.deepEqual(evidence.network,{chainId:CHAIN_ID,genesisHash:GENESIS_HASH});
 assert.equal(evidence.receipt.transactionHash,TRANSACTION);assert.equal(evidence.receipt.logs.length,1);assert.equal(evidence.receipt.logs[0].data,word('1500000000000000000000000000000000'));
 assert.equal(evidence.canonicalBlock.hash,RECEIPT_HASH);assert.equal(evidence.finalBlockReread.hash,RECEIPT_HASH);assert.equal(evidence.headBlock.hash,HEAD_HASH);
 assert.deepEqual(evidence.runtime,{address:TOKEN,blockHash:STATE_HASH,code:'0x60016000'});
 assert.deepEqual(evidence.currentState.calls.map(call=>call.name),['decimals','totalSupply','paused']);assert.ok(evidence.currentState.calls.every(call=>call.blockHash===STATE_HASH));assert.equal(evidence.currentState.finalBlockReread.hash,STATE_HASH);
 assert.equal(evidence.signed,false);assert.equal(evidence.broadcast,false);assert.equal(evidence.executionPerformed,false);
 assert.doesNotMatch(JSON.stringify(evidence),/private-test-credential|must-not-leave-the-worker/);
 const allowed=new Set(['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber','eth_getCode','eth_call']);assert.ok(rpc.calls.every(call=>allowed.has(call.method)));
 assert.equal(rpc.calls.filter(call=>call.method==='eth_getTransactionReceipt').length,1);assert.equal(rpc.calls.filter(call=>call.method==='eth_getCode').length,1);assert.equal(rpc.calls.filter(call=>call.method==='eth_call').length,3);
});

test('missing logs, conflicting block bindings, and invalid live state fail closed',async()=>{
 for(const [mutate,code]of [
  [data=>{data.receipt.logs=[];},'EVIDENCE_MISMATCH'],
  [data=>{data.receiptBlock.hash='0x'+'44'.repeat(32);},'EVIDENCE_MISMATCH'],
 ]){
  const data=fixture();mutate(data);const rpc=mockRpc(data);
  await assert.rejects(collectExistingTokenEvidence(env,{fetcher:rpc.fetcher}),error=>error.code===code);
 }
 const rpc=mockRpc(),original=rpc.fetcher;
 rpc.fetcher=async(url,options)=>{const request=JSON.parse(options.body),response=await original(url,options);return request.method==='eth_call'&&request.params[0].data==='0x5c975abb'?Response.json({jsonrpc:'2.0',id:request.id,result:word(2)}):response;};
 await assert.rejects(collectExistingTokenEvidence(env,{fetcher:rpc.fetcher}),error=>error.code==='NUSD_STATE_MISMATCH');
});

test('HTTP route rejects methods and all caller-selected RPC inputs before fetching',async()=>{
 let calls=0;const options={fetcher:async()=>{calls++;throw Error('must not fetch');}};
 for(const request of [
  new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE,{method:'POST'}),
  new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE+'?transactionHash=0x01'),
  new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE+'?method=eth_sendRawTransaction'),
 ]){
  const response=await existingTokenEvidenceHttp(request,env,options);assert.ok([400,405].includes(response.status));
 }
 assert.equal(calls,0);
});

test('source and built Workers expose the same public fixed evidence route without reviewer authentication',async t=>{
 const rpc=mockRpc();t.mock.method(globalThis,'fetch',rpc.fetcher);
 for(const handler of [worker,built]){
  const response=await handler.fetch(new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(response.headers.get('x-request-id'));
  const evidence=await response.json();assert.equal(evidence.receipt.transactionHash,TRANSACTION);assert.equal(evidence.currentState.calls.length,3);assert.equal(evidence.executionPerformed,false);
  assert.equal(evidence.currentState.observed.paused,true);assert.equal(evidence.currentState.observed.currentRoleControlVerified,false);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await handler.fetch(new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE,{method}),env)).status,405);
 }
});

test('configuration and provider diagnostics never leak through the public response',async()=>{
 const unavailable=await existingTokenEvidenceHttp(new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE),{...env,NUMINA_RPC_URL:'https://attacker.invalid'},{fetcher:async()=>{throw Error('secret provider diagnostic');}});
 assert.equal(unavailable.status,503);const text=await unavailable.text();assert.match(text,/CONFIGURATION_MISMATCH/);assert.doesNotMatch(text,/attacker|secret|private-test-credential/);
 const denied=await existingTokenEvidenceHttp(new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE),env,{fetcher:async()=>new Response(JSON.stringify({error:'private-test-credential'}),{status:403,headers:{'Content-Type':'application/json'}})});
 assert.equal(denied.status,502);assert.doesNotMatch(await denied.text(),/private-test-credential/);
});


test('mutable supply and pause observations remain typed facts without approval, settlement or role-control claims',async()=>{
 for(const [supply,paused] of [['0',false],['1500000000000000000000000000000001',true],['42',false]]){
  const rpc=mockRpc(),original=rpc.fetcher;
  const fetcher=async(url,options)=>{const request=JSON.parse(options.body),response=await original(url,options);
   if(request.method!=='eth_call')return response;
   const selector=request.params[0].data;
   return selector==='0x18160ddd'||selector==='0x5c975abb'?Response.json({jsonrpc:'2.0',id:request.id,result:word(selector==='0x18160ddd'?supply:paused?1:0)}):response;
  };
  const evidence=await collectExistingTokenEvidence(env,{fetcher});
  assert.deepEqual(evidence.currentState.observed,{decimals:18,totalSupplyBaseUnits:supply,paused,scope:'READ_ONLY_CHAIN_OBSERVATION',settlementVerified:false,approvalVerified:false,currentRoleControlVerified:false,activationAuthorized:false});
  assert.equal(evidence.receipt.logs[0].data,word('1500000000000000000000000000000000'));
  assert.equal(evidence.currentState.block.hash,STATE_HASH);assert.equal(evidence.signed,false);assert.equal(evidence.broadcast,false);assert.equal(evidence.executionPerformed,false);assert.equal(evidence.productionReceiptCreated,false);
  assert.ok(rpc.calls.every(call=>!/^eth_(send|sign)/.test(call.method)));
 }
});

test('observed-state collection rejects malformed ABI and changed immutable decimals',async()=>{
 for(const [selector,result] of [['0x313ce567',word(6)],['0x18160ddd','0x1'],['0x18160ddd','0x'+'f'.repeat(65)],['0x5c975abb',word(2)]]){
  const rpc=mockRpc(),original=rpc.fetcher;
  const fetcher=async(url,options)=>{const request=JSON.parse(options.body),response=await original(url,options);return request.method==='eth_call'&&request.params[0].data===selector?Response.json({jsonrpc:'2.0',id:request.id,result}):response;};
  await assert.rejects(collectExistingTokenEvidence(env,{fetcher}),error=>error.code==='NUSD_STATE_MISMATCH');
 }
});


test('built collector preserves changed current observations without promoting historical issuance to activation',async t=>{
 const rpc=mockRpc(),original=rpc.fetcher;
 t.mock.method(globalThis,'fetch',async(url,options)=>{const request=JSON.parse(options.body),response=await original(url,options);
  if(request.method!=='eth_call')return response;
  const selector=request.params[0].data;return selector==='0x18160ddd'||selector==='0x5c975abb'?Response.json({jsonrpc:'2.0',id:request.id,result:word(selector==='0x18160ddd'?'42':0)}):response;
 });
 const response=await built.fetch(new Request('https://numina.test'+NUSD_EXISTING_TOKEN_EVIDENCE_ROUTE),env);assert.equal(response.status,200);
 const evidence=await response.json();assert.equal(evidence.currentState.observed.totalSupplyBaseUnits,'42');assert.equal(evidence.currentState.observed.paused,false);
 for(const key of ['settlementVerified','approvalVerified','currentRoleControlVerified','activationAuthorized'])assert.equal(evidence.currentState.observed[key],false);
 assert.equal(evidence.executionPerformed,false);assert.equal(evidence.broadcast,false);assert.equal(evidence.productionReceiptCreated,false);
});
