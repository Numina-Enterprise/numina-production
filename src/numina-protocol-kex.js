// numina-protocol-kex.js — hybrid post-quantum key exchange for the Singularity Protocol.
//
// Construction (pinned in numina-protocol.json, postQuantum.hybridKeyExchange):
//   - Initiator generates an ephemeral X25519 keypair and computes the
//     X25519 shared secret (32 bytes) with the responder's X25519 public key.
//   - Initiator encapsulates to the responder's ML-KEM-768 public key
//     (ciphertext 1,088 bytes, shared secret 32 bytes, NIST FIPS 203).
//   - IKM = X25519 shared secret (32 bytes) || ML-KEM-768 shared secret
//     (32 bytes), X25519 first. HKDF-SHA-256 (RFC 5869) with salt
//     UTF-8("numina-pqc-kex-v1") and info UTF-8(the profile string below)
//     derives 32 bytes = the AES-256-GCM key.
//   - Transcript (returned for the caller to bind/sign) =
//     UTF-8(profile) || 0x00 || uint32-BE length + initiator ephemeral
//     X25519 SPKI DER || uint32-BE length + responder X25519 SPKI DER ||
//     uint32-BE length + ML-KEM-768 ciphertext. All lengths big-endian.
//
// The profile string is NEW — the old profile name
// numina-e2ee-x25519-hkdf-aes256gcm-ed25519-v1 existed only as a name in
// AGENTS.md; no code implemented it, so nothing is migrated and the old
// name is never reused for this different construction.
//
// Authentication of the transcript is by hybrid signature
// (Ed25519 + ML-DSA-65, src/numina-protocol-pqc.js) and is the caller's
// responsibility; this module derives keys only and never signs.
//
// Implemented with Node's built-in node:crypto only (Node 26.11.1 /
// OpenSSL 3.5.9, verified 2026-11-14). No new dependency. All keypairs
// are ephemeral, generated in-process; no private key is stored or logged.
// Decapsulation uses FIPS 203 implicit rejection: a corrupted
// ciphertext does NOT throw — it yields a different shared secret, so the
// responder derives a different key. Agreement is never assumed; it is
// proven by the transcript and by AES-256-GCM authentication. No
// fallback key is ever substituted.
//
// Sizes, measured empirically on Node 26.11.1 / OpenSSL 3.5.9 (2026-11-14):
//   X25519 shared secret ........... 32 bytes; SPKI DER 44 bytes
//   ML-KEM-768 public key (raw) .... 1,184 bytes; SPKI DER 1,206 bytes
//   ML-KEM-768 ciphertext .......... 1,088 bytes; shared secret 32 bytes
//   HKDF-SHA-256 output (AES key) .. 32 bytes; AES-256-GCM IV 12 bytes
import {
  generateKeyPairSync,
  diffieHellman,
  encapsulate,
  decapsulate,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createPublicKey,
} from 'node:crypto';
import { hex, unhex } from './numina-protocol-verify.js';
import {
  ML_KEM_768,
  ML_KEM_768_PUBLIC_KEY_SPKI_DER_BYTES,
  ML_KEM_768_CIPHERTEXT_BYTES,
  ML_KEM_768_SHARED_SECRET_BYTES,
  ML_KEM_768_SPKI_PREFIX_HEX,
} from './numina-protocol-pqc.js';

export const KEX_PROFILE =
  'numina-e2ee-x25519-mlkem768-hkdf-aes256gcm-ed25519-mldsa65-v1';
export const SUPERSEDED_KEX_PROFILE = 'numina-e2ee-x25519-hkdf-aes256gcm-ed25519-v1';
export const KEX_HKDF_SALT = 'numina-pqc-kex-v1';
export const X25519_PUBLIC_KEY_SPKI_DER_BYTES = 44;
export const X25519_SHARED_SECRET_BYTES = 32;
export const KEX_AES_KEY_BYTES = 32;
export const KEX_AES_IV_BYTES = 12;

// X25519 SPKI DER prefix: SEQUENCE (30 2a) + AlgorithmIdentifier
// (30 05 06 03 2b 65 6e) + BIT STRING (03 21 00), then the 32-byte raw key.
export const X25519_SPKI_PREFIX_HEX = '302a300506032b656e032100';

