/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Archive Seal counter-signs a batch of existing Ed25519 logs with ML-DSA-65.
 * It writes a separate archive object. It does not change the records or the
 * live signing path. The signed statement is a Merkle root plus the ordered
 * leaf hashes and batch metadata. Thresholds count distinct signerId values.
 */

import { randomBytes } from 'node:crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { ARCHIVE_SUITE, ML_DSA_PUBLIC_BYTES, ML_DSA_SEED_BYTES, ML_DSA_SIGNATURE_BYTES, OBJECTS } from './meta.mjs';
import { canonicalBytes, canonicalizeJson, fromBase64, sha256, sha256Hex, toBase64 } from './canonical.mjs';
import { ed25519KeyFromRawPublic, verifyEd25519 } from './ed25519.mjs';
import { verifyManifestEd25519 } from './provenance.mjs';

const ARCHIVE = OBJECTS['archive-seal'];
const ARCHIVE_PREFIX = Buffer.from('ARCHIVE-SEAL-V1\n', 'utf8');

export function generateArchiveKey({ signerId } = {}) {
  if (typeof signerId !== 'string' || signerId.length === 0) throw new Error('SIGNER_ID_REQUIRED');
  const seed = randomBytes(ML_DSA_SEED_BYTES);
  return archiveKeyFromSeed({ signerId, seed });
}

export function archiveKeyFromSeed({ signerId, seed }) {
  if (typeof signerId !== 'string' || signerId.length === 0) throw new Error('SIGNER_ID_REQUIRED');
  const seedBuf = Buffer.from(seed);
  if (seedBuf.length !== ML_DSA_SEED_BYTES) throw new Error('INVALID_ML_DSA_SEED_LENGTH');
  const generated = ml_dsa65.keygen(seedBuf);
  const publicKey = Buffer.from(generated.publicKey);
  if (publicKey.length !== ML_DSA_PUBLIC_BYTES) throw new Error('ML_DSA_PUBLIC_KEY_LENGTH');
  return {
    signerId,
    seed: seedBuf,
    secretKey: generated.secretKey,
    publicKey,
    kid: sha256Hex(publicKey),
  };
}

function nodeHash(left, right) {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

export function merkle(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) throw new Error('EMPTY_BATCH');
  let level = leaves.map((leaf) => Buffer.from(leaf));
  const odd = [];
  while (level.length > 1) {
    if (level.length % 2 === 1) odd.push(level.length);
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(nodeHash(level[i], right));
    }
    level = next;
  }
  return { root: level[0], oddLevels: odd };
}

export function leafHash(record) {
  return sha256(Buffer.concat([Buffer.from([0x00]), canonicalBytes(record)]));
}

function evidencePreimage(record) {
  return canonicalBytes({
    artifact_type: record.artifact_type,
    key_id: record.key_id,
    payload: record.payload,
  });
}

export function verifyEmbeddedEd25519(record) {
  if (record && record.schemaVersion === 'numina-provenance-manifest-v1') {
    return verifyManifestEd25519(record);
  }
  if (record && record.algorithm === 'Ed25519' && record.artifact_type && record.key_id && record.payload && record.public_key && record.signature) {
    try {
      const raw = fromBase64(record.public_key, 'public_key');
      const signature = fromBase64(record.signature, 'signature');
      if (raw.length !== 32) return { ok: false, reason: 'ED25519_PUBLIC_KEY_LENGTH' };
      const kid = sha256Hex(raw).slice(0, 24);
      if (record.key_id !== kid) return { ok: false, reason: 'EVIDENCE_KEY_ID_MISMATCH' };
      const ok = verifyEd25519(evidencePreimage(record), ed25519KeyFromRawPublic(raw), signature);
      return { ok, reason: ok ? undefined : 'ED25519_LOG_FAILED' };
    } catch (error) {
      return { ok: false, reason: error.message };
    }
  }
  return { ok: false, reason: 'UNRECOGNIZED_ED25519_LOG' };
}

