// numina-batch-signature.test.mjs — Batch-signature records for NCPS
// (owner directive Nov 21, 2026: "implement the batch sig").
//
// Source: draft-ramadan-mboned-mcast-manifest-01 (Ramadan, 2 Nov 2026),
// §4 (digest), §5 (manifest record and signature), §5.1 (signature
// context binding), §5.2 (keys, epochs, sequence numbers), §6 (sender),
// §7 (receiver). -02 was uploaded 20 Nov 2026 but its text had not
// published at the last check (~06:47 UTC 21 Nov); -02 changes are
// unestablished and NOT implemented here.
//
// What these tests prove:
//   - Item 1 (batch signature): one Ed25519 signature covers a
//     manifest of up to 37 digests; the 37 cap is enforced at mint; a
//     manifest minted under a key verifies under that key and no other;
//     every field, when mutated, is refused (mutant-kill).
//   - Item 2 (fail-closed receiver): the draft §7 step-1 order holds —
//     structural checks before cryptography, signature, and only then
//     are digests read; any failure refuses the WHOLE manifest and
//     admits nothing; receiveBatch refuses the whole batch on any item
//     mismatch (no partial acceptance).
//   - Item 3 (ctx binding): ctx is derived under a label from the
//     context and bound in the signed payload; a receiver holding the
//     context source rejects a differing ctx, and a signature cannot be
//     replayed into a different flow or context.
//   - The digest is exactly SHA-256(pseudoheader || data), recomputed
//     independently in the tests; the pseudoheader binds the flow.
//   - Replay: a manifest verified once is refused a second time
//     through a caller-owned verifiedRecords set (the draft's twin /
//     replay drop, §7 step 1).
//
// NO KAT/ACVP PASS IS CLAIMED HERE: the draft's Appendix A vectors
// are for its fixed binary wire record, which this module does not
// build (NCPS records are JCS JSON). These tests are negative-control
// and mutant-kill tests. Keys are freshly generated per run
// (node:crypto Ed25519); signatures are deterministic given the keys,
// and every minted manifest is re-verified by the module before it is
// returned, so cross-run randomness cannot mask a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import {
  BATCH_DRAFT,
  BATCH_SCHEME,
  BATCH_TYP,
  BATCH_LABEL,
  BATCH_HASH_ALG,
  BATCH_MAX_DIGESTS,
  BATCH_MAX_ITEM_BYTES,
  BATCH_DEFAULT_MAX_BEHIND_SECONDS,
  BATCH_DEFAULT_MAX_AHEAD_SECONDS,
  batchDigest,
  batchPseudoheader,
  deriveCtx,
  zeroCtx,
  validateFlow,
  validateManifestShape,
  mintBatchManifest,
  verifyBatchManifest,
  receiveBatch,
} from '../src/numina-batch-signature.js';

import { pedigreeSigningInput, pedigreeCanonicalText } from '../src/numina-pedigree.js';

const NOW = 1795238100; // 2026-11-21 ~05:15 UTC, fixed for freshness tests

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

function signWith(privateKey) {
  return (bytes) => cryptoSign(null, bytes, privateKey);
}

function makeFlow(overrides = {}) {
  return { streamId: 7, source: 'numina-batch-flow', group: 'numina-batch-group', port: 5004, ...overrides };
}

function makeItems(flow, firstSeq, count) {
  const encoder = new TextEncoder();
  return Array.from({ length: count }, (_, i) => ({
    seq: firstSeq + i,
    data: encoder.encode(`batch-item-${firstSeq + i}`),
  }));
}

function makeFields(overrides = {}) {
  const flow = makeFlow(overrides.flow ?? {});
  const firstSeq = overrides.first_seq ?? 100;
  const count = overrides.count ?? 3;
  const items = makeItems(flow, firstSeq, count);
  const digests = items.map((item) => batchDigest(flow, item.data));
  const fields = {
    label: BATCH_LABEL,
    scheme: BATCH_SCHEME,
    kid: 'key-1',
    epoch: 3,
    mseq: 41,
    first_seq: firstSeq,
    count,
    hash_alg: BATCH_HASH_ALG,
    flags: 0,
    sent: NOW,
    ctx: zeroCtx(),
    flow,
    digests,
  };
  delete overrides.flow;
  Object.assign(fields, overrides);
  return { fields, items, flow };
}

function mintValid(overrides = {}) {
  const keys = makeKeys();
  const { fields, items, flow } = makeFields(overrides);
  const minted = mintBatchManifest({ fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk });
  return { keys, fields, items, flow, minted };
}

