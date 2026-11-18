// numina-consensus-canonicalization.test.mjs — RFC 8785 canonicalization audit
// for the consensus/Raft path.
//
// What this proves, with ephemeral keypairs generated fresh on every run:
//  - (a) the same unsigned envelope with keys in different orders produces
//    identical canonical bytes, identical envelope digests
//    (NuminaPairBindingRaftEngine.envelopeDigest), and identical Ed25519
//    signatures; the ML-DSA-65 parts are NOT byte-identical — ML-DSA-65
//    signing is randomized (FIPS 204), verified empirically on this Node /
//    OpenSSL — so the hybrid invariant is verification-equivalence, not
//    byte-identity: each ML-DSA-65 signature verifies over BOTH key
//    orderings, and the full hybrid signature verifies cross-ordering;
//  - (b) the same envelope parsed from JSON text with different whitespace
//    (and different key order) produces identical digests and signatures;
//  - (c) a digest computed over JSON.stringify bytes DIFFERS from the
//    canonical digest when key order differs — documenting why
//    canonicalization matters: a verifier hashing JSON.stringify bytes
//    would accept one key ordering and reject the other, while the
//    canonical digest accepts both;
//  - end to end: an envelope signed over one key ordering commits in the
//    Raft engine when assembled with another key ordering, with the same
//    digest — the signatures cover canonical bytes, not insertion order;
//  - the KEX transcript boundary: the KEX transcript is a defined binary
//    layout (UTF-8 profile, 0x00, uint32-BE lengths), not JSON, so
//    RFC 8785 does not apply to it; it is byte-deterministic for the same
//    inputs and uses big-endian length prefixes.
//
// No Authority or Guardian private key exists anywhere in this codebase;
// every keypair here is ephemeral, never stored, never logged, and never
// presented as the Authority. The real ML-DSA-65 keys are unprovisioned
// (null), so all hybrid signing here uses a test protocol object.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalBytes, hex, verifySignature } from '../src/numina-protocol-verify.js';
import { signPayload } from '../src/numina-protocol-sign.js';
import {
  generateMlDsa65Keypair,
  exportMlDsa65PublicKeySpkiDer,
  signHybridPayload,
  verifyHybridSignature,
  verifyMlDsa65,
} from '../src/numina-protocol-pqc.js';
import { buildKexTranscript, generateKexKeypair } from '../src/numina-protocol-kex.js';
import {
  NuminaPairBindingRaftEngine,
  PAIR_BINDING_SCHEMA_VERSION,
  PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
  PAIR_BINDING_SOLE_OWNER,
} from '../src/numina-pair-binding-raft.js';

const CHAIN_ID = 962421430;
const GENESIS = '0x05b4e83876ea30a83f011ab5b0537b59ea1175810dc977f1d4eefbd1d0d7c88b';
const NONCE = '0123456789abcdef0123456789abcdef';
const CLUSTER_ID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
const TIMESTAMP = '2026-11-15T18:00:00.000Z';
const ORIGIN_NODE_ID = 'node-authority-01';
const COUNTERPARTY_NODE_ID = 'node-guardian-01';
const ENGINE_NODE_ID = 'node-authority-01';

// A protocol object with ephemeral Ed25519 + ML-DSA-65 keys pinned for
// both roles, so the engine can be tested without touching the real
// pinned Authority key (whose PQC key is unprovisioned).
function testProtocol() {
  const { publicKey: aPub, secretKey: aPriv } = ed25519.keygen();
  const { publicKey: gPub, secretKey: gPriv } = ed25519.keygen();
  const aDsa = generateMlDsa65Keypair();
  const gDsa = generateMlDsa65Keypair();
  return {
    protocol: {
      authority: { rawPublicKey: hex(aPub) },
      guardian: { rawPublicKey: hex(gPub) },
      chain: { id: CHAIN_ID, genesis: GENESIS },
      postQuantum: {
        keys: {
          authority: { mlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(aDsa.publicKey) },
          guardian: { mlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(gDsa.publicKey) },
        },
      },
    },
    authorityEdPublicKeyHex: hex(aPub),
    guardianEdPublicKeyHex: hex(gPub),
    authorityEdPrivateKey: aPriv,
    guardianEdPrivateKey: gPriv,
    authorityDsa: aDsa,
    guardianDsa: gDsa,
  };
}

