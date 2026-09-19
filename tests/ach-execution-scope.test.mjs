import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {privateBankRouteConfiguration} from '../src/bank-route-model.js';

test('FINAL pins and all maintained ACH projections preserve the latest execution-only instruction',()=>{
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/check-final-build.mjs',import.meta.url))]);
});

test('private bank configuration does not turn routing or native settlement into ACH evidence',()=>{
  for(const env of [{},{NUMINA_BOFA_SAVINGS_ACCOUNT:'123453486',NUMINA_BOFA_ACH_ROUTING_NUMBER:'073000176'}]){
    const route=privateBankRouteConfiguration(env);
    assert.equal(route.identity,'NUMINA');
    assert.equal(route.treasuryIdentity,'NUMINA');
    assert.equal(route.achExecutionScope.treasuryIdentity,'NUMINA NATIVE TREASURY');
    assert.equal(route.achExecutionScope.endpointIdentity,'SK Consulting LLC');
    assert.equal(route.achSubmissionEnabled,false);
    assert.equal(route.achOriginatorSubmissionPerformed,false);
    assert.equal(route.externalAchOriginatorConfirmed,false);
    assert.equal(route.networkSubmissionVerified,false);
    assert.equal(route.settlementPerformed,false);
    assert.equal(route.settlementStatus,'UNVERIFIED');
    assert.equal(route.achTraceNumber,null);
    assert.equal(route.providerConfirmationId,null);
    assert.equal(route.nativeSettlementEvidenceScope,'NUMINA_INTERNAL_SOFTWARE_STATE');
  }
});

test('built web and downloadable FINAL projections carry identical scoped instruction',()=>{
  const json=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url)));
  const source=json('public/final-build.json');
  for(const path of ['dist/client/final-build.json','dist/client/downloads/NUMINA-FINAL-BUILD.json'])assert.deepEqual(json(path),source,path);
});
