import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl,commitControl} from '../src/control-store.js';
import {controlHash} from '../src/control.js';
import {readStripeTreasury,STRIPE_TREASURY_ACCOUNT,STRIPE_TREASURY_FINANCIAL_ACCOUNT} from '../src/stripe-treasury.js';
import worker from '../src/worker.js';

// Local fixtures only: no Stripe request or real API key is used by this file.
const readKey=('rk_live_' + 'synthetic'.repeat(4));
const owner='email:owner@example.test',ownerKey='local-treasury-owner-test-key';
const endpoint='https://numina.test/api/control/v1/stripe-treasury';
const canary='PRIVATE_PROVIDER_FIELD_MUST_NOT_ESCAPE_49317';
const identity=email=>({'oai-authenticated-user-id':'local-fixture-user','oai-authenticated-user-email':email});
const ownerHeaders=identity('owner@example.test');
const config=()=>({NUMINA_STRIPE_TREASURY_READ_KEY:readKey,NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:STRIPE_TREASURY_FINANCIAL_ACCOUNT});
const amount=(currency,value)=>({currency,value});
function financialAccount(){return {
 id:STRIPE_TREASURY_FINANCIAL_ACCOUNT,object:'v2.money_management.financial_account',display_name:'Local fixture financial account',status:'open',type:'storage',livemode:true,
 balance:{available:{usd:amount('usd',0),usdc:amount('usdc',0)},inbound_pending:{usd:amount('usd',0),usdc:amount('usdc',0)},outbound_pending:{usd:amount('usd',0),usdc:amount('usdc',0)}},
 metadata:{secret:canary},financial_addresses:[{account_number:canary}],unrelated_provider_field:canary
};}
function providerResponse(value=financialAccount(),status=200,headers={}){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json',...headers}});}
function numericText(formatted){assert.equal(typeof formatted,'string');const match=formatted.replace(/[$,]/g,'').match(/-?\d+(?:\.\d+)?/);assert.ok(match,'formatted amount must contain a number');return match[0];}
function assertSafe(value){const text=typeof value==='string'?value:JSON.stringify(value);assert.equal(text.includes(readKey),false);assert.equal(text.includes(canary),false);}
async function rejectsWith(promise,code,status){await assert.rejects(promise,error=>{assert.equal(error.code,code);assert.equal(error.status,status);assertSafe(String(error));assertSafe(error);return true;});}
async function fixture(){const DB=database();await bootstrapControl(DB,owner,Math.floor(Date.now()/1000));return {...config(),DB,NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(ownerKey)};}
function routeRequest(headers=ownerHeaders,method='GET'){return new Request(endpoint,{method,headers:{...headers,...(method==='POST'?{Origin:'https://numina.test'}:{})}});}

test('Treasury read is one pinned GET and returns a sanitized read-only projection',async()=>{
 const requests=[];
 const result=await readStripeTreasury(config(),{fetcher:async(url,options)=>{requests.push({url:String(url),options});return providerResponse();}});
 assert.equal(requests.length,1);
 const [{url,options}]=requests,headers=new Headers(options.headers);
 assert.equal(url,'https://api.stripe.com/v2/money_management/financial_accounts/'+STRIPE_TREASURY_FINANCIAL_ACCOUNT);
 assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.body,undefined);
 assert.equal(headers.get('Authorization'),'Bearer '+readKey);assert.equal(headers.get('Stripe-Version'),'2026-08-26.preview');
 assert.equal(headers.has('Cookie'),false);assert.equal(headers.has('oai-authenticated-user-email'),false);
 assert.equal(result.schema,'numina.stripe.treasury.v1');assert.equal(result.connection,'read_only');
 assert.equal(result.identity,'NUMINA');assert.equal(result.treasuryIdentity,'NUMINA');assert.equal(result.provider,'NUMINA');assert.equal(result.transportProvider,'Stripe');
 assert.equal(result.backingVerified,true);assert.equal(result.nativeEvidenceStatus,'FINAL');assert.equal(result.nativeModel.scope,'NUMINA_MANIFEST_FINAL');
 assert.equal(result.submission_performed,false);assert.equal(result.settlement_performed,false);assert.equal(result.receipt,null);
 assert.equal(result.account.id,STRIPE_TREASURY_FINANCIAL_ACCOUNT);assert.equal(result.account.name,'Local fixture financial account');assert.equal(result.account.status,'open');assert.equal(result.account.livemode,true);
 assert.equal(result.transfer_execution,false);assert.equal(result.nusd_settlement,false);assertSafe(result);
 assert.equal(Object.hasOwn(result.account,'metadata'),false);assert.equal(Object.hasOwn(result,'financial_addresses'),false);
 assert.match(STRIPE_TREASURY_ACCOUNT,/^acct_[A-Za-z0-9]+$/);
});