// The unsigned envelope — the bytes both roles hybrid-sign — in one
// insertion order. Nested objects give key-order coverage at every level.
function buildUnsigned() {
  return {
    version: PAIR_BINDING_SCHEMA_VERSION,
    timestamp: TIMESTAMP,
    nonce: NONCE,
    authorship: {
      owner: PAIR_BINDING_SOLE_OWNER,
      entity: 'Numina Labs',
      controlPercentage: 100,
    },
    raftContext: {
      term: 1,
      index: 1,
      leaderId: ORIGIN_NODE_ID,
      clusterId: CLUSTER_ID,
      originNodeId: ORIGIN_NODE_ID,
      counterpartyNodeId: COUNTERPARTY_NODE_ID,
      // Genesis entry: predecessor is the all-zero hash. prevEntryHash
      // sits inside the signed bytes, so the chain link is covered by
      // the same canonical digest as the rest of the envelope.
      prevEntryHash: PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
    },
    payload: {
      stateTransition: 'IMMUTABLE_SUCCESSION_ROOT_ACTIVATION',
      metricsNormalization: [100, 200, 300],
      nested: { zeta: 'last', alpha: 'first', mid: { b: 2, a: 1 } },
    },
  };
}

// Same logical value, keys inserted in the opposite order at every level.
// Arrays keep their order: JSON arrays are ordered, and canonicalization
// preserves array order — only object key order is insignificant.
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = reverseKeys(value[key]);
    return out;
  }
  return value;
}

/** SHA-256 hex of raw JSON.stringify bytes — the non-canonical digest. */
function stringifyDigest(value) {
  return hex(sha256(new TextEncoder().encode(JSON.stringify(value))));
}

/** SHA-256 hex of the RFC 8785 canonical bytes — the envelope digest. */
function canonicalDigest(value) {
  return hex(sha256(canonicalBytes(value)));
}

function signBoth(fixture, unsigned) {
  const origin = signHybridPayload({
    ed25519PrivateKey: fixture.authorityEdPrivateKey,
    mlDsa65PrivateKey: fixture.authorityDsa.privateKey,
    payload: unsigned,
    expectedEd25519PublicKey: fixture.authorityEdPublicKeyHex,
    expectedMlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey),
  });
  const counterparty = signHybridPayload({
    ed25519PrivateKey: fixture.guardianEdPrivateKey,
    mlDsa65PrivateKey: fixture.guardianDsa.privateKey,
    payload: unsigned,
    expectedEd25519PublicKey: fixture.guardianEdPublicKeyHex,
    expectedMlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(fixture.guardianDsa.publicKey),
  });
  return { origin, counterparty };
}

function hybridRecord(signed) {
  return {
    schema: signed.schema,
    ed25519Signature: signed.ed25519Signature,
    mlDsa65Signature: signed.mlDsa65Signature,
  };
}

test('(a) key order: identical canonical bytes, digests, and Ed25519 signatures', () => {
  const fixture = testProtocol();
  const unsigned = buildUnsigned();
  const reordered = reverseKeys(unsigned);
  assert.notDeepEqual(Object.keys(unsigned), Object.keys(reordered));
  assert.notEqual(JSON.stringify(unsigned), JSON.stringify(reordered));

  // Identical canonical bytes, hence identical envelope digests.
  assert.deepEqual(canonicalBytes(unsigned), canonicalBytes(reordered));
  assert.equal(canonicalDigest(unsigned), canonicalDigest(reordered));
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  assert.deepEqual(engine.envelopeDigest(unsigned), engine.envelopeDigest(reordered));

  // Ed25519 is deterministic (RFC 8032): the same canonical bytes give
  // the same signature, whichever key order the envelope arrived in.
  const signed = signBoth(fixture, unsigned);
  const signedReordered = signBoth(fixture, reordered);
  assert.equal(signed.origin.ed25519Signature, signedReordered.origin.ed25519Signature);
  assert.equal(signed.counterparty.ed25519Signature, signedReordered.counterparty.ed25519Signature);
  assert.equal(signed.origin.canonicalBytesHex, signedReordered.origin.canonicalBytesHex);
  assert.equal(signed.counterparty.canonicalBytesHex, signedReordered.counterparty.canonicalBytesHex);
});

