import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {ESTIMATE_PINS,validateDeploymentReview,observeDeploymentEstimate} from '../runtime/vercel-production/lib/deployment-estimate.mjs';
import {createEstimateHandler} from '../runtime/vercel-production/api/deployment-estimate.mjs';

const originalTelemetry=process.env.NUMINA_TELEMETRY_LOGS;process.env.NUMINA_TELEMETRY_LOGS='false';
test.after(()=>{if(originalTelemetry===undefined)delete process.env.NUMINA_TELEMETRY_LOGS;else process.env.NUMINA_TELEMETRY_LOGS=originalTelemetry;});

const RPC='https://u0yth28mgh-u0vtj8pzdz-rpc.us0-aws.kaleido.io/';
const ACCOUNT='0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',CHAIN='962421430';
const GENESIS='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
const REVIEW_SHA='ee2aaf226f9f6e843aac8f1d1ad222045db8bb3b83cd5fe23f7f2bc7c217dde8';
const CREATION_SHA='bdaf4313f68b97d504ef3796096814d41b3002bffcf9ed75b78a939de6049401';
const POLICY_SHA='1d24f311a34a28d9560db1f32eb3efc4241701c5ae7233b97c2527006623b13d';
const bytes=readFileSync(new URL('../public/wallet-signing-review.json',import.meta.url));
const rawReview=JSON.parse(bytes),NOW=1789536000000;
const secret='Basic test-fixture-credential-not-a-real-secret';
const env=()=>({NUMINA_RPC_URL:RPC,NUMINA_RPC_AUTHORIZATION:secret,NUMINA_EXPECTED_CHAIN_ID:CHAIN,NUMINA_DEPLOYER_ADDRESS:ACCOUNT.toLowerCase()});
const bodyKeys=['gasLimit','gasPrice','calculatedTotalBaseUnits','balanceBaseUnits'];
const defer=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function response(body,{status=200,type='application/json',url=RPC,redirected=false,headers={}}={}){
 const result=new Response(body,{status,headers:{'Content-Type':type,...headers}});
 Object.defineProperty(result,'url',{value:url});Object.defineProperty(result,'redirected',{value:redirected});return result;
}
function fixture(){
 const state={chain:'0x'+BigInt(CHAIN).toString(16),genesis:{number:'0x0',hash:GENESIS,timestamp:'0x0'},gas:'0x5208',price:'0x2',balance:'0x186a0',calls:[],hook:null,override:null};
 state.fetcher=async(url,options)=>{
  const request=JSON.parse(options.body),call={url,options,request};state.calls.push(call);state.hook?.(call);
  if(state.override){const override=await state.override(call);if(override!==undefined)return override;}
  const result=({eth_chainId:state.chain,eth_getBlockByNumber:state.genesis,eth_estimateGas:state.gas,eth_gasPrice:state.price,eth_getBalance:state.balance})[request.method];
  assert.notEqual(result,undefined,'Unexpected or mutating provider method: '+request.method);
  return response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
 };
 state.observe=options=>observeDeploymentEstimate({env:env(),fetcher:state.fetcher,reviewBytes:bytes,now:()=>NOW,...options});return state;
}
function unavailable(result){
 assert.notEqual(result.httpStatus,200);assert.equal(result.body.schema,'numina.deployment-estimate.v1');assert.equal(result.body.status,'unavailable');assert.equal(typeof result.body.error?.code,'string');
 for(const field of bodyKeys)assert.equal(result.body[field],null,field+' must not retain a partial estimate');
 assert.equal(result.body.observedAt,null);assert.equal(result.body.expiresAt,null);assert.equal(result.body.estimateObserved,false);assert.equal(result.body.networkChecked,false);assert.equal(result.body.signingControlVerified,false);
 assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(JSON.stringify(result).includes('upstream-secret'),false);
}

