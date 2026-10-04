import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {database} from '../scripts/sqlite.mjs';
import {MemoryBucket} from './helpers/memory-bucket.mjs';
import {bootstrapControl,readControl,commitControl} from '../src/control-store.js';
import {controlHash} from '../src/control.js';
import {frontierVerify} from '../src/frontier.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {treasuryEvidencePayload,TREASURY_EVIDENCE_ROUTE} from '../src/treasury-evidence.js';
import {STRIPE_TREASURY_FINANCIAL_ACCOUNT} from '../src/stripe-treasury.js';
import worker from '../src/worker.js';

// Isolated SQLite, generated test signing keys and intercepted provider reads only.
const owner='email:owner@example.test',token='isolated-owner-evidence-token',origin='https://numina.test';
const now=()=>Math.floor(Date.now()/1000);
async function fixture(){
  const DB=database();await bootstrapControl(DB,owner,now());
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const env={DB,BUCKET:new MemoryBucket(),NUMINA_CONTROL_OWNER:owner,NUMINA_CONTROL_API_KEY_SHA256:await controlHash(token),NUMINA_RECEIPT_PRIVATE_JWK:JSON.stringify(privateKey.export({format:'jwk'})),NUMINA_RECEIPT_PUBLIC_JWK:JSON.stringify(publicKey.export({format:'jwk'})),NUMINA_STRIPE_TREASURY_READ_KEY:'rk_live_'+'synthetic'.repeat(4),NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT:STRIPE_TREASURY_FINANCIAL_ACCOUNT};
  const row=await readControl(DB);await createNuminaTreasury({db:DB,principal:owner,root:owner}).writeTreasury({id:'isolated-native-init',expectedRevision:row.revision,expectedHead:row.head_hash,Principal:owner,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Isolated evidence fixture'}});
  return env;
}
const req=(path=TREASURY_EVIDENCE_ROUTE,{method='GET',body,authorization='Bearer '+token,extra={}}={})=>new Request(origin+path,{method,headers:{...(authorization?{Authorization:authorization}:{}),...extra,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
function provider(){return Response.json({id:STRIPE_TREASURY_FINANCIAL_ACCOUNT,object:'v2.money_management.financial_account',display_name:'Isolated provider fixture',status:'open',type:'storage',livemode:true,balance:{available:{usd:{value:12500,currency:'usd'},usdc:{value:0,currency:'usdc'}}}},{headers:{'request-id':'req_isolated_evidence_fixture'}});}

test('owner-only evidence is signed, snapshot-bound and preserves the original journal',async()=>{
  const env=await fixture(),original=globalThis.fetch;let reads=0;
  globalThis.fetch=async(url,options)=>{reads++;assert.equal(String(url),'https://api.stripe.com/v2/money_management/financial_accounts/'+STRIPE_TREASURY_FINANCIAL_ACCOUNT);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return provider();};
  try{
    const before=await readControl(env.DB),response=await worker.fetch(req(),env),receipt=await response.json();
    assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(reads,1);
    assert.equal(await frontierVerify(receipt,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),true);
    const p=receipt.payload;assert.equal(p.head,before.head_hash);assert.equal(p.revision,before.revision);assert.equal(p.evidenceHash,await controlHash(p.source));
    assert.equal(p.source.nativeTreasury.projection.balance,'500000000000000');assert.equal(p.source.providerObservation.record.balances.available.usd.value,12500);
    assert.equal(p.source.canonicalTreasury.id,'numina:treasury:NUMINA');assert.equal(p.source.canonicalTreasury.root,'NUMINA');
    assert.equal(p.reconciliation.schema,'numina.treasury.reconciliation.v1');assert.equal(p.reconciliation.status,'NOT_RECONCILED');
    assert.deepEqual(p.reconciliation.canonicalTreasury,{source:'/source/canonicalTreasury',id:p.source.canonicalTreasury.id,route:'/api/control/v1/treasury',revision:p.revision,head:p.head,status:'VERIFIED'});
    assert.equal(p.reconciliation.capturedAt,p.capturedAt);assert.equal(p.reconciliation.depositReadiness.status,'NOT_READY');
    assert.equal(p.reconciliation.depositReadiness.submissionPerformed,false);assert.equal(p.reconciliation.depositReadiness.receipt,null);
    assert.equal(p.records.nativeTreasury.verification.status,'VERIFIED');assert.equal(p.records.providerBalances.verification.status,'AUTHENTICATED_OBSERVATION');
    assert.equal(p.records.providerBalances.source,'/source/providerObservation');assert.equal(p.records.bankFunding.verification.status,'BANK_PROVIDER_NOT_CONNECTED');
    const currencies=p.records.providerBalances.currencies;
    assert.equal(currencies.usd.precision,2);assert.equal(currencies.usdc.precision,6);assert.equal(currencies.nusd.precision,null);
    assert.equal(currencies.usd.balances.available.verification.status,'AUTHENTICATED_OBSERVATION');
    assert.equal(currencies.usdc.balances.available.verification.status,'AUTHENTICATED_OBSERVATION');
    assert.equal(currencies.usd.balances.inbound_pending.verification.status,'NOT_REPORTED');
    assert.equal(currencies.nusd.verification.status,'NOT_REPORTED');
    assert.equal(currencies.usdc.balances.available.source,'/source/providerObservation/record/balances/available/usdc');
    assert.equal(Object.hasOwn(currencies.usdc.balances.available,'value'),false);
    assert.equal(p.records.reserveAllocation.source,null);assert.equal(p.records.redemption.source,null);
    assert.equal(p.records.reserveAllocation.verification.status,'NOT_VERIFIED');assert.equal(p.records.redemption.verification.status,'NOT_VERIFIED');
    assert.equal(p.fundingVerification.actual_funding,false);assert.equal(p.fundingVerification.bankConfirmation.verified,false);assert.equal(p.source.supportingDocuments.complete,true);
    assert.equal((await readControl(env.DB)).head_hash,before.head_hash);assert.equal(JSON.stringify(receipt).includes(env.NUMINA_STRIPE_TREASURY_READ_KEY),false);
    const altered=structuredClone(receipt);altered.payload.fundingVerification.actual_funding=true;assert.equal(await frontierVerify(altered,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),false);
    const combined=structuredClone(receipt);combined.payload.records.reserveAllocation=combined.payload.records.nativeTreasury;assert.equal(await frontierVerify(combined,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),false);
    const changedCurrency=structuredClone(receipt);changedCurrency.payload.records.providerBalances.currencies.usd.balances.inbound_pending.verification.status='AUTHENTICATED_OBSERVATION';assert.equal(await frontierVerify(changedCurrency,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),false);
    const changedReadiness=structuredClone(receipt);changedReadiness.payload.reconciliation.depositReadiness.status='READY';assert.equal(await frontierVerify(changedReadiness,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),false);
    const changedBinding=structuredClone(receipt);changedBinding.payload.reconciliation.canonicalTreasury.head='b'.repeat(64);assert.equal(await frontierVerify(changedBinding,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),false);
  }finally{globalThis.fetch=original;env.DB.close();}
});

test('unauthorized, cross-origin and caller-supplied funding flags are rejected before provider reads',async()=>{
  const env=await fixture(),original=globalThis.fetch;let reads=0;globalThis.fetch=async()=>{reads++;return provider();};
  try{
    for(const [request,status] of [[req(undefined,{authorization:null}),401],[req(undefined,{authorization:'Bearer wrong'}),401],[req(undefined,{extra:{Origin:'https://other.test'}}),403],[req(undefined,{method:'POST',body:{actual_funding:true}}),405],[req(TREASURY_EVIDENCE_ROUTE+'?actual_funding=true'),400]])assert.equal((await worker.fetch(request,env)).status,status);
    const rpc={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'numina_treasury_evidence',arguments:{actual_funding:true}}};
    const response=await worker.fetch(req('/api/control/v2/mcp',{method:'POST',body:rpc}),env);assert.equal((await response.json()).result.isError,true);assert.equal(reads,0);
  }finally{globalThis.fetch=original;env.DB.close();}
});

test('signed provider observations retain large amounts exactly without establishing reserve allocation',async()=>{
  const env=await fixture(),original=globalThis.fetch;
  globalThis.fetch=async()=>new Response((await provider().text()).replace('12500','50000000000000001').replace('"value":0,"currency":"usdc"','"value":500000000000000000001,"currency":"usdc"'));
  try{
    const before=await readControl(env.DB),response=await worker.fetch(req(),env),receipt=await response.json();
    assert.equal(response.status,200);assert.equal(await frontierVerify(receipt,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),true);
    const p=receipt.payload,available=p.source.providerObservation.record.balances.available;
    assert.equal(available.usd.value,'50000000000000001');assert.equal(available.usdc.value,'500000000000000000001');
    for(const currency of ['usd','usdc'])assert.equal(p.records.providerBalances.currencies[currency].balances.available.verification.status,'AUTHENTICATED_OBSERVATION');
    assert.equal(p.evidenceHash,await controlHash(p.source));assert.equal(p.source.nativeTreasury.projection.balance,'500000000000000');
    assert.equal(p.fundingVerification.actual_funding,false);assert.equal(p.fundingVerification.allocatedReservesVerified,false);
    assert.equal((await readControl(env.DB)).head_hash,before.head_hash);
  }finally{globalThis.fetch=original;env.DB.close();}
});

test('MCP and A2A return the same owner-only evidence schema without granting delegated access',async()=>{
  const env=await fixture(),original=globalThis.fetch;globalThis.fetch=async()=>provider();
  try{
    for(const path of ['/api/control/v2/mcp','/api/control/v2/a2a']){
      const body=path.endsWith('/mcp')?{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'numina_treasury_evidence',arguments:{}}}:{jsonrpc:'2.0',id:1,method:'message/send',params:{message:{role:'user',messageId:'isolated-a2a',parts:[{kind:'data',data:{tool:'numina_treasury_evidence',arguments:{}}}]}}};
      const response=await worker.fetch(req(path,{method:'POST',body}),env),json=await response.json();
      const receipt=path.endsWith('/mcp')?JSON.parse(json.result.content[0].text):json.result.parts[0].data;
      assert.equal(receipt.payload.schema,'numina.treasury.evidence-snapshot.v1');assert.equal(await frontierVerify(receipt,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),true);
    }
    const delegated=req(undefined,{authorization:null,extra:{'oai-authenticated-user-id':'fixture-delegate','oai-authenticated-user-email':'delegate@example.test'}});assert.equal((await worker.fetch(delegated,env)).status,403);
  }finally{globalThis.fetch=original;env.DB.close();}
});

test('provider failure is unavailable evidence and a concurrent journal change prevents signing a mixed snapshot',async()=>{
  const env=await fixture(),original=globalThis.fetch;
  try{
    delete env.NUMINA_STRIPE_TREASURY_READ_KEY;delete env.BUCKET;
    let response=await worker.fetch(req(),env),receipt=await response.json();assert.equal(response.status,200);assert.equal(receipt.payload.source.providerObservation.status,'UNAVAILABLE');assert.equal(receipt.payload.source.supportingDocuments.complete,false);assert.equal(receipt.payload.fundingVerification.actual_funding,false);
    env.NUMINA_STRIPE_TREASURY_READ_KEY='rk_live_'+'synthetic'.repeat(4);
    globalThis.fetch=async()=>{const row=await readControl(env.DB);await commitControl(env.DB,{id:'isolated-concurrent-change',expectedRevision:row.revision,type:'delegate',data:{id:'isolated-grant',parent:'root',subject:'email:delegate@example.test',scopes:['request.create'],resourcePrefix:'record:',expiresAt:now()+300}},owner,now());return provider();};
    response=await worker.fetch(req(),env);assert.equal(response.status,409);assert.equal((await response.json()).error,'TREASURY_SNAPSHOT_CHANGED');
  }finally{globalThis.fetch=original;env.DB.close();}
});

test('owner claims and uploaded-document metadata cannot promote actual funding',async()=>{
  const treasury={root:owner,revision:4,head:'a'.repeat(64),projection:{balance:'500000000000000',unit:'NUSD'}};
  const frontier={fundingDeclaration:{FUNDED_PLAN:true,bankFundingVerified:true},accounts:[]};
  const payload=await treasuryEvidencePayload({treasury,frontier,providerObservation:{status:'UNAVAILABLE',record:null},supportingDocuments:{record:{documents:[{bank_issuer_verified:true}]}},capturedAt:'2026-01-01T00:00:00Z'});
  assert.equal(payload.fundingVerification.actual_funding,false);assert.equal(payload.fundingVerification.ownerDeclaredFunded,true);assert.equal(payload.fundingVerification.allocatedReservesVerified,false);
  assert.equal(payload.records.providerBalances.verification.status,'UNAVAILABLE');assert.equal(payload.records.reserveAllocation.verification.status,'NOT_VERIFIED');assert.equal(payload.records.redemption.verification.status,'NOT_VERIFIED');
  treasury.projection.balance='1';assert.equal(payload.source.nativeTreasury.projection.balance,'500000000000000');assert.equal(payload.evidenceHash,await controlHash(payload.source));
});

test('native settlement records remain captured internal state without proving external settlement',async()=>{
  const treasury={root:owner,status:'READY',revision:4,head:'a'.repeat(64),projection:{balance:'500000000000000',unit:'NUSD',verification:'VERIFIED'},
    aggregateSettlement:{status:'SETTLED',evidenceScope:'NUMINA_INTERNAL_SOFTWARE_STATE',receiptId:'native-settlement-fixture',submissionPerformed:true,settlementPerformed:true}};
  const payload=await treasuryEvidencePayload({treasury,frontier:{},providerObservation:{status:'UNAVAILABLE',record:null},supportingDocuments:null,capturedAt:'2026-09-19T00:00:00Z'});
  assert.deepEqual(payload.source.nativeTreasury.aggregateSettlement,treasury.aggregateSettlement);
  assert.equal(payload.records.nativeTreasury.verification.status,'VERIFIED');
  assert.equal(payload.fundingVerification.actual_funding,false);assert.equal(payload.fundingVerification.bankConfirmation.verified,false);
  assert.equal(payload.fundingVerification.submissionPerformed,false);assert.equal(payload.fundingVerification.settlementPerformed,false);
  assert.equal(payload.reconciliation.depositReadiness.status,'NOT_READY');assert.equal(payload.reconciliation.depositReadiness.receipt,null);
  assert.equal(payload.reconciliation.depositReadiness.settlementEvidence.status,'NOT_VERIFIED');
});

test('reported provider NUSD and negative balances retain their own sources without proving native asset identity',async()=>{
  const env=await fixture(),original=globalThis.fetch;
  globalThis.fetch=async()=>{const value=await provider().json();value.balance.available.usd.value=-12500;value.balance.available.nusd={currency:'nusd',value:500};return Response.json(value);};
  try{
    const receipt=await (await worker.fetch(req(),env)).json(),p=receipt.payload,currencies=p.records.providerBalances.currencies;
    assert.equal(p.source.providerObservation.record.balances.available.usd.value,-12500);
    assert.equal(currencies.usd.balances.available.verification.status,'AUTHENTICATED_OBSERVATION');
    assert.equal(currencies.nusd.verification.status,'ASSET_NOT_VERIFIED');assert.equal(currencies.nusd.precision,null);
    assert.equal(currencies.nusd.balances.available.verification.status,'ASSET_NOT_VERIFIED');
    assert.equal(currencies.nusd.balances.available.source,'/source/providerObservation/record/provider_nusd_balance/buckets/available');
    assert.equal(currencies.nusd.balances.inbound_pending.verification.status,'NOT_REPORTED');
    assert.equal(currencies.nusd.balances.inbound_pending.source,null);
    assert.equal(p.fundingVerification.actual_funding,false);assert.equal(p.source.nativeTreasury.projection.balance,'500000000000000');
    assert.equal(await frontierVerify(receipt,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),true);
  }finally{globalThis.fetch=original;env.DB.close();}
});

test('an observation label alone cannot authenticate currency or balance records',async()=>{
  for(const observation of [{status:'UNAVAILABLE',record:null},{status:'OBSERVED',authentication:'server_held_stripe_read_credential',record:{schema:'owner_assertion',balances:{available:{usd:{currency:'usd',value:500000000000000}}}}}]){
    const p=await treasuryEvidencePayload({treasury:{root:owner},frontier:{},providerObservation:observation,supportingDocuments:null,capturedAt:'2026-01-01T00:00:00Z'});
    assert.equal(p.records.providerBalances.verification.status,'UNAVAILABLE');
    for(const currency of Object.values(p.records.providerBalances.currencies)){
      assert.equal(currency.source,null);assert.equal(currency.verification.status,'UNAVAILABLE');
      for(const balance of Object.values(currency.balances)){assert.equal(balance.source,null);assert.equal(balance.verification.status,'UNAVAILABLE');}
    }
  }
});

test('reconciliation preserves each captured provider status without aggregating amounts or granting deposit readiness',async()=>{
  const input={treasury:{root:owner,status:'READY',revision:4,head:'a'.repeat(64),projection:{balance:'500000000000000',unit:'NUSD',verification:'VERIFIED'}},
    frontier:{fundingDeclaration:{FUNDED_PLAN:true,bankFundingVerified:true},fundingPlan:{confirmedFunding:{amount:'500000000000000',unit:'USDC'},externalReceipt:{id:'owner-claim'}}},
    providerObservation:{status:'OBSERVED',authentication:'server_held_stripe_read_credential',record:{schema:'numina.stripe.treasury.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'Stripe',connection:'read_only',
      account:{id:STRIPE_TREASURY_FINANCIAL_ACCOUNT,livemode:true,status:'open'},reported_currencies:['usd','usdc','nusd'],
      balances:{available:{usd:{currency:'usd',value:0},usdc:{currency:'usdc',value:'500000000000000000001'}},inbound_pending:{usd:{currency:'usd',value:12500}}},
      provider_nusd_balance:{buckets:{available:{currency:'nusd',value:500}}}}},
    supportingDocuments:{status:'OBSERVED',record:{documents:[{bank_issuer_verified:true}]}},capturedAt:'2026-09-15T12:00:00Z'};
  const before=structuredClone(input),payload=await treasuryEvidencePayload(input),r=payload.reconciliation;
  assert.deepEqual(input,before);assert.equal(payload.evidenceHash,await controlHash(payload.source));
  assert.equal(r.records.nativeTreasury.source,'/records/nativeTreasury');assert.equal(r.records.nativeTreasury.status,'VERIFIED');
  assert.equal(r.records.stripe.source,'/records/providerBalances');assert.equal(r.records.stripe.status,'AUTHENTICATED_OBSERVATION');
  assert.deepEqual(r.records.stripe.currencies,payload.records.providerBalances.currencies);
  assert.equal(r.records.stripe.currencies.usd.balances.available.verification.status,'AUTHENTICATED_OBSERVATION');
  assert.equal(r.records.stripe.currencies.usdc.balances.available.verification.status,'AUTHENTICATED_OBSERVATION');
  assert.equal(r.records.stripe.currencies.usdc.balances.inbound_pending.verification.status,'NOT_REPORTED');
  assert.equal(r.records.stripe.currencies.nusd.balances.available.verification.status,'ASSET_NOT_VERIFIED');
  assert.equal(r.records.bank.source,'/records/bankFunding');assert.equal(r.records.bank.status,'BANK_PROVIDER_NOT_CONNECTED');
  assert.equal(r.records.supportingDocuments.source,'/records/supportingDocuments');assert.equal(r.records.supportingDocuments.status,'OWNER_UPLOADED_UNVERIFIED');assert.equal(r.records.supportingDocuments.complete,false);
  for(const record of Object.values(r.records))assert.deepEqual(record.treasuryRef,{id:payload.source.canonicalTreasury.id,source:'/source/canonicalTreasury',nativeUnit:'NUSD',amountSource:'/source/canonicalTreasury/native/amount'});
  assert.equal(r.depositReadiness.status,'NOT_READY');assert.equal(r.depositReadiness.externalSubmissionImplemented,false);
  assert.equal(r.depositReadiness.submissionPerformed,false);assert.equal(r.depositReadiness.receipt,null);
  assert.deepEqual(r.depositReadiness.requiredEvidence.map(item=>[item.id,item.status]),[['funding_source','NOT_VERIFIED'],['reserve_allocation','NOT_VERIFIED'],['provider_acceptance','NOT_VERIFIED']]);
  assert.equal(r.depositReadiness.settlementEvidence.status,'NOT_VERIFIED');assert.equal(r.depositReadiness.settlementEvidence.requiredAfter,'submission');
  assert.equal(payload.fundingVerification.actual_funding,false);assert.equal(payload.fundingVerification.ownerDeclaredFunded,true);
  const serialized=JSON.stringify({records:r.records,depositReadiness:r.depositReadiness});assert.doesNotMatch(serialized,/"(?:amount|value|formatted)":/);assert.equal(serialized.includes('500000000000000'),false);
  assert.equal(r.nativeSettlement.status,'UNVERIFIED');
  assert.equal(r.nativeSettlement.receipt,null);
  assert.equal(r.nativeSettlement.currentJournalProjection.balance,'500000000000000');
  assert.equal(r.nativeSettlement.currentJournalProjection.revision,4);
  assert.equal(r.nativeSettlement.historicalReceipt.id,'numina:treasury:settlement:2026-09-19:v1');
  assert.equal(r.nativeSettlement.historicalReceipt.currentJournalConfirmed,false);
  assert.equal(r.nativeSettlement.canonicalTreasuryValues.aggregate.current,null);
  r.records.stripe.currencies.usdc.balances.available.verification.status='CHANGED';
  assert.equal(payload.records.providerBalances.currencies.usdc.balances.available.verification.status,'AUTHENTICATED_OBSERVATION');
  assert.deepEqual(payload.source.providerObservation,input.providerObservation);
});

test('reconciliation fails closed without an initialized canonical projection or authenticated provider record',async()=>{
  const valid={root:owner,status:'READY',revision:4,head:'a'.repeat(64),projection:{balance:'500000000000000',unit:'NUSD',verification:'VERIFIED'}};
  const missingStatus={...valid};delete missingStatus.status;
  for(const treasury of [{...valid,status:'NOT_INITIALIZED',projection:null},{...valid,projection:null},missingStatus,{...valid,root:''},{...valid,head:'invalid'}]){
    const payload=await treasuryEvidencePayload({treasury,frontier:{fundingDeclaration:{FUNDED_PLAN:true}},providerObservation:{status:'UNAVAILABLE',record:null},supportingDocuments:null,capturedAt:'2026-09-15T12:00:00Z'});
    const r=payload.reconciliation;
    assert.equal(r.canonicalTreasury.id,null);assert.equal(r.canonicalTreasury.status,treasury.status==='NOT_INITIALIZED'?'NOT_INITIALIZED':'NOT_VERIFIED');
    for(const record of Object.values(r.records))assert.equal(record.treasuryRef,null);
    assert.equal(r.depositReadiness.status,'NOT_READY');assert.equal(r.depositReadiness.submissionPerformed,false);assert.equal(r.depositReadiness.receipt,null);
    assert.equal(r.records.stripe.status,'UNAVAILABLE');
    for(const currency of Object.values(r.records.stripe.currencies)){
      assert.equal(currency.source,null);assert.equal(currency.verification.status,'UNAVAILABLE');
      for(const balance of Object.values(currency.balances)){assert.equal(balance.source,null);assert.equal(balance.verification.status,'UNAVAILABLE');}
    }
  }
});
