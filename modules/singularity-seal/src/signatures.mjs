/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * One signature block is one signer. Composite blocks verify only when both
 * halves pass. Legacy Ed25519 blocks stay invalid unless the caller passes
 * acceptLegacy, and even then the verdict is legacy rather than valid.
 */

import { LEGACY_SUITE, SUITE } from './meta.mjs';
import { fromBase64 } from './canonical.mjs';
import { verifyComposite } from './composite.mjs';
import { ed25519KeyFromRawPublic, verifyEd25519 } from './ed25519.mjs';
import {
  evaluateThreshold,
  expectedOid,
  legacyMayCount,
  objectSpec,
  policyEntryForSignature,
  suitePhaseAllows,
} from './governance.mjs';

const REQUIRED = ['v', 'suite', 'suiteOid', 'kid', 'signerId', 'role', 'ctx', 'sig'];

export function signatureBlock(key, { suite, ctx, sig }) {
  if (suite === SUITE) {
    return {
      v: 1,
      suite: SUITE,
      suiteOid: expectedOid(SUITE),
      kid: key.kid,
      signerId: key.signerId,
      role: key.role,
      ctx,
      sig,
    };
  }
  if (suite === LEGACY_SUITE) {
    return {
      v: 1,
      suite: LEGACY_SUITE,
      suiteOid: expectedOid(LEGACY_SUITE),
      kid: key.kid,
      signerId: key.signerId,
      role: key.role,
      ctx,
      sig,
    };
  }
  throw new Error('UNKNOWN_SUITE');
}

export function verifySignatureBlock(block, message, policy, { objectType, acceptLegacy }) {
  const components = { 'ml-dsa-65': 'absent', ed25519: 'absent' };
  const base = {
    signerId: block?.signerId ?? null,
    role: block?.role ?? null,
    suite: block?.suite ?? null,
    kid: block?.kid ?? null,
    accepted: false,
    counts: 0,
    components,
    verdict: 'invalid',
  };
  if (!block || typeof block !== 'object') return { ...base, reason: 'SIGNATURE_BLOCK' };
  for (const field of REQUIRED) {
    if (typeof block[field] !== 'string' && field !== 'v') {
      return { ...base, reason: 'SIGNATURE_FIELD:' + field };
    }
  }
  if (block.v !== 1) return { ...base, reason: 'SIGNATURE_VERSION' };
  let spec;
  try {
    spec = objectSpec(objectType);
  } catch (error) {
    return { ...base, reason: error.message };
  }
  if (block.ctx !== spec.ctx) return { ...base, reason: 'CTX_MISMATCH' };
  if (expectedOid(block.suite) !== block.suiteOid) return { ...base, reason: 'SUITE_OID_MISMATCH' };
  const legacyInPhase2 = block.suite === LEGACY_SUITE && policy.phase >= 2;
  if (!legacyInPhase2 && !suitePhaseAllows(policy, block.suite)) return { ...base, reason: 'SUITE_NOT_IN_PHASE' };
  const located = policyEntryForSignature(policy, block);
  if (located.error) return { ...base, reason: located.error };
  if (block.suite === SUITE && located.kind !== 'composite') return { ...base, reason: 'KEY_KIND_MISMATCH' };
  if (block.suite === LEGACY_SUITE && located.kind !== 'legacy') return { ...base, reason: 'KEY_KIND_MISMATCH' };

  if (block.suite === SUITE) {
    let raw;
    try {
      raw = fromBase64(block.sig, 'sig');
    } catch (error) {
      return { ...base, reason: error.message };
    }
    const result = verifyComposite(message, located.person.composite.publicKey, raw, { ctx: spec.ctx });
    return {
      ...base,
      components: result.components,
      accepted: result.ok,
      counts: result.ok ? 1 : 0,
      verdict: result.ok ? 'valid' : 'invalid',
      reason: result.reason,
    };
  }

  if (block.suite === LEGACY_SUITE) {
    let raw;
    try {
      raw = fromBase64(block.sig, 'sig');
    } catch (error) {
      return { ...base, reason: error.message };
    }
    const cryptoOk = verifyEd25519(message, ed25519KeyFromRawPublic(located.person.legacy.publicKey), raw);
    const componentsLegacy = { 'ml-dsa-65': 'absent', ed25519: cryptoOk ? 'pass' : 'fail' };
    if (!cryptoOk) {
      return { ...base, components: componentsLegacy, reason: 'LEGACY_SIGNATURE_FAILED' };
    }
    if (!acceptLegacy) {
      return { ...base, components: componentsLegacy, reason: 'LEGACY_NOT_ACCEPTED', wouldVerify: true };
    }
    if (policy.phase >= 2) {
      return { ...base, components: componentsLegacy, reason: 'LEGACY_REJECTED_BY_PHASE', wouldVerify: true };
    }
    if (!legacyMayCount(policy, objectType, true)) {
      const reason = objectType === 'governance-policy' ? 'LEGACY_REJECTED_FOR_GOVERNANCE' : 'LEGACY_DOES_NOT_COUNT';
      return { ...base, components: componentsLegacy, reason, wouldVerify: true };
    }
    return {
      ...base,
      components: componentsLegacy,
      accepted: true,
      counts: 1,
      verdict: 'legacy',
    };
  }
  return { ...base, reason: 'UNKNOWN_SUITE' };
}

export function decide(checks, policy, { objectType, acceptLegacy }) {
  const threshold = evaluateThreshold(checks, policy, { objectType, acceptLegacy });
  const refused = checks.find((check) => check.reason && check.reason.startsWith('LEGACY_') && check.reason !== 'LEGACY_SIGNATURE_FAILED' && !check.accepted);
  if (checks.length === 0) {
    return { verdict: 'invalid', reason: 'NO_SIGNATURES', threshold, signatures: checks };
  }
  if (refused) {
    return { verdict: 'invalid', reason: refused.reason, threshold, signatures: checks };
  }
  if (checks.some((check) => !check.accepted)) {
    const failed = checks.find((check) => !check.accepted);
    return { verdict: 'invalid', reason: failed.reason || 'SIGNATURE_REJECTED', threshold, signatures: checks };
  }
  if (!threshold.met) {
    return { verdict: 'invalid', reason: 'THRESHOLD_NOT_MET', threshold, signatures: checks };
  }
  const legacyUsed = checks.some((check) => check.verdict === 'legacy');
  return {
    verdict: legacyUsed ? 'legacy' : 'valid',
    reason: undefined,
    threshold,
    signatures: checks,
  };
}