function anchorsFor(keys, kid = 'key-1') {
  return [{ kid, publicJwk: keys.publicJwk }];
}

function verifyOpts(keys, overrides = {}) {
  return { trustAnchors: anchorsFor(keys), nowUnixSeconds: NOW, ...overrides };
}

function tamperPayload(minted, mutate) {
  const [headerPart, payloadPart, signaturePart] = minted.compact.split('.');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  mutate(payload);
  const newPayloadPart = Buffer.from(canonicalize(payload)).toString('base64url');
  return `${headerPart}.${newPayloadPart}.${signaturePart}`;
}

// ---------------------------------------------------------------------------
// Digest (draft §4)
// ---------------------------------------------------------------------------

test('batchDigest is exactly SHA-256(pseudoheader || data), recomputed independently', () => {
  const flow = makeFlow();
  const data = new TextEncoder().encode('hello batch');
  const digest = batchDigest(flow, data);
  const header = batchPseudoheader(flow, data.length);
  const expected = `sha256:${createHash('sha256').update(Buffer.concat([Buffer.from(header), Buffer.from(data)])).digest('hex')}`;
  assert.equal(digest, expected);
});

test('batchDigest binds the flow: same bytes, different flow, different digest', () => {
  const data = new TextEncoder().encode('same bytes');
  const a = batchDigest(makeFlow(), data);
  const b = batchDigest(makeFlow({ streamId: 8 }), data);
  const c = batchDigest(makeFlow({ port: 5005 }), data);
  const d = batchDigest(makeFlow({ source: 'other-flow' }), data);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.equal(a, batchDigest(makeFlow(), data));
});

test('batchDigest refuses data over the 65535-byte bound (draft §4 u16 payload_length)', () => {
  const flow = makeFlow();
  assert.throws(
    () => batchDigest(flow, new Uint8Array(BATCH_MAX_ITEM_BYTES + 1)),
    /over the 65535-byte bound/,
  );
});

test('validateFlow rejects an unknown field, a NUL in source, and a bad port', () => {
  assert.equal(validateFlow(makeFlow()).ok, true);
  assert.equal(validateFlow(makeFlow({ extra: 1 })).ok, false);
  assert.equal(validateFlow(makeFlow({ source: 'a\0b' })).ok, false);
  assert.equal(validateFlow(makeFlow({ port: 65536 })).ok, false);
  assert.equal(validateFlow(makeFlow({ streamId: -1 })).ok, false);
});

// ---------------------------------------------------------------------------
// ctx (draft §5.1)
// ---------------------------------------------------------------------------

test('deriveCtx is deterministic and label-bound and context-bound', () => {
  const a = deriveCtx('numina-batch', { flow: 'x', purpose: 'evidence' });
  assert.equal(a, deriveCtx('numina-batch', { flow: 'x', purpose: 'evidence' }));
  assert.notEqual(a, deriveCtx('other-label', { flow: 'x', purpose: 'evidence' }));
  assert.notEqual(a, deriveCtx('numina-batch', { flow: 'y', purpose: 'evidence' }));
  assert.equal(a.length, 43);
});

test('zeroCtx is the base64url of 32 zero octets', () => {
  assert.equal(zeroCtx(), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
});

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

test('mintBatchManifest mints a well-formed manifest that verifies', () => {
  const { keys, minted } = mintValid();
  assert.equal(minted.header.typ, BATCH_TYP);
  assert.equal(minted.header.alg, 'Ed25519');
  assert.equal(minted.payload.scheme, BATCH_SCHEME);
  const result = verifyBatchManifest(minted.compact, verifyOpts(keys));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'verified');
  assert.deepEqual(result.admittedDigests.map((entry) => entry.seq), [100, 101, 102]);
  assert.equal(result.epochEnd, false);
  assert.equal(typeof result.recordDigest, 'string');
});

test('mint enforces the 37-digest cap (draft §5)', () => {
  const keys = makeKeys();
  const { fields } = makeFields({ count: 37 });
  assert.equal(fields.digests.length, 37);
  assert.doesNotThrow(() => mintBatchManifest({ fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }));
  const over = makeFields({ count: 38 });
  assert.throws(
    () => mintBatchManifest({ fields: over.fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }),
    /count must be an integer in 1\.\.37/,
  );
});

