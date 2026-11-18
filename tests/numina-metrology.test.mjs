// numina-metrology.test.mjs — measurement primitives for information
// operations in the Numina stack.
//
// What this proves, with ephemeral keypairs generated fresh on every run:
//  - canonical byte counts are exact: the meter's canonicalByteCount and
//    measureCanonical agree byte-for-byte with canonicalBytes from the
//    verify module, for the same payload in any key order or whitespace;
//    the pure measurement helpers do NOT touch the counters;
//  - counters increment exactly once per operation actually performed:
//    one Ed25519 verify, one ML-DSA-65 verify, one Ed25519 sign (+ its
//    re-verification), one ML-DSA-65 sign (+ its re-verification when an
//    expected key is given, none without), and one Raft processEntry
//    (record form and signatures-array form) with the exact totals the
//    call graph performs — 6 canonicalizations, 1 SHA-256, 2 Ed25519
//    verifies, 2 ML-DSA-65 verifies, 0 signs;
//  - a failed entry records the attempts and nothing else (bad ML-DSA-65
//    part: verifies counted, no digest, nothing committed), and a
//    schema-invalid entry records nothing at all — telemetry never
//    changes accept/reject semantics, and no phantom operation is
//    recorded for work that never ran;
//  - the Landauer floor is exact at stated temperatures, against
//    hard numbers (not the same formula): 1 bit at 300 K, 8 bits at
//    300 K, 1 bit at 273.15 K and at 77 K, 0 bits, and the exact
//    doubling from 300 K to 600 K; invalid inputs fail closed;
//  - actual energy is unmeasured (joules null — never zero, never an
//    estimate) with no platform counter, and measured only from a
//    registered counter; a failing or bad counter reports unmeasured;
//  - wall-clock timing returns the result with a finite non-negative
//    duration and propagates errors; meters are isolated, snapshots
//    are copies, reset zeroes; record() fails closed on bad input.
//
// No Authority or Guardian private key exists anywhere in this codebase;
// every keypair here is ephemeral, never stored, never logged, and never
// presented as the Authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalBytes, hex, verifySignature, verifyMurphRecord } from '../src/numina-protocol-verify.js';
import { signPayload, signAsRole } from '../src/numina-protocol-sign.js';
import {
  generateMlDsa65Keypair,
  exportMlDsa65PublicKeySpkiDer,
  signMlDsa65,
  verifyMlDsa65,
  signHybridPayload,
} from '../src/numina-protocol-pqc.js';
import {
  NuminaPairBindingRaftEngine,
  PAIR_BINDING_SCHEMA_VERSION,
  PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
  PAIR_BINDING_SOLE_OWNER,
} from '../src/numina-pair-binding-raft.js';
import {
  createMetrology,
  defaultMetrology,
  landauerFloorJoules,
  erasureFloorForBytes,
  LANDAUER_BOUND_LABEL,
  LANDAUER_FORMULA,
} from '../src/numina-metrology.js';

const CHAIN_ID = 962421430;
const GENESIS = '0x05b4e83876ea30a83f011ab5b0537b59ea1175810dc977f1d4eefbd1d0d7c88b';
const NONCE = '0123456789abcdef0123456789abcdef';
const CLUSTER_ID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
const TIMESTAMP = '2026-11-15T18:00:00.000Z';
const ORIGIN_NODE_ID = 'node-authority-01';
const COUNTERPARTY_NODE_ID = 'node-guardian-01';
const ENGINE_NODE_ID = 'node-authority-01';
const PAYLOAD = {
  stateTransition: 'IMMUTABLE_SUCCESSION_ROOT_ACTIVATION',
  metricsNormalization: [100, 200, 300],
};

// Hard Landauer numbers (joules), computed from kB = 1.380649e-23 J/K
// (exact, SI) and ln 2 — asserted against these literals, not the
// formula under test, so a wrong constant or a wrong formula fails.
const JOULES_1_BIT_300K = 2.870978885078724e-21;
const JOULES_8_BITS_300K = 2.296783108062979e-20;
const JOULES_1_BIT_273_15K = 2.6140262748641777e-21;
const JOULES_1_BIT_77K = 7.368845805035391e-22;
const JOULES_1_BIT_600K = 5.741957770157448e-21;

/** Assert a joules value against a hard literal (relative 1e-12). */
function assertJoules(actual, expected) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= expected * 1e-12,
    `expected ${expected} J, got ${actual} J`,
  );
}

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