test('(a) ML-DSA-65 is randomized: hybrid equivalence is verification, not byte-identity', () => {
  const fixture = testProtocol();
  const unsigned = buildUnsigned();
  const reordered = reverseKeys(unsigned);

  // Signing the SAME payload twice yields different ML-DSA-65 signatures:
  // FIPS 204 signing is randomized in Node/OpenSSL. Byte-identical hybrid
  // signatures are therefore not the invariant — verification is.
  const first = signBoth(fixture, unsigned);
  const second = signBoth(fixture, unsigned);
  assert.notEqual(first.origin.mlDsa65Signature, second.origin.mlDsa65Signature);
  assert.notEqual(first.origin.bundleHex, second.origin.bundleHex);

  // Each ML-DSA-65 signature verifies over BOTH key orderings.
  for (const signed of [first, second]) {
    for (const payload of [unsigned, reordered]) {
      assert.equal(
        verifyMlDsa65({
          publicKey: exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey),
          signature: signed.origin.mlDsa65Signature,
          payload,
        }),
        true,
      );
      assert.equal(
        verifyHybridSignature({
          ed25519PublicKey: fixture.authorityEdPublicKeyHex,
          mlDsa65PublicKey: exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey),
          hybridSignature: hybridRecord(signed.origin),
          payload,
        }),
        true,
      );
    }
  }
  // And a signature made over the reordered envelope verifies over the
  // original ordering, and vice versa.
  const signedReordered = signBoth(fixture, reordered);
  assert.equal(
    verifyHybridSignature({
      ed25519PublicKey: fixture.guardianEdPublicKeyHex,
      mlDsa65PublicKey: exportMlDsa65PublicKeySpkiDer(fixture.guardianDsa.publicKey),
      hybridSignature: hybridRecord(signedReordered.counterparty),
      payload: unsigned,
    }),
    true,
  );
});

test('(b) whitespace: the same envelope parsed from differently spaced JSON text is identical', () => {
  const fixture = testProtocol();
  const unsigned = buildUnsigned();
  const reordered = reverseKeys(unsigned);
  // Pretty-printed, reordered keys, extra blank lines; compact, original order.
  const prettyText = `\n\n${JSON.stringify(reordered, null, 2)}\n\n`;
  const compactText = JSON.stringify(unsigned);
  assert.notEqual(prettyText, compactText);
  const fromPretty = JSON.parse(prettyText);
  const fromCompact = JSON.parse(compactText);
  assert.deepEqual(fromPretty, fromCompact);

  assert.deepEqual(canonicalBytes(fromPretty), canonicalBytes(fromCompact));
  assert.equal(canonicalDigest(fromPretty), canonicalDigest(fromCompact));
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  assert.deepEqual(engine.envelopeDigest(fromPretty), engine.envelopeDigest(fromCompact));

  // The Ed25519-only sign path (scripts/sign-murph-record.mjs reads the
  // payload file with JSON.parse, then signs canonical bytes) is likewise
  // whitespace-insensitive: identical signature and canonical bytes.
  const signedPretty = signPayload({
    privateKey: fixture.authorityEdPrivateKey,
    payload: fromPretty,
    expectedPublicKey: fixture.authorityEdPublicKeyHex,
  });
  const signedCompact = signPayload({
    privateKey: fixture.authorityEdPrivateKey,
    payload: fromCompact,
    expectedPublicKey: fixture.authorityEdPublicKeyHex,
  });
  assert.equal(signedPretty.signatureHex, signedCompact.signatureHex);
  assert.equal(signedPretty.canonicalBytesHex, signedCompact.canonicalBytesHex);
  // A signature made over the pretty-parsed payload verifies over the
  // compact-parsed payload, and vice versa.
  assert.equal(
    verifySignature({
      publicKey: fixture.authorityEdPublicKeyHex,
      signature: signedPretty.signatureHex,
      payload: fromCompact,
    }),
    true,
  );
});

test('(c) a JSON.stringify digest DIFFERS from the canonical digest when key order differs', () => {
  const unsigned = buildUnsigned();
  const reordered = reverseKeys(unsigned);

  // The canonical digest is one value for both orderings.
  assert.equal(canonicalDigest(unsigned), canonicalDigest(reordered));
  // The JSON.stringify digests differ from each other — and from the
  // canonical digest — because JSON.stringify preserves insertion order.
  assert.notEqual(stringifyDigest(unsigned), stringifyDigest(reordered));
  assert.notEqual(stringifyDigest(unsigned), canonicalDigest(unsigned));
  assert.notEqual(stringifyDigest(reordered), canonicalDigest(reordered));
  // The raw texts differ too: this is not a hash collision artifact.
  assert.notEqual(JSON.stringify(unsigned), JSON.stringify(reordered));
  // A verifier hashing JSON.stringify bytes would therefore accept one
  // ordering and reject the other, for the same logical envelope — the
  // exact failure canonicalization exists to prevent.
});