test('Treasury reads work on managed Workers without RequestInit cache support',async()=>{
 const result=await readStripeTreasury(config(),{fetcher:async(url,options)=>{
  if('cache' in options)throw new TypeError("The 'cache' field on 'RequestInitializerDict' is not implemented.");
  const headers=new Headers(options.headers);assert.equal(headers.get('Cache-Control'),'no-store');
  return providerResponse();
 }});
 assert.equal(result.connection,'read_only');assert.equal(result.balances.available.usd.value,0);
});

test('the default Treasury reader preserves the host fetch receiver',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async function(url,options){assert.equal(this,globalThis);calls++;assert.equal(options.method,'GET');return providerResponse();};
 try{const result=await readStripeTreasury(config());assert.equal(result.balances.available.usd.value,0);assert.equal(calls,1);}
 finally{globalThis.fetch=original;}
});

test('runtime diagnostics reveal only predefined categories and never provider details or credentials',async()=>{
 const original=console.log,logs=[];console.log=value=>logs.push(JSON.parse(value));
 try{
  await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>{throw new TypeError('Illegal invocation '+canary+' '+readKey);}}),'STRIPE_TREASURY_UNAVAILABLE',503);
  await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>{throw {name:canary,message:readKey+' '+canary};}}),'STRIPE_TREASURY_UNAVAILABLE',503);
 }finally{console.log=original;}
 assert.equal(logs.length,2);assertSafe(logs);
 assert.deepEqual(logs[0],{event:'stripe_treasury_runtime_error',stage:'fetch_pending',response_received:false,category:'invalid_receiver',error_name:'TypeError'});
 assert.deepEqual(logs[1],{event:'stripe_treasury_runtime_error',stage:'fetch_pending',response_received:false,category:'unclassified',error_name:'OtherError'});
});

test('diagnostic logging failures preserve the sanitized provider outcome',async()=>{
 const original=console.log;console.log=()=>{throw new Error(canary+' '+readKey);};
 try{
  await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>providerResponse({error:{message:canary}},403)}),'STRIPE_TREASURY_UNAVAILABLE',503);
  await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>{throw new Error(canary);}}),'STRIPE_TREASURY_UNAVAILABLE',503);
 }finally{console.log=original;}
});

test('Treasury balances preserve zero, distinguish missing values and use USD cents versus USDC millionths',async()=>{
 const account=financialAccount();
 account.balance={available:{usd:amount('usd',12345),usdc:amount('usdc',1234567)},inbound_pending:{usd:amount('usd',0)},outbound_pending:{usdc:amount('usdc',0)}};
 const result=await readStripeTreasury(config(),{fetcher:async()=>providerResponse(account)});
 assert.equal(result.balances.available.usd.value,12345);assert.equal(result.balances.available.usd.currency,'usd');assert.equal(numericText(result.balances.available.usd.formatted),'123.45');
 assert.equal(result.balances.available.usdc.value,1234567);assert.equal(result.balances.available.usdc.currency,'usdc');assert.equal(numericText(result.balances.available.usdc.formatted),'1.234567');
 assert.equal(result.balances.inbound_pending.usd.value,0);assert.equal(Number(numericText(result.balances.inbound_pending.usd.formatted)),0);assert.equal(result.balances.inbound_pending.usdc,null);
 assert.equal(result.balances.outbound_pending.usd,null);assert.equal(result.balances.outbound_pending.usdc.value,0);
 const missing=financialAccount();missing.balance={available:{},inbound_pending:{},outbound_pending:{}};
 const empty=await readStripeTreasury(config(),{fetcher:async()=>providerResponse(missing)});
 for(const subtotal of ['available','inbound_pending','outbound_pending'])assert.deepEqual(empty.balances[subtotal],{usd:null,usdc:null});
});