function hybridRecord(signed) {
  return {
    schema: signed.schema,
    ed25519Signature: signed.ed25519Signature,
    mlDsa65Signature: signed.mlDsa65Signature,
  };
}

// Signing is done on a throwaway meter so the signing operations never
// pollute the counting meter under test.
function signBoth(fixture, unsigned, signingMeter = createMetrology()) {
  const origin = signHybridPayload({
    ed25519PrivateKey: fixture.authorityEdPrivateKey,
    mlDsa65PrivateKey: fixture.authorityDsa.privateKey,
    payload: unsigned,
    expectedEd25519PublicKey: fixture.authorityEdPublicKeyHex,
    expectedMlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey),
    meter: signingMeter,
  });
  const counterparty = signHybridPayload({
    ed25519PrivateKey: fixture.guardianEdPrivateKey,
    mlDsa65PrivateKey: fixture.guardianDsa.privateKey,
    payload: unsigned,
    expectedEd25519PublicKey: fixture.guardianEdPublicKeyHex,
    expectedMlDsa65PublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(fixture.guardianDsa.publicKey),
    meter: signingMeter,
  });
  return { origin, counterparty };
}

function buildDocument(fixture, { hybridSignatureForm = 'record' } = {}) {
  const unsigned = {
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
      prevEntryHash: PAIR_BINDING_GENESIS_PREV_ENTRY_HASH,
    },
    payload: PAYLOAD,
  };
  const signed = signBoth(fixture, unsigned);
  const toAttestation = (part, publicKey, nodeId) => {
    if (hybridSignatureForm === 'array') {
      return {
        publicKey,
        nodeId,
        signatures: [
          { algorithm: 'ed25519', signature: part.ed25519Signature, publicKey },
          { algorithm: 'ml-dsa-65', signature: part.mlDsa65Signature },
        ],
      };
    }
    return { publicKey, nodeId, hybridSignature: hybridRecord(part) };
  };
  return {
    document: {
      ...unsigned,
      attestations: {
        origin: toAttestation(signed.origin, fixture.authorityEdPublicKeyHex, ORIGIN_NODE_ID),
        counterparty: toAttestation(signed.counterparty, fixture.guardianEdPublicKeyHex, COUNTERPARTY_NODE_ID),
      },
    },
    unsigned,
  };
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = reverseKeys(value[key]);
    return out;
  }
  return value;
}

function deepCopy(document) {
  return JSON.parse(JSON.stringify(document));
}

test('canonical byte counts are exact and order-insensitive; pure helpers do not touch counters', () => {
  const meter = createMetrology();
  const payload = {
    stateTransition: 'IMMUTABLE_SUCCESSION_ROOT_ACTIVATION',
    nested: { zeta: 'last', alpha: 'first', mid: { b: 2, a: 1 } },
    metricsNormalization: [100, 200, 300],
  };
  const reordered = reverseKeys(payload);
  const prettyText = `\n\n${JSON.stringify(reordered, null, 2)}\n\n`;
  const fromPretty = JSON.parse(prettyText);
  assert.notEqual(JSON.stringify(payload), JSON.stringify(reordered));

  const expectedBytes = canonicalBytes(payload);
  assert.equal(meter.canonicalByteCount(payload), expectedBytes.length);
  assert.equal(meter.canonicalByteCount(reordered), expectedBytes.length);
  assert.equal(meter.canonicalByteCount(fromPretty), expectedBytes.length);

  const measured = meter.measureCanonical(payload);
  assert.equal(measured.byteCount, expectedBytes.length);
  assert.equal(measured.byteCountUnit, 'bytes');
  assert.equal(measured.sha256Hex, hex(sha256(expectedBytes)));
  assert.equal(meter.measureCanonical(reordered).sha256Hex, measured.sha256Hex);
  assert.equal(meter.measureCanonical(fromPretty).sha256Hex, measured.sha256Hex);

  // Pure measurement helpers record nothing.
  const snapshot = meter.snapshot();
  assert.deepEqual(snapshot.counts, {
    sha256: 0,
    ed25519Sign: 0,
    ed25519Verify: 0,
    mlDsa65Sign: 0,
    mlDsa65Verify: 0,
  });
  assert.equal(snapshot.canonicalizations, 0);
  assert.equal(snapshot.canonicalBytesTotal, 0);
});

test('canonicalByteCount throws on a non-canonicalizable payload', () => {
  const meter = createMetrology();
  assert.throws(() => meter.canonicalByteCount(undefined), /not JSON-canonicalizable/);
  assert.throws(() => meter.measureCanonical(() => {}), /not JSON-canonicalizable/);
});