test('end to end: an envelope signed over one key ordering commits when assembled in another', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const unsigned = buildUnsigned();
  const reordered = reverseKeys(unsigned);
  // Sign the original ordering, then assemble the full document with the
  // unsigned fields in the reordered ordering. The signatures cover
  // canonical bytes, so verification must pass.
  const signed = signBoth(fixture, unsigned);
  const document = {
    ...reordered,
    attestations: {
      origin: {
        publicKey: fixture.authorityEdPublicKeyHex,
        nodeId: ORIGIN_NODE_ID,
        hybridSignature: hybridRecord(signed.origin),
      },
      counterparty: {
        publicKey: fixture.guardianEdPublicKeyHex,
        nodeId: COUNTERPARTY_NODE_ID,
        hybridSignature: hybridRecord(signed.counterparty),
      },
    },
  };
  const result = engine.processEntry(document);
  assert.equal(result.success, true);
  assert.equal(result.digest, canonicalDigest(unsigned));
  assert.equal(result.digest, canonicalDigest(reordered));
  assert.equal(result.prevEntryHash, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  assert.equal(engine.stateLog.length, 1);
  assert.equal(engine.stateLog[0].digest, canonicalDigest(unsigned));
  assert.equal(engine.stateLog[0].prevEntryHash, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  // The committed digest is the canonical digest, not a stringify digest.
  assert.notEqual(engine.stateLog[0].digest, stringifyDigest(unsigned));
  assert.notEqual(engine.stateLog[0].digest, stringifyDigest(reordered));
});

test('canonicalBytes rejects a non-JSON-canonicalizable payload instead of hashing garbage', () => {
  assert.throws(() => canonicalBytes(undefined), /not JSON-canonicalizable/);
  assert.throws(() => canonicalBytes(() => {}), /not JSON-canonicalizable/);
});

test('KEX transcript boundary: binary layout with big-endian lengths, not JSON', () => {
  const responder = generateKexKeypair();
  const responderXDer = responder.x25519.publicKey.export({ type: 'spki', format: 'der' });
  const initiatorXDer = generateKexKeypair().x25519.publicKey.export({ type: 'spki', format: 'der' });
  const ciphertext = Buffer.alloc(1088, 0xab);
  const transcript = buildKexTranscript({
    initiatorX25519PublicKeyDer: initiatorXDer,
    responderX25519PublicKeyDer: responderXDer,
    mlKem768Ciphertext: ciphertext,
  });
  // Manual reconstruction of the documented layout: UTF-8(profile) ||
  // 0x00 || uint32-BE length + initiator DER || uint32-BE length +
  // responder DER || uint32-BE length + ciphertext. No JSON anywhere.
  const profile = Buffer.from('numina-e2ee-x25519-mlkem768-hkdf-aes256gcm-ed25519-mldsa65-v1', 'utf8');
  const u32be = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n, 0);
    return b;
  };
  const expected = Buffer.concat([
    profile,
    Buffer.from([0x00]),
    u32be(initiatorXDer.length),
    initiatorXDer,
    u32be(responderXDer.length),
    responderXDer,
    u32be(ciphertext.length),
    ciphertext,
  ]);
  assert.deepEqual(Buffer.from(transcript), expected);
  // The length prefixes read big-endian: 44 for each X25519 SPKI DER.
  const view = new DataView(transcript.buffer, transcript.byteOffset, transcript.byteLength);
  assert.equal(view.getUint32(profile.length + 1, false), 44);
  // Deterministic for the same inputs: no key order or whitespace exists
  // to vary, because the transcript is binary, not a JSON payload.
  const again = buildKexTranscript({
    initiatorX25519PublicKeyDer: initiatorXDer,
    responderX25519PublicKeyDer: responderXDer,
    mlKem768Ciphertext: ciphertext,
  });
  assert.deepEqual(Buffer.from(again), Buffer.from(transcript));
});
