import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {NUSD_POLICY} from '../src/nusd-http.js';
import {readFileSync} from 'node:fs';
test('retired reference APIs cannot run or touch storage with or without configured ownership',async()=>{
 for(const owner of [undefined,'email:owner@example.test'])for(const path of ['/api/v0.1/commit','/api/v0.1/verify','/api/v0.1/coverage','/api/core/v1.8/eac/verify','/api/core/v1.8/stability/assess'])for(const method of ['GET','POST']){
  const env={NUMINA_CONTROL_OWNER:owner,get DB(){throw new Error('Retired route touched storage');},ASSETS:{fetch(){throw new Error('Retired route served an asset');}}};
  const response=await worker.fetch(new Request('https://numina.test'+path,{method,...(method==='POST'?{body:'{"paid":true,"mint":true}'}:{})}),env);
  assert.equal(response.status,410,path);assert.equal((await response.json()).error,'REFERENCE_RUNTIME_RETIRED');
 }
});
test('recorded network and token verification remain separate from current financial execution',()=>{
 const verified=JSON.parse(readFileSync(new URL('../runtime/nusd/deployment-verification.json',import.meta.url)));
 assert.equal(NUSD_POLICY.network_policy.name,'Numina');assert.equal(NUSD_POLICY.network_policy.status,'authenticated_provider_live');
 assert.equal(NUSD_POLICY.network_policy.chain_id,verified.chainId);
 assert.equal(NUSD_POLICY.network_policy.genesis_hash,verified.genesisHash);
 assert.equal(NUSD_POLICY.network_policy.explorer_url,null);
 assert.equal(NUSD_POLICY.network_policy.authenticated_rpc_verified,true);
 assert.equal(NUSD_POLICY.network_policy.continuous_monitoring,false);
 assert.equal(NUSD_POLICY.network_policy.independently_verified,false);
 assert.equal(NUSD_POLICY.asset.chain,verified.chainId);assert.equal(NUSD_POLICY.asset.contract,verified.token.address);
 assert.equal(NUSD_POLICY.asset.decimals,18);assert.equal(NUSD_POLICY.capabilities.mint,false);assert.equal(NUSD_POLICY.capabilities.settlement,false);
 assert.equal(NUSD_POLICY.operator_activation.currentChainActivityVerified,true);assert.equal(NUSD_POLICY.capabilities.transfer,true);
});
