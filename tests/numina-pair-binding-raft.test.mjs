// numina-pair-binding-raft.test.mjs — pair-binding Raft engine on the hybrid PQC path.
//
// What this proves, with ephemeral keypairs generated fresh on every run:
//  - a valid hybrid-signed entry (Ed25519 + ML-DSA-65, both parts over the
//    same canonical bytes) commits, in record form, in bundle-hex form,
//    and in multi-algorithm signatures-array form;
//  - a bad Ed25519 part fails; a bad ML-DSA-65 part fails; either part
//    failing fails the whole entry (fail-closed);
//  - the engine takes authority ONLY from the pinned keys: a document
//    signed by keys that are not pinned is rejected (PINNED_KEY_MISMATCH),
//    and a document that copies the pinned public keys into its
//    attestations without the private keys is rejected too (the signature
//    cannot verify against the pinned key);
//  - node identity is bound: an attestation naming the wrong node id
//    fails (NODE_ID_BINDING_MISMATCH), a leader that is neither bound
//    node fails structural validation, and a node id changed inside the
//    signed bytes fails signature verification;
//  - strict predecessor hash-chaining (v1.2.0): raftContext.prevEntryHash
//    must equal the stored digest of the last committed entry (or the
//    all-zero hash for the genesis entry), enforced after index
//    monotonicity and before hybrid verification as
//    PREV_ENTRY_HASH_MISMATCH; a wrong predecessor, a forked chain head,
//    an out-of-order append, and a non-zero genesis predecessor all fail
//    and commit nothing;
//  - an envelope larger than the 16,384-byte frame bound fails
//    (FRAME_EXCEEDS_MTU) and nothing is committed;
//  - a stale Raft term fails; a non-monotonic index fails; an authorship
//    mismatch fails; unprovisioned ML-DSA-65 keys fail closed;
//  - malformed envelopes fail structural validation;
//  - duplicate signer keys are rejected.
//
// No Authority or Guardian private key exists anywhere in this codebase;
// every keypair here is ephemeral, never stored, never logged, and never
// presented as the Authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { loadProtocol, canonicalBytes, hex } from '../src/numina-protocol-verify.js';
import {
  generateMlDsa65Keypair,
  exportMlDsa65PublicKeySpkiDer,
  signHybridPayload,
} from '../src/numina-protocol-pqc.js';
import {
  NuminaPairBindingRaftEngine,
  loadPairBindingSchema,
  validatePairBindingEnvelope,
  PAIR_BINDING_SCHEMA_VERSION,
  PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
  PAIR_BINDING_MAX_FRAME_BYTES,
  PAIR_BINDING_SIGNATURE_ALGORITHMS,
  PAIR_BINDING_SOLE_OWNER,
} from '../src/numina-pair-binding-raft.js';

const CHAIN_ID = 962421430;
const GENESIS = '0x05b4e83876ea30a83f011ab5b0537b59ea1175810dc977f1d4eefbd1d0d7c88b';
const NONCE = '0123456789abcdef0123456789abcdef';
const NONCE_2 = 'fedcba9876543210fedcba9876543210';
const CLUSTER_ID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
const TIMESTAMP = '2026-11-15T18:00:00.000Z';
const ORIGIN_NODE_ID = 'node-authority-01';
const COUNTERPARTY_NODE_ID = 'node-guardian-01';
const ENGINE_NODE_ID = 'node-authority-01';
const PAYLOAD = {
  stateTransition: 'IMMUTABLE_SUCCESSION_ROOT_ACTIVATION',
  metricsNormalization: [100, 200, 300],
};

// A protocol object with ephemeral Ed25519 + ML-DSA-65 keys pinned for
// both roles, so the engine can be tested both ways without touching the
// real pinned Authority key (whose PQC key is unprovisioned).
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