/** Generate an ephemeral KEX keypair: { x25519, mlKem768 } KeyObject pairs. */
export function generateKexKeypair() {
  return {
    x25519: generateKeyPairSync('x25519'),
    mlKem768: generateKeyPairSync(ML_KEM_768),
  };
}

/** Export a KEX keypair's public keys as SPKI DER hex (44 / 1,206 bytes). */
export function exportKexPublicKeys(keypair) {
  const xDer = keypair.x25519.publicKey.export({ type: 'spki', format: 'der' });
  const kemDer = keypair.mlKem768.publicKey.export({ type: 'spki', format: 'der' });
  if (xDer.length !== X25519_PUBLIC_KEY_SPKI_DER_BYTES) {
    throw new Error(`X25519 SPKI DER must be ${X25519_PUBLIC_KEY_SPKI_DER_BYTES} bytes`);
  }
  if (kemDer.length !== ML_KEM_768_PUBLIC_KEY_SPKI_DER_BYTES) {
    throw new Error(`ML-KEM-768 SPKI DER must be ${ML_KEM_768_PUBLIC_KEY_SPKI_DER_BYTES} bytes`);
  }
  return {
    x25519PublicKeySpkiDer: hex(xDer),
    mlKem768PublicKeySpkiDer: hex(kemDer),
  };
}

/** Import KEX public keys from SPKI DER hex. Returns { x25519, mlKem768 } KeyObjects. */
export function importKexPublicKeys({ x25519PublicKeySpkiDer, mlKem768PublicKeySpkiDer }) {
  const xDer = Buffer.from(unhex(x25519PublicKeySpkiDer));
  const kemDer = Buffer.from(unhex(mlKem768PublicKeySpkiDer));
  if (xDer.length !== X25519_PUBLIC_KEY_SPKI_DER_BYTES) {
    throw new Error(`X25519 SPKI DER must be ${X25519_PUBLIC_KEY_SPKI_DER_BYTES} bytes`);
  }
  if (hex(xDer.subarray(0, 12)) !== X25519_SPKI_PREFIX_HEX) {
    throw new Error('X25519 SPKI DER prefix mismatch');
  }
  if (kemDer.length !== ML_KEM_768_PUBLIC_KEY_SPKI_DER_BYTES) {
    throw new Error(`ML-KEM-768 SPKI DER must be ${ML_KEM_768_PUBLIC_KEY_SPKI_DER_BYTES} bytes`);
  }
  if (hex(kemDer.subarray(0, 22)) !== ML_KEM_768_SPKI_PREFIX_HEX) {
    throw new Error('ML-KEM-768 SPKI DER prefix mismatch');
  }
  const x25519 = createPublicKey({ key: xDer, format: 'der', type: 'spki' });
  const mlKem768 = createPublicKey({ key: kemDer, format: 'der', type: 'spki' });
  if (x25519.asymmetricKeyType !== 'x25519') throw new Error('imported key is not x25519');
  if (mlKem768.asymmetricKeyType !== ML_KEM_768) throw new Error('imported key is not ml-kem-768');
  return { x25519, mlKem768 };
}

function uint32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/**
 * Build the KEX transcript: UTF-8(profile) || 0x00 || uint32-BE length +
 * initiator ephemeral X25519 SPKI DER || uint32-BE length + responder
 * X25519 SPKI DER || uint32-BE length + ML-KEM-768 ciphertext.
 * All length prefixes are big-endian (see the `endianness` rule).
 */
export function buildKexTranscript({
  profile = KEX_PROFILE,
  initiatorX25519PublicKeyDer,
  responderX25519PublicKeyDer,
  mlKem768Ciphertext,
}) {
  const initiator = Buffer.from(initiatorX25519PublicKeyDer);
  const responder = Buffer.from(responderX25519PublicKeyDer);
  const ciphertext = Buffer.from(mlKem768Ciphertext);
  return Buffer.concat([
    Buffer.from(profile, 'utf8'),
    Buffer.from([0x00]),
    uint32BE(initiator.length),
    initiator,
    uint32BE(responder.length),
    responder,
    uint32BE(ciphertext.length),
    ciphertext,
  ]);
}

