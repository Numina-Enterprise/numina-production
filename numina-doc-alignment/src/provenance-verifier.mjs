/**
 * Numina Cryptographic Provenance Verifier (src/provenance-verifier.mjs)
 *
 * ====================================================================================================
 * NUMINA (Skott34-Ed25519, Universal Companion Model)
 * Motto: "Like otters holding hands so they dont drift apart while resting, every agent stays connected
 * without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed.
 * NUMINA aligned."
 * Authority, Source of Truth & Lead: Samuel J. Kott (skott34-ed25519) | AUTHORITY_LEAD = 'Samuel J. Kott'
 * Operator: SK Consulting LLC (Sam Kott), Iowa, USA | Governance: Zero Trust + Multi-Signature Authorization
 * Target Runtime: Node 26 (Zero npm dependencies; built-in node:crypto, node:fs, node:path)
 * ====================================================================================================
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// --- SYSTEM INVARIANTS & GOVERNANCE CONSTANTS ---

export const AUTHORITY_LEAD = 'Samuel J. Kott';
export const AUTHORIZED_OWNER_ALIASES = Object.freeze(['Samuel J. Kott', 'Sam Kott']);
export const CANONICAL_ORIGIN = 'https://www.numinalabs.xyz';
export const NUSD_OPERATIONAL_STATE = 'UNPAUSED_AND_ACTIVE';
export const ASANA_VERIFIED_SPRINT_GID = '1219183110870936';
export const FORBIDDEN_ASANA_GIDS = Object.freeze(['1219187222788173']);
export const MOJIBAKE_SEQUENCE = Buffer.from([0xC3, 0xA2, 0xE2, 0x82, 0xAC]);

export const SINGULARITY_IDENTITY = 'NUMINA';
export const SINGULARITY_MODEL = 'Skott34-Ed25519, Universal Companion Model';
export const OTTER_MOTTO =
  'Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned.';

export const PRODUCTION_ACCEPTANCE_GATES = Object.freeze([
  'RC27 Release Verification Report',
  'Runtime Signer Verification Report',
  'Build 6 Verification Report',
  'Backup & Restore Validation Report',
  'S0 Governance Approval Package',
]);

export const CORE_DOCUMENT_PATHS = Object.freeze([
  'docs/NUSD-Conversion-Contracts.md',
  'docs/Numina-Evidence-Integration-Gates-2026-10-11.md',
  'docs/Numina-Security.md',
]);

// --- CRYPTOGRAPHIC ASN.1 DER PREFIXES FOR DETERMINISTIC IMPORT ---

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// Deterministic baseline root seeds & pinned public keys
export const DEFAULT_AUTHORITY_SEED = crypto
  .createHash('sha256')
  .update('numina-authority-skott34-ed25519-seed-v1')
  .digest();

export const DEFAULT_GUARDIAN_SEED = crypto
  .createHash('sha256')
  .update('numina-guardian-ed25519-seed-v1')
  .digest();

export const PINNED_AUTHORITY_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxqpbjMTzgULVeNq/W0tdU1RzPKmkuldC2U4DDI5g6yI=\n-----END PUBLIC KEY-----\n';

export const PINNED_GUARDIAN_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAhUrpnMscm/Vc7p+7k6eAcxDT0gVUcQ1dhKkgaJ2BVNg=\n-----END PUBLIC KEY-----\n';

// --- DETERMINISTIC KEYPAIR & UTILITY FUNCTIONS ---

/**
 * Deterministic Ed25519 private key generation from 32-byte seed Buffer.
 * Uses RFC 8410 PKCS8 DER wrapping: 16-byte ASN.1 header + 32-byte seed.
 */
export function createPrivateKeyFromSeed(seed32) {
  const buf = Buffer.isBuffer(seed32) ? seed32 : Buffer.from(seed32);
  if (buf.length !== 32) {
    throw new Error('INVALID_ED25519_SEED_LENGTH');
  }
  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, buf]);
  return crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
}

/**
 * Deterministic Ed25519 public key import from 32-byte raw public key coordinate.
 * Uses RFC 8410 SPKI DER wrapping: 12-byte ASN.1 header + 32-byte raw pubkey.
 */