// A degenerate protocol where both roles pin the SAME Ed25519 key (but
// distinct ML-DSA-65 keys): only used to prove the duplicate-signer guard.
function sharedKeyProtocol() {
  const fixture = testProtocol();
  fixture.protocol.guardian.rawPublicKey = fixture.authorityEdPublicKeyHex;
  fixture.guardianEdPublicKeyHex = fixture.authorityEdPublicKeyHex;
  fixture.guardianEdPrivateKey = fixture.authorityEdPrivateKey;
  return fixture;
}

/** The three-field hybrid signature record (no bundle/canonical extras). */
function hybridRecord(signed) {
  return {
    schema: signed.schema,
    ed25519Signature: signed.ed25519Signature,
    mlDsa65Signature: signed.mlDsa65Signature,
  };
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

function buildDocument(
  fixture,
  {
    term = 1,
    index = 1,
    prevEntryHash = PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
    nonce = NONCE,
    authorship = {
      owner: PAIR_BINDING_SOLE_OWNER,
      entity: 'Numina Labs',
      controlPercentage: 100,
    },
    payload = PAYLOAD,
    signer = fixture,
    originPublicKey = signer.authorityEdPublicKeyHex,
    counterpartyPublicKey = signer.guardianEdPublicKeyHex,
    leaderId = ORIGIN_NODE_ID,
    originNodeId = ORIGIN_NODE_ID,
    counterpartyNodeId = COUNTERPARTY_NODE_ID,
    hybridSignatureForm = 'record',
  } = {},
) {
  const unsigned = {
    version: PAIR_BINDING_SCHEMA_VERSION,
    timestamp: TIMESTAMP,
    nonce,
    authorship,
    raftContext: { term, index, leaderId, clusterId: CLUSTER_ID, originNodeId, counterpartyNodeId, prevEntryHash },
    payload,
  };
  const signed = signBoth(signer, unsigned);
  const toAttestation = (part, publicKey, nodeId) => {
    if (hybridSignatureForm === 'array') {
      // Multi-algorithm signature array: one Ed25519 entry (which names
      // the attestation's public key) and one ML-DSA-65 entry (signature
      // only — its key is the pinned key for the role, never transmitted).
      return {
        publicKey,
        nodeId,
        signatures: [
          { algorithm: 'ed25519', signature: part.ed25519Signature, publicKey },
          { algorithm: 'ml-dsa-65', signature: part.mlDsa65Signature },
        ],
      };
    }
    return {
      publicKey,
      nodeId,
      hybridSignature: hybridSignatureForm === 'bundle' ? part.bundleHex : hybridRecord(part),
    };
  };
  return {
    ...unsigned,
    attestations: {
      origin: toAttestation(signed.origin, originPublicKey, originNodeId),
      counterparty: toAttestation(signed.counterparty, counterpartyPublicKey, counterpartyNodeId),
    },
  };
}

function deepCopy(document) {
  return JSON.parse(JSON.stringify(document));
}

test('schema file describes the hybrid envelope and a valid envelope validates', () => {
  const schema = loadPairBindingSchema();
  assert.equal(schema.title, 'Numina Bilateral Pair-Binding & Raft Consensus Envelope (Hybrid PQC)');
  assert.deepEqual(schema.required, [
    'version',
    'timestamp',
    'nonce',
    'authorship',
    'raftContext',
    'payload',
    'attestations',
  ]);
  assert.equal(schema.properties.version.const, '1.2.0');
  assert.equal(schema.properties.authorship.properties.owner.const, 'Samuel J. Kott');
  assert.equal(schema.properties.authorship.properties.controlPercentage.const, 100);
  assert.equal(schema.$defs.hybridSignatureRecord.properties.schema.const, 'numina.hybrid-signature.v1');
  assert.match(schema.$defs.hybridSignatureRecord.properties.mlDsa65Signature.pattern, /6618/);
  assert.match(schema.$defs.hybridAttestation.properties.publicKey.pattern, /64/);
  // v1.2.0: strict predecessor hash-chaining (prevEntryHash), on top of
  // the v1.1.0 multi-algorithm signature arrays, node-id binding, and
  // frame bound.
  assert.equal(PAIR_BINDING_SCHEMA_VERSION, '1.2.0');
  assert.equal(PAIR_BINDING_GENESIS_PREV_ENTRY_HASH, '00'.repeat(32));
  assert.equal(PAIR_BINDING_GENESIS_PREV_ENTRY_HASH.length, 64);
  assert.match(schema.description, /prevEntryHash/);
  assert.match(schema.description, /all-zero/);
  assert.deepEqual(schema.properties.raftContext.required, [
    'term',
    'index',
    'leaderId',
    'clusterId',
    'originNodeId',
    'counterpartyNodeId',
    'prevEntryHash',
  ]);
  assert.equal(schema.properties.raftContext.properties.prevEntryHash.pattern, '^[a-f0-9]{64}$');
  assert.match(schema.properties.raftContext.properties.prevEntryHash.description, /all-zero/);
  assert.equal(PAIR_BINDING_MAX_FRAME_BYTES, 16384);
  assert.deepEqual(PAIR_BINDING_SIGNATURE_ALGORITHMS, ['ed25519', 'ml-dsa-65']);
  assert.equal(schema.$defs.signatureArray.minItems, 2);
  assert.equal(schema.$defs.signatureArray.maxItems, 2);
  assert.equal(schema.$defs.ed25519SignatureEntry.properties.algorithm.const, 'ed25519');
  assert.equal(schema.$defs.mlDsa65SignatureEntry.properties.algorithm.const, 'ml-dsa-65');
  assert.match(schema.$defs.mlDsa65SignatureEntry.properties.signature.pattern, /6618/);
  assert.match(schema.description, /16,384-byte/);
  const fixture = testProtocol();
  const document = buildDocument(fixture);
  assert.deepEqual(validatePairBindingEnvelope(document), { ok: true, issues: [] });
  const arrayDocument = buildDocument(fixture, { hybridSignatureForm: 'array', nonce: NONCE_2 });
  assert.deepEqual(validatePairBindingEnvelope(arrayDocument), { ok: true, issues: [] });
});

test('valid hybrid-signed entry commits, in record form and in bundle-hex form', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture);
  const result = engine.processEntry(document);
  assert.equal(result.success, true);
  assert.equal(result.commitIndex, 1);
  assert.equal(result.term, 1);
  assert.equal(result.index, 1);
  assert.equal(result.soleOwner, PAIR_BINDING_SOLE_OWNER);
  assert.equal(result.ownershipShare, '100%');
  // The digest is the SHA-256 of the canonical bytes of the unsigned envelope.
  const expectedDigest = hex(
    sha256(canonicalBytes(NuminaPairBindingRaftEngine.unsignedEnvelope(document))),
  );
  assert.equal(result.digest, expectedDigest);
  assert.equal(result.prevEntryHash, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  assert.equal(engine.stateLog.length, 1);
  assert.deepEqual(engine.stateLog[0], {
    index: 1,
    term: 1,
    digest: expectedDigest,
    prevEntryHash: PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
    owner: PAIR_BINDING_SOLE_OWNER,
    payload: PAYLOAD,
  });
  // A second entry, hybrid signatures as NPQ1 bundle hex, commits too —
  // chained to the first entry's digest, not to the genesis hash.
  const second = buildDocument(fixture, {
    index: 2,
    nonce: NONCE_2,
    hybridSignatureForm: 'bundle',
    prevEntryHash: result.digest,
  });
  const secondResult = engine.processEntry(second);
  assert.equal(secondResult.success, true);
  assert.equal(secondResult.commitIndex, 2);
  assert.equal(secondResult.prevEntryHash, result.digest);
  assert.equal(engine.stateLog[1].prevEntryHash, result.digest);
  assert.equal(engine.stateLog.length, 2);
});

