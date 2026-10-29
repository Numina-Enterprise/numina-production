import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyUsdcReceipt} from '../src/usdc-receipt-verifier.js';

// Synthetic fixtures only. These hashes are not actual treasury execution evidence.
// Protocol fixtures: https://ethereum.org/developers/docs/apis/json-rpc/
// USDC pin: https://developers.circle.com/stablecoins/usdc-contract-addresses
const tx='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64),finalHash='0x'+'c'.repeat(64);
const from='0x'+'1'.repeat(40),to='0x'+'2'.repeat(40),token='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const transfer='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const word=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
const topic=address=>'0x'+'0'.repeat(24)+address.slice(2);
const evidence=()=>({rail:'USDC',requestId:'numina-usdc-500t-20260918',amount:'500000000000000',network:'base',transactionHash:tx,from,to,logIndex:3});
function fixtures(){
  const log={address:token,topics:[transfer,topic(from),topic(to)],data:word(500000000000000000000n),blockHash,blockNumber:'0x64',transactionHash:tx,transactionIndex:'0x1',logIndex:'0x3',removed:false};
  return {chain:'0x2105',receipt:{transactionHash:tx,blockHash,blockNumber:'0x64',transactionIndex:'0x1',status:'0x1',logs:[log]},finalized:{hash:finalHash,number:'0x66',timestamp:'0x6a'},canonical:{hash:blockHash,number:'0x64',timestamp:'0x68',transactions:['0x'+'d'.repeat(64),tx]},canonicalFinalized:{hash:finalHash,number:'0x66',timestamp:'0x6a'},decimals:word(6)};
}
function mockRpc(data=fixtures(),override){
  const calls=[];
  const fetcher=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url,options,request});
    if(override){const response=await override(request,calls);if(response!==undefined)return response;}
    let result;
    if(request.method==='eth_chainId')result=data.chain;
    else if(request.method==='eth_getTransactionReceipt')result=data.receipt;
    else if(request.method==='eth_call')result=data.decimals;
    else if(request.params[0]==='finalized')result=data.finalized;
    else if(request.params[0]===data.receipt?.blockNumber)result=data.canonical;
    else result=data.canonicalFinalized;
    return Response.json({jsonrpc:'2.0',id:request.id,result});
  };
  return {fetcher,calls};
}
test('verifies exact 500T native USDC event using only pinned read-only RPC calls',async()=>{
  const rpc=mockRpc(),result=await verifyUsdcReceipt(evidence(),{RPC_URL:'https://attacker.invalid',PRIVATE_KEY:'never-used'},rpc);
  assert.equal(result.status,'VERIFIED_ONCHAIN_TRANSFER');assert.equal(result.verified,true);
  assert.equal(result.source.amountBaseUnits,'500000000000000000000');assert.equal(result.source.tokenDecimals,6);
  assert.equal(result.source.chainId,8453);assert.equal(result.source.network,'base');assert.equal(result.source.blockNumber,'100');
  assert.equal(result.source.finalizedBlockNumber,'102');assert.equal(result.source.transactionHash,tx);
  assert.match(result.scope,/Not an independent light-client proof/);assert.match(result.scope,/provider deposit-credit/);
  assert.equal(Object.hasOwn(result,'settled'),false);assert.match(result.observedAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.equal(rpc.calls.length,6);
  for(const {url,options,request} of rpc.calls){
    assert.equal(url,'https://mainnet.base.org');assert.equal(options.redirect,'manual');assert.equal(options.method,'POST');
    assert.ok(['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber','eth_call'].includes(request.method));
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.signal.aborted,true);
    assert.doesNotMatch(options.body,/never-used|sendTransaction|sendRawTransaction|personal_/);
  }
  assert.deepEqual(rpc.calls.at(-1).request.params,[{to:token,data:'0x313ce567'},{blockHash,requireCanonical:true}]);
});
test('amounts preserve micro-USDC exactly and never borrow NUSD model precision',async()=>{
  const data=fixtures(),input={...evidence(),amount:'9007199254740993.000001'};
  data.receipt.logs[0].data=word(9007199254740993000001n);
  const result=await verifyUsdcReceipt(input,{},mockRpc(data));
  assert.equal(result.verified,true);assert.equal(result.source.amountBaseUnits,'9007199254740993000001');
});
test('unsupported networks, malformed fields and non-exact amounts make no RPC request',async()=>{
  const bad=[{network:'ethereum'},{network:'base-sepolia'},{network:'https://attacker.invalid'},{transactionHash:'0x123'},{from:'0x'+'0'.repeat(40)},{to:'0x'+'0'.repeat(40)},{amount:500000000000000},{amount:'5e14'},{amount:'01'},{amount:'-1'},{amount:'0'},{amount:'1.0000001'},{amount:'9'.repeat(79)},{rail:'NUSD'},{requestId:'../../receipt'},{logIndex:-1},{logIndex:1.5},{logIndex:'3'}];
  for(const patch of bad){const rpc=mockRpc(),result=await verifyUsdcReceipt({...evidence(),...patch},{},rpc);assert.equal(result.status,'NOT_VERIFIED',JSON.stringify(patch));assert.equal(result.verified,false);assert.equal(rpc.calls.length,0);}
});
test('successful transaction alone, wrong chain and spoofed receipt identifiers never verify',async()=>{
  const mutations=[
    data=>{data.chain='0x1';},data=>{data.receipt.transactionHash='0x'+'e'.repeat(64);},
    data=>{data.receipt.status='0x0';},data=>{data.receipt.status=true;},data=>{data.receipt.status='0x01';},
    data=>{data.receipt.logs=[];},data=>{data.receipt.blockHash=null;},data=>{data.receipt.blockNumber='0x064';},
    data=>{data.receipt.logs.push({...data.receipt.logs[0]});}
  ];
  for(const mutate of mutations){const data=fixtures();mutate(data);const result=await verifyUsdcReceipt(evidence(),{},mockRpc(data));assert.equal(result.status,'NOT_VERIFIED');assert.equal(result.verified,false);}
});
test('pins token, event signature, exact value, parties, log index and all log provenance',async()=>{
  const mutations=[
    log=>{log.address=from;},log=>{log.topics[0]='0x'+'0'.repeat(64);},log=>{log.topics[1]=topic(to);},log=>{log.topics[2]=topic(from);},
    log=>{log.topics[1]='0x'+'f'.repeat(24)+from.slice(2);},log=>{log.topics.push(word(0));},
    log=>{log.data=word(500000000000000000001n);},log=>{log.data=word(500000000000000n*10n**18n);},
    log=>{log.removed=true;},log=>{delete log.removed;},log=>{log.logIndex='0x4';},
    log=>{log.transactionHash='0x'+'e'.repeat(64);},log=>{log.blockHash=finalHash;},log=>{log.blockNumber='0x65';},log=>{log.transactionIndex='0x0';}
  ];
  for(const mutate of mutations){const data=fixtures();mutate(data.receipt.logs[0]);const result=await verifyUsdcReceipt(evidence(),{},mockRpc(data));assert.equal(result.status,'NOT_VERIFIED');assert.equal(result.verified,false);}
});
test('missing receipts and unfinalized observations remain pending without implying submission',async()=>{
  for(const mutate of [data=>{data.receipt=null;},data=>{data.finalized=null;},data=>{data.finalized.number='0x63';}]){
    const data=fixtures();mutate(data);const result=await verifyUsdcReceipt(evidence(),{},mockRpc(data));assert.equal(result.status,'PENDING');assert.equal(result.verified,false);assert.equal(Object.hasOwn(result,'submitted'),false);
  }
});
test('canonical receipt block, inclusion index and canonical finalized head must match',async()=>{
  const mutations=[
    data=>{data.canonical.hash=finalHash;},data=>{data.canonical.number='0x65';},data=>{data.canonical.transactions=[tx];},
    data=>{data.canonical.transactions=[tx,'0x'+'e'.repeat(64)];},data=>{data.canonical.transactions[0]='not-a-hash';},
    data=>{data.canonicalFinalized.hash=blockHash;},data=>{data.canonicalFinalized.number='0x67';},
    data=>{data.decimals=word(18);},data=>{data.decimals='0x6';}
  ];
  for(const mutate of mutations){const data=fixtures();mutate(data);const result=await verifyUsdcReceipt(evidence(),{},mockRpc(data));assert.equal(result.status,'NOT_VERIFIED');assert.equal(result.verified,false);}
});
test('receipt exactly at finalized head requires that same finalized block hash',async()=>{
  const data=fixtures();data.finalized={...data.canonical};const rpc=mockRpc(data);
  assert.equal((await verifyUsdcReceipt(evidence(),{},rpc)).verified,true);assert.equal(rpc.calls.length,5);
  data.finalized.hash=finalHash;assert.equal((await verifyUsdcReceipt(evidence(),{},mockRpc(data))).reason,'FINALIZED_BLOCK_NOT_CANONICAL');
});
test('redirects, HTTP failures and JSON-RPC errors are unavailable, not settlement',async()=>{
  const responses=[()=>new Response(null,{status:302,headers:{Location:'https://attacker.invalid'}}),()=>new Response(null,{status:429}),()=>Response.json({jsonrpc:'2.0',id:1,error:{code:-32000,message:'provider secret must not leak'}})];
  for(const response of responses){const rpc=mockRpc(fixtures(),()=>response()),result=await verifyUsdcReceipt(evidence(),{},rpc);assert.equal(result.status,'UNAVAILABLE');assert.equal(result.verified,false);assert.equal(rpc.calls.length,1);assert.doesNotMatch(JSON.stringify(result),/provider secret/);}
});
test('malformed JSON, wrong RPC IDs and oversized bodies fail closed',async()=>{
  const responses=[
    ()=>new Response('{broken'),()=>Response.json({jsonrpc:'2.0',id:99,result:'0x2105'}),
    ()=>Response.json({jsonrpc:'1.0',id:1,result:'0x2105'}),()=>Response.json([{jsonrpc:'2.0',id:1,result:'0x2105'}]),
    ()=>new Response('x'.repeat(524289)),()=>new Response('{}',{headers:{'content-length':'524289'}}),
    ()=>new Response(new Uint8Array([0xff,0xfe]))
  ];
  for(const response of responses){const rpc=mockRpc(fixtures(),()=>response()),result=await verifyUsdcReceipt(evidence(),{},rpc);assert.equal(result.status,'NOT_VERIFIED');assert.equal(result.verified,false);assert.equal(rpc.calls.length,1);}
});
test('provider errors do not expose arbitrary details',async()=>{
  const result=await verifyUsdcReceipt(evidence(),{},{fetcher:async()=>{throw new Error('credential and private diagnostic');}});
  assert.equal(result.status,'UNAVAILABLE');assert.equal(result.reason,'RPC_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(result),/credential and/);
});
test('an unresponsive RPC is bounded by the total deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let signal;
  const pending=verifyUsdcReceipt(evidence(),{},{fetcher:(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
  t.mock.timers.tick(8001);
  const result=await pending;assert.equal(result.status,'UNAVAILABLE');assert.equal(result.reason,'RPC_TIMEOUT');assert.equal(signal.aborted,true);
});