test('deployment estimator pins exact 1500T review bytes and all constructor identity hashes',async()=>{
 assert.equal(createHash('sha256').update(bytes).digest('hex'),REVIEW_SHA);
 const review=await validateDeploymentReview(bytes);
 assert.equal(review.constructor.initialSupplyBaseUnits,'1500000000000000000000');assert.equal(review.constructor.initialRecipient,ACCOUNT);assert.equal(review.creationBytes,10746);
 assert.equal(review.issuerPolicySha256,POLICY_SHA);assert.equal(review.requestSha256,'0af2b7e72cd18f9676f85356da95f8deee8788eac0dee3d587a1278342a401ca');assert.equal(review.requestHashBasis,'raw_request_file_bytes');
 assert.equal(review.artifactSha256,'a77132febebe10172a7fe3ee1814ed124ea5503b93f1e2e4ffdfb218889a262a');assert.equal(review.sourceSha256,'87755643e690b82b11a9f5744f1dd9803965b0f38fa9ac4d18542e72b4bb80cc');
 assert.equal(createHash('sha256').update(Buffer.from(review.constructorData.slice(2),'hex')).digest('hex'),CREATION_SHA);
 const pinValues=Object.values(ESTIMATE_PINS);for(const pin of [REVIEW_SHA,CREATION_SHA,POLICY_SHA,CHAIN,GENESIS])assert.ok(pinValues.includes(pin),'Missing expected pin: '+pin);
 assert.equal(Object.isFrozen(review),true);assert.equal(Object.isFrozen(review.constructor),true);
});
test('review validation snapshots bytes and rejects 500T, changed code, forged approvals or receipt',async()=>{
 const copy=new Uint8Array(bytes),pending=validateDeploymentReview(copy);copy.fill(0);assert.equal((await pending).constructorDataSha256,CREATION_SHA);
 for(const changes of [{constructor:{...rawReview.constructor,initialSupplyBaseUnits:'500000000000000000000'}},{constructorData:rawReview.constructorData.slice(0,-2)+'00'},{productionReady:true},{receipt:{status:1}},{issuerPolicySha256:'95f806c9c64fd2cee955eb0c05ffcb6653f4cdeab33a85b993e1bd4c60f3092c'}])assert.throws(()=>validateDeploymentReview(new TextEncoder().encode(JSON.stringify({...rawReview,...changes}))),{code:'REVIEW_INVALID'});
 for(const value of [null,{},'',new Uint8Array(),new Uint8Array(65537)])assert.throws(()=>validateDeploymentReview(value),{code:'REVIEW_INVALID'});
});
test('packaged runtime review is byte-identical and the default loader estimates that fixed file',async()=>{
 const packaged=readFileSync(new URL('../runtime/vercel-production/lib/numina-1500t-constructor-review.json',import.meta.url));assert.deepEqual(packaged,bytes);assert.equal(createHash('sha256').update(packaged).digest('hex'),REVIEW_SHA);
 const f=fixture(),result=await observeDeploymentEstimate({env:env(),fetcher:f.fetcher,now:()=>NOW});assert.equal(result.httpStatus,200);assert.equal(f.calls[2].request.params[0].data,rawReview.constructorData);
});
test('one successful estimate uses only seven fixed read RPCs and exact reviewed creation data',async()=>{
 const f=fixture(),result=await f.observe();assert.equal(result.httpStatus,200);assert.equal(result.body.status,'observed');assert.equal(result.body.schema,'numina.deployment-estimate.v1');
 assert.deepEqual(f.calls.map(call=>call.request.method),['eth_chainId','eth_getBlockByNumber','eth_estimateGas','eth_gasPrice','eth_getBalance','eth_chainId','eth_getBlockByNumber']);
 assert.deepEqual(f.calls[2].request.params,[{from:ACCOUNT,value:'0x0',data:rawReview.constructorData},'pending']);assert.deepEqual(f.calls[4].request.params,[ACCOUNT,'pending']);
 assert.deepEqual(f.calls[1].request.params,['0x0',false]);assert.deepEqual(f.calls[6].request.params,['0x0',false]);
 for(const [i,call] of f.calls.entries()){
  assert.equal(call.url,RPC);assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'error');assert.equal(call.options.credentials,'omit');assert.equal(call.options.cache,'no-store');assert.equal(call.options.headers.Authorization,secret);
  assert.equal(call.request.jsonrpc,'2.0');assert.equal(call.request.id,i+1);assert.deepEqual(Object.keys(call.request).sort(),['id','jsonrpc','method','params']);
 }
});
test('successful quote contains exact amounts, fixed network, bounded lifetime and no execution claims',async()=>{
 const {body}=await fixture().observe();assert.equal(body.account,ACCOUNT);assert.equal(body.chainId,CHAIN);assert.equal(body.genesisHash,GENESIS);assert.equal(body.constructorDataSha256,CREATION_SHA);
 assert.equal(body.gasLimit,'21000');assert.equal(body.gasPrice,'2');assert.equal(body.calculatedTotalBaseUnits,'42000');assert.equal(body.balanceBaseUnits,'100000');assert.equal(body.balanceSufficient,true);assert.equal(body.feeAsset,null);
 assert.equal(body.observedAt,new Date(NOW).toISOString());assert.equal(body.expiresAt,new Date(NOW+60000).toISOString());assert.equal(body.receipt,null);
 for(const field of ['productionReady','reviewEvidenceVerified','policyReviewVerified','signed','broadcast','minted','deposited','networkIdentityVerified','signingControlVerified','reservesVerified','settlementVerified','feeAssetVerified','estimateVerified','feeDeducted','treasuryWritePerformed'])assert.equal(body[field],false,field);
 assert.equal(JSON.stringify(body).includes(secret),false);assert.equal(JSON.stringify(body).includes(rawReview.constructorData),false);assert.equal(Object.hasOwn(body,'nonce'),false);
});
test('missing or changed server configuration never sends an authenticated request',async()=>{
 for(const key of Object.keys(env())){const f=fixture(),config=env();delete config[key];const result=await f.observe({env:config});unavailable(result);assert.equal(f.calls.length,0);}
 for(const changes of [{NUMINA_RPC_URL:'https://attacker.invalid/'},{NUMINA_EXPECTED_CHAIN_ID:'1'},{NUMINA_DEPLOYER_ADDRESS:'0x'+'1'.repeat(40)},{NUMINA_RPC_AUTHORIZATION:'Basic upstream-secret\r\nInjected: true'},{NUMINA_RPC_AUTHORIZATION:'Bearer '+ 'x'.repeat(8193)}]){const f=fixture(),result=await f.observe({env:{...env(),...changes}});unavailable(result);assert.equal(f.calls.length,0);}
});
test('untrusted review fails before provider authentication and never substitutes a caller transaction',async()=>{
 const f=fixture(),result=await f.observe({reviewBytes:new TextEncoder().encode(JSON.stringify({...rawReview,constructorData:'0x00'})),data:'0x00',sender:'0x'+'1'.repeat(40),chainId:'1'});unavailable(result);assert.equal(f.calls.length,0);
});
test('native balance shortage is observed without pretending funding or deposit completion',async()=>{
 const f=fixture();f.balance='0x0';const result=await f.observe();assert.equal(result.httpStatus,200);assert.equal(result.body.balanceBaseUnits,'0');assert.equal(result.body.balanceSufficient,false);assert.equal(result.body.calculatedTotalBaseUnits,'42000');assert.equal(result.body.minted,false);assert.equal(result.body.receipt,null);
});
test('zero gas pricing is accepted while zero gas amount is rejected',async()=>{
 {const f=fixture();f.price='0x0';f.balance='0x0';const result=await f.observe();assert.equal(result.httpStatus,200);assert.equal(result.body.gasPrice,'0');assert.equal(result.body.calculatedTotalBaseUnits,'0');assert.equal(result.body.balanceSufficient,true);}
 {const f=fixture();f.gas='0x0';unavailable(await f.observe());}
});
test('exact fee arithmetic handles values above safe integers and rejects uint256 overflow',async()=>{
 {const f=fixture();f.gas='0x20000000000001';f.price='0x3';f.balance='0xffffffffffffffff';const result=await f.observe();assert.equal(result.httpStatus,200);assert.equal(result.body.calculatedTotalBaseUnits,'27021597764222979');}
 {const f=fixture();f.gas='0x'+'f'.repeat(64);f.price='0x2';unavailable(await f.observe());}
});
test('noncanonical, negative, numeric and overlarge provider quantities fail closed',async()=>{
 for(const field of ['gas','price','balance'])for(const value of [null,9007199254740992,'21000','0x','0x00','0x-1','0x1.1','0x'+'1'.repeat(65)]){const f=fixture();f[field]=value;unavailable(await f.observe());}
});
test('initial wrong chain or genesis prevents estimating and sending constructor data',async()=>{
 for(const changes of [{chain:'0x1'},{genesis:{number:'0x0',hash:'0x'+'1'.repeat(64)}},{genesis:{number:'0x1',hash:GENESIS}},{genesis:{number:'0x0'}},{genesis:null}]){const f=fixture();Object.assign(f,changes);unavailable(await f.observe());assert.equal(f.calls.some(call=>call.request.method==='eth_estimateGas'),false);}
});
test('chain or genesis changes after estimation invalidate every partial quote field',async()=>{
 for(const change of [f=>{f.chain='0x1';},f=>{f.genesis={number:'0x0',hash:'0x'+'2'.repeat(64)};}]){const f=fixture();f.hook=call=>{if(call.request.method==='eth_getBalance')change(f);};const result=await f.observe();unavailable(result);assert.equal(f.calls.some(call=>call.request.method==='eth_estimateGas'),true);}
});
test('provider authentication failures and arbitrary exceptions never leak secrets or provider details',async()=>{
 for(const status of [401,403,404,500]){const f=fixture();f.override=()=>response('upstream-secret',{status});unavailable(await f.observe());}
 const f=fixture();f.fetcher=async()=>{throw Error('upstream-secret '+secret);};const result=await observeDeploymentEstimate({env:env(),fetcher:f.fetcher,reviewBytes:bytes,now:()=>NOW});unavailable(result);assert.equal(JSON.stringify(result).includes(RPC),false);
});
test('redirected responses or an unexpected upstream response URL cannot produce a quote',async()=>{
 for(const options of [{redirected:true},{url:'https://attacker.invalid/'},{url:RPC+'?echo=upstream-secret'}]){const f=fixture();f.override=call=>response(JSON.stringify({jsonrpc:'2.0',id:call.request.id,result:f.chain}),options);unavailable(await f.observe());}
});
test('RPC envelope must have matching ID, JSON-RPC version, sole result and no error',async()=>{
 const envelopes=[id=>({jsonrpc:'1.0',id,result:'0x1'}),id=>({jsonrpc:'2.0',id:id+1,result:'0x1'}),id=>({jsonrpc:'2.0',id:String(id),result:'0x1'}),id=>({jsonrpc:'2.0',id,result:'0x1',extra:true}),id=>({jsonrpc:'2.0',id,error:{message:'upstream-secret'}}),id=>({jsonrpc:'2.0',id,result:'0x1',error:null}),id=>({jsonrpc:'2.0',id}),()=>[],()=>null];
 for(const envelope of envelopes){const f=fixture();f.override=call=>response(JSON.stringify(envelope(call.request.id)));unavailable(await f.observe());}
});
test('response media type, JSON syntax and UTF-8 are checked before accepting values',async()=>{
 for(const options of [{type:'text/html'},{type:'text/plain'},{type:'application/jsonp'}]){const f=fixture();f.override=call=>response(JSON.stringify({jsonrpc:'2.0',id:call.request.id,result:f.chain}),options);unavailable(await f.observe());}
 for(const body of ['not JSON upstream-secret',new Uint8Array([0xff,0xfe])]){const f=fixture();f.override=()=>response(body);unavailable(await f.observe());}
});
test('declared and streaming responses are capped at 128 KiB',async()=>{
 {const f=fixture();f.override=()=>response('{}',{headers:{'Content-Length':'131073'}});unavailable(await f.observe());}
 {const f=fixture();f.override=()=>response(new Uint8Array(131073));unavailable(await f.observe());}
 {const f=fixture();f.override=()=>response('{}',{headers:{'Content-Length':'not-an-integer'}});unavailable(await f.observe());}
});
test('deadline includes stalled response body and returns a bounded timeout without an estimate',async()=>{
 const f=fixture();f.override=call=>response(new ReadableStream({start(controller){call.options.signal.addEventListener('abort',()=>controller.error(Error('upstream-secret')),{once:true});}}));const result=await f.observe({timeoutMs:10});unavailable(result);assert.equal(result.httpStatus,504);assert.match(result.body.error.code,/TIMEOUT/);assert.equal(f.calls.length,1);
});
test('deadline actively cancels a body that ignores fetch abort without awaiting a stalled cancellation',async()=>{
 let cancellations=0;const f=fixture();f.override=()=>response(new ReadableStream({start(){},cancel(){cancellations++;return new Promise(()=>{});}}));
 const result=await f.observe({timeoutMs:10});unavailable(result);assert.equal(result.httpStatus,504);assert.equal(result.body.error.code,'RPC_TIMEOUT');await nextTurn();assert.equal(cancellations,1);assert.equal(f.calls.length,1);
});
test('provider requests that ignore abort cannot issue later RPCs after the observation timed out',async()=>{
 const f=fixture(),held=defer();f.override=()=>held.promise;const result=await f.observe({timeoutMs:10});unavailable(result);assert.equal(result.httpStatus,504);assert.equal(f.calls.length,1);
 held.resolve(response(JSON.stringify({jsonrpc:'2.0',id:1,result:f.chain})));await nextTurn();assert.equal(f.calls.length,1);
});
test('clock failures, time reversal and expiration cannot label an observation current',async()=>{
 for(const value of [NaN,Infinity,-1,Number.MAX_SAFE_INTEGER]){const f=fixture(),result=await f.observe({now:()=>value});unavailable(result);assert.equal(result.body.error.code,'CLOCK_INVALID');assert.equal(f.calls.length,0);}
 for(const end of [NOW-1,NOW+60000]){let reads=0;const f=fixture(),result=await f.observe({now:()=>reads++===0?NOW:end});unavailable(result);assert.equal(result.body.error.code,'CLOCK_INVALID');}
});
test('timeout injection cannot disable the deadline or exceed the production bound',async()=>{
 for(const timeoutMs of [0,-1,8001,Infinity,NaN,'8000']){const f=fixture(),result=await f.observe({timeoutMs});unavailable(result);assert.equal(result.httpStatus,503);assert.equal(f.calls.length,0);}
});