test('multi-algorithm signatures array commits, and fits the 16 KiB frame', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture, { hybridSignatureForm: 'array' });
  assert.deepEqual(validatePairBindingEnvelope(document), { ok: true, issues: [] });
  const frameBytes = canonicalBytes(document).length;
  assert.ok(frameBytes <= PAIR_BINDING_MAX_FRAME_BYTES, `array-form frame is ${frameBytes} bytes`);
  const result = engine.processEntry(document);
  assert.equal(result.success, true);
  assert.equal(result.commitIndex, 1);
  assert.equal(engine.stateLog.length, 1);
  // All three signature forms fit the frame with a small payload.
  for (const form of ['record', 'bundle', 'array']) {
    const sized = buildDocument(fixture, { hybridSignatureForm: form, nonce: NONCE_2 });
    const size = canonicalBytes(sized).length;
    assert.ok(size <= PAIR_BINDING_MAX_FRAME_BYTES, `${form} frame is ${size} bytes`);
  }
});

test('array missing the ML-DSA-65 entry fails structural validation', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture, { hybridSignatureForm: 'array' });
  const tampered = deepCopy(document);
  tampered.attestations.origin.signatures = tampered.attestations.origin.signatures.filter(
    (entry) => entry.algorithm === 'ed25519',
  );
  assert.equal(validatePairBindingEnvelope(tampered).ok, false);
  const result = engine.processEntry(tampered);
  assert.equal(result.success, false);
  assert.equal(result.error, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(engine.stateLog.length, 0);
});