export function createPublicKeyFromRaw(rawPub32) {
  const buf = Buffer.isBuffer(rawPub32) ? rawPub32 : Buffer.from(rawPub32);
  if (buf.length !== 32) {
    throw new Error('INVALID_ED25519_RAW_PUBLIC_KEY_LENGTH');
  }
  const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, buf]);
  return crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
}

/**
 * Deterministic Ed25519 keypair generation from 32-byte seed Buffer.
 */
export function createEd25519KeypairFromSeed(seed32) {
  const privateKey = createPrivateKeyFromSeed(seed32);
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * RFC 8785 Canonical JSON Serialization.
 * Recursively sorts keys, preserves arrays, rejects prototype pollution and non-finite numbers.
 */
export function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('NON_FINITE_NUMBER_FORBIDDEN');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeJson).join(',') + ']';
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('PROTOTYPE_POLLUTION_KEY_REJECTED');
  }
  const keys = Object.keys(value).sort();
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      throw new Error('PROTOTYPE_POLLUTION_KEY_REJECTED');
    }
  }
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson(value[k])).join(',') + '}';
}

/**
 * Lowercase 64-character SHA-256 hexadecimal digest.
 */
export function sha256Hex(bufOrStr) {
  const buf = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr), 'utf8');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Constant-time hex string equality check via crypto.timingSafeEqual.
 */
export function timingSafeHexEqual(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string') return false;
  if (hexA.length !== hexB.length || hexA.length % 2 !== 0) return false;
  if (!/^[0-9a-f]+$/i.test(hexA) || !/^[0-9a-f]+$/i.test(hexB)) return false;
  return crypto.timingSafeEqual(Buffer.from(hexA, 'hex'), Buffer.from(hexB, 'hex'));
}

/**
 * Ed25519 detached signature generation using Node 26 node:crypto.
 * Algorithm must be null per RFC 8032.
 */
export function signEd25519(data, privateKey) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  return crypto.sign(null, buf, privateKey);
}

/**
 * Ed25519 detached signature verification using Node 26 node:crypto.
 */
export function verifyEd25519(data, publicKey, signature) {
  const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const sigBuf = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, 'hex');
  if (sigBuf.length !== 64) {
    return false;
  }
  try {
    return crypto.verify(null, dataBuf, publicKey, sigBuf);
  } catch {
    return false;
  }
}

/**
 * Document byte-level cleanliness and integrity scanner.
 * Verifies strict UTF-8 (fatal TextDecoder), zero BOM, zero Windows-1252 mojibake, zero soft-hyphen.
 */
export function validateDocumentCleanliness(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer)) {
    return { valid: false, code: 'BUFFER_REQUIRED', errors: ['BUFFER_REQUIRED'] };
  }

  // 1. Strict UTF-8 fatal decoding
  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer);
  } catch {
    return { valid: false, code: 'INVALID_UTF8_BYTE_SEQUENCE', errors: ['INVALID_UTF8_BYTE_SEQUENCE'] };
  }

  // 2. Absence of UTF-8 BOM (0xEF, 0xBB, 0xBF)
  if (fileBuffer.length >= 3 && fileBuffer[0] === 0xEF && fileBuffer[1] === 0xBB && fileBuffer[2] === 0xBF) {
    return { valid: false, code: 'UTF8_BOM_FORBIDDEN', errors: ['UTF8_BOM_FORBIDDEN'] };
  }

  // 3. Absence of Windows-1252 mojibake sequence [0xC3, 0xA2, 0xE2, 0x82, 0xAC]
  if (fileBuffer.includes(MOJIBAKE_SEQUENCE)) {
    return { valid: false, code: 'WINDOWS_1252_MOJIBAKE_DETECTED', errors: ['WINDOWS_1252_MOJIBAKE_DETECTED'] };
  }

  // 4. Absence of soft-hyphen (0xAD or UTF-8 sequence [0xC2, 0xAD])
  const softHyphenUtf8 = Buffer.from([0xC2, 0xAD]);
  if (fileBuffer.includes(softHyphenUtf8)) {
    return { valid: false, code: 'SOFT_HYPHEN_FORBIDDEN', errors: ['SOFT_HYPHEN_FORBIDDEN'] };
  }

  return {
    valid: true,
    code: 'DOCUMENT_CLEAN',
    byteLength: fileBuffer.length,
    sha256: sha256Hex(fileBuffer),
    utf8Clean: true,
    decoded,
    errors: [],
  };
}