function signedBytes(body) {
  return Buffer.concat([ARCHIVE_PREFIX, canonicalBytes(body)]);
}

export function sealArchive(records, keys, { batchId, signedAt, thresholdK, deterministic = false } = {}) {
  if (!Array.isArray(records) || records.length === 0) throw new Error('EMPTY_BATCH');
  if (!Array.isArray(keys) || keys.length === 0) throw new Error('SIGNERS_REQUIRED');
  if (typeof batchId !== 'string' || batchId.length === 0) throw new Error('BATCH_ID_REQUIRED');
  const embedded = records.map((record) => verifyEmbeddedEd25519(record));
  if (embedded.some((item) => !item.ok)) {
    throw new Error('ED25519_LOG_FAILED');
  }
  const leaves = records.map((record) => leafHash(record));
  const tree = merkle(leaves);
  const k = thresholdK ?? keys.length;
  if (!Number.isInteger(k) || k < 1 || k > keys.length) throw new Error('ARCHIVE_THRESHOLD');
  const body = {
    v: 1,
    product: 'archive-seal',
    objectType: ARCHIVE.objectType,
    suite: ARCHIVE_SUITE,
    ctx: ARCHIVE.ctx,
    batchId,
    signedAt: signedAt ?? new Date().toISOString(),
    hash: 'sha256',
    leafDomain: '00',
    nodeDomain: '01',
    oddNode: 'duplicate-last',
    leafCount: records.length,
    leafHashes: leaves.map((leaf) => leaf.toString('hex')),
    merkleRoot: tree.root.toString('hex'),
    threshold: { k },
  };
  const message = signedBytes(body);
  const ctx = Buffer.from(ARCHIVE.ctx, 'utf8');
  const signatures = keys.map((key) => {
    const sig = Buffer.from(ml_dsa65.sign(message, key.secretKey, {
      context: ctx,
      extraEntropy: deterministic ? false : undefined,
    }));
    if (sig.length !== ML_DSA_SIGNATURE_BYTES) throw new Error('ML_DSA_SIGNATURE_LENGTH');
    return {
      v: 1,
      suite: ARCHIVE_SUITE,
      signerId: key.signerId,
      kid: key.kid,
      publicKey: toBase64(key.publicKey),
      sig: toBase64(sig),
    };
  });
  return { ...body, signatures };
}

function verifyArchiveSignature(block, message, policy) {
  const base = {
    signerId: block?.signerId ?? null,
    suite: block?.suite ?? null,
    kid: block?.kid ?? null,
    accepted: false,
    counts: 0,
    components: { 'ml-dsa-65': 'fail' },
    verdict: 'invalid',
  };
  if (!block || block.v !== 1 || block.suite !== ARCHIVE_SUITE) return { ...base, reason: 'ARCHIVE_SIGNATURE_SUITE' };
  if (typeof block.signerId !== 'string' || typeof block.kid !== 'string') return { ...base, reason: 'ARCHIVE_SIGNATURE_FIELDS' };
  let publicKey;
  let sig;
  try {
    publicKey = fromBase64(block.publicKey, 'publicKey');
    sig = fromBase64(block.sig, 'sig');
  } catch (error) {
    return { ...base, reason: error.message };
  }
  if (publicKey.length !== ML_DSA_PUBLIC_BYTES || sig.length !== ML_DSA_SIGNATURE_BYTES) {
    return { ...base, reason: 'ARCHIVE_SIGNATURE_LENGTH' };
  }
  const kid = sha256Hex(publicKey);
  if (block.kid !== kid) return { ...base, reason: 'ARCHIVE_KID_MISMATCH' };
  if (policy) {
    const allowed = policy.signers?.find((signer) => signer.signerId === block.signerId && signer.kid === kid);
    if (!allowed) return { ...base, reason: 'UNKNOWN_SIGNER' };
  }
  let ok = false;
  try {
    ok = ml_dsa65.verify(sig, message, publicKey, { context: Buffer.from(ARCHIVE.ctx, 'utf8') });
  } catch {
    ok = false;
  }
  return {
    ...base,
    accepted: ok,
    counts: ok ? 1 : 0,
    components: { 'ml-dsa-65': ok ? 'pass' : 'fail' },
    verdict: ok ? 'valid' : 'invalid',
    reason: ok ? undefined : 'ML_DSA_FAILED',
  };
}

