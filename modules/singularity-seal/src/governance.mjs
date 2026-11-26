/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Thresholds count distinct signerId values (people). One person with a
 * composite signature, a legacy signature, or both, counts as one. Algorithms
 * and repeated signatures do not increase the count. A signature proves key
 * possession. The role comes only from the policy registry.
 */

import { OBJECTS, LEGACY_SUITE, SUITE, SUITE_OID, LEGACY_OID } from './meta.mjs';
import { fromBase64, sha256Hex } from './canonical.mjs';
import { splitCompositePublicKey } from './composite.mjs';

const PHASES = new Set([0, 1, 2]);

function suiteAllowed(policy, suite) {
  if (policy.phase === 0) return suite === LEGACY_SUITE;
  if (policy.phase === 2) return suite === SUITE;
  return suite === SUITE || suite === LEGACY_SUITE;
}

export function loadPolicy(input) {
  const policy = typeof input === 'string' ? JSON.parse(input) : input;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('POLICY_INVALID');
  }
  if (policy.v !== 1) throw new Error('POLICY_VERSION');
  if (!PHASES.has(policy.phase)) throw new Error('POLICY_PHASE');
  const k = policy.threshold?.k;
  if (!Number.isInteger(k) || k < 1) throw new Error('POLICY_THRESHOLD');
  if (!Array.isArray(policy.signers) || policy.signers.length < k) {
    throw new Error('POLICY_SIGNERS');
  }
  const legacyCountsFor = Array.isArray(policy.legacyCountsFor) ? [...policy.legacyCountsFor] : [];
  const signers = new Map();
  const byKid = new Map();
  for (const entry of policy.signers) {
    if (!entry || typeof entry.signerId !== 'string' || typeof entry.role !== 'string') {
      throw new Error('POLICY_SIGNER_FIELDS');
    }
    if (signers.has(entry.signerId)) throw new Error('POLICY_DUPLICATE_SIGNER');
    const person = { signerId: entry.signerId, role: entry.role, composite: null, legacy: null };
    if (entry.composite) {
      const publicKey = fromBase64(entry.composite.publicKey, 'composite.publicKey');
      splitCompositePublicKey(publicKey);
      const kid = sha256Hex(publicKey);
      if (entry.composite.kid !== kid) throw new Error('POLICY_KID_MISMATCH');
      if (byKid.has(kid)) throw new Error('POLICY_DUPLICATE_KID');
      person.composite = { kid, publicKey };
      byKid.set(kid, { signerId: entry.signerId, kind: 'composite' });
    }
    if (entry.legacy) {
      const publicKey = fromBase64(entry.legacy.publicKey, 'legacy.publicKey');
      if (publicKey.length !== 32) throw new Error('POLICY_LEGACY_KEY_LENGTH');
      const kid = sha256Hex(publicKey);
      if (entry.legacy.kid !== kid) throw new Error('POLICY_KID_MISMATCH');
      if (byKid.has(kid)) throw new Error('POLICY_DUPLICATE_KID');
      person.legacy = { kid, publicKey };
      byKid.set(kid, { signerId: entry.signerId, kind: 'legacy' });
    }
    if (!person.composite && !person.legacy) throw new Error('POLICY_SIGNER_KEY');
    signers.set(entry.signerId, person);
  }
  return {
    v: 1,
    phase: policy.phase,
    threshold: { k },
    legacyCountsFor,
    signers,
    byKid,
    signerCount: signers.size,
  };
}

export function policyEntryForSignature(policy, block) {
  const found = policy.byKid.get(block.kid);
  if (!found) return { error: 'UNKNOWN_SIGNER' };
  const person = policy.signers.get(found.signerId);
  if (block.signerId !== person.signerId) return { error: 'SIGNER_ID_MISMATCH' };
  if (block.role !== person.role) return { error: 'ROLE_MISMATCH' };
  return { person, kind: found.kind };
}

export function expectedOid(suite) {
  if (suite === SUITE) return SUITE_OID;
  if (suite === LEGACY_SUITE) return LEGACY_OID;
  return null;
}

export function legacyMayCount(policy, objectType, acceptLegacy) {
  if (objectType === 'governance-policy') return false;
  if (!acceptLegacy) return false;
  if (policy.phase >= 2) return false;
  if (policy.phase === 0) return true;
  return policy.legacyCountsFor.includes(objectType);
}

export function evaluateThreshold(checks, policy, { objectType, acceptLegacy }) {
  const people = new Map();
  for (const check of checks) {
    if (!check.accepted) continue;
    if (people.has(check.signerId)) {
      check.counts = 0;
      check.repeatedSigner = true;
      continue;
    }
    people.set(check.signerId, { signerId: check.signerId, suite: check.suite, repeated: false });
  }
  const count = people.size;
  const met = count >= policy.threshold.k;
  return {
    k: policy.threshold.k,
    n: policy.signerCount,
    distinctSigners: count,
    met,
    people: [...people.values()],
    reason: met ? undefined : 'THRESHOLD_NOT_MET',
    objectType,
    acceptLegacy: acceptLegacy === true,
  };
}

export function objectSpec(objectType) {
  const spec = OBJECTS[objectType];
  if (!spec) throw new Error('UNKNOWN_OBJECT_TYPE');
  return spec;
}

export function suitePhaseAllows(policy, suite) {
  return suiteAllowed(policy, suite);
}