test('array with a duplicate algorithm fails structural validation', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture, { hybridSignatureForm: 'array' });
  const tampered = deepCopy(document);
  tampered.attestations.counterparty.signatures[1] = {
    ...tampered.attestations.counterparty.signatures[0],
  };
  assert.equal(validatePairBindingEnvelope(tampered).ok, false);
  const result = engine.processEntry(tampered);
  assert.equal(result.success, false);
  assert.equal(result.error, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(engine.stateLog.length, 0);
});

test('array with a bad ML-DSA-65 part fails, and nothing is committed', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture, { hybridSignatureForm: 'array' });
  const tampered = deepCopy(document);
  const dsa = tampered.attestations.origin.signatures.find((entry) => entry.algorithm === 'ml-dsa-65');
  dsa.signature = `00${dsa.signature.slice(2)}`;
  const result = engine.processEntry(tampered);
  assert.equal(result.success, false);
  assert.equal(result.error, 'CRYPTOGRAPHIC_SIGNATURE_MISMATCH');
  assert.deepEqual(result.checks, { originValid: false, counterpartyValid: true });
  assert.equal(engine.stateLog.length, 0);
});

test('attestation naming the wrong node id fails the binding gate', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  // The attestation node id is NOT inside the signed bytes, so changing
  // it leaves the signatures valid — the binding gate must still refuse:
  // the attestation claims a node the signed raftContext does not bind.
  const document = buildDocument(fixture);
  const tampered = deepCopy(document);
  tampered.attestations.origin.nodeId = COUNTERPARTY_NODE_ID;
  assert.deepEqual(validatePairBindingEnvelope(tampered), { ok: true, issues: [] });
  const result = engine.processEntry(tampered);
  assert.equal(result.success, false);
  assert.equal(result.error, 'NODE_ID_BINDING_MISMATCH');
  assert.equal(engine.stateLog.length, 0);
});

test('node id changed inside the signed bytes fails signature verification', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  // Change the node id in BOTH the signed raftContext and the attestation,
  // so the binding gate passes — the signatures were made over the
  // original node id, so verification must now fail.
  const document = buildDocument(fixture);
  const tampered = deepCopy(document);
  tampered.raftContext.originNodeId = 'node-impostor-01';
  tampered.attestations.origin.nodeId = 'node-impostor-01';
  tampered.raftContext.leaderId = 'node-impostor-01';
  assert.deepEqual(validatePairBindingEnvelope(tampered), { ok: true, issues: [] });
  const result = engine.processEntry(tampered);
  assert.equal(result.success, false);
  assert.equal(result.error, 'CRYPTOGRAPHIC_SIGNATURE_MISMATCH');
  assert.equal(engine.stateLog.length, 0);
});