class ResponseMock extends EventEmitter{
 constructor(){super();this.headers={};this.statusCode=200;this.body='';this.writableFinished=false;}
 setHeader(name,value){this.headers[name.toLowerCase()]=String(value);}
 end(body){this.body=body??'';this.writableFinished=true;this.emit('finish');}
}
function request(changes={}){return {method:'GET',url:'/api/deployment-estimate',headers:{},query:{},...changes};}
test('HTTP endpoint invokes only its fixed observer for an empty GET and disables shared caching',async()=>{
 let calls=0;const observed={httpStatus:200,body:{schema:'numina.deployment-estimate.v1',status:'observed'}};
 const handler=createEstimateHandler({observe:async(...args)=>{calls++;assert.equal(args.length,0);return observed;}}),res=new ResponseMock();await handler(request(),res);
 assert.equal(calls,1);assert.equal(res.statusCode,200);assert.deepEqual(JSON.parse(res.body),observed.body);for(const header of ['cache-control','cdn-cache-control','vercel-cdn-cache-control'])assert.equal(res.headers[header],'no-store');assert.equal(res.headers['x-content-type-options'],'nosniff');
 assert.equal(res.headers['access-control-allow-origin'],undefined);
});
test('non-GET methods cannot trigger provider access; HEAD has no response body',async()=>{
 let calls=0;const handler=createEstimateHandler({observe:async()=>{calls++;throw Error('must not execute');}});
 for(const method of ['HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){const res=new ResponseMock();await handler(request({method}),res);assert.equal(res.statusCode,405,method);assert.equal(res.headers.allow,'GET');if(method==='HEAD')assert.equal(res.body,'');}
 assert.equal(calls,0);
});
test('simultaneous reads share one observation, and a subsequent request obtains a fresh observation',async()=>{
 let calls=0;const pending=defer();const handler=createEstimateHandler({observe:async()=>{calls++;return calls===1?pending.promise:{httpStatus:200,body:{observation:'second'}};}}),first=new ResponseMock(),second=new ResponseMock();
 const one=handler(request(),first),two=handler(request(),second);await nextTurn();assert.equal(calls,1);pending.resolve({httpStatus:200,body:{observation:'first'}});await Promise.all([one,two]);assert.deepEqual(JSON.parse(first.body),{observation:'first'});assert.equal(first.body,second.body);
 const third=new ResponseMock();await handler(request(),third);assert.equal(calls,2);assert.deepEqual(JSON.parse(third.body),{observation:'second'});
});
test('an observer exception is bounded, shared safely, and does not poison a later request',async()=>{
 let calls=0;const held=defer();const handler=createEstimateHandler({observe:async()=>{calls++;if(calls===1){await held.promise;throw Error('upstream-secret '+secret);}return {httpStatus:200,body:{status:'observed'}};}}),first=new ResponseMock(),second=new ResponseMock();
 const one=handler(request(),first),two=handler(request(),second);await nextTurn();held.resolve();await Promise.all([one,two]);assert.equal(calls,1);
 for(const res of [first,second]){assert.equal(res.statusCode,503);assert.equal(JSON.parse(res.body).error.code,'OBSERVATION_UNAVAILABLE');assert.equal(res.body.includes('upstream-secret'),false);assert.equal(res.body.includes(secret),false);}
 const retry=new ResponseMock();await handler(request(),retry);assert.equal(calls,2);assert.equal(retry.statusCode,200);
});
test('query values and request bodies are rejected rather than selecting a provider, account or transaction',async()=>{
 let calls=0;const handler=createEstimateHandler({observe:async()=>{calls++;throw Error('must not execute');}});
 const variants=[{url:'/api/deployment-estimate?method=eth_sendTransaction'},{query:{method:'eth_sendTransaction'}},{query:{chainId:'1'}},{body:{from:'0x'+'1'.repeat(40),data:'0x00'}},{body:'0x00'},{headers:{'content-length':'1'}},{headers:{'transfer-encoding':'chunked'}}];
 for(const changes of variants){const res=new ResponseMock();await handler(request(changes),res);assert.equal(res.statusCode,400,JSON.stringify(changes));}
 assert.equal(calls,0);
});
