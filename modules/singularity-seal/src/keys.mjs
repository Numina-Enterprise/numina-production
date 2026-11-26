/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Composite keys are freshly generated pairs. An Ed25519 seed already used
 * as a standalone legacy key is refused. Pinned repository public keys are
 * refused. Private seeds stay on the key object and are not returned by
 * publicKeyInfo.
 */

import { randomBytes } from 'node:crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  COMPOSITE_PUBLIC_BYTES,
  ED25519_SEED_BYTES,
  ML_DSA_PUBLIC_BYTES,
  ML_DSA_SEED_BYTES,
} from './meta.mjs';
import { fromBase64, sha256Hex, toBase64 } from './canonical.mjs';
import { assertEd25519NotPinned, ed25519FromSeed } from './ed25519.mjs';

function asSeed(seed, length, code) {
  const buf = Buffer.from(seed);
  if (buf.length !== length) throw new Error(code);
  return buf;
}

export function compositeFromSeeds({ mldsaSeed, ed25519Seed, signerId, role, legacyEd25519 = false }) {
  if (legacyEd25519) {
    throw new Error('ED25519_KEY_ALREADY_USED_ALONE');
  }
  if (typeof signerId !== 'string' || signerId.length === 0) {
    throw new Error('SIGNER_ID_REQUIRED');
  }
  if (typeof role !== 'string' || role.length === 0) {
    throw new Error('ROLE_REQUIRED');
  }
  const mldsaSeedBuf = asSeed(mldsaSeed, ML_DSA_SEED_BYTES, 'INVALID_ML_DSA_SEED_LENGTH');
  const edSeedBuf = asSeed(ed25519Seed, ED25519_SEED_BYTES, 'INVALID_ED25519_SEED_LENGTH');
  const mldsa = ml_dsa65.keygen(mldsaSeedBuf);
  const mldsaPublic = Buffer.from(mldsa.publicKey);
  if (mldsaPublic.length !== ML_DSA_PUBLIC_BYTES) {
    throw new Error('ML_DSA_PUBLIC_KEY_LENGTH');
  }
  const ed = ed25519FromSeed(edSeedBuf);
  assertEd25519NotPinned(ed.rawPublicKey);
  const compositePublic = Buffer.concat([mldsaPublic, ed.rawPublicKey]);
  if (compositePublic.length !== COMPOSITE_PUBLIC_BYTES) {
    throw new Error('COMPOSITE_PUBLIC_KEY_LENGTH');
  }
  return {
    signerId,
    role,
    mldsaSeed: mldsaSeedBuf,
    mldsaSecret: mldsa.secretKey,
    mldsaPublic,
    ed25519Seed: edSeedBuf,
    edPrivate: ed.privateKey,
    edPublic: ed.publicKey,
    edPublicRaw: ed.rawPublicKey,
    edPublicPem: ed.publicKeyPem,
    legacyKid: ed.kid,
    compositePublic,
    kid: sha256Hex(compositePublic),
  };
}

export function generateCompositeKey({ signerId, role } = {}) {
  return compositeFromSeeds({
    signerId,
    role,
    mldsaSeed: randomBytes(ML_DSA_SEED_BYTES),
    ed25519Seed: randomBytes(ED25519_SEED_BYTES),
    legacyEd25519: false,
  });
}

export function generateLegacyEd25519Key({ signerId, role } = {}) {
  if (typeof signerId !== 'string' || signerId.length === 0) throw new Error('SIGNER_ID_REQUIRED');
  if (typeof role !== 'string' || role.length === 0) throw new Error('ROLE_REQUIRED');
  const ed = ed25519FromSeed(randomBytes(ED25519_SEED_BYTES));
  return {
    signerId,
    role,
    ed25519Seed: ed.seed,
    edPrivate: ed.privateKey,
    edPublic: ed.publicKey,
    edPublicRaw: ed.rawPublicKey,
    edPublicPem: ed.publicKeyPem,
    kid: ed.kid,
  };
}

export function publicCompositeInfo(key) {
  return {
    signerId: key.signerId,
    role: key.role,
    kid: key.kid,
    publicKey: toBase64(key.compositePublic),
    legacyKid: key.legacyKid,
  };
}

export function loadCompositeKeyFile(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('KEY_FILE_INVALID');
  }
  return compositeFromSeeds({
    signerId: parsed.signerId,
    role: parsed.role,
    mldsaSeed: fromBase64(parsed.mldsaSeed, 'mldsaSeed'),
    ed25519Seed: fromBase64(parsed.ed25519Seed, 'ed25519Seed'),
    legacyEd25519: parsed.legacyEd25519 === true,
  });
}

export function exportCompositeKeyFile(key) {
  return {
    scheme: 'COMPSIG-MLDSA65-Ed25519-SHA512',
    signerId: key.signerId,
    role: key.role,
    mldsaSeed: toBase64(key.mldsaSeed),
    ed25519Seed: toBase64(key.ed25519Seed),
    legacyEd25519: false,
    publicKey: toBase64(key.compositePublic),
    kid: key.kid,
  };
}
