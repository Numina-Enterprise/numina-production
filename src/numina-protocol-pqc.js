// numina-protocol-pqc.js — hybrid post-quantum signatures for the Singularity Protocol.
//
// Hybrid: the SAME RFC 8785 canonical bytes are signed twice — once with
// Ed25519 (64-byte signature, the existing protocol) and once with ML-DSA-65
// (3,309-byte signature, NIST FIPS 204, level 3). Verification requires
// BOTH signatures to verify over the same canonical bytes; either one
// failing fails the whole verification (fail-closed).
//
// Existing single-Ed25519 records still verify through the unchanged
// verifySignature path in numina-protocol-verify.js — backward
// compatibility is the old path kept working, not a downgrade of the new
// one. A legacy record has no ML-DSA-65 part, so hybrid verification of
// it is false by construction; that is the point, not a bug.
//
// PQC keys are implemented with Node's built-in node:crypto only
// (Node 26.11.1 / OpenSSL 3.5.9, verified 2026-11-14). No new dependency.
// All keypairs in tests are EPHEMERAL, generated in-test. The Authority
// and Guardian ML-DSA-65 public keys in numina-protocol.json are null
// (UNPROVISIONED) — no agent generates them. Until the owner provisions
// them, hybrid verification of Authority/Guardian records fails closed.
//
// Sizes, measured empirically on Node 26.11.1 / OpenSSL 3.5.9 (2026-11-14):
//   ML-DSA-65 signature ............ 3,309 bytes (FIPS 204; NOT 3,295)
//   ML-DSA-65 public key (raw) ..... 1,952 bytes; SPKI DER 1,974 bytes
//   ML-KEM-768 public key (raw) .... 1,184 bytes; SPKI DER 1,206 bytes
//   ML-KEM-768 ciphertext .......... 1,088 bytes; shared secret 32 bytes
//   Ed25519 signature .............. 64 bytes
//
// Endianness: the hybrid signature bundle layout defined here uses
// big-endian (network byte order) length prefixes — see the `endianness`
// section of numina-protocol.json. The primitives' own internal byte
// encodings are LABELED EXCEPTIONS and are never re-encoded: Ed25519
// field elements/scalars are little-endian per RFC 8032; ML-DSA byte
// encodings are as FIPS 204 defines them. Re-encoding either would break
// verification and interoperability.
import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createPrivateKey,
} from 'node:crypto';
import {
  canonicalBytes,
  hex,
  unhex,
  loadProtocol,
  verifySignature,
  checkGenesis,
} from './numina-protocol-verify.js';
import { signPayload } from './numina-protocol-sign.js';
import { defaultMetrology } from './numina-metrology.js';

export const ML_DSA_65 = 'ml-dsa-65';
export const ML_KEM_768 = 'ml-kem-768';
export const HYBRID_SIGNATURE_SCHEMA = 'numina.hybrid-signature.v1';
export const ML_DSA_65_SIGNATURE_BYTES = 3309;
export const ML_DSA_65_PUBLIC_KEY_BYTES = 1952;
export const ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES = 1974;
export const ML_KEM_768_PUBLIC_KEY_BYTES = 1184;
export const ML_KEM_768_PUBLIC_KEY_SPKI_DER_BYTES = 1206;
export const ML_KEM_768_CIPHERTEXT_BYTES = 1088;
export const ML_KEM_768_SHARED_SECRET_BYTES = 32;
export const ED25519_SIGNATURE_BYTES = 64;

// Hybrid signature bundle layout (3,383 bytes total), all integers big-endian:
//   ASCII magic "NPQ1" (4 bytes)
//   version uint16 BE = 1
//   Ed25519 signature length uint16 BE = 64, then the 64-byte signature
//   ML-DSA-65 signature length uint16 BE = 3309, then the 3,309-byte signature
export const HYBRID_BUNDLE_MAGIC = 'NPQ1';
export const HYBRID_BUNDLE_VERSION = 1;
export const HYBRID_BUNDLE_BYTES =
  4 + 2 + 2 + ED25519_SIGNATURE_BYTES + 2 + ML_DSA_65_SIGNATURE_BYTES;

// SPKI DER prefixes, verified empirically on Node 26.11.1 / OpenSSL 3.5.9:
// ML-DSA-65: SEQUENCE len + AlgorithmIdentifier (OID 2.16.840.1.101.3.4.3.17)
// + BIT STRING header; ML-KEM-768: same shape, OID 2.16.840.1.101.3.4.4.2.
export const ML_DSA_65_SPKI_PREFIX_HEX = '308207b2300b0609608648016503040312038207a100';
export const ML_KEM_768_SPKI_PREFIX_HEX = '308204b2300b0609608648016503040402038204a100';