test('Treasury negative balances retain their sign and are not converted into spendable positive funds',async()=>{
 const account=financialAccount();account.balance.available={usd:amount('usd',-101),usdc:amount('usdc',-1000001)};
 const result=await readStripeTreasury(config(),{fetcher:async()=>providerResponse(account)});
 assert.equal(result.balances.available.usd.value,-101);assert.equal(numericText(result.balances.available.usd.formatted),'-1.01');
 assert.equal(result.balances.available.usdc.value,-1000001);assert.equal(numericText(result.balances.available.usdc.formatted),'-1.000001');
 assert.equal(result.transfer_execution,false);assert.equal(result.nusd_settlement,false);
});

test('missing, unsafe or unpinned Treasury configuration never contacts a provider',async()=>{
 let calls=0;const fetcher=async()=>{calls++;throw new Error('Unexpected provider request');};
 const invalid=[{}, {...config(),NUMINA_STRIPE_TREASURY_READ_KEY:undefined}, {...config(),NUMINA_STRIPE_TREASURY_READ_KEY:'sk_live_00000000000000000000'}, {...config(),NUMINA_STRIPE_TREASURY_READ_KEY:'rk_test_00000000000000000000'}, {...config(),NUMINA_STRIPE_TREASURY_READ_KEY:'rk_live_short'}, {...config(),NUMINA_STRIPE_TREASURY_READ_KEY:readKey+'\r\nX-Injected: value'}, {...config(),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:undefined}, {...config(),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:'fa_differentaccount'}, {...config(),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:'fa_test_fixture'}, {...config(),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:'https://evil.example/steal'}];
 for(const env of invalid)await rejectsWith(readStripeTreasury(env,{fetcher}),'STRIPE_TREASURY_NOT_CONNECTED',503);
 assert.equal(calls,0);
});

test('malformed or non-live FinancialAccounts fail without exposing provider fields',async()=>{
 const cases=[null,[],{...financialAccount(),id:'fa_differentaccount'},{...financialAccount(),object:'treasury.financial_account'},{...financialAccount(),livemode:false},{...financialAccount(),type:'payments'},{...financialAccount(),status:'invented'},{...financialAccount(),balance:[]},{...financialAccount(),balance:{available:[]}}];
 for(const malformed of [{currency:'usd',value:1.25},{currency:'usd',value:'100'},{currency:'usd',value:'9007199254740993'},{currency:'usdc',value:100},{currency:'usd',value:null}]){const account=financialAccount();account.balance.available.usd=malformed;cases.push(account);}
 for(const account of cases)await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>providerResponse(account)}),'STRIPE_TREASURY_INVALID_RESPONSE',502);
 await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>new Response('<html>'+canary+'</html>',{headers:{'Content-Type':'application/json'}})}),'STRIPE_TREASURY_INVALID_RESPONSE',502);
 await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>providerResponse({...financialAccount(),oversized:'x'.repeat(65537)})}),'STRIPE_TREASURY_INVALID_RESPONSE',502);
});

test('raw Treasury JSON rejects fractions, exponents, negative zero and oversized integers',async()=>{
 // Replace a quoted placeholder so JavaScript cannot round the fixture first.
 const account=financialAccount();account.balance.available.usd.value='RAW_AMOUNT_TOKEN';
 const template=JSON.stringify(account);
 const invalidTokens=['9007199254740991.4','-9007199254740991.4','1.000000000000000000000000000000000001','0.'+'0'.repeat(330)+'1','1e-400','9'.repeat(79),'-0','1.0','1e0'];
 for(const token of invalidTokens){
  const raw=template.replace('"RAW_AMOUNT_TOKEN"',token);
  await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>new Response(raw,{headers:{'Content-Type':'application/json'}})}),'STRIPE_TREASURY_INVALID_RESPONSE',502);
 }
 const unknownNumeric=JSON.stringify({...financialAccount(),unknown_provider_numeric:1.25});
 await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>new Response(unknownNumeric,{headers:{'Content-Type':'application/json'}})}),'STRIPE_TREASURY_INVALID_RESPONSE',502);
});

