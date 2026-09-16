import test from 'node:test';
import assert from 'node:assert/strict';
import {nusdHttp,NUSD_POLICY,NUSD_APPROVED_REVIEW,NUSD_SIMULATION} from '../src/nusd-http.js';
import {createTreasurySimulation} from '../public/treasury-simulation-model.js';

test('simulation descriptor binds one 500T allocation to the approved review without changing production capability',async()=>{
 const state=createTreasurySimulation();
 const response=await nusdHttp(new Request('https://numinalabs.xyz/api/nusd/v1/simulation'));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const descriptor=await response.json();assert.deepEqual(descriptor,NUSD_SIMULATION);
 assert.equal(descriptor.initialSupplyBaseUnits,state.totalBaseUnits);
 assert.equal(descriptor.reviewId,NUSD_APPROVED_REVIEW.id);
 assert.deepEqual(descriptor.source,NUSD_APPROVED_REVIEW.source);
 assert.deepEqual(descriptor.artifact,NUSD_APPROVED_REVIEW.artifact);
 assert.equal(descriptor.execution.receipt,null);assert.equal(descriptor.execution.submission_performed,false);
 assert.equal(descriptor.execution.providerBalancesChanged,false);assert.equal(descriptor.execution.nativeJournalChanged,false);
 for(const name of ['mint','transfer','settlement','redemption','exchange'])assert.equal(NUSD_POLICY.capabilities[name],false);
 assert.equal(NUSD_APPROVED_REVIEW.deployment.contractAddress,null);
 assert.equal(NUSD_POLICY.simulation,NUSD_SIMULATION);
});

test('simulation route exposes no mutation and requires no database or provider',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE']){
  const response=await nusdHttp(new Request('https://numinalabs.xyz/api/nusd/v1/simulation',{method}));
  assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');
 }
});