test('leader that is neither bound node fails structural validation', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture, { leaderId: 'node-somewhere-else' });
  assert.equal(validatePairBindingEnvelope(document).ok, false);
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(engine.stateLog.length, 0);
  // Either bound node may lead.
  const guardianLeads = buildDocument(fixture, { leaderId: COUNTERPARTY_NODE_ID, nonce: NONCE_2 });
  assert.equal(engine.processEntry(guardianLeads).success, true);
});

test('envelope larger than the 16 KiB frame bound is rejected, never truncated', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const bigPayload = { stateTransition: 'BULK_STATE_SYNC', blob: 'x'.repeat(4000) };
  const document = buildDocument(fixture, { payload: bigPayload });
  assert.deepEqual(validatePairBindingEnvelope(document), { ok: true, issues: [] });
  const frameBytes = canonicalBytes(document).length;
  assert.ok(frameBytes > PAIR_BINDING_MAX_FRAME_BYTES, `frame is ${frameBytes} bytes`);
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'FRAME_EXCEEDS_MTU');
  assert.equal(result.frameBytes, frameBytes);
  assert.equal(result.maxFrameBytes, PAIR_BINDING_MAX_FRAME_BYTES);
  assert.equal(engine.stateLog.length, 0);
});

test('bad Ed25519 part fails, and nothing is committed', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture);
  const tampered = deepCopy(document);
  const record = tampered.attestations.origin.hybridSignature;
  record.ed25519Signature = `00${record.ed25519Signature.slice(2)}`;
  const result = engine.processEntry(tampered);
  assert.equal(result.success, false);
  assert.equal(result.error, 'CRYPTOGRAPHIC_SIGNATURE_MISMATCH');
  assert.deepEqual(result.checks, { originValid: false, counterpartyValid: true });
  assert.equal(engine.commitIndex, 0);
  assert.equal(engine.stateLog.length, 0);
});

test('bad ML-DSA-65 part fails', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const document = buildDocument(fixture);
  const tampered = deepCopy(document);
  const record = tampered.attestations.origin.hybridSignature;
  record.mlDsa65Signature = `00${record.mlDsa65Signature.slice(2)}`;
  const result = engine.processEntry(tampered);
  assert.equal(result.success, false);
  assert.equal(result.error, 'CRYPTOGRAPHIC_SIGNATURE_MISMATCH');
  assert.deepEqual(result.checks, { originValid: false, counterpartyValid: true });
  assert.equal(engine.stateLog.length, 0);
});

test('wrong pinned key fails: a document signed by unpinned keys is rejected', () => {
  const fixture = testProtocol();
  const attacker = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  // The attacker signs validly with their own keys — but their keys are
  // not pinned, so the engine must refuse before checking signatures.
  const document = buildDocument(fixture, { signer: attacker });
  assert.equal(validatePairBindingEnvelope(document).ok, true);
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'PINNED_KEY_MISMATCH');
  assert.equal(engine.stateLog.length, 0);
});

test('self-supplied pinned keys do not confer authority', () => {
  const fixture = testProtocol();
  const attacker = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  // The attacker copies the PINNED public keys into the attestations but
  // signs with their own keys. The pinned-key check passes (the strings
  // match), but the signatures cannot verify against the pinned keys.
  const document = buildDocument(fixture, {
    signer: attacker,
    originPublicKey: fixture.authorityEdPublicKeyHex,
    counterpartyPublicKey: fixture.guardianEdPublicKeyHex,
  });
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'CRYPTOGRAPHIC_SIGNATURE_MISMATCH');
  assert.deepEqual(result.checks, { originValid: false, counterpartyValid: false });
  assert.equal(engine.stateLog.length, 0);
});

