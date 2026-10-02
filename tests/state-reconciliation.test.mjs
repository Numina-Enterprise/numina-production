import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NUMINA_STATE_RECONCILIATION as state} from '../public/state-reconciliation.js';
import {frontierHttp} from '../src/frontier-http.js';
import {CONTROL_ADAPTER} from '../src/control.js';
import {FRONTIER_PROVIDERS} from '../src/frontier.js';
import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {NUSD_PROVIDER_ROUTING} from '../src/stripe-treasury.js';

test('owner assertions and dated provider activity never enable execution or conversion',()=>{
 assert.equal(state.intendedState.externalExecution,true);
 assert.equal(state.providerConfirmedState.stripeAccountDetailsSubmitted,true);
 assert.equal(state.providerConfirmedState.historicalPaymentsToTreasuryBalanceMovement,true);
 assert.equal(state.providerConfirmedState.numinaControlExecutionLinked,false);
 assert.equal(state.providerConfirmedState.nusdConversionVerified,false);
 assert.equal(CONTROL_ADAPTER.externalExecution,false);
 assert.equal(FRONTIER_PROVIDERS.find(p=>p.id==='stripe').submission,false);
 assert.equal(NUSD_PROVIDER_ROUTING.transferExecution,false);
 assert.equal(NUMINA_DENOMINATION_POLICY.providerBalancesChanged,false);
 assert.equal(NUMINA_DENOMINATION_POLICY.executableConversionVerified,false);
});
test('reconciliation readback is public and reads no journal or provider',async()=>{
 const env=new Proxy({}, {get(){throw Error('unexpected runtime access');}});
 const response=await frontierHttp(new Request('https://numinalabs.xyz/api/control/v2/state-reconciliation'),env);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),state);
});
test('release, architecture, integration and mobile records keep the same scoped descriptor',()=>{
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 assert.deepEqual(read('config/numina-state-reconciliation.v1.json'),state);
 assert.deepEqual(read('public/state-reconciliation.json'),state);
 assert.deepEqual(read('dist/client/source-alignment.json').stateReconciliation,state);
 assert.deepEqual(read('dist/client/downloads/application-release-v4.json').stateReconciliation,state);
 assert.deepEqual(read('integrations/numina/distribution.json').stateReconciliation,state);
 assert.deepEqual(read('integrations/numina/file-manifest.json').stateReconciliation,state);
 assert.equal(read('docs/native-package-record-v4.json').stateReconciliation.storeSubmissionConfirmed,false);
 assert.equal(read('mobile/signing/release-identities.json').canonicalIdentity.rootHash,state.roots.recordedControlGenesisRoot);
 assert.notEqual(state.roots.recordedControlGenesisRoot,state.roots.publicIdentityProjectionRoot);
 assert.equal(state.roots.rootMutationPerformed,false);
});
