/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPolicy } from '../src/governance.mjs';
import { signEnvelope, verifyEnvelope, signGovernance, verifyGovernance } from '../src/envelope.mjs';
import { sealProvenance, verifyProvenanceSeal, provenanceTranscript } from '../src/provenance.mjs';
import { blankEnvelope, compositePerson, governanceBody, legacyPerson, policyDocument, provenanceRecord } from './helpers.mjs';

function loaded(document) {
  return loadPolicy(document);
}

test('threshold counts people, not algorithms or repeated signatures', () => {
  const alice = {
    composite: compositePerson('alice'),
    legacy: legacyPerson('alice'),
  };
  const bob = { composite: compositePerson('bob') };
  const bothAlgorithms = signEnvelope(blankEnvelope(), [alice.composite, alice.legacy], { deterministic: true });
  const onePerson = verifyEnvelope(bothAlgorithms, loaded(policyDocument({
    k: 2,
    legacyCountsFor: ['task-envelope'],
    people: [alice, bob],
  })), { acceptLegacy: true });
  assert.equal(onePerson.threshold.distinctSigners, 1);
  assert.equal(onePerson.reason, 'THRESHOLD_NOT_MET');
  assert.equal(onePerson.verdict, 'invalid');
  assert.equal(onePerson.signatures.filter((sig) => sig.accepted).length, 2);
  assert.equal(onePerson.signatures.reduce((sum, sig) => sum + sig.counts, 0), 1);
  const repeated = signEnvelope(blankEnvelope(), [alice.composite], { deterministic: true });
  repeated.signatures.push(structuredClone(repeated.signatures[0]));
  const twice = verifyEnvelope(repeated, loaded(policyDocument({ k: 2, people: [alice, bob] })), { acceptLegacy: false });
  assert.equal(twice.threshold.distinctSigners, 1);
  assert.equal(twice.reason, 'THRESHOLD_NOT_MET');
  const pair = signEnvelope(blankEnvelope(), [alice.composite, bob.composite], { deterministic: true });
  const two = verifyEnvelope(pair, loaded(policyDocument({ k: 2, people: [alice, bob] })), { acceptLegacy: false });
  assert.equal(two.verdict, 'valid');
  assert.equal(two.threshold.distinctSigners, 2);
  assert.equal(two.signatures[0].counts, 1);
  assert.equal(two.signatures[0].components['ml-dsa-65'], 'pass');
  assert.equal(two.signatures[0].components.ed25519, 'pass');
});

test('legacy mode is explicit and never reported as valid', () => {
  const alice = { legacy: legacyPerson('alice'), composite: compositePerson('alice') };
  const signed = signEnvelope(blankEnvelope(), [alice.legacy], { deterministic: true });
  const policy = loaded(policyDocument({ phase: 1, k: 1, legacyCountsFor: ['task-envelope'], people: [alice] }));
  const silent = verifyEnvelope(signed, policy, { acceptLegacy: false });
  assert.equal(silent.verdict, 'invalid');
  assert.equal(silent.reason, 'LEGACY_NOT_ACCEPTED');
  assert.notEqual(silent.verdict, 'legacy');
  assert.equal(silent.signatures[0].wouldVerify, true);
  const accepted = verifyEnvelope(signed, policy, { acceptLegacy: true });
  assert.equal(accepted.verdict, 'legacy');
  assert.equal(accepted.signatures[0].components['ml-dsa-65'], 'absent');
  assert.equal(accepted.signatures[0].components.ed25519, 'pass');
  const phase2 = loaded(policyDocument({ phase: 2, k: 1, legacyCountsFor: ['task-envelope'], people: [alice] }));
  const rejected = verifyEnvelope(signed, phase2, { acceptLegacy: true });
  assert.equal(rejected.verdict, 'invalid');
  assert.equal(rejected.reason, 'LEGACY_REJECTED_BY_PHASE');
  assert.notEqual(rejected.verdict, 'legacy');
});

test('a role or signer id on the signature does not grant registry authority', () => {
  const alice = { composite: compositePerson('alice', 'operator') };
  const signed = signEnvelope(blankEnvelope(), [alice.composite], { deterministic: true });
  const policy = loaded(policyDocument({ k: 1, people: [alice] }));
  const role = structuredClone(signed);
  role.signatures[0].role = 'admin';
  assert.equal(verifyEnvelope(role, policy).reason, 'ROLE_MISMATCH');
  const person = structuredClone(signed);
  person.signatures[0].signerId = 'bob';
  assert.equal(verifyEnvelope(person, policy).reason, 'SIGNER_ID_MISMATCH');
});

test('governance changes do not count legacy signatures', () => {
  const alice = { composite: compositePerson('alice'), legacy: legacyPerson('alice') };
  const policy = loaded(policyDocument({
    k: 1,
    legacyCountsFor: ['governance-policy', 'task-envelope'],
    people: [alice],
  }));
  const legacySigned = signGovernance(governanceBody(), [alice.legacy], { deterministic: true });
  const denied = verifyGovernance(legacySigned, policy, { acceptLegacy: true });
  assert.equal(denied.reason, 'LEGACY_REJECTED_FOR_GOVERNANCE');
  assert.notEqual(denied.verdict, 'legacy');
  const compositeSigned = signGovernance(governanceBody(), [alice.composite], { deterministic: true });
  assert.equal(verifyGovernance(compositeSigned, policy, { acceptLegacy: false }).verdict, 'valid');
});

test('provenance seal uses the repository transcript and leaves the manifest unsigned by mutation', () => {
  const alice = { composite: compositePerson('alice'), legacy: legacyPerson('alice') };
  const manifest = provenanceRecord([alice.legacy]);
  const before = JSON.stringify(manifest);
  const { transcript, root } = provenanceTranscript(manifest);
  assert.ok(transcript.toString('utf8').startsWith('NUMINA-PROVENANCE-MANIFEST-V1\n' + root + '\n'));
  const seal = sealProvenance(manifest, [alice.composite], { deterministic: true });
  assert.equal(JSON.stringify(manifest), before);
  const policy = loaded(policyDocument({ k: 1, people: [alice] }));
  const ok = verifyProvenanceSeal(manifest, seal, policy, { acceptLegacy: false });
  assert.equal(ok.verdict, 'valid');
  const tampered = structuredClone(manifest);
  tampered.documents[0].byteLength = 9;
  assert.equal(verifyProvenanceSeal(tampered, seal, policy).reason, 'CLUSTER_STATE_ROOT_MISMATCH');
  const badSeal = structuredClone(seal);
  const raw = Buffer.from(badSeal.signatures[0].sig, 'base64');
  raw[3] ^= 0x01;
  badSeal.signatures[0].sig = raw.toString('base64');
  assert.equal(verifyProvenanceSeal(manifest, badSeal, policy).verdict, 'invalid');
});