test('stale term fails and does not commit', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  assert.equal(engine.processEntry(buildDocument(fixture, { term: 2, index: 1 })).success, true);
  assert.equal(engine.currentTerm, 2);
  const stale = buildDocument(fixture, { term: 1, index: 2, nonce: NONCE_2 });
  const result = engine.processEntry(stale);
  assert.equal(result.success, false);
  assert.equal(result.error, 'STALE_RAFT_TERM');
  assert.equal(result.currentTerm, 2);
  assert.equal(result.receivedTerm, 1);
  assert.equal(engine.stateLog.length, 1);
});

test('non-monotonic index fails and does not commit', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  assert.equal(engine.processEntry(buildDocument(fixture, { index: 1 })).success, true);
  const repeat = buildDocument(fixture, { index: 1, nonce: NONCE_2 });
  const result = engine.processEntry(repeat);
  assert.equal(result.success, false);
  assert.equal(result.error, 'INDEX_NOT_MONOTONIC');
  assert.equal(result.commitIndex, 1);
  assert.equal(result.receivedIndex, 1);
  assert.equal(engine.stateLog.length, 1);
});

test('authorship mismatch fails', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const wrongOwner = buildDocument(fixture, {
    authorship: { owner: 'Mallory', entity: 'Numina Labs', controlPercentage: 100 },
  });
  assert.equal(engine.processEntry(wrongOwner).error, 'AUTHORSHIP_OWNERSHIP_MISMATCH');
  const wrongShare = buildDocument(fixture, {
    nonce: NONCE_2,
    authorship: { owner: PAIR_BINDING_SOLE_OWNER, entity: 'Numina Labs', controlPercentage: 99 },
  });
  assert.equal(engine.processEntry(wrongShare).error, 'AUTHORSHIP_OWNERSHIP_MISMATCH');
  assert.equal(engine.stateLog.length, 0);
});

test('unprovisioned ML-DSA-65 keys fail closed against the real protocol', () => {
  const protocol = loadProtocol();
  assert.equal(protocol.postQuantum.keys.authority.mlDsa65PublicKeySpkiDer, null);
  assert.equal(protocol.postQuantum.keys.guardian.mlDsa65PublicKeySpkiDer, null);
  const ephemeral = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID);
  // Attestations name the real pinned Ed25519 keys, so the pinned-key
  // check passes; the hybrid signatures are from ephemeral keys. The
  // provisioning gate must fire before any signature is checked.
  const document = buildDocument(ephemeral, {
    signer: ephemeral,
    originPublicKey: protocol.authority.rawPublicKey,
    counterpartyPublicKey: protocol.guardian.rawPublicKey,
  });
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'PQC_KEYS_UNPROVISIONED');
  assert.equal(engine.stateLog.length, 0);
});

test('structural validation rejects malformed envelopes', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const cases = [
    ['missing payload', (doc) => delete doc.payload],
    ['extra top-level key', (doc) => { doc.extra = 1; }],
    ['bad nonce', (doc) => { doc.nonce = 'xyz'; }],
    ['bad clusterId', (doc) => { doc.raftContext.clusterId = 'not-a-uuid'; }],
    ['bad timestamp', (doc) => { doc.timestamp = 'yesterday'; }],
    ['wrong version', (doc) => { doc.version = '2.0.0'; }],
    ['negative term', (doc) => { doc.raftContext.term = -1; }],
    ['empty payload', (doc) => { doc.payload = {}; }],
    ['short ML-DSA-65 signature', (doc) => {
      doc.attestations.origin.hybridSignature.mlDsa65Signature = '00'.repeat(64);
    }],
    ['missing counterparty attestation', (doc) => delete doc.attestations.counterparty],
  ];
  for (const [name, mutate] of cases) {
    const document = buildDocument(fixture);
    mutate(document);
    assert.equal(validatePairBindingEnvelope(document).ok, false, name);
    const result = engine.processEntry(document);
    assert.equal(result.success, false, name);
    assert.equal(result.error, 'SCHEMA_VALIDATION_FAILED', name);
    assert.ok(Array.isArray(result.details) && result.details.length > 0, name);
  }
  assert.equal(engine.stateLog.length, 0);
});

