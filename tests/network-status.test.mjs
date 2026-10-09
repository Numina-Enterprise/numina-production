import test from 'node:test';
import assert from 'node:assert/strict';
import {networkPresentation,loadNetworkPanels} from '../public/network-status.js';
import {NUSD_POLICY} from '../src/nusd-http.js';

test('network observation preserves its date while pointing to the receipt-backed NUSD status',()=>{
 const view=networkPresentation(NUSD_POLICY);
 assert.match(view.summary,/3 validators in the recorded network configuration/);
 assert.match(view.detail,/962421430/);
 assert.match(view.observed,/2026-09-18 15:31:26.425 UTC/);
 assert.match(view.observed,/not continuous monitoring/);
 assert.match(view.asset,/See the NUSD status record/);
 assert.equal(NUSD_POLICY.asset.contract,'0x491c1DF1b5CA77AF797f052c2310ca17039C931b');
 assert.equal(NUSD_POLICY.asset.decimals,18);
 for(const capability of ['mint','settlement','redemption','exchange'])assert.equal(NUSD_POLICY.capabilities[capability],false);
 assert.equal(NUSD_POLICY.capabilities.transfer,false);
 assert.equal(NUSD_POLICY.network_policy.authenticated_rpc_verified,true);
 assert.equal(NUSD_POLICY.treasury_backing.valuation,null);
});
test('missing, invalid and unexpected network records cannot display a running state',()=>{
 for(const input of [null,{}, {...NUSD_POLICY,network_policy:{...NUSD_POLICY.network_policy,status:'unavailable'}},{...NUSD_POLICY,network_policy:{...NUSD_POLICY.network_policy,observed_at:'unknown'}}])assert.throws(()=>networkPresentation(input));
});
test('a failed refresh removes previous network status instead of keeping it as current',async()=>{
 const nodes=new Map(['summary','detail','observed','asset'].map(key=>[`[data-network-${key}]`,{textContent:'Old success'}]));
 const panel={querySelector:key=>nodes.get(key)};
 await loadNetworkPanels([panel],async()=>{throw new Error('private provider detail');});
 assert.match(nodes.get('[data-network-summary]').textContent,/unavailable/);
 for(const key of ['detail','observed','asset'])assert.equal(nodes.get(`[data-network-${key}]`).textContent,'');
 assert.doesNotMatch(nodes.get('[data-network-summary]').textContent,/private provider/);
});
