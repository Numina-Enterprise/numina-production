import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

test('published 1:1 rate is non-executable and cannot masquerade as active holder terms',async()=>{
 const r=await worker.fetch(new Request('https://numina.test/api/nusd/v1/redemption-policy'),{});
 assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
 const policy=await r.json();assert.equal(policy.schema,'numina.nusd.redemption_policy.v1');
 assert.equal(policy.rate.base,'NUSD');assert.equal(policy.rate.quote,'USD');
 assert.equal(BigInt(policy.rate.numerator),BigInt(policy.rate.denominator));assert.equal(BigInt(policy.rate.numerator),1n);
 assert.equal(policy.rate.executable,false);assert.equal(policy.rate.market_rate,null);
 assert.equal(policy.effective_at,null);assert.equal(policy.redemption_available,false);assert.equal(policy.rights.terms_effective,false);
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