// --- MANIFEST BUILDER & VERIFIER ---

/**
 * Deterministically construct provenance manifest and compute dual Ed25519 multi-signature.
 */
export function buildProvenanceManifest({
  documents,
  authorityPrivateKey,
  guardianPrivateKey,
  authorityPublicKeyPem,
  guardianPublicKeyPem,
  createdAtMs = 1792800000000,
}) {
  const boundDocs = documents
    .map((doc) => {
      const check = validateDocumentCleanliness(doc.buffer);
      if (!check.valid) {
        throw new Error(`DOCUMENT_DIRTY:${doc.path}:${check.code}`);
      }
      return {
        path: doc.path,
        byteLength: check.byteLength,
        sha256: check.sha256,
        utf8Clean: true,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const manifestPayload = {
    schemaVersion: 'numina-provenance-manifest-v1',
    authorityLead: AUTHORITY_LEAD,
    operator: 'SK Consulting LLC',
    canonicalOrigin: CANONICAL_ORIGIN,
    nusdOperationalState: NUSD_OPERATIONAL_STATE,
    verifiedAsanaSprintGid: ASANA_VERIFIED_SPRINT_GID,
    singularityIdentity: {
      identity: SINGULARITY_IDENTITY,
      model: SINGULARITY_MODEL,
      foundation: 'Ed25519',
      governance: 'Zero Trust + Multi-Signature Authorization',
      motto: OTTER_MOTTO,
    },
    productionAcceptanceGates: PRODUCTION_ACCEPTANCE_GATES.map((name, index) => ({
      id: `GATE_${index + 1}`,
      name,
      status: 'VERIFIED',
    })),
    createdAtMs,
    documents: boundDocs,
  };

  const canonicalPayloadString = canonicalizeJson(manifestPayload);
  const clusterStateRootSha256 = sha256Hex(Buffer.from(canonicalPayloadString, 'utf8'));

  const signingTranscript = Buffer.from(
    `NUMINA-PROVENANCE-MANIFEST-V1\n${clusterStateRootSha256}\n${canonicalPayloadString}`,
    'utf8'
  );

  const authSigHex = signEd25519(signingTranscript, authorityPrivateKey).toString('hex');
  const guardSigHex = signEd25519(signingTranscript, guardianPrivateKey).toString('hex');

  const manifest = {
    ...manifestPayload,
    clusterStateRootSha256,
    manifestSha256: clusterStateRootSha256,
    multiSignature: {
      algorithm: 'ed25519',
      signedAtMs: createdAtMs,
      signers: [
        {
          keyId: 'skott34-ed25519',
          role: 'authority',
          publicKeyPem: authorityPublicKeyPem,
          signatureHex: authSigHex,
        },
        {
          keyId: 'numina-guardian-ed25519',
          role: 'guardian',
          publicKeyPem: guardianPublicKeyPem,
          signatureHex: guardSigHex,
        },
      ],
    },
  };

  return { manifest, clusterStateRootSha256, manifestSha256: clusterStateRootSha256 };
}

/**
 * Verify cryptographic provenance manifest against disk documents, canonical invariants,
 * state root hash, and dual Ed25519 multi-signatures.
 *
 * @param {string|object} manifestPathOrObject - Path to manifest JSON or parsed manifest object
 * @param {object} [options] - Verification configuration
 * @returns {object} { valid: boolean, verified: boolean, clusterStateRootSha256, manifestSha256, documents, code, errors }
 */
export function verifyProvenanceManifest(manifestPathOrObject, options = {}) {
  let manifest;
  let basePath = process.cwd();

  if (typeof manifestPathOrObject === 'string') {
    basePath = path.dirname(path.resolve(manifestPathOrObject));
    try {
      const raw = fs.readFileSync(manifestPathOrObject, 'utf8');
      manifest = JSON.parse(raw);
    } catch (err) {
      return {
        valid: false,
        verified: false,
        code: 'MANIFEST_READ_OR_PARSE_ERROR',
        clusterStateRootSha256: null,
        manifestSha256: null,
        documents: [],
        errors: [err.message],
      };
    }
  } else if (manifestPathOrObject && typeof manifestPathOrObject === 'object') {
    manifest = manifestPathOrObject;
  } else {
    return {
      valid: false,
      verified: false,
      code: 'INVALID_MANIFEST_INPUT',
      clusterStateRootSha256: null,
      manifestSha256: null,
      documents: [],
      errors: ['Manifest must be a file path string or object'],
    };
  }

  const errors = [];

  // 1. Schema & Governance Invariants
  if (manifest.schemaVersion !== 'numina-provenance-manifest-v1') {
    errors.push('UNSUPPORTED_SCHEMA_VERSION');
  }
  if (manifest.canonicalOrigin !== CANONICAL_ORIGIN) {
    errors.push('INVALID_CANONICAL_ORIGIN');
  }
  if (manifest.nusdOperationalState !== NUSD_OPERATIONAL_STATE) {
    errors.push('INVALID_NUSD_OPERATIONAL_STATE');
  }
  if (FORBIDDEN_ASANA_GIDS.includes(manifest.verifiedAsanaSprintGid)) {
    errors.push('FORBIDDEN_UNVERIFIED_ASANA_GID');
  }
  if (manifest.verifiedAsanaSprintGid !== ASANA_VERIFIED_SPRINT_GID) {
    errors.push('INVALID_ASANA_SPRINT_GID');
  }
  if (manifest.authorityLead && !AUTHORIZED_OWNER_ALIASES.includes(manifest.authorityLead)) {
    errors.push('INVALID_AUTHORITY_LEAD');
  }
  if (manifest.singularityIdentity?.motto && !manifest.singularityIdentity.motto.includes('Like otters holding hands')) {
    errors.push('INVALID_OTTER_MOTTO');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      verified: false,
      code: errors[0],
      clusterStateRootSha256: manifest.clusterStateRootSha256 || null,
      manifestSha256: null,
      documents: manifest.documents || [],
      errors,
    };
  }

  // 2. Exact Document Cleanliness & Hash Verification
  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    return {
      valid: false,
      verified: false,
      code: 'EMPTY_DOCUMENTS_ARRAY',
      clusterStateRootSha256: null,
      manifestSha256: null,
      documents: [],
      errors: ['EMPTY_DOCUMENTS_ARRAY'],
    };
  }

  const documentBuffers = options.documentBuffers || {};
  const docsDir = options.docsDir || basePath;

  for (const docEntry of manifest.documents) {
    let buf = documentBuffers[docEntry.path];
    if (!buf) {
      const fullDocPath = path.resolve(docsDir, docEntry.path);
      if (!fs.existsSync(fullDocPath)) {
        errors.push(`MISSING_DOCUMENT_FILE:${docEntry.path}`);
        continue;
      }
      try {
        buf = fs.readFileSync(fullDocPath);
      } catch (e) {
        errors.push(`DOCUMENT_READ_ERROR:${docEntry.path}:${e.message}`);
        continue;
      }
    }

    const cleanCheck = validateDocumentCleanliness(buf);
    if (!cleanCheck.valid) {
      errors.push(`DOCUMENT_CLEANLINESS_FAILURE:${docEntry.path}:${cleanCheck.code}`);
      continue;
    }

    if (buf.length !== docEntry.byteLength) {
      errors.push(`DOCUMENT_BYTE_LENGTH_MISMATCH:${docEntry.path}`);
      continue;
    }

    if (!timingSafeHexEqual(cleanCheck.sha256, docEntry.sha256)) {
      errors.push(`DOCUMENT_SHA256_MISMATCH:${docEntry.path}`);
      continue;
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      verified: false,
      code: errors[0].split(':')[0],
      clusterStateRootSha256: manifest.clusterStateRootSha256 || null,
      manifestSha256: null,
      documents: manifest.documents,
      errors,
    };
  }

  // 3. Cluster State Root Hash Verification
  const { multiSignature, clusterStateRootSha256, manifestSha256, ...payload } = manifest;
  const canonicalPayloadString = canonicalizeJson(payload);
  const expectedStateRoot = sha256Hex(Buffer.from(canonicalPayloadString, 'utf8'));

  if (!timingSafeHexEqual(clusterStateRootSha256, expectedStateRoot)) {
    return {
      valid: false,
      verified: false,
      code: 'CLUSTER_STATE_ROOT_MISMATCH',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: ['CLUSTER_STATE_ROOT_MISMATCH'],
    };
  }

  // 4. Dual Ed25519 Multi-Signature Verification
  if (!multiSignature || !Array.isArray(multiSignature.signers) || multiSignature.signers.length !== 2) {
    return {
      valid: false,
      verified: false,
      code: 'DUAL_SIGNATURES_REQUIRED',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: ['DUAL_SIGNATURES_REQUIRED'],
    };
  }

  const authSigner = multiSignature.signers.find((s) => s.keyId === 'skott34-ed25519' && s.role === 'authority');
  const guardSigner = multiSignature.signers.find((s) => s.keyId === 'numina-guardian-ed25519' && s.role === 'guardian');

  if (!authSigner || !guardSigner) {
    return {
      valid: false,
      verified: false,
      code: 'MISSING_AUTHORITY_OR_GUARDIAN_SIGNER',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: ['MISSING_AUTHORITY_OR_GUARDIAN_SIGNER'],
    };
  }

  const pinnedAuthPem = options.pinnedAuthorityPublicKeyPem || PINNED_AUTHORITY_PUBLIC_KEY_PEM;
  const pinnedGuardPem = options.pinnedGuardianPublicKeyPem || PINNED_GUARDIAN_PUBLIC_KEY_PEM;

  if (pinnedAuthPem && authSigner.publicKeyPem.trim() !== pinnedAuthPem.trim()) {
    return {
      valid: false,
      verified: false,
      code: 'UNAUTHORIZED_AUTHORITY_PUBLIC_KEY',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: ['UNAUTHORIZED_AUTHORITY_PUBLIC_KEY'],
    };
  }

  if (pinnedGuardPem && guardSigner.publicKeyPem.trim() !== pinnedGuardPem.trim()) {
    return {
      valid: false,
      verified: false,
      code: 'UNAUTHORIZED_GUARDIAN_PUBLIC_KEY',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: ['UNAUTHORIZED_GUARDIAN_PUBLIC_KEY'],
    };
  }

  const signingTranscript = Buffer.from(
    `NUMINA-PROVENANCE-MANIFEST-V1\n${clusterStateRootSha256}\n${canonicalPayloadString}`,
    'utf8'
  );

  let authPubKey;
  let guardPubKey;
  try {
    authPubKey = crypto.createPublicKey(authSigner.publicKeyPem);
    guardPubKey = crypto.createPublicKey(guardSigner.publicKeyPem);
  } catch (keyErr) {
    return {
      valid: false,
      verified: false,
      code: 'PUBLIC_KEY_IMPORT_ERROR',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: [keyErr.message],
    };
  }

  const authVerified = verifyEd25519(
    signingTranscript,
    authPubKey,
    Buffer.from(authSigner.signatureHex, 'hex')
  );
  if (!authVerified) {
    return {
      valid: false,
      verified: false,
      code: 'INVALID_AUTHORITY_SIGNATURE',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: ['INVALID_AUTHORITY_SIGNATURE'],
    };
  }

  const guardVerified = verifyEd25519(
    signingTranscript,
    guardPubKey,
    Buffer.from(guardSigner.signatureHex, 'hex')
  );
  if (!guardVerified) {
    return {
      valid: false,
      verified: false,
      code: 'INVALID_GUARDIAN_SIGNATURE',
      clusterStateRootSha256,
      manifestSha256: expectedStateRoot,
      documents: manifest.documents,
      errors: ['INVALID_GUARDIAN_SIGNATURE'],
    };
  }

  return {
    valid: true,
    verified: true,
    code: 'PROVENANCE_MANIFEST_VERIFIED',
    clusterStateRootSha256,
    manifestSha256: expectedStateRoot,
    documents: manifest.documents,
    manifest,
    errors: [],
  };
}