test('one Ed25519 verify counts exactly once', () => {
  const fixture = testProtocol();
  const payload = { metrology: 'ed25519-verify-probe' };
  const signed = signPayload({
    privateKey: fixture.authorityEdPrivateKey,
    payload,
    expectedPublicKey: fixture.authorityEdPublicKeyHex,
    meter: createMetrology(), // signing meter: discarded
  });
  const meter = createMetrology();
  assert.equal(
    verifySignature({
      publicKey: fixture.authorityEdPublicKeyHex,
      signature: signed.signatureHex,
      payload,
      meter,
    }),
    true,
  );
  const snapshot = meter.snapshot();
  assert.equal(snapshot.counts.ed25519Verify, 1);
  assert.equal(snapshot.counts.ed25519Sign, 0);
  assert.equal(snapshot.counts.sha256, 0);
  assert.equal(snapshot.canonicalizations, 1);
  assert.equal(snapshot.canonicalBytesTotal, canonicalBytes(payload).length);
});

test('one ML-DSA-65 verify counts exactly once', () => {
  const fixture = testProtocol();
  const payload = { metrology: 'ml-dsa-65-verify-probe' };
  const signature = signMlDsa65({
    privateKey: fixture.authorityDsa.privateKey,
    payload,
    expectedPublicKeySpkiDer: exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey),
    meter: createMetrology(), // signing meter: discarded
  });
  const meter = createMetrology();
  assert.equal(
    verifyMlDsa65({
      publicKey: exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey),
      signature,
      payload,
      meter,
    }),
    true,
  );
  const snapshot = meter.snapshot();
  assert.equal(snapshot.counts.mlDsa65Verify, 1);
  assert.equal(snapshot.counts.mlDsa65Sign, 0);
  assert.equal(snapshot.canonicalizations, 1);
  assert.equal(snapshot.canonicalBytesTotal, canonicalBytes(payload).length);
});

test('signPayload counts one sign and one re-verification', () => {
  const fixture = testProtocol();
  const payload = { metrology: 'ed25519-sign-probe' };
  const meter = createMetrology();
  const signed = signPayload({
    privateKey: fixture.authorityEdPrivateKey,
    payload,
    expectedPublicKey: fixture.authorityEdPublicKeyHex,
    meter,
  });
  assert.equal(typeof signed.signatureHex, 'string');
  const snapshot = meter.snapshot();
  assert.equal(snapshot.counts.ed25519Sign, 1);
  assert.equal(snapshot.counts.ed25519Verify, 1);
  assert.equal(snapshot.canonicalizations, 2);
  assert.equal(snapshot.canonicalBytesTotal, 2 * canonicalBytes(payload).length);
});

test('signMlDsa65 counts one sign and one re-verification only when an expected key is given', () => {
  const fixture = testProtocol();
  const payload = { metrology: 'ml-dsa-65-sign-probe' };
  const spki = exportMlDsa65PublicKeySpkiDer(fixture.authorityDsa.publicKey);

  const withKey = createMetrology();
  signMlDsa65({
    privateKey: fixture.authorityDsa.privateKey,
    payload,
    expectedPublicKeySpkiDer: spki,
    meter: withKey,
  });
  assert.deepEqual(withKey.snapshot().counts, {
    sha256: 0,
    ed25519Sign: 0,
    ed25519Verify: 0,
    mlDsa65Sign: 1,
    mlDsa65Verify: 1,
  });
  assert.equal(withKey.snapshot().canonicalizations, 2);

  const withoutKey = createMetrology();
  signMlDsa65({ privateKey: fixture.authorityDsa.privateKey, payload, meter: withoutKey });
  assert.deepEqual(withoutKey.snapshot().counts, {
    sha256: 0,
    ed25519Sign: 0,
    ed25519Verify: 0,
    mlDsa65Sign: 1,
    mlDsa65Verify: 0,
  });
  assert.equal(withoutKey.snapshot().canonicalizations, 1);
});