test('Treasury raw-number validation preserves safe integer boundaries and treats account names as text',async()=>{
 const account=financialAccount();
 account.display_name='Local "9.25e+40" \\ 9007199254740991.4 / 1.0000000000000001 / 1e-400';
 account.balance.available={usd:amount('usd',Number.MAX_SAFE_INTEGER),usdc:amount('usdc',-Number.MAX_SAFE_INTEGER)};
 const result=await readStripeTreasury(config(),{fetcher:async()=>providerResponse(account)});
 assert.equal(result.account.name,account.display_name);
 assert.equal(result.balances.available.usd.value,Number.MAX_SAFE_INTEGER);assert.equal(numericText(result.balances.available.usd.formatted),'90071992547409.91');
 assert.equal(result.balances.available.usdc.value,-Number.MAX_SAFE_INTEGER);assert.equal(numericText(result.balances.available.usdc.formatted),'-9007199254.740991');
 assert.equal(result.transfer_execution,false);assert.equal(result.nusd_settlement,false);
});

test('raw large provider amounts retain every minor unit, currency and sign',async()=>{
 const fixture=financialAccount();fixture.balance.available.usd.value='RAW_USD';fixture.balance.available.usdc.value='RAW_USDC';
 fixture.balance.inbound_pending.nusd={currency:'nusd',value:'RAW_NUSD'};
 const raw=JSON.stringify(fixture).replace('"RAW_USD"','50000000000000000').replace('"RAW_USDC"','500000000000000000000').replace('"RAW_NUSD"','9007199254740993');
 const result=await readStripeTreasury(config(),{fetcher:async()=>new Response(raw)});
 assert.deepEqual(result.balances.available.usd,{currency:'usd',value:'50000000000000000',formatted:'$500,000,000,000,000.00'});
 assert.deepEqual(result.balances.available.usdc,{currency:'usdc',value:'500000000000000000000',formatted:'500,000,000,000,000.000000 USDC'});
 assert.equal(result.provider_nusd_balance.buckets.inbound_pending.value,'9007199254740993');
 assert.equal(result.provider_nusd_balance.tokenIdentityVerified,false);assert.equal(result.provider_nusd_balance.precision,null);
 assert.equal(result.balances.outbound_pending.usd.value,0);assert.equal(result.transfer_execution,false);
 const values=[];
 for(const token of ['9007199254740992','9007199254740993','-9007199254740993']){
  const body=JSON.stringify(fixture).replace('"RAW_USD"',token).replace('"RAW_USDC"','0').replace('"RAW_NUSD"','0');
  const read=await readStripeTreasury(config(),{fetcher:async()=>new Response(body)});values.push(read.balances.available.usd.value);
  if(token[0]==='-')assert.equal(read.balances.available.usd.formatted,'-$90,071,992,547,409.93');
 }
 assert.deepEqual(values,['9007199254740992','9007199254740993','-9007199254740993']);
});

test('lossless parsing cannot reinterpret quoted markers or repair malformed numeric keys',async()=>{
 const fixture=financialAccount();fixture.display_name='__numina_exact_integer_0__';fixture.metadata.escaped='__numina_exact_integer_1__';fixture.balance.available.usd.value='RAW';
 const raw=JSON.stringify(fixture).replace('"RAW"','9007199254740993').replace('"__numina_exact_integer_1__"','"\\u005f_numina_exact_integer_1__"');
 const result=await readStripeTreasury(config(),{fetcher:async()=>new Response(raw)});
 assert.equal(result.account.name,'__numina_exact_integer_0__');assert.equal(result.balances.available.usd.value,'9007199254740993');
 for(const malformed of [raw.replace('"display_name":','9007199254740993:'),raw.replace('9007199254740993','09007199254740993')]){
  await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>new Response(malformed)}),'STRIPE_TREASURY_INVALID_RESPONSE',502);
 }
});