/**
 * Derive the AES-256-GCM key from the two shared secrets.
 * IKM = X25519 shared secret (32 B) || ML-KEM-768 shared secret (32 B),
 * X25519 first. HKDF-SHA-256, salt UTF-8("numina-pqc-kex-v1"), info
 * UTF-8(profile), output 32 bytes.
 */
export function deriveKexKey({ x25519SharedSecret, mlKem768SharedSecret, profile = KEX_PROFILE }) {
  const xss = Buffer.from(x25519SharedSecret);
  const kemss = Buffer.from(mlKem768SharedSecret);
  if (xss.length !== X25519_SHARED_SECRET_BYTES) {
    throw new Error(`X25519 shared secret must be ${X25519_SHARED_SECRET_BYTES} bytes`);
  }
  if (kemss.length !== ML_KEM_768_SHARED_SECRET_BYTES) {
    throw new Error(`ML-KEM-768 shared secret must be ${ML_KEM_768_SHARED_SECRET_BYTES} bytes`);
  }
  const ikm = Buffer.concat([xss, kemss]);
  return new Uint8Array(
    hkdfSync('sha256', ikm, Buffer.from(KEX_HKDF_SALT, 'utf8'), Buffer.from(profile, 'utf8'), KEX_AES_KEY_BYTES),
  );
}

/**
 * Initiator side. Generates an ephemeral X25519 keypair, computes the
 * X25519 shared secret with the responder's X25519 public key,
 * encapsulates to the responder's ML-KEM-768 public key, and derives the
 * AES-256-GCM key. Returns { key, transcript, ephemeralX25519PublicKeySpkiDer,
 * mlKem768Ciphertext }. Public keys may be KeyObjects or SPKI DER hex.
 */
export function deriveInitiatorKey({ recipientX25519PublicKey, recipientMlKem768PublicKey, profile = KEX_PROFILE }) {
  const recipient = importKexPublicKeys({
    x25519PublicKeySpkiDer:
      typeof recipientX25519PublicKey === 'string'
        ? recipientX25519PublicKey
        : hex(recipientX25519PublicKey.export({ type: 'spki', format: 'der' })),
    mlKem768PublicKeySpkiDer:
      typeof recipientMlKem768PublicKey === 'string'
        ? recipientMlKem768PublicKey
        : hex(recipientMlKem768PublicKey.export({ type: 'spki', format: 'der' })),
  });
  const ephemeral = generateKeyPairSync('x25519');
  const xss = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient.x25519 });
  const { ciphertext, sharedKey: kemss } = encapsulate(recipient.mlKem768);
  if (ciphertext.length !== ML_KEM_768_CIPHERTEXT_BYTES) {
    throw new Error(`ML-KEM-768 ciphertext must be ${ML_KEM_768_CIPHERTEXT_BYTES} bytes`);
  }
  const key = deriveKexKey({ x25519SharedSecret: xss, mlKem768SharedSecret: kemss, profile });
  const ephemeralDer = ephemeral.publicKey.export({ type: 'spki', format: 'der' });
  const recipientDer = recipient.x25519.export({ type: 'spki', format: 'der' });
  const transcript = buildKexTranscript({
    profile,
    initiatorX25519PublicKeyDer: ephemeralDer,
    responderX25519PublicKeyDer: recipientDer,
    mlKem768Ciphertext: ciphertext,
  });
  return {
    key,
    transcript,
    ephemeralX25519PublicKeySpkiDer: hex(ephemeralDer),
    mlKem768Ciphertext: hex(ciphertext),
  };
}

/**
 * Responder side. Decapsulates the ML-KEM-768 ciphertext — under FIPS 203
 * implicit rejection a corrupted ciphertext yields a different shared
 * secret rather than throwing, so a corrupted exchange derives a
 * different key (never silent agreement) — and computes the X25519
 * shared secret with the initiator's ephemeral public key, then derives
 * the same AES-256-GCM key. Returns { key, transcript }. Private keys
 * are KeyObjects; public inputs may be KeyObjects or SPKI DER hex.
 */
