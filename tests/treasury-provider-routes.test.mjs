import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {controlHash} from '../src/control.js';
import {readStripeProviderRoutes,STRIPE_TREASURY_FINANCIAL_ACCOUNT,TREASURY_PROVIDER_ROUTES} from '../src/stripe-treasury.js';
import worker from '../src/worker.js';

// Isolated provider fixtures and SQLite only. No provider connection or real key is used.
const readKey='rk_live_'+'synthetic'.repeat(4),canary='PRIVATE_BANK_DETAIL_MUST_NOT_ESCAPE_86132';
const owner='email:owner@example.test',ownerKey='local-provider-routes-owner-key';
const accountUrl='https://api.stripe.com/v2/money_management/financial_accounts/'+STRIPE_TREASURY_FINANCIAL_ACCOUNT;
const addressesUrl='https://api.stripe.com/v2/money_management/financial_addresses?financial_account='+STRIPE_TREASURY_FINANCIAL_ACCOUNT+'&limit=50';
const identity=email=>({'oai-authenticated-user-id':'fixture-user','oai-authenticated-user-email':email});
const config=()=>({NUMINA_STRIPE_TREASURY_READ_KEY:readKey,NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:STRIPE_TREASURY_FINANCIAL_ACCOUNT});
function account(){return {id:STRIPE_TREASURY_FINANCIAL_ACCOUNT,object:'v2.money_management.financial_account',display_name:'Fixture account',status:'open',type:'storage',livemode:true,balance:{available:{usd:{value:0,currency:'usd'},usdc:{value:0,currency:'usdc'}}}};}
function address(){return {id:'finaddr_fixture1',object:'v2.money_management.financial_address',financial_account:STRIPE_TREASURY_FINANCIAL_ACCOUNT,livemode:true,status:'active',currency:'usdc',settlement_currency:'usdc',credentials:{type:'crypto_wallet',crypto_wallet:{address:'0x1111111111111111111111111111111111111111',network:'base',memo:null}},metadata:{secret:canary}};}
const page=()=>({data:[address()],next_page_url:null});
const response=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});
function provider({financialAccount=account(),routes=page(),addressResponse}={}){const calls=[];return {calls,fetcher:async(url,options)=>{calls.push({url:String(url),options});assert.ok([accountUrl,addressesUrl].includes(String(url)),'provider URL must be pinned');return String(url)===accountUrl?response(financialAccount):addressResponse?addressResponse():response(routes,200,{'request-id':'req_routes_fixture'});}};}
function safe(value){const text=typeof value==='string'?value:JSON.stringify(value);assert.equal(text.includes(readKey),false);assert.equal(text.includes(canary),false);}
async function rejects(promise,code,status){await assert.rejects(promise,error=>{assert.equal(error.code,code);assert.equal(error.status,status);safe(String(error));safe(error);return true;});}
async function fixture(){const DB=database();await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));return {...config(),DB,NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(ownerKey),NUMINA_TELEMETRY_LOGS:'false'};}
const request=({method='GET',headers={Authorization:'Bearer '+ownerKey},query=''}={})=>new Request('https://numina.test'+TREASURY_PROVIDER_ROUTES+query,{method,headers});

