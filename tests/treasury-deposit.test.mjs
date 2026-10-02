import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl,readControl} from '../src/control-store.js';
import {stable,controlHash} from '../src/control.js';
import {STRIPE_TREASURY_FINANCIAL_ACCOUNT as fa} from '../src/stripe-treasury.js';
import {STRIPE_DEPOSIT_CAPABILITY,readStripeDepositInstructions,readStripeDepositReceipt} from '../src/stripe-deposit-provider.js';
import {validateDepositIntent,prepareDepositInstructions,reconcileDeposit,readDepositIntent} from '../src/treasury-deposit-store.js';
import {treasuryConnectionHttp} from '../src/treasury-connection-http.js';
import worker from '../src/worker.js';

// All provider responses and credentials here are offline synthetic fixtures.
const owner='email:deposit@example.test',key='deposit-test-key-001',address='finaddr_offline',receiptId='rc_offline',transactionId='trxn_offline';
const created='2026-10-01T12:00:00.000Z',observed='2026-10-01T12:05:00.000Z',received='2026-10-01T12:01:00.000Z';
const secret='PRIVATE_BANK_NUMBER_NOT_PERSISTED';
const envConfig=()=>({NUMINA_STRIPE_TREASURY_READ_KEY:'rk_live_'+'offline'.repeat(4),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:fa});
const intent=()=>({source:{currency:'NUSD',amount:'10'},settlement:{currency:'USD',amount:'10.00'},financialAccount:fa});
function prepare(idempotencyKey=key,value=intent()){
  const body={action:'prepare_external_funding',idempotencyKey,intent:value};return {...body,authorization:{...body,confirmed:true}};
}
function poll(idempotencyKey=key,id=receiptId,receiptKind='received_credit'){
  const body={action:'reconcile',idempotencyKey,providerReceiptId:id,receiptKind};return {...body,authorization:{...body,confirmed:true}};
}
const money=value=>({value,currency:'usd'});
const account=()=>({id:fa,object:'v2.money_management.financial_account',status:'open',type:'storage',livemode:true,
  balance:{available:{usd:money(1000)},inbound_pending:{usd:money(0)},outbound_pending:{usd:money(0)}}});
const addresses=()=>({data:[{id:address,object:'v2.money_management.financial_address',financial_account:fa,status:'active',currency:'usd',settlement_currency:'usd',livemode:true,credentials:{type:'us_bank_account',us_bank_account:{account_number:secret,routing_number:secret}}}],next_page_url:null});
const receipt=()=>({id:receiptId,object:'v2.money_management.received_credit',financial_account:fa,livemode:true,amount:money(1000),status:'succeeded',created:received,type:'bank_transfer',bank_transfer:{financial_address:address,us_bank_account:{network:'ach'}},receipt_url:'https://pay.stripe.com/fixture'});
const transaction=()=>({id:transactionId,object:'v2.money_management.transaction',financial_account:fa,livemode:true,amount:money(1000),status:'posted',created:received,
  flow:{type:'received_credit',received_credit:receiptId},balance_impact:{available:money(1000),inbound_pending:money(0),outbound_pending:money(0)}});
function provider({credit=receipt(),tx=transaction(),pageComplete=true,bankAddresses=addresses(),rejectPath=null,rejectStatus=403}={}){
  const calls=[];const fetcher=async(path,options)=>{
    const url=new URL(path);calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.body,undefined);
    if(rejectPath&&url.pathname.includes(rejectPath))return new Response(secret,{status:rejectStatus,headers:{'request-id':'req_denied'}});
    let value;
    if(url.pathname.endsWith('/financial_accounts/'+fa))value=account();
    else if(url.pathname.endsWith('/financial_addresses'))value=bankAddresses;
    else if(url.pathname.includes('/received_credits/')||url.pathname.includes('/inbound_transfers/'))value=credit;
    else if(url.pathname.endsWith('/transactions')){assert.equal(url.searchParams.get('flow'),credit.id);value={data:tx?[tx]:[],next_page_url:pageComplete?null:'https://attacker.invalid/next'};}
    else throw Error('Unexpected provider route');
    return Response.json(value,{headers:{'request-id':'req_offline'}});
  };return {fetcher,calls};
}
async function fixture(t){const db=database();t.after(()=>db.close());await bootstrapControl(db,owner,1700000000);return {db,env:{...envConfig(),DB:db,NUMINA_CONTROL_OWNER:owner}};}
const opts=p=>({providerOptions:{fetcher:p.fetcher},now:()=>created});
const pollOpts=p=>({...opts(p),now:()=>observed});
const errorIs=code=>error=>error.code===code;