export function deriveResponderKey({
  responderX25519PrivateKey,
  responderMlKem768PrivateKey,
  initiatorX25519PublicKey,
  mlKem768Ciphertext,
  responderX25519PublicKey,
  profile = KEX_PROFILE,
}) {
  const ct = Buffer.from(
    typeof mlKem768Ciphertext === 'string' ? unhex(mlKem768Ciphertext) : mlKem768Ciphertext,
  );
  if (ct.length !== ML_KEM_768_CIPHERTEXT_BYTES) {
    throw new Error(`ML-KEM-768 ciphertext must be ${ML_KEM_768_CIPHERTEXT_BYTES} bytes`);
  }
  const initiatorKey =
    typeof initiatorX25519PublicKey === 'string'
      ? createPublicKey({
          key: Buffer.from(unhex(initiatorX25519PublicKey)),
          format: 'der',
          type: 'spki',
        })
      : initiatorX25519PublicKey;
  if (initiatorKey.asymmetricKeyType !== 'x25519') {
    throw new Error('initiator key is not x25519');
  }
  let kemss;
  try {
    kemss = decapsulate(responderMlKem768PrivateKey, ct);
  } catch {
    throw new Error('ML-KEM-768 decapsulation failed — refusing to derive a key');
  }
  const xss = diffieHellman({ privateKey: responderX25519PrivateKey, publicKey: initiatorKey });
  const key = deriveKexKey({ x25519SharedSecret: xss, mlKem768SharedSecret: kemss, profile });
  if (!responderX25519PublicKey) {
    throw new Error('responderX25519PublicKey (SPKI DER hex or KeyObject) is required for the transcript');
  }
  const responderDer =
    responderX25519PublicKey instanceof Uint8Array || typeof responderX25519PublicKey === 'string'
      ? Buffer.from(
          typeof responderX25519PublicKey === 'string'
            ? unhex(responderX25519PublicKey)
            : responderX25519PublicKey,
        )
      : responderX25519PublicKey.export({ type: 'spki', format: 'der' });
  const initiatorDer =
    typeof initiatorX25519PublicKey === 'string'
      ? Buffer.from(unhex(initiatorX25519PublicKey))
      : initiatorX25519PublicKey.export({ type: 'spki', format: 'der' });
  const transcript = buildKexTranscript({
    profile,
    initiatorX25519PublicKeyDer: initiatorDer,
    responderX25519PublicKeyDer: responderDer,
    mlKem768Ciphertext: ct,
  });
  return { key, transcript };
}

/**
 * Seal a message with AES-256-GCM under a KEX-derived key.
 * Returns { iv, ciphertext, authTag } (all hex; IV is 12 random bytes).
 */
export function sealMessage({ key, plaintext }) {
  const keyBytes = Buffer.from(key);
  if (keyBytes.length !== KEX_AES_KEY_BYTES) {
    throw new Error(`AES-256-GCM key must be ${KEX_AES_KEY_BYTES} bytes`);
  }
  const iv = randomBytes(KEX_AES_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return {
    iv: hex(iv),
    ciphertext: hex(ciphertext),
    authTag: hex(cipher.getAuthTag()),
  };
}

/**
 * Open a sealed message. Throws on authentication failure (tampered
 * ciphertext, tag, or IV) or a wrong-length key — fail-closed.
 */
export function openMessage({ key, iv, ciphertext, authTag }) {
  const keyBytes = Buffer.from(key);
  if (keyBytes.length !== KEX_AES_KEY_BYTES) {
    throw new Error(`AES-256-GCM key must be ${KEX_AES_KEY_BYTES} bytes`);
  }
  const decipher = createDecipheriv('aes-256-gcm', keyBytes, Buffer.from(unhex(iv)));
  decipher.setAuthTag(Buffer.from(unhex(authTag)));
  return new Uint8Array(
    Buffer.concat([
      decipher.update(Buffer.from(unhex(ciphertext))),
      decipher.final(),
    ]),
  );
}
