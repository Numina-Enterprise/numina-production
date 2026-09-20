import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPinnedEnvelope} from '../api/application-release.mjs';

const evidence=JSON.parse(readFileSync(new URL('../release-evidence/frontier-readiness-19c445b.json',import.meta.url),'utf8'));

test('pinned frontier readiness receipt verifies and binds exact production deployment',()=>{
  const v=evidence.verification;
  const receipt=evidence.receipt;
  assert.equal(v.schema,'numina.frontier-readiness-verification.v1');
  assert.equal(v.signatureVerified,true);
  assert.equal(v.payloadMatchesReceipt,true);
  assert.equal(v.ready,true);
  assert.equal(v.deployed,true);
  assert.equal(v.sourceCommit,'19c445bd88680a2a11ec07a1a87e925be7d71ab5');
  assert.equal(v.deploymentId,'dpl_5kVERo7Vasy99Q9smxZNdf91eNaC');
  assert.equal(v.providerExternalBalanceVerified,false);
  assert.equal(v.evidenceBoundary,'READINESS_AND_SOFTWARE_STATE_ONLY');
  assert.equal(verifyPinnedEnvelope(receipt,'NUMINA_FRONTIER_READINESS'),true);
  assert.deepEqual(receipt.payload, receipt.payload);
  assert.equal(receipt.payload.transport.substrate_observation.observation.git_commit_sha,v.sourceCommit);
  assert.equal(receipt.payload.transport.substrate_observation.observation.deployment_id,v.deploymentId);
});