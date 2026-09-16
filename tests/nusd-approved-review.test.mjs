import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {nusdHttp,NUSD_POLICY,NUSD_APPROVED_REVIEW} from '../src/nusd-http.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('approved review binds one shared500T to uncapped artifact and local evidence',async()=>{
 const review=NUSD_APPROVED_REVIEW;
 assert.equal(review.approval.approved,true);assert.equal(review.approval.authority,'owner');
 assert.equal(review.supply.policy,'uncapped');assert.equal(review.supply.initialSupplyNusd,'500000000000000');
 assert.equal(review.treasury.countedOnce,true);assert.equal(review.treasury.additionalAllocationNusd,'0');
 assert.equal(BigInt(review.supply.initialSupplyNusd)*1000000n,BigInt(review.supply.initialSupplyBaseUnits));
 for(const item of [review.source,review.artifact,review.policy,review.package])assert.equal(hash(fs.readFileSync(new URL('../docs/'+item.url.replace('/downloads/',''),import.meta.url))),item.sha256);
 const artifact=JSON.parse(fs.readFileSync(new URL('../runtime/nusd/reviews/uncapped-500t/artifacts/NuminaUSD.json',import.meta.url)));
 assert.equal(artifact.abi.find(x=>x.type==='constructor').inputs.length,8);assert.equal(artifact.abi.some(x=>x.name==='cap'),false);
 assert.deepEqual(NUSD_POLICY.approved_review,review);
 assert.equal(review.verification.providerFundingVerified,false);assert.equal(review.verification.chainReceiptVerified,false);
 assert.equal(review.deployment.contractAddress,null);assert.equal(review.deployment.receipt,null);
 assert.ok(Object.values(review.execution).every(x=>x===false));
 const response=await nusdHttp(new Request('https://numinalabs.xyz/api/nusd/v1/approved-review'));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(await response.json(),review);
});
test('approved review endpoint cannot trigger mutations',async()=>{
 for(const method of ['POST','PUT','DELETE']){const response=await nusdHttp(new Request('https://numinalabs.xyz/api/nusd/v1/approved-review',{method}));assert.equal(response.status,405);}
 for(const key of ['mint','transfer','settlement','redemption','exchange'])assert.equal(NUSD_POLICY.capabilities[key],false);
});
