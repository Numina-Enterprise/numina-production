/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * RFC 10073 composite ML-DSA-65 + Ed25519 (SHA-512 prehash of the message).
 * A composite signature verifies only when both component signatures verify.
 * ML-DSA is @noble/post-quantum ml_dsa65 (FIPS 204). Ed25519 is node:crypto.
 */

import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  COMPOSITE_PUBLIC_BYTES,
  COMPOSITE_SIGNATURE_BYTES,
  ED25519_PUBLIC_BYTES,
  ED25519_SIGNATURE_BYTES,
  LABEL_ASCII,
  ML_DSA_PUBLIC_BYTES,
  ML_DSA_SIGNATURE_BYTES,
  PREFIX_ASCII,
  SUITE,
} from './meta.mjs';
import { sha512 } from './canonical.mjs';
import { ed25519KeyFromRawPublic, signEd25519, verifyEd25519 } from './ed25519.mjs';

const PREFIX = Buffer.from(PREFIX_ASCII, 'ascii');
const LABEL = Buffer.from(LABEL_ASCII, 'ascii');

export function messageRepresentative(message, ctx) {
  const ctxBytes = Buffer.isBuffer(ctx) ? ctx : Buffer.from(String(ctx), 'utf8');
  if (ctxBytes.length > 255) {
    throw new Error('CTX_TOO_LONG');
  }
  const body = Buffer.isBuffer(message) ? message : Buffer.from(message);
  const digest = sha512(body);
  if (digest.length !== 64) {
    throw new Error('SHA512_LENGTH');
  }
  return Buffer.concat([PREFIX, LABEL, Buffer.from([ctxBytes.length]), ctxBytes, digest]);
}

export function splitCompositePublicKey(publicKey) {
  const raw = Buffer.from(publicKey);
  if (raw.length !== COMPOSITE_PUBLIC_BYTES) {
    throw new Error('COMPOSITE_PUBLIC_KEY_LENGTH');
  }
  return {
    mldsaPublic: raw.subarray(0, ML_DSA_PUBLIC_BYTES),
    edPublic: raw.subarray(ML_DSA_PUBLIC_BYTES),
  };
}

export function splitCompositeSignature(signature) {
  const raw = Buffer.from(signature);
  if (raw.length !== COMPOSITE_SIGNATURE_BYTES) {
    return null;
  }
  const mldsaSig = raw.subarray(0, ML_DSA_SIGNATURE_BYTES);
  const edSig = raw.subarray(ML_DSA_SIGNATURE_BYTES);
  if (edSig.length !== ED25519_SIGNATURE_BYTES) return null;
  return { mldsaSig, edSig };
}

function asUint8(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

export function signComposite(message, key, { ctx, deterministic = false } = {}) {
  if (!key?.mldsaSecret || !key?.edPrivate || !key?.compositePublic) {
    throw new Error('COMPOSITE_KEY_REQUIRED');
  }
  if (key.compositePublic.length !== COMPOSITE_PUBLIC_BYTES) {
    throw new Error('COMPOSITE_PUBLIC_KEY_LENGTH');
  }
  if (key.edPublicRaw.length !== ED25519_PUBLIC_BYTES) {
    throw new Error('INVALID_ED25519_RAW_PUBLIC_KEY_LENGTH');
  }
  const mPrime = messageRepresentative(message, ctx);
  const mldsaSig = Buffer.from(
    ml_dsa65.sign(asUint8(mPrime), asUint8(key.mldsaSecret), {
      context: asUint8(LABEL),
      extraEntropy: deterministic ? false : undefined,
    }),
  );
  if (mldsaSig.length !== ML_DSA_SIGNATURE_BYTES) {
    throw new Error('ML_DSA_SIGNATURE_LENGTH');
  }
  const edSig = signEd25519(mPrime, key.edPrivate);
  const signature = Buffer.concat([mldsaSig, edSig]);
  if (signature.length !== COMPOSITE_SIGNATURE_BYTES) {
    throw new Error('COMPOSITE_SIGNATURE_LENGTH');
  }
  return signature;
}

export function verifyComposite(message, publicKey, signature, { ctx } = {}) {
  const components = { 'ml-dsa-65': 'fail', ed25519: 'fail' };
  let mldsaPublic;
  let edPublic;
  try {
    ({ mldsaPublic, edPublic } = splitCompositePublicKey(publicKey));
  } catch {
    return { ok: false, verdict: 'invalid', reason: 'COMPOSITE_PUBLIC_KEY_LENGTH', components };
  }
  const parts = splitCompositeSignature(signature);
  if (!parts) {
    return { ok: false, verdict: 'invalid', reason: 'COMPOSITE_SIGNATURE_LENGTH', components };
  }
  let mPrime;
  try {
    mPrime = messageRepresentative(message, ctx);
  } catch (error) {
    return { ok: false, verdict: 'invalid', reason: error.message, components };
  }
  try {
    if (ml_dsa65.verify(asUint8(parts.mldsaSig), asUint8(mPrime), asUint8(mldsaPublic), { context: asUint8(LABEL) })) {
      components['ml-dsa-65'] = 'pass';
    }
  } catch {
    components['ml-dsa-65'] = 'fail';
  }
  try {
    if (verifyEd25519(mPrime, ed25519KeyFromRawPublic(edPublic), parts.edSig)) {
      components.ed25519 = 'pass';
    }
  } catch {
    components.ed25519 = 'fail';
  }
  const ok = components['ml-dsa-65'] === 'pass' && components.ed25519 === 'pass';
  return {
    ok,
    verdict: ok ? 'valid' : 'invalid',
    reason: ok ? undefined : 'COMPOSITE_AND_FAILED',
    components,
    suite: SUITE,
  };
}
