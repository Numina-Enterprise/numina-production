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
    assert.equal(p.source.canonicalTreasury.id,'numina:treasury:'+encodeURIComponent(owner));
    assert.equal(p.records.nativeTreasury.verification.status,'VERIFIED');assert.equal(p.records.providerBalances.verification.status,'AUTHENTICATED_OBSERVATION');
    assert.equal(p.records.providerBalances.source,'/source/providerObservation');assert.equal(p.records.bankFunding.verification.status,'BANK_PROVIDER_NOT_CONNECTED');
    assert.equal(p.records.reserveAllocation.source,null);assert.equal(p.records.redemption.source,null);
    assert.equal(p.records.reserveAllocation.verification.status,'NOT_VERIFIED');assert.equal(p.records.redemption.verification.status,'NOT_VERIFIED');
    assert.equal(p.fundingVerification.actual_funding,false);assert.equal(p.fundingVerification.bankConfirmation.verified,false);assert.equal(p.source.supportingDocuments.complete,true);
    assert.equal((await readControl(env.DB)).head_hash,before.head_hash);assert.equal(JSON.stringify(receipt).includes(env.NUMINA_STRIPE_TREASURY_READ_KEY),false);
    const altered=structuredClone(receipt);altered.payload.fundingVerification.actual_funding=true;assert.equal(await frontierVerify(altered,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),false);
    const combined=structuredClone(receipt);combined.payload.records.reserveAllocation=combined.payload.records.nativeTreasury;assert.equal(await frontierVerify(combined,JSON.parse(env.NUMINA_RECEIPT_PUBLIC_JWK)),false);
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
