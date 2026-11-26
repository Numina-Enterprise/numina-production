/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Task envelopes have no byte encoding in this repository. The coordination
 * model names six components and says the design still needs implementation.
 * This file defines that encoding: identity, topology, task, evidence,
 * signatures, and protocol version (v), plus objectType so a signature cannot
 * be replayed as another object. The signed bytes are the canonical JSON of
 * the envelope with the signatures array removed.
 */

import { LEGACY_SUITE, OBJECTS, SUITE } from './meta.mjs';
import { canonicalBytes, toBase64 } from './canonical.mjs';
import { signComposite } from './composite.mjs';
import { signEd25519 } from './ed25519.mjs';
import { decide, signatureBlock, verifySignatureBlock } from './signatures.mjs';

const ENVELOPE = OBJECTS['task-envelope'];
const GOVERNANCE = OBJECTS['governance-policy'];
const COMPONENTS = ['identity', 'topology', 'task', 'evidence'];

export function envelopeSignedBody(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('ENVELOPE_SHAPE');
  }
  if (envelope.v !== 1) throw new Error('ENVELOPE_VERSION');
  if (envelope.objectType !== ENVELOPE.objectType) throw new Error('ENVELOPE_OBJECT_TYPE');
  for (const key of COMPONENTS) {
    const value = envelope[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('ENVELOPE_COMPONENT:' + key);
    }
  }
  const body = { ...envelope };
  delete body.signatures;
  return body;
}

function signBody(body, keys, ctx, deterministic) {
  const message = canonicalBytes(body);
  return keys.map((key) => {
    if (key.compositePublic) {
      const sig = signComposite(message, key, { ctx, deterministic });
      return signatureBlock(key, { suite: SUITE, ctx, sig: toBase64(sig) });
    }
    const sig = signEd25519(message, key.edPrivate);
    return signatureBlock(key, { suite: LEGACY_SUITE, ctx, sig: toBase64(sig) });
  });
}

export function signEnvelope(envelope, keys, { deterministic = false } = {}) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('SIGNERS_REQUIRED');
  const body = envelopeSignedBody(envelope);
  return { ...body, signatures: signBody(body, keys, ENVELOPE.ctx, deterministic) };
}

export function verifyEnvelope(envelope, policy, { acceptLegacy = false } = {}) {
  const body = envelopeSignedBody(envelope);
  const message = canonicalBytes(body);
  const blocks = Array.isArray(envelope.signatures) ? envelope.signatures : [];
  const checks = blocks.map((block) => verifySignatureBlock(block, message, policy, {
    objectType: ENVELOPE.objectType,
    acceptLegacy,
  }));
  const decision = decide(checks, policy, { objectType: ENVELOPE.objectType, acceptLegacy });
  return { ...decision, objectType: ENVELOPE.objectType, ctx: ENVELOPE.ctx };
}

export function governanceSignedBody(policyDocument) {
  if (!policyDocument || policyDocument.v !== 1 || policyDocument.objectType !== GOVERNANCE.objectType) {
    throw new Error('GOVERNANCE_SHAPE');
  }
  const body = { ...policyDocument };
  delete body.signatures;
  return body;
}

export function signGovernance(policyDocument, keys, { deterministic = false } = {}) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('SIGNERS_REQUIRED');
  const body = governanceSignedBody(policyDocument);
  return { ...body, signatures: signBody(body, keys, GOVERNANCE.ctx, deterministic) };
}

export function verifyGovernance(policyDocument, authorizingPolicy, { acceptLegacy = false } = {}) {
  const body = governanceSignedBody(policyDocument);
  const message = canonicalBytes(body);
  const blocks = Array.isArray(policyDocument.signatures) ? policyDocument.signatures : [];
  const checks = blocks.map((block) => verifySignatureBlock(block, message, authorizingPolicy, {
    objectType: GOVERNANCE.objectType,
    acceptLegacy,
  }));
  const decision = decide(checks, authorizingPolicy, { objectType: GOVERNANCE.objectType, acceptLegacy });
  return { ...decision, objectType: GOVERNANCE.objectType, ctx: GOVERNANCE.ctx };
}
