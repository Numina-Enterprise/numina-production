// numina-bc-provenance.test.mjs — Signed provenance for Media over
// QUIC (bc-provenance v2) as an NCPS record.
//
// Source: draft-ramadan-moq-multicast-03 (Ramadan, header 20 Nov 2026),
// §7.2 and Appendix A. The -03 text was fetched from the IETF archive
// and read in full; the Appendix A values below are copied from the
// draft, and every one of them is recomputed by the implementation
// under test (params_hash, ctx, pseudoheader digests, signature) —
// none is taken on trust.
//
// What these tests prove:
//   - Item 1 (signed-provenance record): the draft-exact BCPV2 ctx /
//     params_hash derivation, the draft-exact §7.2.2 datagram digest,
//     and a mint/verify round-trip whose signed context binds
//     namespace, packetIds, codec/timescale/group duration and FEC
//     parameters, so a receipt cannot be replayed across
//     stream/broadcast/key/epoch.
//   - Item 2 (fail-closed receiver, verify-first): the signature is
//     verified BEFORE first_seq, flags or digests are read. A record
//     with an invalid signature AND malformed digests is refused as
//     signature_invalid (the digests were never read); a record with
//     a VALID signature and malformed digests is refused as
//     malformed with signatureVerified: true (the signature was
//     checked first). Any failure refuses the WHOLE record.
//   - Item 3 (SHA-256 mandatory): hash_alg other than 'sha-256' is
//     refused as hash_alg_mismatch.
//   - Item 4 (explicit timing): bcTimingBounds computes the exact
//     bounds the draft states; freshness is enforced at 7 s +
//     maxAuthDelayMs behind / 6 s ahead; the verified result carries
//     the bounds it was verified under.
//   - Catalog and key ranges (§7.2.6): validation, clamping,
//     key-for-epoch selection, minEpoch, rotation to a new key.
//   - Receiver state (§7.2.7 step 1): already-verified, replay
//     floor (mseq + 64 <= highest_mseq), closed epoch, previous
//     epoch grace and deadline, verification budget.
//   - Batch admission: whole-batch admission only; one bad item
//     refuses the whole batch (no partial acceptance).
//   - The NCPS boundary: the module builds JCS compact JWS records,
//     NOT the draft's 196-octet binary wire record; the binary
//     record is verified here by direct byte reads only.
//
// NO KAT/ACVP PASS IS CLAIMED HERE: the draft publishes no KAT/ACVP
// vectors. These tests are negative-control and mutant-kill tests
// plus the draft's own informative Appendix A vectors. Keys are
// freshly generated per run (node:crypto Ed25519); signatures are
// deterministic given the keys, and every minted record is
// re-verified by the module before it is returned, so cross-run
// randomness cannot mask a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createPrivateKey,
  createHash,
} from 'node:crypto';
import canonicalize from 'canonicalize';
import {
  BC_DRAFT,
  BC_PROFILE,
  BC_VERSION,
  BC_HASH_ALG,
  BC_HASH_ALG_ID,
  BC_MAX_DIGESTS,
  BC_DEFAULT_MAX_AUTH_DELAY_MS,
  BC_DEFAULT_MANIFEST_TIMER_MS,
  BC_FRESHNESS_BEHIND_BASE_SECONDS,
  BC_FRESHNESS_AHEAD_SECONDS,
  BC_REPLAY_FLOOR,
  BC_BUDGET_DEPTH,
  BC_OUTCOMES,
  parseIpv4,
  deriveBcParamsHash,
  deriveBcCtx,
  bcDatagramDigest,
  validateBcCatalog,
  bcKeyForEpoch,
  bcEndpointTiming,
  verificationRefillRate,
  createVerificationBudget,
  bcTimingBounds,
  createBcReceiverState,
  bcRecordKey,
  mintBcRecord,
  verifyBcRecord,
  receiveBcBatch,
} from '../src/numina-bc-provenance.js';
import {
  BATCH_LABEL,
  BATCH_SCHEME,
  zeroCtx,
  batchDigest,
} from '../src/numina-batch-signature.js';
import {
  pedigreeCanonicalText,
  pedigreeSigningInput,
} from '../src/numina-pedigree.js';

const NOW = 1795238100; // 2026-11-21 ~05:15 UTC, fixed for freshness tests

// ---------------------------------------------------------------------------
// Appendix A test vectors (draft-ramadan-moq-multicast-03, informative)
// ---------------------------------------------------------------------------

const APPENDIX_A = {
  seedHex: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  publicKeyHex: '03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8',
  source: '198.51.100.7',
  group: '232.10.20.30',
  port: 5004,
  streamId: 2864434397,
  kid: 1,
  epoch: 17,
  mseq: 1,
  firstSeq: 1000,
  flags: 0x00,
  sent: 1792972800,
  namespace: ['example.arena'],
  packetIds: [1, 2],
  params: {
    codec: 'avc1.640028',
    timescale: 90000,
    groupDurationTicks: 3000,
    fecInstances: [{
      scheme: 'raptorq',
      sourceSymbols: 32,
      repairSymbols: 16,
      symbolSize: 1312,
      interleaveDepthMs: 133,
    }],
  },
  pseudoheaderHex: 'c6336407e80a141e00110578138c138caabbccdd',
  prefixHex: '6d636173742d6d616e69666573742d763200aabbccddc6336407e80a141e138c',
  digest0Hex: '7ead4d8be7d24e08d7075bbac8fbe7779ab3b8f1c47d3f8be4d2a514f2ec2069',
  digest1Hex: '6f7d9007e81b73c9f54aff8c2f66bd6e8956bfa7e001789b986c328f9ed78751',
  paramsHashHex: '1f652ba84e4a44425da55ddffb24c0791a3851a1d1022b4b47b30881146edf7c',
  ctxHex: 'fe68177dd329ee6fdd668cb43ebdeb6d2e4c2ae351fd25050ab68dd98af19214',
  signatureHex: 'b7bffcf63fc764c87438b55e521dccaf5e59177ae245aafe47fc1e15b7786795'
    + '8e07f6ef2fa45c1162735ab5e2c1a942fe75cb6f8879f49d0b14a41f8306230d',
  recordHex: '4d484d320000000100000011000000000000000100000000000003e800020100'
    + '6ade9800fe68177dd329ee6fdd668cb43ebdeb6d2e4c2ae351fd25050ab68dd98af19214'
    + '7ead4d8be7d24e08d7075bbac8fbe7779ab3b8f1c47d3f8be4d2a514f2ec2069'
    + '6f7d9007e81b73c9f54aff8c2f66bd6e8956bfa7e001789b986c328f9ed78751'
    + 'b7bffcf63fc764c87438b55e521dccaf5e59177ae245aafe47fc1e15b7786795'
    + '8e07f6ef2fa45c1162735ab5e2c1a942fe75cb6f8879f49d0b14a41f8306230d',
};

