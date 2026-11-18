// numina-protocol-verify.js — verify-only Ed25519 over RFC 8785 canonical bytes.
//
// The authoritative signing key (SKOTT34-Ed25519) is implemented here as a
// PINNED PUBLIC KEY, loaded from numina-protocol.json. This module VERIFIES
// signatures against it. It NEVER signs: there is no private key in this
// codebase, no signing function, and no code path that creates one. Muse
// holds no SKOTT34-Ed25519 private key; signing is the owner's act alone.
//
// The pinned keys are self-checked at load: the Authority SPKI SHA-256 is
// recomputed from the PEM and the Guardian SPKI SHA-256 is recomputed from
// the raw public key (Ed25519 SPKI DER = fixed 12-byte prefix + 32-byte raw
// key). A mismatch fails loudly instead of verifying against a wrong key.
//
// Canonical bytes come from RFC 8785 (JCS) via the `canonicalize` package.
// Ed25519 verification and SHA-256 come from @noble/curves and @noble/hashes.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import canonicalize from 'canonicalize';
import { defaultMetrology } from './numina-metrology.js';

const PROTOCOL_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'numina-protocol.json');

// Ed25519 SPKI DER prefix: SEQUENCE (30 2a) + AlgorithmIdentifier
// (30 05 06 03 2b 65 70) + BIT STRING (03 21 00), then the 32-byte raw key.
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

