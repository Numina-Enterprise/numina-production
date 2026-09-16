import test from 'node:test';
import assert from 'node:assert/strict';
import {nusdHttp,NUSD_POLICY,NUSD_APPROVED_REVIEW,NUSD_SIMULATION} from '../src/nusd-http.js';
import {createTreasurySimulation} from '../public/treasury-simulation-model.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

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
 const kit=readFileSync(new URL('../docs/Numina-500T-Preparation-Tools.zip',import.meta.url));
 const record=JSON.parse(readFileSync(new URL('../docs/numina-500t-preparation-tools-record.json',import.meta.url)));
 assert.equal(createHash('sha256').update(kit).digest('hex'),descriptor.productionPreparation.sha256);
 assert.equal(record.sha256,descriptor.productionPreparation.sha256);assert.equal(record.bytes,kit.length);
 assert.equal(descriptor.productionPreparation.productionReady,false);assert.equal(record.financialExecution,false);
});

test('simulation route exposes no mutation and requires no database or provider',async()=>{
 for(const method of ['POST','PUT','PATCH','DELETE']){
  const response=await nusdHttp(new Request('https://numinalabs.xyz/api/nusd/v1/simulation',{method}));
  assert.equal(response.status,405);assert.equal(response.headers.get('allow'),'GET');
 }
});