/** Generate an ephemeral ML-DSA-65 keypair (in-memory KeyObjects). */
export function generateMlDsa65Keypair() {
  return generateKeyPairSync(ML_DSA_65);
}

/** Generate an ephemeral ML-KEM-768 keypair (in-memory KeyObjects). */
export function generateMlKem768Keypair() {
  return generateKeyPairSync(ML_KEM_768);
}

function toBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return unhex(value);
  throw new Error(`${label} must be bytes or a hex string`);
}

/** Export an ML-DSA-65 public KeyObject as SPKI DER hex (1,974 bytes). */
export function exportMlDsa65PublicKeySpkiDer(publicKey) {
  if (!publicKey || publicKey.asymmetricKeyType !== ML_DSA_65) {
    throw new Error('expected an ml-dsa-65 public key');
  }
  const der = publicKey.export({ type: 'spki', format: 'der' });
  if (der.length !== ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES) {
    throw new Error(`ML-DSA-65 SPKI DER must be ${ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES} bytes`);
  }
  return hex(der);
}

/** Raw 1,952-byte ML-DSA-65 public key hex from its SPKI DER hex. */
export function mlDsa65RawPublicKeyHex(spkiDerHex) {
  const der = toBytes(spkiDerHex, 'ML-DSA-65 SPKI DER');
  if (der.length !== ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES) {
    throw new Error(`ML-DSA-65 SPKI DER must be ${ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES} bytes`);
  }
  if (hex(der.subarray(0, 22)) !== ML_DSA_65_SPKI_PREFIX_HEX) {
    throw new Error('ML-DSA-65 SPKI DER prefix mismatch');
  }
  return hex(der.subarray(22));
}

