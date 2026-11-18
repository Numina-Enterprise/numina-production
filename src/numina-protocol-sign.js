// numina-protocol-sign.js — signing for the Singularity Protocol.
// Samuel J. Kott, SK Consulting LLC, operating under Numina Labs.
//
// The counterpart to numina-protocol-verify.js. This module SIGNS Ed25519
// signatures over RFC 8785 canonical bytes. It completes the signing
// functionality the Murph check needs (step 3: Authority and Guardian sign
// the same record over the same canonical payload).
//
// THE PRIVATE KEY IS NEVER IN THIS CODEBASE. It is supplied at runtime by
// the caller — the owner, from his own secure key file — and used only in
// memory. This module fails closed: before signing as a role, it derives
// the public key from the supplied private key and requires it to equal the
// pinned public key for that role in numina-protocol.json. A key that does
// not belong to the pinned identity cannot sign as that identity. No key
// substitution, ever. Nothing here prints, logs, or stores a private key.
//
// The owner runs signing through scripts/sign-murph-record.mjs, with his own
// key file. No signature as the Authority exists until he does.
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  canonicalBytes,
  hex,
  unhex,
  loadProtocol,
  verifySignature,
  verifyMurphRecord,
} from './numina-protocol-verify.js';

/**
 * Parse a private key supplied at runtime into 32 seed bytes.
 * Accepted forms: a 32-byte Uint8Array; a 64-character hex string; or a
 * PEM PKCS#8 private key ("-----BEGIN PRIVATE KEY-----"), whose Ed25519
 * seed is the trailing 32 bytes of the DER encoding. Anything else throws.
 * The returned bytes are the caller's secret — never log or store them.
 */
export function parsePrivateKey(input) {
  if (input instanceof Uint8Array) {
    if (input.length !== 32) throw new Error('Ed25519 private key must be 32 bytes');
    return new Uint8Array(input);
  }
  if (typeof input !== 'string') throw new Error('private key must be 32 bytes, hex, or PEM PKCS#8');
  const trimmed = input.trim();
  if (trimmed.startsWith('-----BEGIN')) {
    const body = trimmed
      .replace(/-----BEGIN [^-]+-----/g, '')
      .replace(/-----END [^-]+-----/g, '')
      .replace(/\s+/g, '');
    const der = new Uint8Array(Buffer.from(body, 'base64'));
    if (der.length < 32) throw new Error('PEM private key too short');
    return der.slice(-32);
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return unhex(trimmed);
  throw new Error('private key must be 32 bytes, 64 hex characters, or PEM PKCS#8');
}

export function derivePublicKey(privateKey) {
  const secret = parsePrivateKey(privateKey);
  return hex(ed25519.getPublicKey(secret));
}

/**
 * Sign the RFC 8785 canonical bytes of a payload with a runtime-supplied
 * private key. When expectedPublicKey is given, the derived public key must
 * equal it or signing is refused. Returns { signatureHex, publicKeyHex,
 * canonicalBytesHex }. The signature is re-verified before it is returned.
 */
export function signPayload({ privateKey, payload, expectedPublicKey }) {
  const secret = parsePrivateKey(privateKey);
  const publicKeyHex = hex(ed25519.getPublicKey(secret));
  if (
    typeof expectedPublicKey === 'string' &&
    publicKeyHex !== expectedPublicKey.toLowerCase()
  ) {
    throw new Error('supplied key does not match the expected public key — refusing to sign');
  }
  const bytes = canonicalBytes(payload);
  const signature = ed25519.sign(bytes, secret);
  const signatureHex = hex(signature);
  if (!verifySignature({ publicKey: publicKeyHex, signature: signatureHex, payload })) {
    throw new Error('fresh signature failed re-verification — refusing to return it');
  }
  return { signatureHex, publicKeyHex, canonicalBytesHex: hex(bytes) };
}

/**
 * Sign a payload as one role of the protocol. The supplied private key must
 * derive to the pinned public key for that role, or signing is refused.
 * Returns { role, publicKeyHex, signatureHex, canonicalBytesHex, verified }.
 */
export function signAsRole({ role, privateKey, payload }, protocol = loadProtocol()) {
  if (role !== 'authority' && role !== 'guardian') {
    throw new Error("role must be 'authority' or 'guardian'");
  }
  const pinned = protocol[role].rawPublicKey;
  const signed = signPayload({ privateKey, payload, expectedPublicKey: pinned });
  return { role, ...signed, verified: true };
}

/**
 * Build a signed Murph record: the same payload signed by both Authority
 * and Guardian, each with the private key supplied at runtime for that role.
 * Returns the record plus its verification (both signatures over the same
 * canonical bytes). Either role failing its pinned-key check throws and no
 * record is returned.
 */
export function createSignedMurphRecord(
  { payload, authorityPrivateKey, guardianPrivateKey },
  protocol = loadProtocol(),
) {
  const authority = signAsRole({ role: 'authority', privateKey: authorityPrivateKey, payload }, protocol);
  const guardian = signAsRole({ role: 'guardian', privateKey: guardianPrivateKey, payload }, protocol);
  const verified = verifyMurphRecord(
    {
      payload,
      authoritySignature: authority.signatureHex,
      guardianSignature: guardian.signatureHex,
    },
    protocol,
  );
  if (!verified.complete) {
    throw new Error(
      verified.both
        ? 'signed Murph record is not chain-bound (Genesis guardrail) — refusing to return it'
        : 'signed Murph record failed verification — refusing to return it',
    );
  }
  return {
    payload,
    canonicalBytesHex: verified.canonicalBytesHex,
    authority: { publicKey: authority.publicKeyHex, signature: authority.signatureHex },
    guardian: { publicKey: guardian.publicKeyHex, signature: guardian.signatureHex },
    verified,
  };
}