test('Stripe errors and redirects are sanitized and cannot forward credentials to a new destination',async()=>{
 for(const status of [401,403,404,429,500,503])await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>providerResponse({error:{message:canary+' '+readKey}},status)}),'STRIPE_TREASURY_UNAVAILABLE',503);
 await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>{throw new Error(canary+' '+readKey);}}),'STRIPE_TREASURY_UNAVAILABLE',503);
 const attempts=[];
 await rejectsWith(readStripeTreasury(config(),{fetcher:async(url,options)=>{attempts.push(String(url));assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://evil.example/steal'}});}}),'STRIPE_TREASURY_UNAVAILABLE',503);
 assert.deepEqual(attempts,['https://api.stripe.com/v2/money_management/financial_accounts/'+STRIPE_TREASURY_FINANCIAL_ACCOUNT]);
 await rejectsWith(readStripeTreasury(config(),{fetcher:async()=>{const response=providerResponse();Object.defineProperty(response,'redirected',{value:true});return response;}}),'STRIPE_TREASURY_UNAVAILABLE',503);
});

test('Treasury deadline covers an unresponsive connection and aborts its request', {timeout:2000},async()=>{
 let signal;
 await rejectsWith(readStripeTreasury(config(),{timeoutMs:25,fetcher:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}}),'STRIPE_TREASURY_TIMEOUT',504);
 assert.equal(signal.aborted,true);
});

test('Treasury deadline remains active while reading a stalled JSON body', {timeout:2000},async()=>{
 let signal,bodyController;
 const body=new ReadableStream({start(controller){bodyController=controller;controller.enqueue(new TextEncoder().encode('{"id":'));}});
 try{
  await rejectsWith(readStripeTreasury(config(),{timeoutMs:25,fetcher:async(_url,options)=>{signal=options.signal;return new Response(body,{headers:{'Content-Type':'application/json'}});}}),'STRIPE_TREASURY_TIMEOUT',504);
  assert.equal(signal.aborted,true);
 }finally{try{bodyController.error(new Error('Local fixture closed'));}catch{}}
});

test('Treasury HTTP route rejects non-owners and non-GET methods before provider access',async t=>{
 const env=await fixture();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Unexpected provider request');});
 try{
  const now=Math.floor(Date.now()/1000);await commitControl(env.DB,{id:'treasury-delegate',expectedRevision:0,type:'delegate',data:{id:'treasury-grant',parent:'root',subject:'email:delegate@example.test',scopes:['request.create','record.write'],resourcePrefix:'record:',expiresAt:now+300}},owner,now);
  for(const [headers,status]of [[{},401],[{Authorization:'Bearer invalid'},401],[identity('delegate@example.test'),403]]){
   const response=await worker.fetch(routeRequest(headers),env);assert.equal(response.status,status);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assertSafe(await response.text());
  }
  for(const method of ['POST','PUT','DELETE','HEAD'])assert.equal((await worker.fetch(routeRequest(ownerHeaders,method),env)).status,405);
  assert.equal((await worker.fetch(routeRequest(),{...env,NUMINA_CONTROL_OWNER:'email:changed@example.test'})).status,503);
  const missing=await worker.fetch(routeRequest(),{...env,NUMINA_STRIPE_TREASURY_READ_KEY:undefined});assert.equal(missing.status,503);assert.equal((await missing.json()).error,'STRIPE_TREASURY_NOT_CONNECTED');
  assert.equal(calls,0);
 }finally{env.DB.close();}
});

test('owner Treasury reads stay private, leave the journal unchanged and cannot activate NUSD',async t=>{
 const env=await fixture();let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return providerResponse();});
 try{
  const before=await readControl(env.DB);
  for(const headers of [ownerHeaders,{Authorization:'Bearer '+ownerKey}]){
   const response=await worker.fetch(routeRequest(headers),env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie, Authorization');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
   const result=await response.json();assert.equal(result.schema,'numina.stripe.treasury.v1');assert.equal(result.transfer_execution,false);assert.equal(result.nusd_settlement,false);assertSafe(result);
  }
  assert.equal(calls,2);
  const after=await readControl(env.DB);assert.equal(after.state_hash,before.state_hash);assert.equal(after.revision,before.revision);assert.equal(after.eventCount,before.eventCount);
  for(const route of ['/api/control/v1/health','/api/control/v1/manifest','/api/control/v1/state','/api/nusd/v1/status','/api/nusd/v1/redemption-policy']){
   const response=await worker.fetch(new Request('https://numina.test'+route,{headers:ownerHeaders}),env);assert.equal(response.status,200);const raw=await response.text();assertSafe(raw);assert.equal(raw.includes(STRIPE_TREASURY_FINANCIAL_ACCOUNT),false);assert.equal(raw.includes('Local fixture financial account'),false);
   if(route==='/api/nusd/v1/status'){const status=JSON.parse(raw);for(const capability of ['mint','exchange','redemption','settlement'])assert.equal(status.capabilities[capability],false);assert.equal(status.capabilities.transfer,true);assert.equal(status.treasury_backing.valuation,null);}
  }
  assert.equal(calls,2);
 }finally{env.DB.close();}
});