function base64urlOfHex(hexValue) {
  return Buffer.from(hexValue, 'hex').toString('base64url');
}

function appendixContext() {
  return {
    namespaceFields: [...APPENDIX_A.namespace],
    packetIds: [...APPENDIX_A.packetIds],
    params: {
      codec: APPENDIX_A.params.codec,
      timescale: APPENDIX_A.params.timescale,
      groupDurationTicks: APPENDIX_A.params.groupDurationTicks,
      fecInstances: APPENDIX_A.params.fecInstances.map((instance) => ({ ...instance })),
    },
  };
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

function signWith(privateKey) {
  return (bytes) => cryptoSign(null, bytes, privateKey);
}

function makeFlow(overrides = {}) {
  return { streamId: 7, source: 'numina-bc-flow', group: 'numina-bc-group', port: 5004, ...overrides };
}

function makeContext(overrides = {}) {
  const context = {
    namespaceFields: ['example.arena'],
    packetIds: [1, 2],
    params: {
      codec: 'avc1.640028',
      timescale: 90000,
      groupDurationTicks: 3000,
      fecInstances: [{
        scheme: 'raptorq',
        sourceSymbols: 32,
        repairSymbols: 16,
        symbolSize: 1312,
        interleaveDepthMs: 133,
      }],
    },
  };
  if (overrides.params) Object.assign(context.params, overrides.params);
  if (overrides.namespaceFields) context.namespaceFields = overrides.namespaceFields;
  if (overrides.packetIds) context.packetIds = overrides.packetIds;
  return context;
}

function makeFields(overrides = {}) {
  const flow = makeFlow(overrides.flow ?? {});
  const firstSeq = overrides.first_seq ?? 100;
  const count = overrides.count ?? 3;
  const encoder = new TextEncoder();
  const items = Array.from({ length: count }, (_, i) => ({
    seq: firstSeq + i,
    data: encoder.encode(`bc-item-${firstSeq + i}`),
  }));
  const digests = items.map((item) => batchDigest(flow, item.data));
  const fields = {
    kid: 'key-1',
    epoch: 3,
    mseq: 41,
    first_seq: firstSeq,
    count,
    hash_alg: BC_HASH_ALG,
    flags: 0,
    sent: NOW,
    flow,
    digests,
  };
  delete overrides.flow;
  Object.assign(fields, overrides);
  return { fields, items, flow };
}

function mintValid(overrides = {}) {
  const keys = makeKeys();
  const context = overrides.context === null ? undefined : makeContext(overrides.context ?? {});
  const { fields, items, flow } = makeFields(overrides);
  const minted = mintBcRecord({
    fields,
    sign: signWith(keys.privateKey),
    publicJwk: keys.publicJwk,
    ...(context === undefined ? {} : { context }),
  });
  return { keys, context, fields, items, flow, minted };
}

function verifyOpts(overrides = {}) {
  return {
    publicJwk: overrides.publicJwk,
    nowUnixSeconds: overrides.nowUnixSeconds ?? NOW,
    receiverState: overrides.receiverState,
    context: overrides.context,
    catalog: overrides.catalog,
    budget: overrides.budget,
    skipFreshness: overrides.skipFreshness,
    maxAuthDelayMs: overrides.maxAuthDelayMs,
    manifestTimerMs: overrides.manifestTimerMs,
  };
}

/** Decode a minted compact JWS payload, mutate it, re-encode WITHOUT
 *  re-signing (so the signature no longer covers the payload). */
function mutatePayload(compact, mutate) {
  const parts = compact.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  mutate(payload);
  parts[1] = Buffer.from(canonicalize(payload), 'utf8').toString('base64url');
  return parts.join('.');
}

/** Sign an arbitrary payload object by hand (bypassing mint), to
 *  build records mint would refuse — e.g. a valid signature over
 *  malformed digests, or a non-sha-256 hash_alg. */
function handSign(payload, privateKey) {
  const header = { typ: 'numina-batch-manifest+jwt', alg: 'Ed25519' };
  const { ascii, bytes } = pedigreeSigningInput(header, payload);
  const signature = cryptoSign(null, bytes, privateKey);
  const compact =
    `${Buffer.from(pedigreeCanonicalText(header), 'utf8').toString('base64url')}.`
    + `${Buffer.from(pedigreeCanonicalText(payload), 'utf8').toString('base64url')}.`
    + `${Buffer.from(signature).toString('base64url')}`;
  return compact;
}

function makeCatalog(keys, overrides = {}) {
  const publicKeys = keys.map((entry) => entry.publicJwk.x);
  return {
    scheme: BC_PROFILE,
    version: BC_VERSION,
    sig: 'ed25519',
    keys: keys.map((entry, i) => ({
      kid: entry.kid,
      publicKey: publicKeys[i],
      firstEpoch: entry.firstEpoch,
    })),
    minEpoch: overrides.minEpoch ?? 0,
    ...(overrides.endpoint === null ? {} : {
      endpoint: {
        streamId: 7,
        port: 5004,
        ...(overrides.endpoint ?? {}),
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Item 5 / Appendix A: the draft's vectors run through the implementation
// ---------------------------------------------------------------------------

test('appendix A: params_hash recomputes exactly', () => {
  const paramsHash = deriveBcParamsHash(appendixContext().params);
  assert.equal(paramsHash, base64urlOfHex(APPENDIX_A.paramsHashHex));
});

test('appendix A: ctx recomputes exactly', () => {
  const ctx = deriveBcCtx(appendixContext());
  assert.equal(ctx, base64urlOfHex(APPENDIX_A.ctxHex));
});

test('appendix A: datagram digests D_0 and D_1 recompute exactly', () => {
  const d0 = bcDatagramDigest({
    source: APPENDIX_A.source,
    group: APPENDIX_A.group,
    port: APPENDIX_A.port,
    streamId: APPENDIX_A.streamId,
    data: new Uint8Array(1400).fill(0x11),
  });
  const d1 = bcDatagramDigest({
    source: APPENDIX_A.source,
    group: APPENDIX_A.group,
    port: APPENDIX_A.port,
    streamId: APPENDIX_A.streamId,
    data: new Uint8Array(1400).fill(0x22),
  });
  assert.equal(d0, `sha256:${APPENDIX_A.digest0Hex}`);
  assert.equal(d1, `sha256:${APPENDIX_A.digest1Hex}`);
});

test('appendix A: the 196-octet binary record parses and its signature verifies', () => {
  const record = Buffer.from(APPENDIX_A.recordHex, 'hex');
  assert.equal(record.length, 196);
  assert.equal(record.subarray(0, 4).toString('ascii'), 'MHM2');
  assert.equal(record.readUInt32BE(4), APPENDIX_A.kid);
  assert.equal(record.readUInt32BE(8), APPENDIX_A.epoch);
  assert.equal(Number(record.readBigUInt64BE(12)), APPENDIX_A.mseq);
  assert.equal(Number(record.readBigUInt64BE(20)), APPENDIX_A.firstSeq);
  assert.equal(record.readUInt16BE(28), 2);
  assert.equal(record[30], BC_HASH_ALG_ID);
  assert.equal(record[31], APPENDIX_A.flags);
  assert.equal(record.readUInt32BE(32), APPENDIX_A.sent);
  assert.equal(record.subarray(36, 68).toString('hex'), APPENDIX_A.ctxHex);
  assert.equal(record.subarray(68, 100).toString('hex'), APPENDIX_A.digest0Hex);
  assert.equal(record.subarray(100, 132).toString('hex'), APPENDIX_A.digest1Hex);
  assert.equal(record.subarray(132, 196).toString('hex'), APPENDIX_A.signatureHex);

  const prefix = Buffer.concat([
    Buffer.from('mcast-manifest-v2', 'utf8'),
    Buffer.from([0x00]),
    (() => { const b = Buffer.alloc(4); b.writeUInt32BE(APPENDIX_A.streamId); return b; })(),
    parseIpv4(APPENDIX_A.source),
    parseIpv4(APPENDIX_A.group),
    (() => { const b = Buffer.alloc(2); b.writeUInt16BE(APPENDIX_A.port); return b; })(),
  ]);
  assert.equal(prefix.toString('hex'), APPENDIX_A.prefixHex);
  const signedMessage = Buffer.concat([prefix, record.subarray(0, 132)]);
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(APPENDIX_A.publicKeyHex, 'hex'),
    ]),
    format: 'der',
    type: 'spki',
  });
  assert.equal(
    cryptoVerify(null, signedMessage, publicKey, record.subarray(132, 196)),
    true,
  );

  // The signature is reproducible from the published seed alone.
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(APPENDIX_A.seedHex, 'hex'),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const reproduced = cryptoSign(null, signedMessage, privateKey);
  assert.equal(Buffer.from(reproduced).toString('hex'), APPENDIX_A.signatureHex);
});

test('appendix A: pseudoheader recomputes exactly (via the digest inputs)', () => {
  // The pseudoheader is the first 20 octets of the §7.2.2 digest
  // preimage; recompute it from the Appendix A inputs directly.
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
  const pseudoheader = Buffer.concat([
    parseIpv4(APPENDIX_A.source),
    parseIpv4(APPENDIX_A.group),
    Buffer.from([0x00, 0x11]),
    u16(1400),
    u16(APPENDIX_A.port),
    u16(APPENDIX_A.port),
    u32(APPENDIX_A.streamId),
  ]);
  assert.equal(pseudoheader.toString('hex'), APPENDIX_A.pseudoheaderHex);
  const d0 = createHash('sha256')
    .update(Buffer.concat([pseudoheader, Buffer.alloc(1400, 0x11)]))
    .digest('hex');
  assert.equal(d0, APPENDIX_A.digest0Hex);
});

test('no-FEC context carries lp16("none") and four u32(0) in params_hash', () => {
  const context = makeContext({ params: { fecInstances: [] } });
  const paramsHash = deriveBcParamsHash(context.params);
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
  const lp16 = (s) => Buffer.concat([u16(Buffer.byteLength(s)), Buffer.from(s, 'utf8')]);
  const expected = createHash('sha256').update(Buffer.concat([
    Buffer.from('BCPV2-params', 'utf8'),
    lp16('avc1.640028'), u32(90000), u32(3000),
    lp16('none'), u32(0), u32(0), u32(0), u32(0),
  ])).digest().toString('base64url');
  assert.equal(paramsHash, expected);
  assert.notEqual(deriveBcCtx(context), base64urlOfHex(APPENDIX_A.ctxHex));
});

// ---------------------------------------------------------------------------
// Item 1: mint / verify round-trip, ctx binding
// ---------------------------------------------------------------------------

test('mint derives the BCPV2 ctx and params_hash, verify accepts the record', () => {
  const { keys, context, minted } = mintValid();
  assert.equal(minted.ctx, deriveBcCtx(context));
  assert.equal(minted.paramsHash, deriveBcParamsHash(context.params));
  const state = createBcReceiverState();
  const verified = verifyBcRecord(minted.manifest.compact, verifyOpts({
    publicJwk: keys.publicJwk,
    receiverState: state,
    context,
  }));
  assert.equal(verified.ok, true);
  assert.equal(verified.outcome, 'verified');
  assert.equal(verified.signatureVerified, true);
  assert.equal(verified.epochEnd, false);
  assert.equal(verified.admittedDigests.length, 3);
  assert.deepEqual(verified.admittedDigests.map((entry) => entry.seq), [100, 101, 102]);
  assert.equal(verified.replayChecked, true);
  assert.equal(verified.ctxChecked, true);
  assert.equal(verified.ctxCarriedBlind, false);
  assert.equal(verified.freshnessChecked, true);
  assert.ok(verified.timing);
  assert.equal(verified.timing.maxAuthDelayMs, BC_DEFAULT_MAX_AUTH_DELAY_MS);
  assert.equal(verified.timing.manifestTimerMs, BC_DEFAULT_MANIFEST_TIMER_MS);
  assert.equal(state.currentEpoch, 3);
  assert.equal(state.fixedHashAlg, BC_HASH_ALG);
});

test('mint without a context carries 32 zero octets; verify carries ctx blind', () => {
  const { keys, minted } = mintValid({ context: null });
  assert.equal(minted.ctx, zeroCtx());
  assert.equal(minted.paramsHash, null);
  const verified = verifyBcRecord(minted.manifest.compact, verifyOpts({ publicJwk: keys.publicJwk }));
  assert.equal(verified.ok, true);
  assert.equal(verified.ctxChecked, false);
  assert.equal(verified.ctxCarriedBlind, true);
});

test('ctx binds the context: a different namespace, packetId or codec is refused', () => {
  const { keys, minted } = mintValid();
  const otherNamespace = verifyBcRecord(minted.manifest.compact, verifyOpts({
    publicJwk: keys.publicJwk,
    context: makeContext({ namespaceFields: ['other.arena'] }),
  }));
  assert.equal(otherNamespace.ok, false);
  assert.equal(otherNamespace.outcome, 'ctx_mismatch');
  const otherPackets = verifyBcRecord(minted.manifest.compact, verifyOpts({
    publicJwk: keys.publicJwk,
    context: makeContext({ packetIds: [1, 3] }),
  }));
  assert.equal(otherPackets.ok, false);
  assert.equal(otherPackets.outcome, 'ctx_mismatch');
  const otherCodec = verifyBcRecord(minted.manifest.compact, verifyOpts({
    publicJwk: keys.publicJwk,
    context: makeContext({ params: { codec: 'avc1.640029' } }),
  }));
  assert.equal(otherCodec.ok, false);
  assert.equal(otherCodec.outcome, 'ctx_mismatch');
});

test('mint is fail-closed: reserved flag bits, count over 37, wrong hash_alg', () => {
  const keys = makeKeys();
  const { fields } = makeFields();
  assert.throws(
    () => mintBcRecord({ fields: { ...fields, flags: 0x02 }, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }),
    /reserved flag bits/,
  );
  const many = makeFields({ count: 38 });
  assert.throws(
    () => mintBcRecord({ fields: many.fields, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }),
    /count must be an integer in 1\.\.37/,
  );
  assert.throws(
    () => mintBcRecord({ fields: { ...fields, hash_alg: 'sha-512' }, sign: signWith(keys.privateKey), publicJwk: keys.publicJwk }),
    /hash_alg must be 'sha-256'/,
  );
});

test('mint never holds a key: a sign callback that returns a bad signature is refused', () => {
  const keys = makeKeys();
  const { fields } = makeFields();
  assert.throws(
    () => mintBcRecord({
      fields,
      sign: () => new Uint8Array(64),
      publicJwk: keys.publicJwk,
    }),
    /fresh signature failed re-verification/,
  );
});

// ---------------------------------------------------------------------------
// Item 2: verify-first ordering — the signature is checked before any
// other field is read
// ---------------------------------------------------------------------------

test('verify-first: invalid signature AND malformed digests refuses as signature_invalid', () => {
  const { keys, minted } = mintValid();
  // Mutate a digest without re-signing: the signature is now invalid
  // AND the digests are malformed. The receiver must report the
  // signature failure — it never read the digests.
  const tampered = mutatePayload(minted.manifest.compact, (payload) => {
    payload.digests[0] = 'not-a-digest';
  });
  const result = verifyBcRecord(tampered, verifyOpts({ publicJwk: keys.publicJwk }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
  assert.equal(result.signatureVerified, false);
  assert.deepEqual(result.admittedDigests, []);
});

test('verify-first: valid signature AND malformed digests refuses as malformed, signature verified', () => {
  const keys = makeKeys();
  const { fields } = makeFields();
  const badPayload = {
    label: BATCH_LABEL,
    scheme: BATCH_SCHEME,
    kid: fields.kid,
    epoch: fields.epoch,
    mseq: fields.mseq,
    first_seq: fields.first_seq,
    count: fields.count,
    hash_alg: fields.hash_alg,
    flags: fields.flags,
    sent: fields.sent,
    ctx: zeroCtx(),
    flow: fields.flow,
    digests: ['not-a-digest', ...fields.digests.slice(1)],
  };
  const compact = handSign(badPayload, keys.privateKey);
  const result = verifyBcRecord(compact, verifyOpts({ publicJwk: keys.publicJwk }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
  assert.equal(result.signatureVerified, true);
  assert.deepEqual(result.admittedDigests, []);
});

test('mutant-kill: every signed field, mutated without re-signing, is refused', () => {
  const { keys, minted } = mintValid();
  const mutations = [
    ['kid', (p) => { p.kid = 'other-key'; }],
    ['epoch', (p) => { p.epoch += 1; }],
    ['mseq', (p) => { p.mseq += 1; }],
    ['first_seq', (p) => { p.first_seq += 1; }],
    ['count', (p) => { p.count = 2; }],
    ['sent', (p) => { p.sent += 1; }],
    ['ctx', (p) => { p.ctx = zeroCtx(); }],
    ['flow.streamId', (p) => { p.flow.streamId += 1; }],
    ['flags', (p) => { p.flags = 1; }],
    ['digests[1]', (p) => { p.digests[1] = p.digests[0]; }],
  ];
  for (const [name, mutate] of mutations) {
    const tampered = mutatePayload(minted.manifest.compact, mutate);
    const result = verifyBcRecord(tampered, verifyOpts({ publicJwk: keys.publicJwk }));
    assert.equal(result.ok, false, `mutation ${name} must be refused`);
    assert.equal(result.outcome, 'signature_invalid', `mutation ${name} must fail on the signature`);
    assert.deepEqual(result.admittedDigests, [], `mutation ${name} must admit nothing`);
  }
});

test('a record verifies under its key and no other', () => {
  const { minted } = mintValid();
  const other = makeKeys();
  const result = verifyBcRecord(minted.manifest.compact, verifyOpts({ publicJwk: other.publicJwk }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('a private JWK member is rejected at verify', () => {
  const keys = makeKeys();
  const { minted } = mintValid();
  const privateJwk = keys.privateKey.export({ format: 'jwk' });
  const result = verifyBcRecord(minted.manifest.compact, verifyOpts({ publicJwk: privateJwk }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

// ---------------------------------------------------------------------------
// Item 3: SHA-256 mandatory
// ---------------------------------------------------------------------------

test('hash_alg other than sha-256 is refused as hash_alg_mismatch', () => {
  const keys = makeKeys();
  const { fields } = makeFields();
  const compact = handSign({ ...fields, label: BATCH_LABEL, scheme: BATCH_SCHEME, ctx: zeroCtx(), hash_alg: 'sha-512' }, keys.privateKey);
  const result = verifyBcRecord(compact, verifyOpts({ publicJwk: keys.publicJwk }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'hash_alg_mismatch');
  assert.equal(result.signatureVerified, false);
});

// ---------------------------------------------------------------------------
// Item 4: explicit timing limits
// ---------------------------------------------------------------------------

test('bcTimingBounds computes the draft bounds exactly', () => {
  const bounds = bcTimingBounds({
    maxAuthDelayMs: 200,
    manifestTimerMs: 20,
    nowMs: 1000000,
    leadMs: 100,
    widenMs: 500,
  });
  assert.equal(bounds.freshnessBehindMs, 7200);
  assert.equal(bounds.freshnessAheadMs, 6000);
  assert.equal(bounds.freshnessBehindSeconds, 7.2);
  assert.equal(bounds.freshnessAheadSeconds, 6);
  assert.equal(bounds.pendingExpiryMs, 1000000 + 200 + 40 + 100);
  assert.equal(bounds.admittedUntilMs, 1000000 + 200 + 100);
  assert.equal(bounds.holdExpiryMs, 1000000 + 200 + 500);
  assert.equal(bounds.previousEpochGraceMs, 5000 + 200 + 40);
  assert.throws(() => bcTimingBounds({ leadMs: 5001 }), /leadMs must be an integer in 0\.\.5000/);
  assert.throws(() => bcTimingBounds({ widenMs: 5001 }), /widenMs must be an integer in 0\.\.5000/);
});

test('freshness: sent more than 7 s + maxAuthDelayMs behind, or 6 s ahead, is stale', () => {
  const staleBehind = mintValid({ sent: NOW - 8 });
  const behind = verifyBcRecord(
    staleBehind.minted.manifest.compact,
    verifyOpts({ publicJwk: staleBehind.keys.publicJwk, nowUnixSeconds: NOW }),
  );
  assert.equal(behind.ok, false);
  assert.equal(behind.outcome, 'stale');
  const ahead = mintValid({ sent: NOW + 7 });
  const aheadResult = verifyBcRecord(
    ahead.minted.manifest.compact,
    verifyOpts({ publicJwk: ahead.keys.publicJwk, nowUnixSeconds: NOW }),
  );
  assert.equal(aheadResult.ok, false);
  assert.equal(aheadResult.outcome, 'stale');
  // Just inside the window: 7 s behind is within 7.2 s.
  const inside = mintValid({ sent: NOW - 7 });
  assert.equal(
    verifyBcRecord(inside.minted.manifest.compact, verifyOpts({ publicJwk: inside.keys.publicJwk, nowUnixSeconds: NOW })).ok,
    true,
  );
});

test('skipFreshness verifies a stale record and records that replay protection is absent', () => {
  const { keys, minted } = mintValid({ sent: NOW - 3600 });
  const result = verifyBcRecord(minted.manifest.compact, verifyOpts({
    publicJwk: keys.publicJwk,
    nowUnixSeconds: NOW,
    skipFreshness: true,
  }));
  assert.equal(result.ok, true);
  assert.equal(result.freshnessChecked, false);
  assert.equal(result.freshnessSkipped, true);
  assert.match(result.reasons.join(' '), /no replay protection/);
});

// ---------------------------------------------------------------------------
// Catalog and key ranges (§7.2.6)
// ---------------------------------------------------------------------------

test('validateBcCatalog accepts a valid catalog and applies defaults and clamps', () => {
  const k1 = makeKeys();
  const k2 = makeKeys();
  const catalog = makeCatalog(
    [{ kid: 'key-1', publicJwk: k1.publicJwk, firstEpoch: 0 }, { kid: 'key-2', publicJwk: k2.publicJwk, firstEpoch: 10 }],
    { minEpoch: 2, endpoint: { maxAuthDelayMs: 5000, manifestTimerMs: 20 } },
  );
  const checked = validateBcCatalog(catalog);
  assert.equal(checked.ok, true);
  assert.equal(checked.normalized.endpoint.maxAuthDelayMs, 1000);
  assert.equal(checked.normalized.endpoint.manifestTimerMs, 20);
  assert.deepEqual(checked.normalized.keys.map((entry) => entry.kid), ['key-1', 'key-2']);
  const timing = bcEndpointTiming(catalog);
  assert.equal(timing.maxAuthDelayMs, 1000);
  assert.equal(timing.manifestTimerMs, 20);
});

test('validateBcCatalog rejects bad scheme, version, sig, key counts, duplicate firstEpoch, bad keys', () => {
  const k1 = makeKeys();
  const base = makeCatalog([{ kid: 'key-1', publicJwk: k1.publicJwk, firstEpoch: 0 }]);
  assert.equal(validateBcCatalog({ ...base, scheme: 'other' }).ok, false);
  assert.equal(validateBcCatalog({ ...base, version: 1 }).ok, false);
  assert.equal(validateBcCatalog({ ...base, sig: 'ed448' }).ok, false);
  assert.equal(validateBcCatalog({ ...base, keys: [] }).ok, false);
  const five = Array.from({ length: 5 }, (_, i) => {
    const k = makeKeys();
    return { kid: `key-${i}`, publicJwk: k.publicJwk, firstEpoch: i };
  });
  assert.equal(validateBcCatalog(makeCatalog(five)).ok, false);
  const dup = makeCatalog([
    { kid: 'key-1', publicJwk: k1.publicJwk, firstEpoch: 0 },
    { kid: 'key-2', publicJwk: makeKeys().publicJwk, firstEpoch: 0 },
  ]);
  assert.equal(validateBcCatalog(dup).ok, false);
  const badKey = makeCatalog([{ kid: 'key-1', publicJwk: k1.publicJwk, firstEpoch: 0 }]);
  badKey.keys[0].publicKey = 'short';
  assert.equal(validateBcCatalog(badKey).ok, false);
  assert.equal(validateBcCatalog({ ...base, endpoint: { streamId: 7, manifestTimerMs: 0 } }).ok, false);
  assert.equal(validateBcCatalog({ ...base, endpoint: { streamId: 7, port: 0 } }).ok, false);
});

test('bcKeyForEpoch selects the key whose firstEpoch covers the epoch', () => {
  const k1 = makeKeys();
  const k2 = makeKeys();
  const catalog = makeCatalog([
    { kid: 'key-1', publicJwk: k1.publicJwk, firstEpoch: 0 },
    { kid: 'key-2', publicJwk: k2.publicJwk, firstEpoch: 10 },
  ]);
  const keys = validateBcCatalog(catalog).normalized.keys;
  assert.equal(bcKeyForEpoch(keys, 0).kid, 'key-1');
  assert.equal(bcKeyForEpoch(keys, 9).kid, 'key-1');
  assert.equal(bcKeyForEpoch(keys, 10).kid, 'key-2');
  assert.equal(bcKeyForEpoch(keys, 1000000).kid, 'key-2');
  const high = makeCatalog([{ kid: 'key-9', publicJwk: makeKeys().publicJwk, firstEpoch: 5 }]);
  assert.equal(bcKeyForEpoch(validateBcCatalog(high).normalized.keys, 3), null);
});

test('bcEndpointTiming defaults to 200 ms / 20 ms with no catalog', () => {
  assert.deepEqual(bcEndpointTiming(null), {
    maxAuthDelayMs: BC_DEFAULT_MAX_AUTH_DELAY_MS,
    manifestTimerMs: BC_DEFAULT_MANIFEST_TIMER_MS,
  });
});

test('mint and verify against a catalog: kid, epoch range and minEpoch enforced', () => {
  const k1 = makeKeys();
  const k2 = makeKeys();
  const catalog = makeCatalog([
    { kid: 'key-1', publicJwk: k1.publicJwk, firstEpoch: 0 },
    { kid: 'key-2', publicJwk: k2.publicJwk, firstEpoch: 10 },
  ], { minEpoch: 2 });
  // Mint under key-1 at epoch 5: inside key-1's range and above minEpoch.
  const { fields } = makeFields({ kid: 'key-1', epoch: 5 });
  const minted = mintBcRecord({
    fields,
    sign: signWith(k1.privateKey),
    publicJwk: k1.publicJwk,
    catalog,
  });
  const verified = verifyBcRecord(minted.manifest.compact, verifyOpts({
    catalog,
    nowUnixSeconds: NOW,
    receiverState: createBcReceiverState(),
  }));
  assert.equal(verified.ok, true);
  // Mint under key-1 at epoch 1: below minEpoch.
  assert.throws(
    () => mintBcRecord({
      fields: { ...fields, epoch: 1 },
      sign: signWith(k1.privateKey),
      publicJwk: k1.publicJwk,
      catalog,
    }),
    /below the catalog minEpoch/,
  );
  // Mint under key-1 at epoch 12: signed by key-2 under this catalog.
  assert.throws(
    () => mintBcRecord({
      fields: { ...fields, epoch: 12 },
      sign: signWith(k1.privateKey),
      publicJwk: k1.publicJwk,
      catalog,
    }),
    /not signed by key 'key-1'/,
  );
  // Mint with a publicJwk that is not the catalog key.
  assert.throws(
    () => mintBcRecord({
      fields,
      sign: signWith(k2.privateKey),
      publicJwk: k2.publicJwk,
      catalog,
    }),
    /does not match the catalog key/,
  );
  // Verify under the catalog with an unknown kid.
  const other = mintValid({ kid: 'key-9' });
  const unknown = verifyBcRecord(other.minted.manifest.compact, verifyOpts({
    catalog,
    nowUnixSeconds: NOW,
  }));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.outcome, 'unknown_key');
  // Verify under the catalog below minEpoch.
  const low = mintValid({ kid: 'key-1', epoch: 1 });
  const lowResult = verifyBcRecord(low.minted.manifest.compact, verifyOpts({
    catalog,
    nowUnixSeconds: NOW,
  }));
  assert.equal(lowResult.ok, false);
  assert.equal(lowResult.outcome, 'epoch_out_of_range');
});

test('key rotation: a record under the old key after rotation is out of range', () => {
  const k1 = makeKeys();
  const k2 = makeKeys();
  const catalog = makeCatalog([
    { kid: 'key-1', publicJwk: k1.publicJwk, firstEpoch: 0 },
    { kid: 'key-2', publicJwk: k2.publicJwk, firstEpoch: 10 },
  ]);
  // key-1 signs epoch 12 — its range ended at epoch 10.
  const { fields } = makeFields({ kid: 'key-1', epoch: 12 });
  const minted = mintBcRecord({
    fields,
    sign: signWith(k1.privateKey),
    publicJwk: k1.publicJwk,
  });
  const result = verifyBcRecord(minted.manifest.compact, verifyOpts({
    catalog,
    nowUnixSeconds: NOW,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'epoch_out_of_range');
});

// ---------------------------------------------------------------------------
// Receiver state (§7.2.7 step 1)
// ---------------------------------------------------------------------------

test('already verified: the twin or a replay of a verified record is refused', () => {
  const { keys, minted } = mintValid();
  const state = createBcReceiverState();
  const first = verifyBcRecord(minted.manifest.compact, verifyOpts({
    publicJwk: keys.publicJwk,
    receiverState: state,
  }));
  assert.equal(first.ok, true);
  const second = verifyBcRecord(minted.manifest.compact, verifyOpts({
    publicJwk: keys.publicJwk,
    receiverState: state,
  }));
  assert.equal(second.ok, false);
  assert.equal(second.outcome, 'already_verified');
  assert.deepEqual(second.admittedDigests, []);
});

test('replay floor: mseq + 64 <= highest_mseq is refused, one above passes', () => {
  const state = createBcReceiverState();
  const high = mintValid({ mseq: 100 });
  assert.equal(
    verifyBcRecord(high.minted.manifest.compact, verifyOpts({ publicJwk: high.keys.publicJwk, receiverState: state })).ok,
    true,
  );
  // Same key object (fresh keys would fail the signature): re-mint
  // under the SAME key as the first record.
  const lowFields = makeFields({ mseq: 36 });
  const low = mintBcRecord({ fields: lowFields.fields, sign: signWith(high.keys.privateKey), publicJwk: high.keys.publicJwk });
  const lowResult = verifyBcRecord(low.manifest.compact, verifyOpts({ publicJwk: high.keys.publicJwk, receiverState: state }));
  assert.equal(lowResult.ok, false);
  assert.equal(lowResult.outcome, 'replay_floor');
  const edgeFields = makeFields({ mseq: 37 });
  const edge = mintBcRecord({ fields: edgeFields.fields, sign: signWith(high.keys.privateKey), publicJwk: high.keys.publicJwk });
  assert.equal(
    verifyBcRecord(edge.manifest.compact, verifyOpts({ publicJwk: high.keys.publicJwk, receiverState: state })).ok,
    true,
  );
});

test('epoch closed: a record above the epoch-closing mseq is refused', () => {
  const state = createBcReceiverState();
  const closing = mintValid({ mseq: 10, flags: 1 });
  const closed = verifyBcRecord(closing.minted.manifest.compact, verifyOpts({
    publicJwk: closing.keys.publicJwk,
    receiverState: state,
  }));
  assert.equal(closed.ok, true);
  assert.equal(closed.epochEnd, true);
  const afterFields = makeFields({ mseq: 11, flags: 0 });
  const after = mintBcRecord({
    fields: afterFields.fields,
    sign: signWith(closing.keys.privateKey),
    publicJwk: closing.keys.publicJwk,
  });
  const result = verifyBcRecord(after.manifest.compact, verifyOpts({
    publicJwk: closing.keys.publicJwk,
    receiverState: state,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'epoch_closed');
});

test('previous epoch grace: admissible inside the deadline, out of range after it', () => {
  const state = createBcReceiverState();
  const e5 = mintValid({ epoch: 5, mseq: 1 });
  assert.equal(
    verifyBcRecord(e5.minted.manifest.compact, verifyOpts({ publicJwk: e5.keys.publicJwk, receiverState: state, nowUnixSeconds: NOW })).ok,
    true,
  );
  const e6 = mintValid({ epoch: 6, mseq: 1 });
  assert.equal(
    verifyBcRecord(e6.minted.manifest.compact, verifyOpts({ publicJwk: e6.keys.publicJwk, receiverState: state, nowUnixSeconds: NOW })).ok,
    true,
  );
  // Previous epoch 5, deadline = NOW*1000 + 5240 ms. 5 s later is inside.
  const e5again = mintValid({ epoch: 5, mseq: 2 });
  assert.equal(
    verifyBcRecord(e5again.minted.manifest.compact, verifyOpts({ publicJwk: e5again.keys.publicJwk, receiverState: state, nowUnixSeconds: NOW + 5 })).ok,
    true,
  );
  // 6 s later is past the 5.24 s grace.
  const e5late = mintValid({ epoch: 5, mseq: 3 });
  const late = verifyBcRecord(e5late.minted.manifest.compact, verifyOpts({
    publicJwk: e5late.keys.publicJwk,
    receiverState: state,
    nowUnixSeconds: NOW + 6,
  }));
  assert.equal(late.ok, false);
  assert.equal(late.outcome, 'epoch_out_of_range');
});

test('verification budget: exhaustion refuses before cryptography', () => {
  const budget = createVerificationBudget({ depth: 1, refillPerSecond: 1000, nowMs: NOW * 1000 });
  const first = mintValid();
  assert.equal(
    verifyBcRecord(first.minted.manifest.compact, verifyOpts({ publicJwk: first.keys.publicJwk, budget })).ok,
    true,
  );
  const second = mintValid();
  const exhausted = verifyBcRecord(second.minted.manifest.compact, verifyOpts({ publicJwk: second.keys.publicJwk, budget }));
  assert.equal(exhausted.ok, false);
  assert.equal(exhausted.outcome, 'budget_exhausted');
  // Even a bad-signature record hits the budget first.
  const bad = mutatePayload(second.minted.manifest.compact, (p) => { p.kid = 'nope'; });
  const badResult = verifyBcRecord(bad, verifyOpts({ publicJwk: second.keys.publicJwk, budget }));
  assert.equal(badResult.outcome, 'budget_exhausted');
});

test('verificationRefillRate follows V = max(1000, 1.25 * bitrate / (8 * 512 * 37))', () => {
  assert.equal(verificationRefillRate(0), 1000);
  assert.equal(verificationRefillRate(1000000), 1000);
  assert.equal(verificationRefillRate(1000000000), Math.max(1000, (1.25 * 1000000000) / (8 * 512 * 37)));
});

test('createVerificationBudget refills by elapsed time', () => {
  const budget = createVerificationBudget({ depth: 2, refillPerSecond: 1, nowMs: 0 });
  assert.equal(budget.take(0), true);
  assert.equal(budget.take(0), true);
  assert.equal(budget.take(0), false);
  assert.equal(budget.take(1000), true);
  assert.equal(budget.take(1000), false);
});

test('bcRecordKey and receiver state start empty', () => {
  assert.equal(bcRecordKey('key-1', 3, 41), 'key-1:3:41');
  const state = createBcReceiverState();
  assert.equal(state.currentEpoch, null);
  assert.equal(state.fixedHashAlg, null);
  assert.equal(state.verifiedRecords.size, 0);
});

// ---------------------------------------------------------------------------
// Batch admission (§7.2.7 step 2, NCPS form)
// ---------------------------------------------------------------------------

test('receiveBcBatch admits the whole batch; uncovered sequences are pending', () => {
  const { keys, items, minted } = mintValid();
  const result = receiveBcBatch(minted.manifest.compact, items.slice(0, 2), verifyOpts({ publicJwk: keys.publicJwk }));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'admitted');
  assert.deepEqual(result.admitted.map((entry) => entry.seq), [100, 101]);
  assert.deepEqual(result.pending, [102]);
  assert.equal(result.signatureVerified, true);
});

test('receiveBcBatch: one bad item refuses the whole batch (no partial acceptance)', () => {
  const { keys, items, minted } = mintValid();
  const tampered = items.map((item) => ({ ...item }));
  tampered[1] = { seq: 101, data: new TextEncoder().encode('bc-item-101-TAMPERED') };
  const result = receiveBcBatch(minted.manifest.compact, tampered, verifyOpts({ publicJwk: keys.publicJwk }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'item_digest_mismatch');
  assert.deepEqual(result.admitted, []);
});

test('receiveBcBatch: item outside the record, duplicate item, invalid record', () => {
  const { keys, items, minted } = mintValid();
  const outside = receiveBcBatch(
    minted.manifest.compact,
    [{ seq: 999, data: items[0].data }],
    verifyOpts({ publicJwk: keys.publicJwk }),
  );
  assert.equal(outside.ok, false);
  assert.equal(outside.outcome, 'item_not_in_manifest');
  const duplicate = receiveBcBatch(
    minted.manifest.compact,
    [items[0], items[0]],
    verifyOpts({ publicJwk: keys.publicJwk }),
  );
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.outcome, 'duplicate_item');
  const badRecord = mutatePayload(minted.manifest.compact, (p) => { p.epoch += 1; });
  const refused = receiveBcBatch(badRecord, items, verifyOpts({ publicJwk: keys.publicJwk }));
  assert.equal(refused.ok, false);
  assert.equal(refused.outcome, 'signature_invalid');
  assert.deepEqual(refused.admitted, []);
});

// ---------------------------------------------------------------------------
// The NCPS boundary: JCS records, not the draft's binary wire record
// ---------------------------------------------------------------------------

test('the NCPS record is a compact JWS, not the draft binary record', () => {
  const { minted } = mintValid();
  const compact = minted.manifest.compact;
  assert.equal(compact.split('.').length, 3);
  assert.notEqual(compact, APPENDIX_A.recordHex);
  assert.equal(minted.manifest.payload.label, BATCH_LABEL);
  assert.equal(minted.manifest.payload.scheme, BATCH_SCHEME);
  assert.equal(BC_DRAFT, 'draft-ramadan-moq-multicast-03');
  assert.equal(BC_PROFILE, 'bc-provenance');
  assert.equal(BC_VERSION, 2);
  assert.equal(BC_HASH_ALG_ID, 1);
  assert.equal(BC_MAX_DIGESTS, 37);
  assert.equal(BC_FRESHNESS_BEHIND_BASE_SECONDS, 7);
  assert.equal(BC_FRESHNESS_AHEAD_SECONDS, 6);
  assert.equal(BC_REPLAY_FLOOR, 64);
  assert.equal(BC_BUDGET_DEPTH, 64);
  assert.equal(BC_OUTCOMES.verified, 'verified');
});

test('the wire digest and the NCPS digest are different forms of the same rule', () => {
  const wire = bcDatagramDigest({
    source: '198.51.100.7',
    group: '232.10.20.30',
    port: 5004,
    streamId: 2864434397,
    data: new Uint8Array(1400).fill(0x11),
  });
  const ncps = batchDigest(
    { streamId: 2864434397, source: '198.51.100.7', group: '232.10.20.30', port: 5004 },
    new Uint8Array(1400).fill(0x11),
  );
  assert.equal(wire, `sha256:${APPENDIX_A.digest0Hex}`);
  assert.notEqual(ncps, wire);
});

test('parseIpv4 rejects non-dotted-quad and mapped forms', () => {
  assert.deepEqual([...parseIpv4('198.51.100.7')], [198, 51, 100, 7]);
  assert.throws(() => parseIpv4('::ffff:198.51.100.7'), /dotted-quad/);
  assert.throws(() => parseIpv4('198.51.100'), /dotted-quad/);
  assert.throws(() => parseIpv4('198.51.100.07'), /dotted-quad/);
  assert.throws(() => parseIpv4('198.51.100.256'), /dotted-quad/);
});