test('success: instructions then exact bank credit + posted flow confirm USD only',async t=>{
  const {db,env}=await fixture(t),p=provider(),before=await readControl(db);
  const prepared=await prepareDepositInstructions(db,owner,prepare(),env,opts(p));
  assert.equal(prepared.record.softwareState.status,'AWAITING_EXTERNAL_USD_FUNDING');assert.equal(prepared.record.submissionPerformed,false);
  assert.equal(prepared.record.intendedState.settlement.minorUnits,'1000');assert.equal(prepared.record.intendedState.source.baseUnits,'10000000000000000000');
  const result=await reconcileDeposit(db,owner,poll(),env,pollOpts(p));
  assert.equal(result.record.softwareState.status,'USD_RECEIPT_RECONCILED');assert.equal(result.record.providerConfirmedState.usdDepositVerified,true);
  assert.equal(result.record.providerConfirmedState.receiptId,receiptId);assert.equal(result.record.providerConfirmedState.transactionId,transactionId);
  assert.equal(result.record.settled,false);assert.equal(result.record.nusdSettlementVerified,false);assert.equal(result.record.sourceEvidence.nusdRedemptionVerified,false);
  assert.deepEqual(await readControl(db),before);assert.equal(p.calls.length,5);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM numina_deposit_observations').first()).n,2);
  const saved=await db.prepare('SELECT observation_json FROM numina_deposit_observations').all();assert.ok(saved.results.every(r=>!r.observation_json.includes(secret)));
  assert.match(saved.results[1].observation_json,/req_offline/);
});
test('provider rejection is persisted with request ID, without receipts or secret body',async t=>{
  const {db,env}=await fixture(t),p=provider({rejectPath:'financial_addresses'});
  const {record}=await prepareDepositInstructions(db,owner,prepare(),env,opts(p));
  assert.equal(record.softwareState.status,'PROVIDER_READ_FAILED');assert.equal(record.observation.error,'STRIPE_DEPOSIT_PROVIDER_REJECTED');
  assert.equal(record.observation.response.httpStatus,403);assert.equal(record.observation.response.requestId,'req_denied');assert.equal(record.providerConfirmedState.usdDepositVerified,false);
  assert.equal(JSON.stringify(record).includes(secret),false);
});
test('concurrent duplicate submissions claim one durable intent; conflicting replay fails',async t=>{
  const {db,env}=await fixture(t),p=provider();
  const results=await Promise.all([prepareDepositInstructions(db,owner,prepare(),env,opts(p)),prepareDepositInstructions(db,owner,prepare(),env,opts(p))]);
  assert.equal(results.filter(r=>r.replayed).length,1);assert.equal(p.calls.length,2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM numina_deposit_intents').first()).n,1);
  const changed=intent();changed.settlement.amount='11.00';await assert.rejects(prepareDepositInstructions(db,owner,prepare(key,changed),env,opts(p)),errorIs('DEPOSIT_IDEMPOTENCY_CONFLICT'));
});
test('missing USD funds and no writable provider produce instructions, never a submission',async t=>{
  const {db,env}=await fixture(t),p=provider();
  const {record}=await prepareDepositInstructions(db,owner,prepare(),env,opts(p));
  assert.equal(STRIPE_DEPOSIT_CAPABILITY.submission,false);assert.equal(STRIPE_DEPOSIT_CAPABILITY.supportedWriteEndpoint,null);
  assert.equal(record.observation.instructions.usdSourceFundsVerified,false);assert.equal(record.sourceEvidence.usdSourceFundsVerified,false);
  const req=new Request('https://numina.test/api/treasury/v1/submissions',{method:'POST',headers:{'content-type':'application/json',origin:'https://numina.test'},body:stable({action:'submit',fundsAvailable:true})});
  const response=await treasuryConnectionHttp(req,env,{authorize:async()=>owner});assert.equal(response.status,409);
  assert.equal((await response.json()).error,'FUNDED_USD_SOURCE_AND_SUPPORTED_WRITE_PROVIDER_REQUIRED');assert.ok(p.calls.every(c=>c.options.method==='GET'));
});
test('amounts and currencies are exact; authorization is request-bound',async t=>{
  const {db,env}=await fixture(t),p=provider();
  for(const amount of [1,0,-1,'0','01','1e3','-1','1.001','NaN','Infinity','1000000000000000000']){
    const value=intent();value.settlement.amount=amount;assert.throws(()=>validateDepositIntent(value));
  }
  const huge=intent();huge.source.amount='500000000000000';huge.settlement.amount='500000000000000';assert.equal(validateDepositIntent(huge).settlement.minorUnits,'50000000000000000');
  const bad=prepare();bad.authorization.intent=intent();bad.authorization.intent.settlement.amount='11.00';
  await assert.rejects(prepareDepositInstructions(db,owner,bad,env,opts(p)),errorIs('EXPLICIT_DEPOSIT_AUTHORIZATION_REQUIRED'));assert.equal(p.calls.length,0);
  for(const mutate of [i=>i.source.currency='USD',i=>i.settlement.currency='USDC',i=>i.financialAccount='fa_other']){const value=intent();mutate(value);assert.throws(()=>validateDepositIntent(value));}
});
test('old/unrelated/wrong amount/currency/account/address and returned credits cannot settle',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  const mutations=[v=>v.created='2026-09-30T12:00:00Z',v=>v.type='balance_transfer',v=>v.amount.value=999,v=>v.amount.currency='usdc',v=>v.financial_account='fa_other',v=>v.bank_transfer.financial_address='finaddr_other',v=>v.status='returned',v=>v.status='failed'];
  for(const mutate of mutations){const value=receipt();mutate(value);const {record}=await reconcileDeposit(db,owner,poll(),env,pollOpts(provider({credit:value})));assert.equal(record.providerConfirmedState.usdDepositVerified,false);assert.equal(record.settled,false);}
});
test('balance-only growth, wrong transaction, void or incomplete page is unconfirmed',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  const txs=[null,{...transaction(),status:'void'},{...transaction(),flow:{type:'received_credit',received_credit:'rc_other'}},{...transaction(),amount:money(999)}];
  for(const tx of txs){const {record}=await reconcileDeposit(db,owner,poll(),env,pollOpts(provider({tx})));assert.equal(record.providerConfirmedState.usdDepositVerified,false);}
  const {record}=await reconcileDeposit(db,owner,poll(),env,pollOpts(provider({pageComplete:false})));assert.equal(record.providerConfirmedState.usdDepositVerified,false);
});
test('pending then succeeded then returned are independently read back and persisted',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  for(const [index,status] of ['pending','succeeded','returned'].entries()){
    const p=provider({credit:{...receipt(),status}}),result=await reconcileDeposit(db,owner,poll(),env,{...pollOpts(p),now:()=>`2026-10-01T12:0${index+5}:00.000Z`});
    assert.equal(result.record.providerConfirmedState.usdDepositVerified,status==='succeeded');
  }
  assert.equal((await readDepositIntent(db,owner,key)).softwareState.status,'PROVIDER_FUNDING_REJECTED');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM numina_deposit_observations').first()).n,4);
});
test('same receipt cannot confirm two intents or be replaced on a bound intent',async t=>{
  const {db,env}=await fixture(t),p=provider();
  await prepareDepositInstructions(db,owner,prepare(),env,opts(p));await prepareDepositInstructions(db,owner,prepare('deposit-test-key-002'),env,opts(p));
  await reconcileDeposit(db,owner,poll(),env,pollOpts(p));
  await assert.rejects(reconcileDeposit(db,owner,poll('deposit-test-key-002'),env,pollOpts(p)),errorIs('PROVIDER_RECEIPT_ALREADY_ALLOCATED'));
  await assert.rejects(reconcileDeposit(db,owner,poll(key,'rc_other'),env,pollOpts(p)),errorIs('DEPOSIT_RECEIPT_BINDING_CONFLICT'));
});
test('v2 inbound history and credited USD use exact flow readback without guessed ID prefix',async t=>{
  const {db,env}=await fixture(t),id='opaque_inbound_001';await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  const inbound={id,object:'v2.money_management.inbound_transfer',livemode:true,amount:money(1000),created:received,
    from:{payment_method:{type:'us_bank_account'}},to:{financial_account:fa,credited:money(1000)},transfer_history:[{id:'entry1',type:'bank_debit_succeeded',created:received,level:'canonical'}]};
  const p=provider({credit:inbound,tx:{...transaction(),flow:{type:'inbound_transfer',inbound_transfer:id}}});
  const {record}=await reconcileDeposit(db,owner,poll(key,id,'inbound_transfer'),env,pollOpts(p));assert.equal(record.providerConfirmedState.usdDepositVerified,true);assert.equal(record.nusdSettlementVerified,false);
});
test('provider configuration, redirects, oversized responses and mode mismatches fail closed',async()=>{
  await assert.rejects(readStripeDepositInstructions({},{}),errorIs('STRIPE_DEPOSIT_NOT_CONNECTED'));
  await assert.rejects(readStripeDepositInstructions(envConfig(),{fetcher:async()=>new Response(null,{status:302})}),errorIs('STRIPE_DEPOSIT_PROVIDER_REJECTED'));
  await assert.rejects(readStripeDepositInstructions(envConfig(),{fetcher:async()=>Response.json({...account(),livemode:false})}),errorIs('STRIPE_DEPOSIT_INVALID_RESPONSE'));
  await assert.rejects(readStripeDepositInstructions(envConfig(),{fetcher:async()=>new Response('x'.repeat(70000))}),errorIs('STRIPE_DEPOSIT_INVALID_RESPONSE'));
  await assert.rejects(readStripeDepositReceipt(envConfig(),'rc_bad/path','received_credit'),errorIs('INVALID_PROVIDER_RECEIPT_ID'));
  await assert.rejects(readStripeDepositInstructions(envConfig(),{fetcher:async()=>new Promise(()=>{}),timeoutMs:5}),errorIs('STRIPE_DEPOSIT_TIMEOUT'));
});
test('HTTP owner/reviewer/CSRF/root gates and status readback integrate with production Worker',async t=>{
  const {db,env}=await fixture(t),p=provider(),url='https://numina.test/api/treasury/v1/submissions';
  const request=(value=prepare(),headers={})=>new Request(url,{method:'POST',headers:{'content-type':'application/json',origin:'https://numina.test',...headers},body:stable(value)});
  const options={authorize:async()=>owner,depositOptions:opts(p)};
  assert.equal((await treasuryConnectionHttp(request(),{...env,NUMINA_REVIEW_SESSION:true},options)).status,403);
  assert.equal((await treasuryConnectionHttp(request(),env,{authorize:async()=> 'email:other@example.test'})).status,403);
  assert.equal((await treasuryConnectionHttp(request(prepare(),{origin:'https://attacker.invalid'}),env,options)).status,403);
  assert.equal((await treasuryConnectionHttp(request(),{...env,NUMINA_CONTROL_OWNER:'email:other@example.test'},{...options,authorize:async()=> 'email:other@example.test'})).status,503);
  const prepared=await treasuryConnectionHttp(request(),env,options);assert.equal(prepared.status,201);
  const get=await treasuryConnectionHttp(new Request(url+'?idempotencyKey='+key),env,options);assert.equal((await get.json()).record.idempotencyKey,key);
  const upstream=await worker.fetch(new Request(url,{headers:{'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'deposit@example.test'}}),{...env,NUMINA_TELEMETRY_LOGS:'false'});
  assert.equal(upstream.headers.get('x-numina-provider-verification'),'scoped-observation-only');assert.equal(upstream.status,200);
  assert.deepEqual((await upstream.json()).depositWorkflow,STRIPE_DEPOSIT_CAPABILITY);
});
test('new migration applies to existing tables and snapshot preserves preceding definitions',()=>{
  const dir=new URL('../drizzle/',import.meta.url),read=name=>readFileSync(new URL(name,dir),'utf8'),db=new DatabaseSync(':memory:');
  try{const journal=JSON.parse(read('meta/_journal.json'));for(const entry of journal.entries)db.exec(read(entry.tag+'.sql'));
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'numina_deposit_%' AND type='table'").get().n,3);
    const previous=JSON.parse(read('meta/0005_snapshot.json')),next=JSON.parse(read('meta/0006_snapshot.json'));assert.equal(next.prevId,previous.id);
    for(const [name,table]of Object.entries(previous.tables))assert.deepEqual(next.tables[name],table);
  }finally{db.close();}
});

test('assembled production Worker prepares, reads and reconciles using offline provider fixtures',async t=>{
  const {default:built}=await import('../dist/server/index.js');
  const {db,env}=await fixture(t),credit=receipt(),tx=transaction(),p=provider({credit,tx}),url='https://numina.test/api/treasury/v1/submissions';
  env.NUMINA_CONTROL_API_KEY_SHA256=await controlHash('offline-control-token');
  const realFetch=globalThis.fetch;globalThis.fetch=p.fetcher;t.after(()=>{globalThis.fetch=realFetch;});
  const headers={'content-type':'application/json',origin:'https://numina.test',authorization:'Bearer offline-control-token'};
  const invoke=body=>built.fetch(new Request(url,{method:'POST',headers,body:stable(body)}),{...env,NUMINA_TELEMETRY_LOGS:'false'});
  const prepared=await invoke(prepare());assert.equal(prepared.status,201);
  const preparedValue=await prepared.json();assert.equal(preparedValue.record.submissionPerformed,false);
  credit.created=preparedValue.record.createdAt;tx.created=preparedValue.record.createdAt;
  const result=await invoke(poll());assert.equal(result.status,201);
  const value=await result.json();assert.equal(value.record.providerConfirmedState.usdDepositVerified,true);assert.equal(value.record.nusdSettlementVerified,false);
  const status=await built.fetch(new Request(url+'?idempotencyKey='+key,{headers}),{...env,NUMINA_TELEMETRY_LOGS:'false'});
  assert.equal(status.headers.get('x-numina-provider-verification'),'scoped-observation-only');
  assert.equal((await status.json()).record.providerConfirmedState.transactionId,transactionId);
  assert.equal(p.calls.length,5);assert.ok(p.calls.every(c=>c.options.method==='GET'));
});
test('known returned credit revokes earlier verification despite supplementary provider rejection',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  await reconcileDeposit(db,owner,poll(),env,pollOpts(provider()));
  const p=provider({credit:{...receipt(),status:'returned'},rejectPath:'transactions'});
  const {record}=await reconcileDeposit(db,owner,poll(),env,{...pollOpts(p),now:()=> '2026-10-01T12:06:00.000Z'});
  assert.equal(record.providerConfirmedState.usdDepositVerified,false);assert.equal(record.providerConfirmedState.receiptStatus,'returned');
  assert.equal(record.softwareState.status,'PROVIDER_FUNDING_REJECTED');assert.equal(record.observation.providerResponses.at(-1).response.requestId,'req_denied');
});
test('concurrent delayed returned read dominates a newer succeeded poll',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  let release,started;const barrier=new Promise(r=>release=r),entered=new Promise(r=>started=r);let calls=0;
  const readReceipt=async(...args)=>{calls++;if(calls===1){started();await barrier;return readStripeDepositReceipt(...args.slice(0,3),{fetcher:provider({credit:{...receipt(),status:'returned'}}).fetcher});}return readStripeDepositReceipt(...args.slice(0,3),{fetcher:provider().fetcher});};
  const slow=reconcileDeposit(db,owner,poll(),env,{readReceipt,now:()=>observed});await entered;
  const fast=await reconcileDeposit(db,owner,poll(),env,{readReceipt,now:()=>observed});assert.equal(fast.record.providerConfirmedState.usdDepositVerified,true);
  release();await slow;assert.equal((await readDepositIntent(db,owner,key)).providerConfirmedState.usdDepositVerified,false);
});
test('missing external bank funds is persisted from v2 failed debit history without a balance write',async t=>{
  const {db,env}=await fixture(t),id='opaque_failed_debit';await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  const inbound={id,object:'v2.money_management.inbound_transfer',livemode:true,amount:money(1000),created:received,
    from:{payment_method:{type:'us_bank_account'}},to:{financial_account:fa,credited:money(0)},
    transfer_history:[{id:'entry_failed',type:'bank_debit_failed',created:received,level:'canonical',bank_debit_failed:{failure_reason:'insufficient_funds'}}]};
  const p=provider({credit:inbound,tx:null});const {record}=await reconcileDeposit(db,owner,poll(key,id,'inbound_transfer'),env,pollOpts(p));
  assert.equal(record.softwareState.status,'PROVIDER_FUNDING_REJECTED');assert.equal(record.providerConfirmedState.usdDepositVerified,false);
  assert.equal(record.observation.providerResponses[0].body.bankDebit.history[0].failureReason,'insufficient_funds');assert.ok(p.calls.every(c=>c.options.method==='GET'));
});
test('malformed allowlisted fields are rejected with request metadata and no nested secret persistence',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  const bad=receipt();bad.bank_transfer.financial_address={secret};
  const {record}=await reconcileDeposit(db,owner,poll(),env,pollOpts(provider({credit:bad})));
  assert.equal(record.softwareState.status,'PROVIDER_READ_FAILED');assert.equal(record.observation.response.httpStatus,200);assert.equal(record.observation.response.requestId,'req_offline');assert.equal(JSON.stringify(record).includes(secret),false);
});
test('nonzero outbound pending impact and unexpected inbound impact cannot reconcile',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider()));
  for(const change of ['outbound_pending','inbound_pending']){const tx=transaction();tx.balance_impact[change]=money(1);const {record}=await reconcileDeposit(db,owner,poll(),env,pollOpts(provider({tx})));assert.equal(record.providerConfirmedState.usdDepositVerified,false);}
});
test('explicit instruction refresh recovers a rejected GET under the original immutable intent',async t=>{
  const {db,env}=await fixture(t);await prepareDepositInstructions(db,owner,prepare(),env,opts(provider({rejectPath:'financial_addresses'})));
  const refresh=prepare();refresh.action='refresh_instructions';refresh.authorization.action=refresh.action;
  const {record}=await prepareDepositInstructions(db,owner,refresh,env,{...opts(provider()),now:()=>observed});
  assert.equal(record.softwareState.status,'AWAITING_EXTERNAL_USD_FUNDING');assert.equal(record.createdAt,created);assert.equal(record.submissionPerformed,false);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM numina_deposit_intents').first()).n,1);
});
test('no active USD bank address keeps funding unavailable without claiming a provider submission',async t=>{
  const {db,env}=await fixture(t),p=provider({bankAddresses:{data:[],next_page_url:null}});
  const {record}=await prepareDepositInstructions(db,owner,prepare(),env,opts(p));assert.equal(record.softwareState.status,'USD_FUNDING_DESTINATION_UNAVAILABLE');assert.equal(record.submissionPerformed,false);
});
