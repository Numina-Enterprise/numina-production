/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Pure Ed25519 (RFC 8032) through Node.js crypto. sign(null, message, key)
 * matches the repository convention in provenance-verifier.mjs: the algorithm
 * argument stays null, which selects pure Ed25519 rather than a prehash.
 * Seeds use the same RFC 8410 PKCS8 and SPKI prefixes as that file.
 */

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { ED25519_PUBLIC_BYTES, ED25519_SEED_BYTES, ED25519_SIGNATURE_BYTES } from './meta.mjs';
import { sha256Hex } from './canonical.mjs';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// Public pins already published in the provenance verifier. This module refuses
// them so a composite or archive key cannot be the repository authority key.
export const PINNED_AUTHORITY_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAxqpbjMTzgULVeNq/W0tdU1RzPKmkuldC2U4DDI5g6yI=\n-----END PUBLIC KEY-----\n';
export const PINNED_GUARDIAN_PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAhUrpnMscm/Vc7p+7k6eAcxDT0gVUcQ1dhKkgaJ2BVNg=\n-----END PUBLIC KEY-----\n';

export function rawPublicKeyFromPem(pem) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('ED25519_PUBLIC_KEY_REQUIRED');
  }
  const der = key.export({ type: 'spki', format: 'der' });
  if (der.length !== ED25519_SPKI_PREFIX.length + ED25519_PUBLIC_BYTES) {
    throw new Error('ED25519_SPKI_LENGTH');
  }
  if (!der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    throw new Error('ED25519_SPKI_PREFIX');
  }
  return Buffer.from(der.subarray(ED25519_SPKI_PREFIX.length));
}

const PINNED_RAW = [
  rawPublicKeyFromPem(PINNED_AUTHORITY_PUBLIC_KEY_PEM),
  rawPublicKeyFromPem(PINNED_GUARDIAN_PUBLIC_KEY_PEM),
];

export function assertEd25519NotPinned(rawPublic) {
  const raw = Buffer.from(rawPublic);
  for (const pinned of PINNED_RAW) {
    if (raw.length === pinned.length && raw.equals(pinned)) {
      throw new Error('PINNED_REPOSITORY_KEY_REFUSED');
    }
  }
}

export function ed25519FromSeed(seed) {
  const buf = Buffer.from(seed);
  if (buf.length !== ED25519_SEED_BYTES) {
    throw new Error('INVALID_ED25519_SEED_LENGTH');
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, buf]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey);
  const rawPublicKey = rawPublicKeyFromPem(publicKey.export({ type: 'spki', format: 'pem' }));
  assertEd25519NotPinned(rawPublicKey);
  return {
    seed: buf,
    privateKey,
    publicKey,
    rawPublicKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    kid: sha256Hex(rawPublicKey),
  };
}

export function ed25519KeyFromRawPublic(rawPublic) {
  const raw = Buffer.from(rawPublic);
  if (raw.length !== ED25519_PUBLIC_BYTES) {
    throw new Error('INVALID_ED25519_RAW_PUBLIC_KEY_LENGTH');
  }
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
  return publicKey;
}

export function signEd25519(message, privateKey) {
  const data = Buffer.isBuffer(message) ? message : Buffer.from(message);
  const signature = sign(null, data, privateKey);
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error('ED25519_SIGNATURE_LENGTH');
  }
  return signature;
}

export function verifyEd25519(message, publicKey, signature) {
  const data = Buffer.isBuffer(message) ? message : Buffer.from(message);
  const sig = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
  if (sig.length !== ED25519_SIGNATURE_BYTES) return false;
  try {
    return verify(null, data, publicKey, sig);
  } catch {
    return false;
  }
}