test('duplicate signer keys are rejected', () => {
  const fixture = sharedKeyProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  // Both attestations carry the one shared pinned key, with valid hybrid
  // signatures under it — the duplicate-signer guard must still refuse.
  const document = buildDocument(fixture);
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'DUPLICATE_SIGNER_KEYS');
  assert.equal(engine.stateLog.length, 0);
});

test('valid two-entry chain passes with correct predecessor chaining', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const first = buildDocument(fixture);
  const firstResult = engine.processEntry(first);
  assert.equal(firstResult.success, true);
  assert.equal(firstResult.prevEntryHash, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  // The second entry names the first entry's digest, computed from the
  // first processEntry result (equivalently: engine.envelopeDigest(first)).
  assert.equal(
    engine.envelopeDigest(first).sha256Hex,
    firstResult.digest,
  );
  const second = buildDocument(fixture, {
    index: 2,
    nonce: NONCE_2,
    prevEntryHash: firstResult.digest,
  });
  const secondResult = engine.processEntry(second);
  assert.equal(secondResult.success, true);
  assert.equal(secondResult.commitIndex, 2);
  assert.equal(secondResult.prevEntryHash, firstResult.digest);
  assert.equal(secondResult.digest, engine.envelopeDigest(second).sha256Hex);
  assert.equal(engine.stateLog.length, 2);
  assert.equal(engine.stateLog[0].prevEntryHash, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  assert.equal(engine.stateLog[1].prevEntryHash, firstResult.digest);
  assert.equal(engine.stateLog[1].digest, secondResult.digest);
  // A third entry chains to the second entry's digest.
  const third = buildDocument(fixture, {
    index: 3,
    nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    prevEntryHash: secondResult.digest,
  });
  assert.equal(engine.processEntry(third).success, true);
  assert.equal(engine.stateLog.length, 3);
  assert.equal(engine.stateLog[2].prevEntryHash, secondResult.digest);
});

test('second entry naming a wrong predecessor hash fails PREV_ENTRY_HASH_MISMATCH', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const first = buildDocument(fixture);
  const firstResult = engine.processEntry(first);
  assert.equal(firstResult.success, true);
  // Correctly signed, correct index — but prevEntryHash still names the
  // genesis (zero) hash while the log is non-empty. The chain gate must
  // refuse it before any signature is checked, and commit nothing.
  const wrongPrev = buildDocument(fixture, {
    index: 2,
    nonce: NONCE_2,
    prevEntryHash: PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
  });
  const result = engine.processEntry(wrongPrev);
  assert.equal(result.success, false);
  assert.equal(result.error, 'PREV_ENTRY_HASH_MISMATCH');
  assert.equal(result.expected, firstResult.digest);
  assert.equal(result.received, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  assert.equal(engine.stateLog.length, 1);
  assert.equal(engine.commitIndex, 1);
  // A one-hex-character typo in the predecessor fails the same way.
  const typoPrev = `0${firstResult.digest.slice(1)}`;
  const typo = buildDocument(fixture, { index: 2, nonce: NONCE_2, prevEntryHash: typoPrev });
  const typoResult = engine.processEntry(typo);
  assert.equal(typoResult.success, false);
  assert.equal(typoResult.error, 'PREV_ENTRY_HASH_MISMATCH');
  assert.equal(typoResult.expected, firstResult.digest);
  assert.equal(typoResult.received, typoPrev);
  assert.equal(engine.stateLog.length, 1);
});

test('forked / stale-leader entry chained to a different head fails PREV_ENTRY_HASH_MISMATCH', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const first = buildDocument(fixture);
  assert.equal(engine.processEntry(first).success, true);
  // A fork: a different first entry (different nonce/payload, correctly
  // signed) that was never committed to this engine. Its digest is a
  // valid chain head — just not THIS engine's head.
  const forkHead = buildDocument(fixture, {
    nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    payload: { stateTransition: 'FORKED_ROOT_ACTIVATION' },
  });
  const forkHeadDigest = engine.envelopeDigest(forkHead).sha256Hex;
  assert.notEqual(forkHeadDigest, engine.stateLog[0].digest);
  // A second entry correctly signed for the fork's head.
  const forked = buildDocument(fixture, {
    index: 2,
    nonce: NONCE_2,
    prevEntryHash: forkHeadDigest,
  });
  const result = engine.processEntry(forked);
  assert.equal(result.success, false);
  assert.equal(result.error, 'PREV_ENTRY_HASH_MISMATCH');
  assert.equal(result.expected, engine.stateLog[0].digest);
  assert.equal(result.received, forkHeadDigest);
  assert.equal(engine.stateLog.length, 1);
  assert.equal(engine.commitIndex, 1);
});

