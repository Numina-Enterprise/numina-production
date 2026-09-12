import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {NUSD_POLICY} from '../src/nusd-http.js';
test('retired reference APIs cannot run or touch storage with or without configured ownership',async()=>{
 for(const owner of [undefined,'email:owner@example.test'])for(const path of ['/api/v0.1/commit','/api/v0.1/verify','/api/v0.1/coverage','/api/core/v1.8/eac/verify','/api/core/v1.8/stability/assess'])for(const method of ['GET','POST']){
  const env={NUMINA_CONTROL_OWNER:owner,get DB(){throw new Error('Retired route touched storage');},ASSETS:{fetch(){throw new Error('Retired route served an asset');}}};
  const response=await worker.fetch(new Request('https://numina.test'+path,{method,...(method==='POST'?{body:'{"paid":true,"mint":true}'}:{})}),env);
  assert.equal(response.status,410,path);assert.equal((await response.json()).error,'REFERENCE_RUNTIME_RETIRED');
 }
});
test('provider network provisioning is separate from token identity and financial execution',()=>{
 assert.equal(NUSD_POLICY.network_policy.name,'Numina');assert.equal(NUSD_POLICY.network_policy.status,'provider_reported_live');
 assert.equal(NUSD_POLICY.network_policy.chain_id,'962421430');
 for(const key of ['explorer_url','genesis_hash'])assert.equal(NUSD_POLICY.network_policy[key],null);
 assert.equal(NUSD_POLICY.network_policy.independently_verified,false);
 assert.equal(NUSD_POLICY.asset.chain,null);assert.equal(NUSD_POLICY.asset.contract,null);assert.equal(NUSD_POLICY.capabilities.mint,false);assert.equal(NUSD_POLICY.capabilities.settlement,false);
});