test('one Raft processEntry (record form) counts exactly the operations it performed', () => {
  const fixture = testProtocol();
  const { document, unsigned } = buildDocument(fixture, { hybridSignatureForm: 'record' });
  const meter = createMetrology();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, {
    protocol: fixture.protocol,
    meter,
  });
  const result = engine.processEntry(document);
  assert.equal(result.success, true);
  assert.equal(engine.stateLog.length, 1);

  // Call graph for one successful entry, record form:
  // frame check: 1 canonicalization of the full document;
  // commit: envelopeDigest, 1 canonicalization of the unsigned
  // envelope + 1 SHA-256; per role: verifySignature (1
  // canonicalization + 1 Ed25519 verify) + verifyMlDsa65 (1
  // canonicalization + 1 ML-DSA-65 verify); two roles.
  const frameBytes = canonicalBytes(document).length;
  const unsignedBytes = canonicalBytes(unsigned).length;
  const snapshot = meter.snapshot();
  assert.deepEqual(snapshot.counts, {
    sha256: 1,
    ed25519Sign: 0,
    ed25519Verify: 2,
    mlDsa65Sign: 0,
    mlDsa65Verify: 2,
  });
  assert.equal(snapshot.canonicalizations, 6);
  assert.equal(snapshot.canonicalBytesTotal, frameBytes + 5 * unsignedBytes);
});

test('one Raft processEntry (signatures-array form) counts the same operations', () => {
  const fixture = testProtocol();
  const { document, unsigned } = buildDocument(fixture, { hybridSignatureForm: 'array' });
  const meter = createMetrology();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, {
    protocol: fixture.protocol,
    meter,
  });
  const result = engine.processEntry(document);
  assert.equal(result.success, true);
  assert.equal(engine.stateLog.length, 1);
  const frameBytes = canonicalBytes(document).length;
  const unsignedBytes = canonicalBytes(unsigned).length;
  const snapshot = meter.snapshot();
  assert.deepEqual(snapshot.counts, {
    sha256: 1,
    ed25519Sign: 0,
    ed25519Verify: 2,
    mlDsa65Sign: 0,
    mlDsa65Verify: 2,
  });
  assert.equal(snapshot.canonicalizations, 6);
  assert.equal(snapshot.canonicalBytesTotal, frameBytes + 5 * unsignedBytes);
});

test('a failed entry records the attempts and no digest; nothing is committed', () => {
  const fixture = testProtocol();
  const { document, unsigned } = buildDocument(fixture, { hybridSignatureForm: 'record' });
  // Corrupt the origin ML-DSA-65 signature: one hex digit flipped.
  // The Ed25519 part still verifies; the lattice part must fail.
  const bad = document.attestations.origin.hybridSignature.mlDsa65Signature;
  document.attestations.origin.hybridSignature.mlDsa65Signature =
    (bad[0] === '0' ? '1' : '0') + bad.slice(1);
  const meter = createMetrology();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, {
    protocol: fixture.protocol,
    meter,
  });
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'CRYPTOGRAPHIC_SIGNATURE_MISMATCH');
  assert.equal(engine.stateLog.length, 0);

  // Frame check ran (1 canonicalization); both roles were verified
  // (2 Ed25519 + 2 ML-DSA-65 verifies, 4 canonicalizations of the
  // unsigned envelope); the commit — and its SHA-256 — never ran.
  const frameBytes = canonicalBytes(document).length;
  const unsignedBytes = canonicalBytes(unsigned).length;
  const snapshot = meter.snapshot();
  assert.deepEqual(snapshot.counts, {
    sha256: 0,
    ed25519Sign: 0,
    ed25519Verify: 2,
    mlDsa65Sign: 0,
    mlDsa65Verify: 2,
  });
  assert.equal(snapshot.canonicalizations, 5);
  assert.equal(snapshot.canonicalBytesTotal, frameBytes + 4 * unsignedBytes);
});

test('a schema-invalid entry records nothing at all', () => {
  const fixture = testProtocol();
  const { document } = buildDocument(fixture, { hybridSignatureForm: 'record' });
  document.version = '9.9.9';
  const meter = createMetrology();
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, {
    protocol: fixture.protocol,
    meter,
  });
  const result = engine.processEntry(document);
  assert.equal(result.success, false);
  assert.equal(result.error, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(engine.stateLog.length, 0);
  assert.deepEqual(meter.snapshot().counts, {
    sha256: 0,
    ed25519Sign: 0,
    ed25519Verify: 0,
    mlDsa65Sign: 0,
    mlDsa65Verify: 0,
  });
  assert.equal(meter.snapshot().canonicalizations, 0);
  assert.equal(meter.snapshot().canonicalBytesTotal, 0);
});