test('out-of-order append fails on the chain gate, not the monotonicity gate', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  // Entry 1 is built (and correctly signed) but NOT submitted yet.
  const first = buildDocument(fixture);
  const firstDigest = engine.envelopeDigest(first).sha256Hex;
  // Entry 2 names entry 1 as its predecessor and is submitted first.
  const second = buildDocument(fixture, {
    index: 2,
    nonce: NONCE_2,
    prevEntryHash: firstDigest,
  });
  const result = engine.processEntry(second);
  // ACTUAL BEHAVIOR: the chain gate fires, not monotonicity. The
  // monotonicity gate only rejects index <= commitIndex when the log is
  // non-empty, and the log is empty here (commitIndex is still 0), so
  // index 2 passes it; the chain gate then expects the all-zero genesis
  // hash on an empty log and receives entry 1's digest instead.
  assert.equal(result.success, false);
  assert.equal(result.error, 'PREV_ENTRY_HASH_MISMATCH');
  assert.equal(result.expected, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  assert.equal(result.received, firstDigest);
  assert.equal(engine.stateLog.length, 0);
  assert.equal(engine.commitIndex, 0);
  // Once entry 1 is committed, the same entry 2 commits cleanly.
  assert.equal(engine.processEntry(first).success, true);
  assert.equal(engine.processEntry(second).success, true);
  assert.equal(engine.stateLog.length, 2);
});

test('genesis entry with a non-zero predecessor hash fails on an empty log', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  // A non-zero hash that is not any committed digest: on an empty log the
  // only acceptable predecessor is the all-zero genesis hash.
  const nonZero = 'ab'.repeat(32);
  const document = buildDocument(fixture, { prevEntryHash: nonZero });
  assert.deepEqual(validatePairBindingEnvelope(document), { ok: true, issues: [] });
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'PREV_ENTRY_HASH_MISMATCH');
  assert.equal(result.expected, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH);
  assert.equal(result.received, nonZero);
  assert.equal(engine.stateLog.length, 0);
  assert.equal(engine.commitIndex, 0);
  // The same entry with the genesis hash commits.
  const genesis = buildDocument(fixture);
  assert.equal(engine.processEntry(genesis).success, true);
  assert.equal(engine.stateLog.length, 1);
});

test('prevEntryHash shape failures are structural, not chain failures', () => {
  const fixture = testProtocol();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  const cases = [
    ['missing prevEntryHash', (doc) => delete doc.raftContext.prevEntryHash],
    ['uppercase hex', (doc) => { doc.raftContext.prevEntryHash = 'AB'.repeat(32); }],
    ['short hash', (doc) => { doc.raftContext.prevEntryHash = '00'.repeat(31); }],
    ['non-hex hash', (doc) => { doc.raftContext.prevEntryHash = 'zz'.repeat(32); }],
  ];
  for (const [name, mutate] of cases) {
    const document = buildDocument(fixture);
    mutate(document);
    assert.equal(validatePairBindingEnvelope(document).ok, false, name);
    const result = engine.processEntry(document);
    assert.equal(result.success, false, name);
    assert.equal(result.error, 'SCHEMA_VALIDATION_FAILED', name);
  }
  assert.equal(engine.stateLog.length, 0);
});