test('provider routes use two pinned read-only GETs and expose only sanitized destination details',async()=>{
 const routes=page();routes.data.push({...address(),id:'finaddr_bank',credentials:{type:'us_bank_account',us_bank_account:{account_number:canary,routing_number:canary}}});routes.private_bank_details=canary;
 const mock=provider({routes}),result=await readStripeProviderRoutes(config(),mock);
 assert.deepEqual(mock.calls.map(call=>call.url),[accountUrl,addressesUrl]);
 for(const {options} of mock.calls){const headers=new Headers(options.headers);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.body,undefined);assert.equal(headers.get('Authorization'),'Bearer '+readKey);assert.equal(headers.get('Stripe-Version'),'2026-08-26.preview');assert.equal(headers.get('Cache-Control'),'no-store');assert.equal(headers.get('Cookie'),null);assert.equal(headers.get('oai-authenticated-user-email'),null);assert.equal(Object.hasOwn(options,'cache'),false);}
 assert.equal(result.schema,'numina.treasury.provider-routes.v1');assert.equal(result.connection,'read_only');assert.equal(result.complete,true);assert.equal(result.excluded_non_crypto_records,1);assert.equal(result.provider_request_id,'req_routes_fixture');
 assert.equal(result.identity,'NUMINA');assert.equal(result.treasuryIdentity,'NUMINA');assert.equal(result.provider,'NUMINA');assert.equal(result.transportProvider,'Stripe');
 assert.equal(result.backingVerified,false);assert.equal(result.nativeModel.scope,'NUMINA_INTERNAL_SOFTWARE_STATE');assert.equal(result.settlement_performed,false);
 assert.deepEqual(result.routes,[{id:'finaddr_fixture1',currency:'usdc',settlement_currency:'usdc',status:'active',network:'base',address:address().credentials.crypto_wallet.address,memo:null,provider_reported_active:true}]);
 assert.equal(result.nusd.status,'NOT_REPORTED');assert.equal(result.nusd.provider_acceptance_verified,false);assert.equal(result.canonical_treasury,'/api/control/v1/treasury');assert.equal(result.transfer_execution,false);assert.equal(result.submission_performed,false);assert.equal(result.receipt,null);safe(result);
});

test('missing or unpinned configuration makes no provider request',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw Error('Unexpected provider request');};
 for(const env of [{},{...config(),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:'fa_other'},{...config(),NUMINA_STRIPE_TREASURY_READ_KEY:'rk_test_'+'x'.repeat(30)},{...config(),NUMINA_STRIPE_TREASURY_READ_KEY:readKey+'\r\nInjected: true'}])await rejects(readStripeProviderRoutes(env,{fetcher}),'STRIPE_TREASURY_NOT_CONNECTED',503);
 assert.equal(calls,0);
});

test('invalid, mismatched and non-live accounts stop before reading destinations',async()=>{
 for(const change of [{id:'fa_other'},{livemode:false},{object:'owner.assertion'},{status:'invented'}]){const mock=provider({financialAccount:{...account(),...change}});await rejects(readStripeProviderRoutes(config(),mock),'STRIPE_TREASURY_INVALID_RESPONSE',502);assert.deepEqual(mock.calls.map(call=>call.url),[accountUrl]);}
});

test('malformed FinancialAddress records fail closed without leaking any bank detail',async()=>{
 const records=[null,{}, {...address(),id:'not_an_address'},{...address(),financial_account:'fa_other'},{...address(),livemode:false},{...address(),object:'owner.acceptance'},{...address(),status:'invented'},{...address(),currency:'USDC'},{...address(),settlement_currency:canary}];
 for(const change of [{address:'https://evil.test/'+canary},{network:'https://evil.test'},{memo:'private\n'+canary},{address:null},{network:null},{memo:undefined}])records.push({...address(),credentials:{type:'crypto_wallet',crypto_wallet:{...address().credentials.crypto_wallet,...change}}});
 records.push({...address(),credentials:{type:'crypto_wallet',crypto_wallet:null}});
 for(const item of records){const mock=provider({routes:{data:[item],next_page_url:null}});await rejects(readStripeProviderRoutes(config(),mock),'STRIPE_PROVIDER_ROUTES_INVALID_RESPONSE',502);assert.equal(mock.calls.length,2);}
});

test('invalid page envelopes and duplicate destination IDs are rejected',async()=>{
 for(const routes of [null,[],{}, {data:[],next_page_url:''},{data:[],next_page_url:3},{data:[]},{data:{},next_page_url:null},{data:[address(),address()],next_page_url:null},{data:Array.from({length:51},(_,i)=>({...address(),id:'finaddr_'+i})),next_page_url:null}])await rejects(readStripeProviderRoutes(config(),provider({routes})),'STRIPE_PROVIDER_ROUTES_INVALID_RESPONSE',502);
});