test('verifyMurphRecord counts two verifies and three canonicalizations', () => {
  const fixture = testProtocol();
  const payload = { chainId: CHAIN_ID, genesis: GENESIS, metrology: 'murph-probe' };
  const signingMeter = createMetrology();
  const authority = signAsRole(
    { role: 'authority', privateKey: fixture.authorityEdPrivateKey, payload, meter: signingMeter },
    fixture.protocol,
  );
  const guardian = signAsRole(
    { role: 'guardian', privateKey: fixture.guardianEdPrivateKey, payload, meter: signingMeter },
    fixture.protocol,
  );
  const meter = createMetrology();
  const verified = verifyMurphRecord(
    {
      payload,
      authoritySignature: authority.signatureHex,
      guardianSignature: guardian.signatureHex,
      meter,
    },
    fixture.protocol,
  );
  assert.equal(verified.complete, true);
  const snapshot = meter.snapshot();
  assert.equal(snapshot.counts.ed25519Verify, 2);
  assert.equal(snapshot.counts.ed25519Sign, 0);
  // Two canonicalizations inside the two verifySignature calls, plus
  // one for the canonicalBytesHex the result reports.
  assert.equal(snapshot.canonicalizations, 3);
  assert.equal(snapshot.canonicalBytesTotal, 3 * canonicalBytes(payload).length);
});

test('Landauer floor math is exact at stated temperatures', () => {
  // Hard literals (joules), not the formula under test.
  assertJoules(landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 300 }).joules, JOULES_1_BIT_300K);
  assertJoules(landauerFloorJoules({ bitsErased: 8, temperatureKelvin: 300 }).joules, JOULES_8_BITS_300K);
  assertJoules(landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 273.15 }).joules, JOULES_1_BIT_273_15K);
  assertJoules(landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 77 }).joules, JOULES_1_BIT_77K);
  assertJoules(landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 600 }).joules, JOULES_1_BIT_600K);
  assert.equal(landauerFloorJoules({ bitsErased: 0, temperatureKelvin: 300 }).joules, 0);

  // The floor is linear in temperature: 600 K is exactly twice 300 K.
  assertJoules(
    landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 600 }).joules,
    2 * landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 300 }).joules,
  );

  // Erasing one byte is erasing eight bits, at the same temperature.
  const forByte = erasureFloorForBytes({ bytes: 1, temperatureKelvin: 300 });
  assertJoules(forByte.joules, JOULES_8_BITS_300K);
  assert.equal(forByte.bytes, 1);
  assert.equal(forByte.bitsErased, 8);
  assert.equal(forByte.bound, LANDAUER_BOUND_LABEL);

  // Labels: a theoretical lower bound, with the formula stated.
  const floor = landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 300 });
  assert.equal(floor.bound, LANDAUER_BOUND_LABEL);
  assert.equal(floor.formula, LANDAUER_FORMULA);
  assert.equal(floor.unit, 'joules');
  assert.equal(floor.bitsErased, 1);
  assert.equal(floor.temperatureKelvin, 300);

  // The meter delegates to the same pure functions.
  const meter = createMetrology();
  assert.deepEqual(
    meter.landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 300 }),
    landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 300 }),
  );
});

test('Landauer floor rejects invalid inputs instead of computing garbage', () => {
  assert.throws(() => landauerFloorJoules({ bitsErased: -1, temperatureKelvin: 300 }), /bitsErased/);
  assert.throws(() => landauerFloorJoules({ bitsErased: 1.5, temperatureKelvin: 300 }), /bitsErased/);
  assert.throws(() => landauerFloorJoules({ bitsErased: Number.NaN, temperatureKelvin: 300 }), /bitsErased/);
  assert.throws(() => landauerFloorJoules({ bitsErased: 1, temperatureKelvin: 0 }), /temperatureKelvin/);
  assert.throws(() => landauerFloorJoules({ bitsErased: 1, temperatureKelvin: -5 }), /temperatureKelvin/);
  assert.throws(() => landauerFloorJoules({ bitsErased: 1, temperatureKelvin: Number.NaN }), /temperatureKelvin/);
  assert.throws(() => landauerFloorJoules({ bitsErased: 1, temperatureKelvin: Infinity }), /temperatureKelvin/);
  assert.throws(() => erasureFloorForBytes({ bytes: -1, temperatureKelvin: 300 }), /bytes/);
  assert.throws(() => erasureFloorForBytes({ bytes: 0.5, temperatureKelvin: 300 }), /bytes/);
});