test('mint refuses count 0, a wrong scheme, a wrong hash_alg, and a bad digest', () => {
  const keys = makeKeys();
  assert.throws(() => mintBatchManifest({ fields: makeFields({ count: 0 }).fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /count/);
  assert.throws(() => mintBatchManifest({ fields: makeFields({ scheme: 'other' }).fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /scheme/);
  assert.throws(() => mintBatchManifest({ fields: makeFields({ hash_alg: 'sha-512' }).fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /hash_alg/);
  const bad = makeFields();
  bad.fields.digests[0] = 'sha256:ZZZ';
  assert.throws(() => mintBatchManifest({ fields: bad.fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /digests\[0\]/);
});

test('mint refuses count != digests.length and reserved flag bits', () => {
  const keys = makeKeys();
  const mismatch = makeFields();
  mismatch.fields.count = 2;
  assert.throws(() => mintBatchManifest({ fields: mismatch.fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /must equal the number of digests/);
  assert.throws(() => mintBatchManifest({ fields: makeFields({ flags: 0x02 }).fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /reserved flag bits/);
  assert.doesNotThrow(() => mintBatchManifest({ fields: makeFields({ flags: 0x01 }).fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }));
});

test('mint refuses a private JWK and a sign callback that returns a bad signature', () => {
  const keys = makeKeys();
  const { privateKey } = generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  assert.equal(typeof privateJwk.d, 'string');
  assert.throws(() => mintBatchManifest({ fields: makeFields().fields, sign: signWith(keys.privateKey), publicJwk: privateJwk }), /public JWK/);
  const badSign = () => new Uint8Array(64);
  assert.throws(() => mintBatchManifest({ fields: makeFields().fields, sign: badSign, publicJwk: keys.publicJwk }), /re-verification/);
});

test('mint refuses an unknown field and an empty kid', () => {
  const keys = makeKeys();
  const extra = makeFields();
  extra.fields.surprise = true;
  assert.throws(() => mintBatchManifest({ fields: extra.fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /unknown field/);
  assert.throws(() => mintBatchManifest({ fields: makeFields({ kid: '' }).fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }), /kid/);
});

test('validateManifestShape accepts a good payload and names each defect', () => {
  const { fields } = makeFields();
  assert.equal(validateManifestShape(fields).ok, true);
  assert.equal(validateManifestShape({ ...fields, label: 'wrong' }).ok, false);
  assert.equal(validateManifestShape({ ...fields, sent: -1 }).ok, false);
  assert.equal(validateManifestShape({ ...fields, ctx: 'not-base64url!' }).ok, false);
});

// ---------------------------------------------------------------------------
// Verify — fail-closed receiver (draft §7 step 1)
// ---------------------------------------------------------------------------

test('verify refuses a manifest signed under a different key', () => {
  const { minted } = mintValid();
  const otherKeys = makeKeys();
  const result = verifyBatchManifest(minted.compact, verifyOpts(otherKeys));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
  assert.deepEqual(result.admittedDigests, []);
});

test('verify refuses a tampered digest, a tampered count, and a tampered flow', () => {
  const { keys, minted } = mintValid();
  const tamperedDigest = tamperPayload(minted, (payload) => {
    payload.digests[0] = `sha256:${'0'.repeat(64)}`;
  });
  assert.equal(verifyBatchManifest(tamperedDigest, verifyOpts(keys)).outcome, 'signature_invalid');
  const tamperedCount = tamperPayload(minted, (payload) => {
    payload.count = 2;
  });
  assert.equal(verifyBatchManifest(tamperedCount, verifyOpts(keys)).outcome, 'malformed');
  const tamperedFlow = tamperPayload(minted, (payload) => {
    payload.flow.port = 5005;
  });
  assert.equal(verifyBatchManifest(tamperedFlow, verifyOpts(keys)).outcome, 'signature_invalid');
});

test('verify refuses an unknown kid', () => {
  const { keys, minted } = mintValid();
  const result = verifyBatchManifest(minted.compact, {
    trustAnchors: [{ kid: 'other-key', publicJwk: keys.publicJwk }],
    nowUnixSeconds: NOW,
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'unknown_key');
});

test('verify enforces freshness: stale behind, stale ahead, boundary passes', () => {
  const staleBehind = mintValid({ sent: NOW - BATCH_DEFAULT_MAX_BEHIND_SECONDS - 1 });
  assert.equal(verifyBatchManifest(staleBehind.minted.compact, verifyOpts(staleBehind.keys)).outcome, 'stale');
  const staleAhead = mintValid({ sent: NOW + BATCH_DEFAULT_MAX_AHEAD_SECONDS + 1 });
  assert.equal(verifyBatchManifest(staleAhead.minted.compact, verifyOpts(staleAhead.keys)).outcome, 'stale');
  const atBehindEdge = mintValid({ sent: NOW - BATCH_DEFAULT_MAX_BEHIND_SECONDS });
  assert.equal(verifyBatchManifest(atBehindEdge.minted.compact, verifyOpts(atBehindEdge.keys)).ok, true);
  const relaxed = mintValid({ sent: NOW - 400 });
  assert.equal(
    verifyBatchManifest(relaxed.minted.compact, verifyOpts(relaxed.keys, { maxBehindSeconds: 1000 })).ok,
    true,
  );
});

test('verify enforces ctx when the receiver holds the context source, and carries it blind otherwise', () => {
  const ctx = deriveCtx('numina-batch', { flow: 'x' });
  const { keys, minted } = mintValid({ ctx });
  assert.equal(
    verifyBatchManifest(minted.compact, verifyOpts(keys, { expectedCtx: ctx })).ok,
    true,
  );
  const wrong = deriveCtx('numina-batch', { flow: 'y' });
  const mismatch = verifyBatchManifest(minted.compact, verifyOpts(keys, { expectedCtx: wrong }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.outcome, 'ctx_mismatch');
  assert.deepEqual(mismatch.admittedDigests, []);
  // A manifest minted with a zero ctx, verified against a held context, is refused.
  const zero = mintValid();
  assert.equal(
    verifyBatchManifest(zero.minted.compact, verifyOpts(zero.keys, { expectedCtx: ctx })).outcome,
    'ctx_mismatch',
  );
});

test('verify refuses a replay through a caller-owned verifiedRecords set', () => {
  const { keys, minted } = mintValid();
  const verifiedRecords = new Set();
  const opts = verifyOpts(keys, { verifiedRecords });
  assert.equal(verifyBatchManifest(minted.compact, opts).ok, true);
  assert.equal(verifiedRecords.size, 1);
  const replay = verifyBatchManifest(minted.compact, opts);
  assert.equal(replay.ok, false);
  assert.equal(replay.outcome, 'already_verified');
  // A fresh set verifies the same manifest again: replay state is the caller's.
  assert.equal(verifyBatchManifest(minted.compact, verifyOpts(keys, { verifiedRecords: new Set() })).ok, true);
});

test('verify refuses malformed compacts and a non-canonical payload', () => {
  const { keys, minted } = mintValid();
  assert.equal(verifyBatchManifest('not-a-compact', verifyOpts(keys)).outcome, 'malformed');
  assert.equal(verifyBatchManifest('a.b', verifyOpts(keys)).outcome, 'malformed');
  const [headerPart, payloadPart, signaturePart] = minted.compact.split('.');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  const spaced = Buffer.from(JSON.stringify(payload, null, 2)).toString('base64url');
  assert.equal(
    verifyBatchManifest(`${headerPart}.${spaced}.${signaturePart}`, verifyOpts(keys)).outcome,
    'non_canonical',
  );
});

test('verify refuses malformed verifier configuration', () => {
  const { keys, minted } = mintValid();
  assert.equal(verifyBatchManifest(minted.compact, {}).outcome, 'malformed');
  assert.equal(verifyBatchManifest(minted.compact, { trustAnchors: [], nowUnixSeconds: NOW }).outcome, 'malformed');
  assert.equal(verifyBatchManifest(minted.compact, verifyOpts(keys, { nowUnixSeconds: -1 })).outcome, 'malformed');
  assert.equal(verifyBatchManifest(minted.compact, verifyOpts(keys, { expectedCtx: 'short' })).outcome, 'malformed');
  assert.equal(verifyBatchManifest(minted.compact, verifyOpts(keys, { verifiedRecords: [] })).outcome, 'malformed');
  const privateJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  assert.equal(
    verifyBatchManifest(minted.compact, verifyOpts(keys, { trustAnchors: [{ kid: 'key-1', publicJwk: privateJwk }] })).outcome,
    'malformed',
  );
});

test('verify reports epochEnd from flags bit 0 and ignores reserved bits on receipt', () => {
  const { keys, minted } = mintValid({ flags: 0x01 });
  const result = verifyBatchManifest(minted.compact, verifyOpts(keys));
  assert.equal(result.ok, true);
  assert.equal(result.epochEnd, true);
  // A manifest with reserved bits set cannot be minted, but a receiver
  // ignores them (draft §5): sign the same payload with bit 1 set by
  // hand and verify it — the signature is valid, so it must verify.
  const { fields } = makeFields({ flags: 0x03 });
  const header = { typ: BATCH_TYP, alg: 'Ed25519' };
  const { ascii, bytes } = pedigreeSigningInput(header, fields);
  const signature = signWith(keys.privateKey)(bytes);
  const base64url = (value) => Buffer.from(value).toString('base64url');
  const compact =
    `${base64url(new TextEncoder().encode(pedigreeCanonicalText(header)))}.` +
    `${base64url(new TextEncoder().encode(pedigreeCanonicalText(fields)))}.` +
    `${base64url(signature)}`;
  const handSigned = verifyBatchManifest(compact, verifyOpts(keys));
  assert.equal(handSigned.ok, true);
  assert.equal(handSigned.epochEnd, true);
});

// ---------------------------------------------------------------------------
// receiveBatch — no partial acceptance (draft §7 step 2, NCPS form)
// ---------------------------------------------------------------------------

test('receiveBatch admits every matching item and lists the pending sequences', () => {
  const { keys, minted, items } = mintValid();
  const result = receiveBatch(minted.compact, items, verifyOpts(keys));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'admitted');
  assert.deepEqual(result.admitted.map((entry) => entry.seq), [100, 101, 102]);
  assert.deepEqual(result.pending, []);
  const subset = receiveBatch(minted.compact, [items[0]], verifyOpts(keys));
  assert.equal(subset.ok, true);
  assert.deepEqual(subset.admitted.map((entry) => entry.seq), [100]);
  assert.deepEqual(subset.pending, [101, 102]);
});

test('receiveBatch refuses the WHOLE batch when one item digest mismatches', () => {
  const { keys, minted, items } = mintValid();
  const tampered = items.map((item, i) =>
    i === 1 ? { seq: item.seq, data: new TextEncoder().encode('forged item') } : item,
  );
  const result = receiveBatch(minted.compact, tampered, verifyOpts(keys));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'item_digest_mismatch');
  assert.deepEqual(result.admitted, []);
});

test('receiveBatch refuses an item outside the manifest and a duplicated sequence', () => {
  const { keys, minted, items } = mintValid();
  const outside = receiveBatch(
    minted.compact,
    [...items, { seq: 103, data: new TextEncoder().encode('extra') }],
    verifyOpts(keys),
  );
  assert.equal(outside.ok, false);
  assert.equal(outside.outcome, 'item_not_in_manifest');
  assert.deepEqual(outside.admitted, []);
  const duplicated = receiveBatch(minted.compact, [items[0], items[0]], verifyOpts(keys));
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.outcome, 'duplicate_item');
});

test('receiveBatch refuses the whole batch when the manifest fails verification', () => {
  const { minted, items } = mintValid();
  const otherKeys = makeKeys();
  const result = receiveBatch(minted.compact, items, verifyOpts(otherKeys));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
  assert.deepEqual(result.admitted, []);
});

test('receiveBatch accepts an empty presentation and reports everything pending', () => {
  const { keys, minted } = mintValid();
  const result = receiveBatch(minted.compact, [], verifyOpts(keys));
  assert.equal(result.ok, true);
  assert.deepEqual(result.admitted, []);
  assert.deepEqual(result.pending, [100, 101, 102]);
});

test('receiveBatch refuses malformed items', () => {
  const { keys, minted, items } = mintValid();
  assert.equal(receiveBatch(minted.compact, 'not-an-array', verifyOpts(keys)).outcome, 'malformed');
  assert.equal(receiveBatch(minted.compact, [{ seq: 100 }], verifyOpts(keys)).outcome, 'malformed');
  assert.equal(
    receiveBatch(minted.compact, [{ seq: 100, data: new Uint8Array(BATCH_MAX_ITEM_BYTES + 1) }], verifyOpts(keys)).outcome,
    'malformed',
  );
  assert.equal(
    receiveBatch(minted.compact, items, verifyOpts(keys, { expectedCtx: deriveCtx('x', {}) })).outcome,
    'ctx_mismatch',
  );
});

test('draft identifier is recorded and the module exports the draft constants', () => {
  assert.equal(BATCH_DRAFT, 'draft-ramadan-mboned-mcast-manifest-01');
  assert.equal(BATCH_SCHEME, 'manifest-ed25519-2');
  assert.equal(BATCH_LABEL, 'mcast-manifest-v2');
  assert.equal(BATCH_MAX_DIGESTS, 37);
  assert.equal(BATCH_HASH_ALG, 'sha-256');
});
