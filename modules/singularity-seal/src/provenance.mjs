/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Provenance manifests in this repository are signed over a labeled transcript,
 * not over the raw canonical JSON alone:
 *   NUMINA-PROVENANCE-MANIFEST-V1\n<sha256 hex of canonical payload>\n<canonical payload>
 * The payload excludes multiSignature, clusterStateRootSha256, and manifestSha256.
 * Pure Ed25519 signs that transcript. This module seals the same transcript with
 * a composite signature in a sidecar file. It does not rewrite the manifest and
 * it does not replace the existing governance gates in the provenance verifier.
 */

import { LEGACY_SUITE, OBJECTS, SUITE } from './meta.mjs';
import { canonicalBytes, canonicalizeJson, sha256Hex, toBase64 } from './canonical.mjs';
import { signComposite } from './composite.mjs';
import { signEd25519, verifyEd25519 } from './ed25519.mjs';
import { decide, signatureBlock, verifySignatureBlock } from './signatures.mjs';

export const PROVENANCE_DOMAIN = 'NUMINA-PROVENANCE-MANIFEST-V1';
const PROVENANCE = OBJECTS['provenance-record'];

export function provenanceTranscript(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('PROVENANCE_SHAPE');
  }
  if (manifest.schemaVersion !== 'numina-provenance-manifest-v1') {
    throw new Error('PROVENANCE_SCHEMA');
  }
  const { multiSignature, clusterStateRootSha256, manifestSha256, ...payload } = manifest;
  const canonical = canonicalizeJson(payload);
  const root = sha256Hex(Buffer.from(canonical, 'utf8'));
  if (typeof clusterStateRootSha256 === 'string' && clusterStateRootSha256 !== root) {
    throw new Error('CLUSTER_STATE_ROOT_MISMATCH');
  }
  if (typeof manifestSha256 === 'string' && manifestSha256 !== root) {
    throw new Error('MANIFEST_SHA256_MISMATCH');
  }
  const transcript = Buffer.from(PROVENANCE_DOMAIN + '\n' + root + '\n' + canonical, 'utf8');
  return { canonical, root, transcript, multiSignature, payload };
}

export function verifyManifestEd25519(manifest) {
  let transcript;
  let multiSignature;
  try {
    ({ transcript, multiSignature } = provenanceTranscript(manifest));
  } catch (error) {
    return { ok: false, reason: error.message, signers: [] };
  }
  if (!multiSignature || !Array.isArray(multiSignature.signers) || multiSignature.signers.length === 0) {
    return { ok: false, reason: 'ED25519_SIGNERS_REQUIRED', signers: [] };
  }
  if (multiSignature.algorithm !== undefined && multiSignature.algorithm !== 'ed25519') {
    return { ok: false, reason: 'ED25519_ALGORITHM', signers: [] };
  }
  const signers = [];
  for (const signer of multiSignature.signers) {
    let ok = false;
    try {
      const signature = Buffer.from(signer.signatureHex || '', 'hex');
      ok = verifyEd25519(transcript, signer.publicKeyPem, signature);
    } catch {
      ok = false;
    }
    signers.push({ keyId: signer.keyId ?? null, role: signer.role ?? null, ok });
  }
  return { ok: signers.every((signer) => signer.ok), reason: signers.every((signer) => signer.ok) ? undefined : 'ED25519_LOG_FAILED', signers };
}

function sealSignatures(transcript, keys, deterministic) {
  return keys.map((key) => {
    if (key.compositePublic) {
      const sig = signComposite(transcript, key, { ctx: PROVENANCE.ctx, deterministic });
      return signatureBlock(key, { suite: SUITE, ctx: PROVENANCE.ctx, sig: toBase64(sig) });
    }
    const sig = signEd25519(transcript, key.edPrivate);
    return signatureBlock(key, { suite: LEGACY_SUITE, ctx: PROVENANCE.ctx, sig: toBase64(sig) });
  });
}

export function sealProvenance(manifest, keys, { deterministic = false } = {}) {
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('SIGNERS_REQUIRED');
  const { transcript, root } = provenanceTranscript(manifest);
  return {
    v: 1,
    objectType: PROVENANCE.objectType,
    ctx: PROVENANCE.ctx,
    transcriptSha256: sha256Hex(transcript),
    clusterStateRootSha256: root,
    signatures: sealSignatures(transcript, keys, deterministic),
  };
}

export function verifyProvenanceSeal(manifest, seal, policy, { acceptLegacy = false } = {}) {
  let transcript;
  let root;
  try {
    ({ transcript, root } = provenanceTranscript(manifest));
  } catch (error) {
    return { verdict: 'invalid', reason: error.message, objectType: PROVENANCE.objectType, signatures: [], threshold: null };
  }
  if (!seal || seal.v !== 1 || seal.objectType !== PROVENANCE.objectType || seal.ctx !== PROVENANCE.ctx) {
    return { verdict: 'invalid', reason: 'SEAL_SHAPE', objectType: PROVENANCE.objectType, signatures: [] };
  }
  if (seal.clusterStateRootSha256 !== root || seal.transcriptSha256 !== sha256Hex(transcript)) {
    return { verdict: 'invalid', reason: 'SEAL_BINDING_MISMATCH', objectType: PROVENANCE.objectType, signatures: [] };
  }
  const blocks = Array.isArray(seal.signatures) ? seal.signatures : [];
  const checks = blocks.map((block) => verifySignatureBlock(block, transcript, policy, {
    objectType: PROVENANCE.objectType,
    acceptLegacy,
  }));
  const decision = decide(checks, policy, { objectType: PROVENANCE.objectType, acceptLegacy });
  return { ...decision, objectType: PROVENANCE.objectType, ctx: PROVENANCE.ctx };
}

export function provenanceCanonicalPayload(manifest) {
  return canonicalBytes(provenanceTranscript(manifest).payload);
}