export function loadProtocol(path = PROTOCOL_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

export function unhex(text) {
  if (typeof text !== 'string' || !/^[0-9a-fA-F]+$/.test(text) || text.length % 2 !== 0) {
    throw new Error('expected an even-length hex string');
  }
  return new Uint8Array(Buffer.from(text, 'hex'));
}

/** RFC 8785 (JCS) canonical bytes of a JSON value. */
export function canonicalBytes(payload) {
  const text = canonicalize(payload);
  if (typeof text !== 'string') throw new Error('payload is not JSON-canonicalizable');
  return new TextEncoder().encode(text);
}

/** SPKI DER bytes for an Ed25519 raw public key (32 bytes). */
export function spkiDerFromRaw(rawPublicKey) {
  const raw = rawPublicKey instanceof Uint8Array ? rawPublicKey : unhex(rawPublicKey);
  if (raw.length !== 32) throw new Error('Ed25519 public key must be 32 bytes');
  const der = new Uint8Array(ED25519_SPKI_PREFIX.length + 32);
  der.set(ED25519_SPKI_PREFIX, 0);
  der.set(raw, ED25519_SPKI_PREFIX.length);
  return der;
}

/** SHA-256 of the SPKI DER encoding, hex — the keypin. */
export function spkiSha256Hex(rawPublicKey) {
  return hex(sha256(spkiDerFromRaw(rawPublicKey)));
}

/** Decode a PEM SPKI public key ("-----BEGIN PUBLIC KEY-----") to DER bytes. */
export function pemToDer(pem) {
  const body = String(pem)
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  return new Uint8Array(Buffer.from(body, 'base64'));
}

/**
 * Verify the pinned keys in numina-protocol.json against each other.
 * Authority: the PEM must decode to the SPKI DER built from the pinned raw
 * key, its SHA-256 must equal the pinned SPKI hash, and the PEM tail must
 * equal the pinned raw key. Guardian: the SPKI hash rebuilt from the pinned
 * raw key must equal the pinned SPKI hash.
 * Returns { authority, guardian, details } — both booleans must be true.
 */
export function verifyPinnedKeys(protocol = loadProtocol()) {
  const a = protocol.authority;
  const g = protocol.guardian;
  const authorityDer = pemToDer(a.pem);
  const authorityRebuilt = spkiDerFromRaw(a.rawPublicKey);
  const authorityPemTailMatches =
    hex(authorityDer.slice(-32)) === a.rawPublicKey.toLowerCase();
  const authorityDerMatches =
    hex(authorityDer) === hex(authorityRebuilt);
  const authorityHashMatches =
    hex(sha256(authorityDer)) === a.spkiSha256.toLowerCase();
  const authority = authorityPemTailMatches && authorityDerMatches && authorityHashMatches;
  const guardianHashMatches =
    spkiSha256Hex(g.rawPublicKey) === g.spkiSha256.toLowerCase();
  const guardian = guardianHashMatches;
  return {
    authority,
    guardian,
    details: {
      authorityPemTailMatches,
      authorityDerMatches,
      authorityHashMatches,
      guardianHashMatches,
    },
  };
}

function toSignatureBytes(signature) {
  if (signature instanceof Uint8Array) return signature;
  return unhex(signature);
}

/**
 * Verify one Ed25519 signature over the RFC 8785 canonical bytes of a
 * payload, against a raw public key (hex or bytes). Returns true/false;
 * malformed keys or signatures verify as false, they do not throw.
 * Telemetry only: the canonical byte count is recorded and the verify
 * is counted on `meter` (default: the module default meter). Counting
 * never changes the result.
 */
export function verifySignature({ publicKey, signature, payload, meter = defaultMetrology }) {
  let pub;
  let sig;
  try {
    pub = publicKey instanceof Uint8Array ? publicKey : unhex(publicKey);
    sig = toSignatureBytes(signature);
    if (pub.length !== 32 || sig.length !== 64) return false;
  } catch {
    return false;
  }
  const bytes = canonicalBytes(payload);
  meter.recordCanonical(bytes.length);
  let ok = false;
  try {
    ok = ed25519.verify(sig, bytes, pub);
  } catch {
    ok = false;
  }
  meter.record('ed25519Verify');
  return ok;
}

/** Verify a signature as the Authority (Samuel J. Kott, SKOTT34-Ed25519). */
export function verifyAuthoritySignature(signature, payload, protocol = loadProtocol(), meter = defaultMetrology) {
  return verifySignature({
    publicKey: protocol.authority.rawPublicKey,
    signature,
    payload,
    meter,
  });
}

/** Verify a signature as the Guardian (Numina, numina-guardian-ed25519). */
export function verifyGuardianSignature(signature, payload, protocol = loadProtocol(), meter = defaultMetrology) {
  return verifySignature({
    publicKey: protocol.guardian.rawPublicKey,
    signature,
    payload,
    meter,
  });
}

/**
 * The Genesis guardrail: a Murph record must name the pinned chain id and
 * genesis hash from numina-protocol.json. A record naming another chain, a
 * different genesis, or no chain at all is refused — it is not a record of
 * this chain, however good its signatures are. Accepts either flat fields
 * ({ chainId, genesis }) or nested ({ chain: { id, genesis } }) on the
 * record. Returns { ok, chainIdMatches, genesisMatches, reason }.
 * A protocol file with no pinned chain cannot pass the guardrail.
 */
export function checkGenesis(record, protocol = loadProtocol()) {
  const pinned = protocol.chain;
  if (!pinned || typeof pinned.id !== 'number' || typeof pinned.genesis !== 'string') {
    return { ok: false, chainIdMatches: false, genesisMatches: false, reason: 'no pinned chain in protocol' };
  }
  const nested = record && typeof record === 'object' ? record.chain : undefined;
  const chainId = record?.chainId ?? nested?.id;
  const genesis = record?.genesis ?? nested?.genesis;
  const chainIdMatches = chainId === pinned.id;
  const genesisMatches =
    typeof genesis === 'string' && genesis.toLowerCase() === pinned.genesis.toLowerCase();
  const ok = chainIdMatches && genesisMatches;
  return {
    ok,
    chainIdMatches,
    genesisMatches,
    reason: ok
      ? 'record names the pinned chain and genesis'
      : !chainIdMatches && !genesisMatches
        ? 'record does not name the pinned chain id or genesis'
        : !chainIdMatches
          ? 'record names the wrong chain id'
          : 'record names the wrong genesis',
  };
}

/**
 * The Murph check, step 3 in code: Authority and Guardian must have signed
 * the SAME record over the SAME RFC 8785 canonical payload. Returns
 * { authority, guardian, both, genesis, complete, canonicalBytesHex }.
 * `complete` adds the Genesis guardrail: both signatures verify AND the
 * payload names the pinned chain id and genesis. A record that is signed
 * but not chain-bound is not complete.
 */
export function verifyMurphRecord({ payload, authoritySignature, guardianSignature, meter = defaultMetrology }, protocol = loadProtocol()) {
  const authority = verifyAuthoritySignature(authoritySignature, payload, protocol, meter);
  const guardian = verifyGuardianSignature(guardianSignature, payload, protocol, meter);
  const genesis = checkGenesis(payload, protocol);
  // Telemetry only: the canonical bytes behind the reported hex are
  // measured like every other canonicalization this module performs.
  const canonicalBytesForHex = canonicalBytes(payload);
  meter.recordCanonical(canonicalBytesForHex.length);
  return {
    authority,
    guardian,
    both: authority && guardian,
    genesis,
    complete: authority && guardian && genesis.ok,
    canonicalBytesHex: hex(canonicalBytesForHex),
  };
}