test('actual energy is unmeasured without a counter, measured only from a registered one', () => {
  const meter = createMetrology();
  const unmeasured = meter.actualEnergy();
  assert.equal(unmeasured.status, 'unmeasured');
  assert.equal(unmeasured.joules, null);
  assert.notEqual(unmeasured.joules, 0);
  assert.equal(unmeasured.unit, 'joules');
  assert.equal(typeof unmeasured.reason, 'string');

  // The snapshot carries the same unmeasured report — never zero,
  // never an estimate.
  assert.equal(meter.snapshot().energy.status, 'unmeasured');
  assert.equal(meter.snapshot().energy.joules, null);

  // A registered counter supplies a real reading.
  meter.registerEnergyCounter(() => 2.5);
  assert.deepEqual(meter.actualEnergy(), {
    status: 'measured',
    joules: 2.5,
    unit: 'joules',
    source: 'registered-platform-counter',
  });

  // A failing counter reports unmeasured, it does not throw.
  meter.registerEnergyCounter(() => {
    throw new Error('counter offline');
  });
  assert.equal(meter.actualEnergy().status, 'unmeasured');
  assert.equal(meter.actualEnergy().joules, null);

  // A counter returning a bad value reports unmeasured.
  meter.registerEnergyCounter(() => Number.NaN);
  assert.equal(meter.actualEnergy().status, 'unmeasured');
  meter.registerEnergyCounter(() => -3);
  assert.equal(meter.actualEnergy().status, 'unmeasured');

  // Registering a non-function fails closed.
  assert.throws(() => meter.registerEnergyCounter('not a function'), /must be a function/);

  // reset() zeroes the counts but keeps the registered counter: the
  // counter belongs to the environment, not to the count.
  meter.registerEnergyCounter(() => 1.25);
  meter.record('sha256');
  meter.reset();
  assert.equal(meter.snapshot().counts.sha256, 0);
  assert.equal(meter.actualEnergy().status, 'measured');
  assert.equal(meter.actualEnergy().joules, 1.25);
});

test('wall-clock timing returns the result with a finite non-negative duration', () => {
  const meter = createMetrology();
  const timed = meter.timeSync(() => 42);
  assert.equal(timed.result, 42);
  assert.equal(timed.durationUnit, 'milliseconds');
  assert.ok(Number.isFinite(timed.durationMs) && timed.durationMs >= 0);
  // Errors propagate: timing never swallows a failure.
  assert.throws(() => meter.timeSync(() => { throw new Error('boom'); }), /boom/);
});

test('meters are isolated, snapshots are copies, reset zeroes', () => {
  const a = createMetrology();
  const b = createMetrology();
  a.record('sha256');
  a.recordCanonical(10);
  assert.equal(b.snapshot().counts.sha256, 0);
  assert.equal(b.snapshot().canonicalBytesTotal, 0);

  const snapshot = a.snapshot();
  assert.equal(snapshot.schema, 'numina.metrology-snapshot.v1');
  assert.equal(snapshot.counts.sha256, 1);
  assert.equal(snapshot.canonicalizations, 1);
  assert.equal(snapshot.canonicalBytesTotal, 10);
  assert.equal(snapshot.canonicalBytesUnit, 'bytes');
  // Mutating the snapshot must not touch the meter.
  snapshot.counts.sha256 = 999;
  snapshot.canonicalBytesTotal = 999;
  assert.equal(a.snapshot().counts.sha256, 1);
  assert.equal(a.snapshot().canonicalBytesTotal, 10);

  a.reset();
  assert.deepEqual(a.snapshot().counts, {
    sha256: 0,
    ed25519Sign: 0,
    ed25519Verify: 0,
    mlDsa65Sign: 0,
    mlDsa65Verify: 0,
  });
  assert.equal(a.snapshot().canonicalizations, 0);
  assert.equal(a.snapshot().canonicalBytesTotal, 0);
});

test('record() fails closed on bad input', () => {
  const meter = createMetrology();
  assert.throws(() => meter.record('not-an-operation'), /unknown metrology operation/);
  assert.throws(() => meter.recordCanonical(-1), /canonical byte count/);
  assert.throws(() => meter.recordCanonical(1.5), /canonical byte count/);
  assert.throws(() => meter.registerEnergyCounter('not a function'), /must be a function/);
});

test('an engine without an explicit meter still commits on the default meter', () => {
  const fixture = testProtocol();
  const { document } = buildDocument(fixture, { hybridSignatureForm: 'record' });
  const engine = new NuminaPairBindingRaftEngine(ENGINE_NODE_ID, { protocol: fixture.protocol });
  assert.equal(engine.meter, defaultMetrology);
  const result = engine.processEntry(document);
  assert.equal(result.success, true);
  assert.equal(engine.stateLog.length, 1);
});
