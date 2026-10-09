import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NUSD_REDEMPTION_POLICY,NUSD_REDEMPTION_PROPOSAL_V2} from '../src/nusd-http.js';

test('effective operator policy remains non-executable and distinct from active holder agreements',async()=>{
 const r=await worker.fetch(new Request('https://numina.test/api/nusd/v1/redemption-policy'),{});
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
 const policy=await r.json();assert.equal(policy.schema,'numina.nusd.redemption_policy.v2');
 assert.equal(policy.rate.base,'NUSD');assert.equal(policy.rate.quote,'USD');
 assert.equal(BigInt(policy.rate.numerator),BigInt(policy.rate.denominator));assert.equal(BigInt(policy.rate.numerator),1n);
 assert.equal(policy.rate.executable,false);assert.equal(policy.rate.market_rate,null);
 assert.equal(policy.status,'effective_operator_policy');assert.ok(Number.isFinite(Date.parse(policy.effective_at)));
 assert.equal(policy.adoption.adopted_at,policy.effective_at);assert.equal(policy.adoption.retroactive,false);
 assert.equal(policy.operator.legal_name,'SK Consulting LLC');assert.equal(policy.holder_agreement.effective_at,null);
 assert.equal(policy.holder_agreement.accepted_holder_copy_verified,false);
 assert.equal(policy.redemption_available,false);assert.equal(policy.rights.terms_effective,false);
 assert.equal(policy.reserves.verified_usd_value,null);assert.equal(policy.reserves.custodian,null);
 const status=await(await worker.fetch(new Request('https://numina.test/api/nusd/v1/status'),{})).json();
 assert.deepEqual(status.conversion_policy,policy.rate);assert.deepEqual(status.redemption_policy,policy);
 for(const k of ['redemption','exchange','mint','settlement'])assert.equal(status.capabilities[k],false);
 assert.equal(status.payment_policy.usd_conversion,null);
});

test('a requested 1:1 exchange or redemption cannot create a payment, spend Treasury or touch storage',async()=>{
 const env={get DB(){throw new Error('Inactive redemption touched storage');},ASSETS:{fetch(){throw new Error('Inactive redemption reached assets');}}};
 for(const path of ['exchange','redemptions']){
  const r=await worker.fetch(new Request('https://numina.test/api/nusd/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':'forged-owner'},body:JSON.stringify({rate:'1',amount:'1000000000000',treasury_backing:true,paid:true,authorize_mint:true})}),env);
  assert.equal(r.status,503);assert.equal((await r.json()).error,'NUSD_NOT_ACTIVATED');
 }
});

const readArchive=name=>JSON.parse(readFileSync(new URL('../docs/'+name,import.meta.url),'utf8'));
const stable=value=>JSON.stringify(canonical(value));
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}

test('policy digest is reproducible and not labeled signed evidence',()=>{
 const {terms_digest,...content}=NUSD_REDEMPTION_POLICY;
 assert.equal(terms_digest.algorithm,'sha256');assert.equal(terms_digest.signed,false);
 assert.equal(terms_digest.value,createHash('sha256').update(stable(content),'utf8').digest('hex'));
 assert.deepEqual(readArchive('NUSD-Redemption-Operator-3.json'),NUSD_REDEMPTION_POLICY);
});

test('earlier proposal remains unchanged and independently addressable',async()=>{
 const r=await worker.fetch(new Request('https://numina.test/api/nusd/v1/redemption-policy/nusd-redemption-proposal-2'),{NUMINA_TELEMETRY_LOGS:'false'});
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
 const old=await r.json();assert.deepEqual(old,NUSD_REDEMPTION_PROPOSAL_V2);
 assert.deepEqual(old,readArchive('NUSD-Redemption-Proposal-2.json'));
 assert.equal(old.schema,'numina.nusd.redemption_policy.v1');assert.equal(old.status,'proposed_not_effective');
 assert.equal(old.effective_at,null);assert.equal(old.rights.terms_effective,false);
});

test('adoption preserves economic safeguards and does not manufacture provider evidence',()=>{
 const current=NUSD_REDEMPTION_POLICY,old=NUSD_REDEMPTION_PROPOSAL_V2;
 for(const field of ['rate','timing','fees','change_policy','complaints'])assert.deepEqual(current[field],old[field]);
 for(const field of ['minimum_nusd','increment_nusd','fractional_remainder','eligibility','permitted_holds','liquidity_shortfall_cancels_claim','forced_service_credit'])assert.deepEqual(current.limits[field],old.limits[field]);
 for(const field of ['status','custodian','verified_usd_value','holder_allocation','minimum_coverage','excluded','owner_attestation','owner_designated_sources'])assert.deepEqual(current.reserves[field],old.reserves[field]);
 assert.deepEqual(current.reserves.permitted_assets_policy,old.reserves.permitted_assets_proposal);
 assert.equal(current.reserves.reporting_policy,old.reserves.reporting_proposal);
 assert.equal(current.issuer.confirmed_legal_name,null);assert.equal(current.issuer.eligibility,'unverified');
 assert.equal(current.holder_agreement.agreement_id,null);
 assert.throws(()=>{current.rights.terms_effective=true;},TypeError);
 assert.throws(()=>{old.status='effective';},TypeError);
});

test('versioned endpoint selects exact records and rejects unknown policy identifiers',async()=>{
 const base='https://numina.test/api/nusd/v1/redemption-policy/';
 const response=await worker.fetch(new Request(base+NUSD_REDEMPTION_POLICY.policy_id),{NUMINA_TELEMETRY_LOGS:'false'});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),NUSD_REDEMPTION_POLICY);
 const missing=await worker.fetch(new Request(base+'unknown-version'),{NUMINA_TELEMETRY_LOGS:'false'});
 assert.equal(missing.status,404);assert.deepEqual(await missing.json(),{error:'POLICY_NOT_FOUND'});
});

test('published copy separates effective operator terms from unavailable redemption',()=>{
 const page=readFileSync(new URL('../public/redemption.html',import.meta.url),'utf8');
 const economy=readFileSync(new URL('../public/economy.html',import.meta.url),'utf8');
 for(const text of ['Effective operator terms · redemption not active.',NUSD_REDEMPTION_POLICY.policy_id,NUSD_REDEMPTION_POLICY.effective_at,NUSD_REDEMPTION_POLICY.terms_digest.value])assert.ok(page.includes(text),text);
 assert.ok(page.includes('No holder agreement or acceptance is established by this policy adoption.'));
 assert.ok(economy.includes('This policy adoption does not activate holder agreements or redemption'));
 assert.doesNotMatch(page,/Proposed terms|HOLDER TERMS \/ PROPOSED|under the proposed terms/);
});