export function verifyArchive(archive, records, { policy = null } = {}) {
  const reasons = [];
  if (!archive || archive.v !== 1 || archive.objectType !== ARCHIVE.objectType || archive.ctx !== ARCHIVE.ctx) {
    return { ok: false, verdict: 'invalid', reasons: ['SEAL_SHAPE'], signatures: [] };
  }
  if (!Array.isArray(records) || records.length !== archive.leafCount) {
    reasons.push('BATCH_LENGTH_MISMATCH');
  }
  const embedded = (Array.isArray(records) ? records : []).map((record, index) => ({
    index,
    ...verifyEmbeddedEd25519(record),
  }));
  if (embedded.some((item) => !item.ok)) reasons.push('ED25519_LOG_FAILED');
  let root = null;
  if (Array.isArray(records) && records.length > 0) {
    const leaves = records.map((record) => leafHash(record));
    const leafHex = leaves.map((leaf) => leaf.toString('hex'));
    if (!Array.isArray(archive.leafHashes) || leafHex.length !== archive.leafHashes.length || leafHex.some((hex, index) => hex !== archive.leafHashes[index])) {
      reasons.push('MERKLE_ROOT_MISMATCH');
    }
    root = merkle(leaves).root.toString('hex');
    if (root !== archive.merkleRoot) reasons.push('MERKLE_ROOT_MISMATCH');
  } else if (!reasons.includes('BATCH_LENGTH_MISMATCH')) {
    reasons.push('EMPTY_BATCH');
  }
  const { signatures, ...body } = archive;
  const checks = (Array.isArray(signatures) ? signatures : []).map((block) => verifyArchiveSignature(block, signedBytes(body), policy));
  if (checks.length === 0) reasons.push('NO_SIGNATURES');
  if (checks.some((check) => !check.accepted)) reasons.push('ML_DSA_FAILED');
  const people = new Map();
  for (const check of checks) {
    if (!check.accepted) continue;
    if (people.has(check.signerId)) {
      check.counts = 0;
      check.repeatedSigner = true;
      continue;
    }
    people.set(check.signerId, check.signerId);
  }
  const k = archive.threshold?.k;
  const distinctSigners = people.size;
  if (!Number.isInteger(k) || distinctSigners < k) reasons.push('THRESHOLD_NOT_MET');
  const uniqueReasons = [...new Set(reasons)];
  const ok = uniqueReasons.length === 0;
  return {
    ok,
    verdict: ok ? 'valid' : 'invalid',
    reasons: uniqueReasons,
    reason: uniqueReasons[0],
    merkleRoot: root,
    distinctSigners,
    threshold: { k: k ?? null, distinctSigners },
    signatures: checks,
    embedded,
  };
}

export function exportArchiveKeyFile(key) {
  return {
    scheme: ARCHIVE_SUITE,
    signerId: key.signerId,
    seed: toBase64(key.seed),
    publicKey: toBase64(key.publicKey),
    kid: key.kid,
  };
}

export function loadArchiveKeyFile(parsed) {
  if (!parsed || parsed.scheme !== ARCHIVE_SUITE) throw new Error('KEY_FILE_INVALID');
  return archiveKeyFromSeed({ signerId: parsed.signerId, seed: fromBase64(parsed.seed, 'seed') });
}

export function canonicalRecord(record) {
  return canonicalizeJson(record);
}