/** Import an ML-DSA-65 public key from SPKI DER hex (1,974 bytes). */
export function importMlDsa65PublicKey(spkiDerHex) {
  const der = toBytes(spkiDerHex, 'ML-DSA-65 SPKI DER');
  if (der.length !== ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES) {
    throw new Error(`ML-DSA-65 SPKI DER must be ${ML_DSA_65_PUBLIC_KEY_SPKI_DER_BYTES} bytes`);
  }
  if (hex(der.subarray(0, 22)) !== ML_DSA_65_SPKI_PREFIX_HEX) {
    throw new Error('ML-DSA-65 SPKI DER prefix mismatch');
  }
  const key = createPublicKey({ key: Buffer.from(der), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== ML_DSA_65) {
    throw new Error('imported key is not ml-dsa-65');
  }
  return key;
}

/**
 * Accept an ML-DSA-65 private key as a KeyObject, a PKCS#8 DER
 * Uint8Array, or a PKCS#8 DER hex string. Returns a KeyObject.
 * The bytes are the caller's secret — never log or store them.
 */
export function toMlDsa65PrivateKey(privateKey) {
  if (privateKey && typeof privateKey === 'object' && privateKey.asymmetricKeyType === ML_DSA_65) {
    return privateKey;
  }
  const der = toBytes(privateKey, 'ML-DSA-65 private key');
  const key = createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
  if (key.asymmetricKeyType !== ML_DSA_65) {
    throw new Error('supplied key is not ml-dsa-65');
  }
  return key;
}

/**
 * Sign the RFC 8785 canonical bytes of a payload with ML-DSA-65.
 * When expectedPublicKeySpkiDer is given, the fresh signature is
 * re-verified against it (proving the private key matches) before it is
 * returned. Returns the signature hex (3,309 bytes). Telemetry only:
 * the canonical byte count is recorded and the sign (and the
 * re-verification, via verifyMlDsa65) is counted on `meter`.
 */
export function signMlDsa65({ privateKey, payload, expectedPublicKeySpkiDer, meter = defaultMetrology }) {
  const key = toMlDsa65PrivateKey(privateKey);
  const bytes = canonicalBytes(payload);
  meter.recordCanonical(bytes.length);
  const signature = cryptoSign(null, bytes, key);
  meter.record('mlDsa65Sign');
  if (signature.length !== ML_DSA_65_SIGNATURE_BYTES) {
    throw new Error(`ML-DSA-65 signature must be ${ML_DSA_65_SIGNATURE_BYTES} bytes`);
  }
  const signatureHex = hex(signature);
  if (typeof expectedPublicKeySpkiDer === 'string') {
    if (
      !verifyMlDsa65({ publicKey: expectedPublicKeySpkiDer, signature: signatureHex, payload, meter })
    ) {
      throw new Error('supplied key does not match the expected ML-DSA-65 public key — refusing to sign');
    }
  }
  return signatureHex;
}

/**
 * Verify one ML-DSA-65 signature over the RFC 8785 canonical bytes of a
 * payload. The public key is a KeyObject or SPKI DER hex. Returns
 * true/false; malformed keys or signatures verify as false, they do
 * not throw. Telemetry only: the canonical byte count is recorded
 * and the verify is counted on `meter`.
 */
export function verifyMlDsa65({ publicKey, signature, payload, meter = defaultMetrology }) {
  let pub;
  let sig;
  try {
    pub =
      publicKey && typeof publicKey === 'object' && publicKey.asymmetricKeyType === ML_DSA_65
        ? publicKey
        : importMlDsa65PublicKey(publicKey);
    sig = toBytes(signature, 'ML-DSA-65 signature');
    if (sig.length !== ML_DSA_65_SIGNATURE_BYTES) return false;
  } catch {
    return false;
  }
  const bytes = canonicalBytes(payload);
  meter.recordCanonical(bytes.length);
  let ok = false;
  try {
    ok = cryptoVerify(null, bytes, pub, sig);
  } catch {
    ok = false;
  }
  meter.record('mlDsa65Verify');
  return ok;
}

/**
 * Encode the hybrid bundle: magic "NPQ1" || version uint16 BE || Ed25519
 * length uint16 BE || Ed25519 signature || ML-DSA-65 length uint16 BE ||
 * ML-DSA-65 signature. Total 3,383 bytes. Lengths are big-endian.
 */
export function encodeHybridSignatureBundle(ed25519Signature, mlDsa65Signature) {
  const ed = toBytes(ed25519Signature, 'Ed25519 signature');
  const dsa = toBytes(mlDsa65Signature, 'ML-DSA-65 signature');
  if (ed.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error(`Ed25519 signature must be ${ED25519_SIGNATURE_BYTES} bytes`);
  }
  if (dsa.length !== ML_DSA_65_SIGNATURE_BYTES) {
    throw new Error(`ML-DSA-65 signature must be ${ML_DSA_65_SIGNATURE_BYTES} bytes`);
  }
  const bundle = new Uint8Array(HYBRID_BUNDLE_BYTES);
  const view = new DataView(bundle.buffer, bundle.byteOffset, bundle.byteLength);
  bundle.set(new TextEncoder().encode(HYBRID_BUNDLE_MAGIC), 0);
  view.setUint16(4, HYBRID_BUNDLE_VERSION, false); // big-endian
  view.setUint16(6, ED25519_SIGNATURE_BYTES, false); // big-endian
  bundle.set(ed, 8);
  view.setUint16(8 + ED25519_SIGNATURE_BYTES, ML_DSA_65_SIGNATURE_BYTES, false); // big-endian
  bundle.set(dsa, 8 + ED25519_SIGNATURE_BYTES + 2);
  return bundle;
}

/**
 * Decode a hybrid bundle strictly. Throws on: wrong length, bad magic,
 * unsupported version, length fields that do not match the pinned sizes
 * (including a little-endian-encoded bundle, whose big-endian reads give
 * 0x4000 / 0xED0C instead of 64 / 3309), or trailing bytes.
 */
export function decodeHybridSignatureBundle(bundle) {
  const bytes = toBytes(bundle, 'hybrid signature bundle');
  if (bytes.length !== HYBRID_BUNDLE_BYTES) {
    throw new Error(`hybrid signature bundle must be ${HYBRID_BUNDLE_BYTES} bytes`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== HYBRID_BUNDLE_MAGIC) {
    throw new Error('hybrid signature bundle has the wrong magic');
  }
  const version = view.getUint16(4, false); // big-endian
  if (version !== HYBRID_BUNDLE_VERSION) {
    throw new Error(`unsupported hybrid signature bundle version: ${version}`);
  }
  const edLength = view.getUint16(6, false); // big-endian
  if (edLength !== ED25519_SIGNATURE_BYTES) {
    throw new Error(`hybrid bundle Ed25519 length must be ${ED25519_SIGNATURE_BYTES}, got ${edLength}`);
  }
  const dsaLength = view.getUint16(8 + ED25519_SIGNATURE_BYTES, false); // big-endian
  if (dsaLength !== ML_DSA_65_SIGNATURE_BYTES) {
    throw new Error(`hybrid bundle ML-DSA-65 length must be ${ML_DSA_65_SIGNATURE_BYTES}, got ${dsaLength}`);
  }
  return {
    ed25519Signature: bytes.slice(8, 8 + ED25519_SIGNATURE_BYTES),
    mlDsa65Signature: bytes.slice(
      8 + ED25519_SIGNATURE_BYTES + 2,
      8 + ED25519_SIGNATURE_BYTES + 2 + ML_DSA_65_SIGNATURE_BYTES,
    ),
  };
}

/** The JSON form of a hybrid signature. */
export function hybridSignatureRecord(ed25519Signature, mlDsa65Signature) {
  const ed = toBytes(ed25519Signature, 'Ed25519 signature');
  const dsa = toBytes(mlDsa65Signature, 'ML-DSA-65 signature');
  if (ed.length !== ED25519_SIGNATURE_BYTES) {
    throw new Error(`Ed25519 signature must be ${ED25519_SIGNATURE_BYTES} bytes`);
  }
  if (dsa.length !== ML_DSA_65_SIGNATURE_BYTES) {
    throw new Error(`ML-DSA-65 signature must be ${ML_DSA_65_SIGNATURE_BYTES} bytes`);
  }
  return {
    schema: HYBRID_SIGNATURE_SCHEMA,
    ed25519Signature: hex(ed),
    mlDsa65Signature: hex(dsa),
  };
}

/**
 * Normalize a hybrid signature to its two parts. Accepts the JSON record
 * ({ schema, ed25519Signature, mlDsa65Signature }), a binary bundle
 * (Uint8Array or hex), or a bundle hex string. Throws on malformed input;
 * verifyHybridSignature catches that and returns false.
 */
export function parseHybridSignature(hybridSignature) {
  if (hybridSignature instanceof Uint8Array) {
    const parts = decodeHybridSignatureBundle(hybridSignature);
    return { ed25519Signature: hex(parts.ed25519Signature), mlDsa65Signature: hex(parts.mlDsa65Signature) };
  }
  if (typeof hybridSignature === 'string') {
    const parts = decodeHybridSignatureBundle(unhex(hybridSignature));
    return { ed25519Signature: hex(parts.ed25519Signature), mlDsa65Signature: hex(parts.mlDsa65Signature) };
  }
  if (hybridSignature && typeof hybridSignature === 'object') {
    if (hybridSignature.schema !== HYBRID_SIGNATURE_SCHEMA) {
      throw new Error(`hybrid signature schema must be ${HYBRID_SIGNATURE_SCHEMA}`);
    }
    return hybridSignatureRecord(hybridSignature.ed25519Signature, hybridSignature.mlDsa65Signature);
  }
  throw new Error('hybrid signature must be a record, a bundle, or bundle hex');
}

/**
 * Sign a payload hybridly: the same RFC 8785 canonical bytes with
 * Ed25519 AND ML-DSA-65. When expected public keys are given, each part
 * is checked against its expected key (the Ed25519 check throws on
 * mismatch; the ML-DSA-65 check re-verifies the fresh signature).
 * Returns { schema, ed25519Signature, mlDsa65Signature, bundleHex,
 * canonicalBytesHex }. The ML-DSA-65 part is re-verified before return.
 */
export function signHybridPayload({
  ed25519PrivateKey,
  mlDsa65PrivateKey,
  payload,
  expectedEd25519PublicKey,
  expectedMlDsa65PublicKeySpkiDer,
  meter = defaultMetrology,
}) {
  const ed = signPayload({
    privateKey: ed25519PrivateKey,
    payload,
    expectedPublicKey: expectedEd25519PublicKey,
    meter,
  });
  const mlDsa65Signature = signMlDsa65({
    privateKey: mlDsa65PrivateKey,
    payload,
    expectedPublicKeySpkiDer: expectedMlDsa65PublicKeySpkiDer,
    meter,
  });
  const bundleHex = hex(encodeHybridSignatureBundle(ed.signatureHex, mlDsa65Signature));
  return {
    schema: HYBRID_SIGNATURE_SCHEMA,
    ed25519Signature: ed.signatureHex,
    mlDsa65Signature,
    bundleHex,
    canonicalBytesHex: ed.canonicalBytesHex,
  };
}

/**
 * Verify a hybrid signature: BOTH the Ed25519 part and the ML-DSA-65
 * part must verify over the same canonical bytes. A null/missing
 * ML-DSA-65 public key, a malformed bundle or record, or either part
 * failing returns false. Never throws for bad input.
 */
export function verifyHybridSignature({ ed25519PublicKey, mlDsa65PublicKey, hybridSignature, payload, meter = defaultMetrology }) {
  if (mlDsa65PublicKey === null || mlDsa65PublicKey === undefined) return false;
  let parts;
  try {
    parts = parseHybridSignature(hybridSignature);
  } catch {
    return false;
  }
  const edOk = verifySignature({
    publicKey: ed25519PublicKey,
    signature: parts.ed25519Signature,
    payload,
    meter,
  });
  if (!edOk) return false;
  return verifyMlDsa65({
    publicKey: mlDsa65PublicKey,
    signature: parts.mlDsa65Signature,
    payload,
    meter,
  });
}

/** Pinned ML-DSA-65 SPKI DER hex for a role, or null when unprovisioned. */
export function pqcPublicKeyForRole(role, protocol = loadProtocol()) {
  return protocol?.postQuantum?.keys?.[role]?.mlDsa65PublicKeySpkiDer ?? null;
}

/** Provisioning status of the pinned PQC keys: 'provisioned' | 'unprovisioned'. */
export function pqcProvisioningStatus(protocol = loadProtocol()) {
  const status = (role) =>
    typeof pqcPublicKeyForRole(role, protocol) === 'string' ? 'provisioned' : 'unprovisioned';
  return { authority: status('authority'), guardian: status('guardian') };
}

/** Verify a hybrid signature as the Authority (Ed25519 + ML-DSA-65). */
export function verifyHybridAuthoritySignature(hybridSignature, payload, protocol = loadProtocol(), meter = defaultMetrology) {
  return verifyHybridSignature({
    ed25519PublicKey: protocol.authority.rawPublicKey,
    mlDsa65PublicKey: pqcPublicKeyForRole('authority', protocol),
    hybridSignature,
    payload,
    meter,
  });
}

/** Verify a hybrid signature as the Guardian (Ed25519 + ML-DSA-65). */
export function verifyHybridGuardianSignature(hybridSignature, payload, protocol = loadProtocol(), meter = defaultMetrology) {
  return verifyHybridSignature({
    ed25519PublicKey: protocol.guardian.rawPublicKey,
    mlDsa65PublicKey: pqcPublicKeyForRole('guardian', protocol),
    hybridSignature,
    payload,
    meter,
  });
}

/**
 * Sign a payload hybridly as one role. The Ed25519 key must derive to
 * the pinned Ed25519 key for the role, and the ML-DSA-65 key must match
 * the pinned ML-DSA-65 key for the role. An unprovisioned (null) pinned
 * PQC key refuses signing — fail-closed. Returns the hybrid signature
 * plus its bundle and canonical bytes, re-verified before return.
 */
export function signHybridAsRole(
  { role, ed25519PrivateKey, mlDsa65PrivateKey, payload, meter = defaultMetrology },
  protocol = loadProtocol(),
) {
  if (role !== 'authority' && role !== 'guardian') {
    throw new Error("role must be 'authority' or 'guardian'");
  }
  const pinnedPqc = pqcPublicKeyForRole(role, protocol);
  if (typeof pinnedPqc !== 'string') {
    throw new Error(`ML-DSA-65 public key for ${role} is unprovisioned — hybrid signing refused`);
  }
  const signed = signHybridPayload({
    ed25519PrivateKey,
    mlDsa65PrivateKey,
    payload,
    expectedEd25519PublicKey: protocol[role].rawPublicKey,
    expectedMlDsa65PublicKeySpkiDer: pinnedPqc,
    meter,
  });
  const verified =
    role === 'authority'
      ? verifyHybridAuthoritySignature(signed, payload, protocol, meter)
      : verifyHybridGuardianSignature(signed, payload, protocol, meter);
  if (!verified) {
    throw new Error('fresh hybrid signature failed re-verification — refusing to return it');
  }
  return { role, ...signed, verified: true };
}

/**
 * The hybrid Murph check: Authority and Guardian must have hybrid-signed
 * the SAME record over the SAME RFC 8785 canonical payload, and the
 * payload must name the pinned chain id and genesis. Returns
 * { authority, guardian, both, genesis, complete, canonicalBytesHex }.
 * `complete` adds the Genesis guardrail, mirroring verifyMurphRecord.
 */
export function verifyHybridMurphRecord(
  { payload, authorityHybridSignature, guardianHybridSignature, meter = defaultMetrology },
  protocol = loadProtocol(),
) {
  const authority = verifyHybridAuthoritySignature(authorityHybridSignature, payload, protocol, meter);
  const guardian = verifyHybridGuardianSignature(guardianHybridSignature, payload, protocol, meter);
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