test('closed accounts and non-active destinations cannot advertise an active route',async()=>{
 for(const accountStatus of ['open','closed']){const routes=page();routes.data=['active','archived','failed','pending'].map((status,i)=>({...address(),id:'finaddr_status'+i,status}));const result=await readStripeProviderRoutes(config(),provider({financialAccount:{...account(),status:accountStatus},routes}));assert.equal(result.account_status,accountStatus);for(const route of result.routes)assert.equal(route.provider_reported_active,accountStatus==='open'&&route.status==='active');assert.equal(result.nusd.provider_acceptance_verified,false);}
});

test('pagination stays explicitly incomplete and no provider pagination URL is followed',async()=>{
 const mock=provider({routes:{data:[address()],next_page_url:'https://evil.test/'+canary}}),result=await readStripeProviderRoutes(config(),mock);
 assert.equal(result.complete,false);assert.equal(result.nusd.status,'OBSERVATION_INCOMPLETE');assert.equal(result.nusd.provider_acceptance_verified,false);assert.equal(result.routes.length,1);assert.deepEqual(mock.calls.map(call=>call.url),[accountUrl,addressesUrl]);safe(result);
});

test('missing and unknown credential types make route absence inconclusive',async()=>{
 for(const credentials of [null,undefined,{},'crypto_wallet',{type:'future_wallet',private_details:canary}]){
  const record={...address(),credentials},result=await readStripeProviderRoutes(config(),provider({routes:{data:[record],next_page_url:null}}));
  assert.equal(result.complete,false);assert.equal(result.unclassified_records,1);assert.equal(result.excluded_non_crypto_records,0);assert.equal(result.routes.length,0);assert.equal(result.nusd.status,'OBSERVATION_INCOMPLETE');assert.equal(result.nusd.provider_acceptance_verified,false);safe(result);
 }
});

test('an NUSD label without destination credentials remains an unverified asset observation',async()=>{
 const record={...address(),currency:'nusd',credentials:null},result=await readStripeProviderRoutes(config(),provider({routes:{data:[record],next_page_url:null}}));
 assert.equal(result.complete,false);assert.equal(result.unclassified_records,1);assert.equal(result.routes.length,0);assert.equal(result.nusd.status,'ASSET_IDENTITY_NOT_VERIFIED');assert.equal(result.nusd.provider_acceptance_verified,false);assert.equal(result.transfer_execution,false);assert.equal(result.submission_performed,false);
});

test('recognized bank credentials stay excluded without exposing their private fields',async()=>{
 const routes={data:['us_bank_account','gb_bank_account'].map((type,i)=>({...address(),id:'finaddr_bank'+i,currency:'usd',settlement_currency:'usd',credentials:{type,[type]:{account_number:canary,routing_number:canary,sort_code:canary}}})),next_page_url:null};
 const result=await readStripeProviderRoutes(config(),provider({routes}));assert.equal(result.complete,true);assert.equal(result.excluded_non_crypto_records,2);assert.equal(result.unclassified_records,0);assert.equal(result.routes.length,0);assert.equal(result.nusd.status,'NOT_REPORTED');safe(result);
});

test('a provider-reported NUSD currency or settlement label never establishes verified token acceptance',async()=>{
 for(const complete of [true,false]){const routes={data:[{...address(),currency:'nusd',settlement_currency:'nusd',provider_acceptance_verified:true,tokenIdentityVerified:true}],next_page_url:complete?null:'https://api.stripe.com/next'};const result=await readStripeProviderRoutes(config(),provider({routes}));assert.equal(result.nusd.status,'ASSET_IDENTITY_NOT_VERIFIED');assert.equal(result.nusd.provider_acceptance_verified,false);assert.equal(result.routes[0].currency,'nusd');assert.equal(result.routes[0].settlement_currency,'nusd');assert.equal(Object.hasOwn(result.routes[0],'provider_acceptance_verified'),false);assert.equal(result.transfer_execution,false);assert.equal(result.submission_performed,false);assert.equal(result.receipt,null);}
 const result=await readStripeProviderRoutes(config(),provider({routes:{data:[{...address(),settlement_currency:'nusd'}],next_page_url:null}}));assert.equal(result.routes[0].currency,'usdc');assert.equal(result.routes[0].settlement_currency,'nusd');assert.equal(result.nusd.provider_acceptance_verified,false);
});

test('destination redirects, HTTP failures and thrown errors remain unavailable and sanitized',async()=>{
 for(const status of [301,302,307,401,404,429,500,503]){const mock=provider({addressResponse:()=>response({error:{message:canary+' '+readKey}},status,{Location:'https://evil.test/steal'})});await rejects(readStripeProviderRoutes(config(),mock),'STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);assert.deepEqual(mock.calls.map(call=>call.url),[accountUrl,addressesUrl]);}
 for(const status of [200,403]){const redirected=provider({addressResponse:()=>{const value=response(page(),status);Object.defineProperty(value,'redirected',{value:true});return value;}});await rejects(readStripeProviderRoutes(config(),redirected),'STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);}
 await rejects(readStripeProviderRoutes(config(),provider({addressResponse:()=>{throw Error(canary+' '+readKey);}})),'STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);
});

test('provider access denial is a sanitized service failure with only safe diagnostic fields',async t=>{
 const logs=[];t.mock.method(console,'log',value=>logs.push(JSON.parse(value)));
 const mock=provider({addressResponse:()=>response({error:{message:canary+' '+readKey}},403,{'request-id':'req_routes_denied_fixture'})});
 await rejects(readStripeProviderRoutes(config(),mock),'STRIPE_PROVIDER_ROUTES_ACCESS_DENIED',503);
 assert.deepEqual(mock.calls.map(call=>call.url),[accountUrl,addressesUrl]);
 assert.deepEqual(logs,[{event:'stripe_provider_routes_provider_error',http_status:403,request_id:'req_routes_denied_fixture'}]);safe(logs);
});

test('provider error logs reject malformed or oversized request IDs without recording response bodies',async t=>{
 const logs=[];t.mock.method(console,'log',value=>logs.push(JSON.parse(value)));
 for(const requestId of ['unsafe request '+canary,'https://example.test/'+canary,'x'.repeat(101)]){
  const mock=provider({addressResponse:()=>response({error:{message:canary+' '+readKey}},500,{'request-id':requestId})});
  await rejects(readStripeProviderRoutes(config(),mock),'STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);
 }
 assert.equal(logs.length,3);for(const log of logs)assert.deepEqual(log,{event:'stripe_provider_routes_provider_error',http_status:500,request_id:null});safe(logs);
});

test('provider fetch exceptions log categories and allowlisted names without raw messages',async t=>{
 const logs=[];t.mock.method(console,'log',value=>logs.push(JSON.parse(value)));
 const failures=[[new TypeError('fetch failed '+canary+' '+readKey),'network_failure','TypeError'],[{name:canary,message:canary+' '+readKey},'unclassified','OtherError']];
 for(const [failure] of failures)await rejects(readStripeProviderRoutes(config(),provider({addressResponse:()=>{throw failure;}})),'STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);
 assert.equal(logs.length,2);
 for(let i=0;i<logs.length;i++){const log=logs[i];assert.equal(log.event,'stripe_provider_routes_runtime_error');assert.equal(log.stage,'fetch_pending');assert.equal(log.category,failures[i][1]);assert.equal(log.error_name,failures[i][2]);assert.ok(Object.keys(log).every(key=>['event','stage','response_received','category','error_name'].includes(key)));assert.equal(Object.hasOwn(log,'message'),false);}
 safe(logs);
});

test('diagnostic logging failure never replaces sanitized provider errors',async t=>{
 t.mock.method(console,'log',()=>{throw Error(canary+' '+readKey);});
 await rejects(readStripeProviderRoutes(config(),provider({addressResponse:()=>response({error:{message:canary}},403)})),'STRIPE_PROVIDER_ROUTES_ACCESS_DENIED',503);
 await rejects(readStripeProviderRoutes(config(),provider({addressResponse:()=>{throw Error('fetch failed '+canary);}})),'STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);
});

test('upstream 403 becomes HTTP 503 while the owner credential and treasury journal remain valid',async t=>{
 const env=await fixture();let denied=true;const mock=provider({addressResponse:()=>denied?response({error:{message:canary+' '+readKey}},403,{'request-id':'req_owner_denied_fixture'}):response(page())});t.mock.method(globalThis,'fetch',mock.fetcher);
 try{
  const before=await readControl(env.DB),failed=await worker.fetch(request(),env);assert.equal(failed.status,503);assert.equal(failed.headers.get('Cache-Control'),'private, no-store');const body=await failed.json();assert.equal(body.error,'STRIPE_PROVIDER_ROUTES_ACCESS_DENIED');safe(body);
  denied=false;const recovered=await worker.fetch(request(),env);assert.equal(recovered.status,200);assert.equal((await recovered.json()).nusd.provider_acceptance_verified,false);assert.equal(mock.calls.length,4);
  const after=await readControl(env.DB);assert.equal(after.head_hash,before.head_hash);assert.equal(after.revision,before.revision);assert.equal(after.eventCount,before.eventCount);
 }finally{env.DB.close();}
});

test('malformed, oversized, invalid UTF-8 and absent response bodies cannot become route observations',async()=>{
 const bodies=[()=>new Response('<html>'+canary+'</html>'),()=>response({...page(),unknown:'x'.repeat(65537)}),()=>new Response(new Uint8Array([0xff,0xfe,0xfd])),()=>new Response(null)];
 for(const addressResponse of bodies)await rejects(readStripeProviderRoutes(config(),provider({addressResponse})),'STRIPE_TREASURY_INVALID_RESPONSE',502);
});

test('the shared provider deadline aborts a stalled destination request', {timeout:2000},async()=>{
 let signal,calls=0;
 await rejects(readStripeProviderRoutes(config(),{timeoutMs:30,fetcher:async(url,options)=>{calls++;if(String(url)===accountUrl)return response(account());signal=options.signal;return new Promise(()=>{});}}),'STRIPE_TREASURY_TIMEOUT',504);
 assert.equal(calls,2);assert.equal(signal.aborted,true);
});

test('the shared provider deadline remains active during destination body streaming', {timeout:2000},async()=>{
 let signal,streamController;
 const body=new ReadableStream({start(controller){streamController=controller;controller.enqueue(new TextEncoder().encode('{"data":['));}});
 try{await rejects(readStripeProviderRoutes(config(),{timeoutMs:30,fetcher:async(url,options)=>{if(String(url)===accountUrl)return response(account());signal=options.signal;return new Response(body);}}),'STRIPE_TREASURY_TIMEOUT',504);assert.equal(signal.aborted,true);}
 finally{try{streamController.error(Error('Local test cleanup'));}catch{}}
});

test('HTTP authentication, owner, origin, query and method rejection occurs before provider access',async t=>{
 const env=await fixture();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Unexpected provider request');});
 try{
  const before=await readControl(env.DB);
  const invalid=[[{headers:{}},401],[{headers:{Authorization:'Bearer invalid'}},401],[{headers:identity('delegate@example.test')},403],[{headers:{Authorization:'Bearer '+ownerKey,Origin:'https://other.test'}},403],[{headers:{...identity('owner@example.test'),Origin:'https://other.test'}},403],[{query:'?accepted=true'},400],[{query:'?financial_account=fa_other'},400],[{query:'?url=https://evil.test'},400],...['POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(method=>[{method},405])];
  for(const [options,status] of invalid){const result=await worker.fetch(request(options),env);assert.equal(result.status,status,JSON.stringify(options));assert.equal(result.headers.get('Cache-Control'),'private, no-store');safe(await result.text());}
  assert.equal((await worker.fetch(request(),{...env,NUMINA_CONTROL_OWNER:'email:different@example.test'})).status,503);
  assert.equal((await worker.fetch(request(),{...env,NUMINA_STRIPE_TREASURY_READ_KEY:undefined})).status,503);assert.equal(calls,0);
  const after=await readControl(env.DB);assert.equal(after.state_hash,before.state_hash);assert.equal(after.head_hash,before.head_hash);assert.equal(after.revision,before.revision);assert.equal(after.eventCount,before.eventCount);
 }finally{env.DB.close();}
});

test('owner HTTP reads remain private and never initialize or mutate the canonical treasury journal',async t=>{
 const env=await fixture(),mock=provider();t.mock.method(globalThis,'fetch',mock.fetcher);
 try{
  const before=await readControl(env.DB);
  for(const headers of [{Authorization:'Bearer '+ownerKey},identity('owner@example.test'),{...identity('owner@example.test'),Origin:'https://numina.test'}]){
   const result=await worker.fetch(request({headers}),env);assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(result.headers.get('Vary'),'Authorization, Cookie');assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');const value=await result.json();assert.equal(value.nusd.provider_acceptance_verified,false);assert.equal(value.submission_performed,false);assert.equal(value.receipt,null);safe(value);
  }
  assert.equal(mock.calls.length,6);const after=await readControl(env.DB);assert.equal(after.state_hash,before.state_hash);assert.equal(after.head_hash,before.head_hash);assert.equal(after.revision,before.revision);assert.equal(after.eventCount,before.eventCount);
  const treasury=await worker.fetch(new Request('https://numina.test/api/control/v1/treasury',{headers:{Authorization:'Bearer '+ownerKey}}),env);assert.equal((await treasury.json()).status,'NOT_INITIALIZED');assert.equal(mock.calls.length,6);
 }finally{env.DB.close();}
});

test('public routing descriptor and owner MCP point to the same read-only provider route',async t=>{
 const env=await fixture(),mock=provider();t.mock.method(globalThis,'fetch',mock.fetcher);
 try{
  const publicResponse=await worker.fetch(new Request('https://numina.test/api/nusd/v1/provider-routing'),env);
  assert.equal(publicResponse.status,200);const descriptor=await publicResponse.json();
  assert.equal(descriptor.route,TREASURY_PROVIDER_ROUTES);assert.equal(descriptor.nusdAcceptanceVerified,false);assert.equal(descriptor.transferExecution,false);
  assert.equal(JSON.stringify(descriptor).includes(STRIPE_TREASURY_FINANCIAL_ACCOUNT),false);
  const rpc=async(name,args)=>worker.fetch(new Request('https://numina.test/api/control/v2/mcp',{method:'POST',headers:{Authorization:'Bearer '+ownerKey,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);
  let result=await (await rpc('numina_provider_routes',{})).json();assert.equal(result.result.isError,false);
  const record=JSON.parse(result.result.content[0].text);assert.equal(record.schema,'numina.treasury.provider-routes.v1');assert.equal(record.nusd.provider_acceptance_verified,false);assert.equal(mock.calls.length,2);
  result=await (await rpc('numina_provider_routes',{verified:true})).json();assert.equal(result.result.isError,true);assert.equal(mock.calls.length,2);
 }finally{env.DB.close();}
});
