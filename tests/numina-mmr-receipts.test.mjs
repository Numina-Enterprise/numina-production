// numina-mmr-receipts.test.mjs — COSE Receipts for MMRs as an NCPS record.
//
// Source: draft-bryce-cose-receipts-mmr-profile-05 (Bryce/Geater,
// posted 21 Nov 2026, ADOPTED by the SCITT WG 18:39 UTC Nov 21).
// The -05 text was fetched from the IETF archive and read in full
// before the module was written.
//
// What these tests prove:
//   - MMR arithmetic (§4.1, §5.2, §7.1.1, §8.1, §9.1-§9.4):
//     index_height, peaks, leaf_count, size round-trips,
//     hash_pospair64 recomputed independently, inclusion and
//     consistency round-trips through the store.
//   - Item 1 (bind the algorithm into trusted state, §11.5): every
//     verification step compares the receipt's protected values
//     against trusted state; a chain that mixes hashes is refused
//     (vds_mismatch) with the state unchanged.
//   - Item 2 (empty-tree rule, §7.1/§11.4): the algorithm is taken
//     from the FIRST consistency receipt into trusted state and
//     never re-taken; a second receipt with a different algorithm
//     is refused even though it is otherwise valid; a failed
//     receipt never poisons the state; inclusion receipts do not
//     bootstrap.
//   - Item 3 (registry completeness, §12.1.2): the checklist lists
//     missing proof entries; verification refuses a receipt whose
//     vds has no corresponding proof entries.
//   - Item 4 (hybrid maintained): Ed25519-only fails under a
//     hybrid profile; ML-DSA-65-only fails (mint throws, verify
//     refuses); a hybrid receipt with either half invalid fails;
//     a null ML-DSA-65 key fails; no downgrade path exists.
//   - Threading: verifyBcRecord and verifyBatchManifest accept and
//     enforce trusted state (additive, fail-closed).
//
// NO KAT/ACVP PASS IS CLAIMED HERE: the draft publishes no test
// vectors. Every vector below is an NCPS fixture constructed by
// this module's own MMR arithmetic, labelled as such, never as a
// draft vector. Keys are freshly generated per run (node:crypto
// Ed25519 + ML-DSA-65); signatures are deterministic given the
// keys, and every minted receipt is re-verified by the module
// before it is returned, so cross-run randomness cannot mask a
// failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as cryptoSign,
  createHash,
} from 'node:crypto';
import { pedigreeCanonicalText } from '../src/numina-pedigree.js';
import {
  generateMlDsa65Keypair,
  signMlDsa65,
} from '../src/numina-protocol-pqc.js';
import {
  MMR_DRAFT,
  MMR_PROFILE,
  MMR_VERSION,
  MMR_TYP,
  MMR_VDS_LABEL,
  MMR_VDP_LABEL,
  MMR_INCLUSION_PROOF_LABEL,
  MMR_CONSISTENCY_PROOF_LABEL,
  MMR_TREE_SIZE_2_LABEL,
  MMR_SHA256_COSE_ALG,
  MMR_CANONICALIZATION_JCS,
  MMR_CANONICALIZATION_CBOR,
  MMR_ALG_ED25519,
  MMR_ALG_HYBRID,
  MMR_OUTCOMES,
  MMR_VDS_REGISTRY,
  createMmrRegistry,
  registerMmrVds,
  lookupMmrVds,
  checkRegistryCompleteness,
  validateMmrVdsEntry,
  mmrIndexHeight,
  mmrPeaks,
  mmrLeafCount,
  mmrSizeForLeafCount,
  mmrIsCompleteSize,
  mmrHashPosPair,
  mmrLeafHash,
  mmrInclusionProofPath,
  mmrIncludedRoot,
  mmrConsistentRoots,
  createMmrStore,
  validateTrustedState,
  createTrustedState,
  createEmptyTrustedState,
  isEmptyTrustedState,
  trustedStateSnapshot,
  checkTrustedStateBinding,
  checkTrustedStateAgainstHashAlg,
  mintMmrReceipt,
  verifyMmrInclusionReceipt,
  verifyMmrConsistencyReceipt,
  verifyMmrReceiptChain,
} from '../src/numina-mmr-receipts.js';
import {
  mintBcRecord,
  verifyBcRecord,
  BC_HASH_ALG,
} from '../src/numina-bc-provenance.js';
import {
  BATCH_LABEL,
  BATCH_SCHEME,
  BATCH_HASH_ALG,
  zeroCtx,
  batchDigest,
  mintBatchManifest,
  verifyBatchManifest,
} from '../src/numina-batch-signature.js';

const NOW = 1795238100; // 2026-11-21 ~05:15 UTC, fixed for freshness tests
const TEXT = new TextEncoder();

// ---------------------------------------------------------------------------
// Local helpers — NCPS fixtures, not draft vectors
// ---------------------------------------------------------------------------

function makeMmrKeys() {
  const ed = generateKeyPairSync('ed25519');
  const ml = generateMlDsa65Keypair();
  return {
    edPrivateKey: ed.privateKey,
    edPublicJwk: ed.publicKey.export({ format: 'jwk' }),
    mlPrivateKey: ml.privateKey,
    mlPublicKey: ml.publicKey,
  };
}

function signersFor(keys) {
  return {
    signEd25519: (record) => cryptoSign(null, Buffer.from(pedigreeCanonicalText(record), 'utf8'), keys.edPrivateKey),
    signMlDsa65: (record) => Buffer.from(signMlDsa65({ privateKey: keys.mlPrivateKey, payload: record }), 'hex'),
  };
}

function keysFor(keys) {
  return { ed25519PublicKey: keys.edPublicJwk, mlDsa65PublicKey: keys.mlPublicKey };
}

function makeStore(leafCount, vds = 'MMR_SHA256', registry, prefix = 'mmr-leaf') {
  const store = registry === undefined ? createMmrStore(vds) : createMmrStore(vds, registry);
  for (let i = 0; i < leafCount; i += 1) {
    store.appendLeaf(TEXT.encode(`${prefix}-${i}`));
  }
  return store;
}

/** A registry with the draft's MMR_SHA256 plus a second hash, MMR_SHA512. */
function sha512Registry() {
  const registry = createMmrRegistry();
  const registered = registerMmrVds(registry, 'MMR_SHA512', {
    hashAlg: 'sha-512',
    nodeSize: 64,
    coseAlg: -17,
    proofs: { inclusion: -1, consistency: -2 },
  });
  assert.equal(registered.ok, true, `MMR_SHA512 must register: ${registered.reasons.join('; ')}`);
  return registry;
}

function mintInclusion(store, leafIndex, keys, overrides = {}) {
  const proof = store.inclusionProof(leafIndex);
  return mintMmrReceipt({
    kind: 'inclusion',
    index: proof.index,
    nodeHash: proof.nodeHash,
    path: proof.path,
    ...signersFor(keys),
    ed25519PublicKey: keys.edPublicJwk,
    mlDsa65PublicKey: keys.mlPublicKey,
    ...overrides,
  }).receipt;
}

function mintConsistency(store, fromSize, toSize, keys, overrides = {}) {
  const proof = store.consistencyProof(fromSize, toSize);
  return mintMmrReceipt({
    kind: 'consistency',
    proofs: [proof],
    treeSize2: proof.treeSize2,
    ...signersFor(keys),
    ed25519PublicKey: keys.edPublicJwk,
    mlDsa65PublicKey: keys.mlPublicKey,
    ...overrides,
  }).receipt;
}

function trustedStateFor(vds = 'MMR_SHA256', profile = 'hybrid', treeSize = 0, accumulator = []) {
  return createTrustedState({
    vds,
    hashAlg: vds === 'MMR_SHA256' ? 'sha-256' : 'sha-512',
    canonicalizationAlg: MMR_CANONICALIZATION_JCS,
    signatureProfile: profile,
    treeSize,
    accumulator,
  });
}

// ---------------------------------------------------------------------------
// Draft identity
// ---------------------------------------------------------------------------

test('module names the -05 draft and the registered VDS', () => {
  assert.equal(MMR_DRAFT, 'draft-bryce-cose-receipts-mmr-profile-05');
  assert.equal(MMR_PROFILE, 'mmr-receipts');
  assert.equal(MMR_VERSION, 5);
  assert.equal(MMR_TYP, 'mmr-receipt+jwt');
  assert.equal(MMR_VDS_LABEL, 395);
  assert.equal(MMR_VDP_LABEL, 396);
  assert.equal(MMR_INCLUSION_PROOF_LABEL, -1);
  assert.equal(MMR_CONSISTENCY_PROOF_LABEL, -2);
  assert.equal(MMR_TREE_SIZE_2_LABEL, -65933);
  assert.equal(MMR_SHA256_COSE_ALG, -16);
  assert.equal(MMR_VDS_REGISTRY.MMR_SHA256.hashAlg, 'sha-256');
  assert.equal(MMR_VDS_REGISTRY.MMR_SHA256.nodeSize, 32);
  assert.equal(MMR_VDS_REGISTRY.MMR_SHA256.coseAlg, -16);
  assert.deepEqual(MMR_VDS_REGISTRY.MMR_SHA256.proofs, { inclusion: -1, consistency: -2 });
});

// ---------------------------------------------------------------------------
// MMR arithmetic (§9.1-§9.4, §8.2.1, §4.1, §5.2, §7.1.1, §8.1)
// ---------------------------------------------------------------------------

test('index_height (§9.1): leaves are height 0, parents climb', () => {
  // The draft §2 diagram: leaves 0,1,3,4,7; parents 2,5; root 6.
  for (const leaf of [0, 1, 3, 4, 7]) assert.equal(mmrIndexHeight(leaf), 0, `index ${leaf} is a leaf`);
  assert.equal(mmrIndexHeight(2), 1);
  assert.equal(mmrIndexHeight(5), 1);
  assert.equal(mmrIndexHeight(6), 2);
  assert.equal(mmrIndexHeight(14), 3);
  assert.equal(mmrIndexHeight(30), 4);
});

test('peaks (§9.2) and leaf_count (§9.3) match the §2 diagram', () => {
  assert.deepEqual(mmrPeaks(7), [6, 7]); // MMR(8): peaks 6 (h2) and 7 (h0)
  assert.deepEqual(mmrPeaks(6), [6]); // MMR(7): single peak 6
  assert.deepEqual(mmrPeaks(0), [0]); // MMR(1)
  assert.deepEqual(mmrPeaks(3), [2, 3]); // MMR(4)
  assert.equal(mmrLeafCount(7), 5);
  assert.equal(mmrLeafCount(6), 4);
  assert.equal(mmrLeafCount(0), 1);
  assert.equal(mmrLeafCount(3), 3);
});

test('mmr_size_for_leaf_count (§9.4) round-trips with leaf_count', () => {
  for (let leaves = 1; leaves <= 20; leaves += 1) {
    const size = mmrSizeForLeafCount(leaves);
    assert.equal(mmrLeafCount(size - 1), leaves, `${leaves} leaves -> size ${size}`);
    assert.equal(mmrIsCompleteSize(size), true);
  }
  assert.equal(mmrSizeForLeafCount(0), 0);
  for (const complete of [1, 3, 4, 7, 8, 10, 11, 15, 16]) assert.equal(mmrIsCompleteSize(complete), true);
  for (const incomplete of [2, 5, 6, 9, 12, 13, 14]) assert.equal(mmrIsCompleteSize(incomplete), false);
});

test('hash_pospair64 (§8.2.1) is exactly H(u64be(pos) || a || b), position-bound', () => {
  const entry = MMR_VDS_REGISTRY.MMR_SHA256;
  const a = new Uint8Array(32).fill(0xaa);
  const b = new Uint8Array(32).fill(0xbb);
  const pos = new DataView(new ArrayBuffer(8));
  pos.setBigUint64(0, 3n, false);
  const expected = new Uint8Array(createHash('sha256').update(new Uint8Array(pos.buffer)).update(a).update(b).digest());
  assert.deepEqual(mmrHashPosPair(entry, 3, a, b), expected);
  assert.notDeepEqual(mmrHashPosPair(entry, 3, a, b), mmrHashPosPair(entry, 4, a, b));
  assert.notDeepEqual(mmrHashPosPair(entry, 3, a, b), mmrHashPosPair(entry, 3, b, a));
});

test('leaf hash (§11.2) is H(0x00 || x), domain-separated from interior nodes', () => {
  const entry = MMR_VDS_REGISTRY.MMR_SHA256;
  const preimage = TEXT.encode('mmr-leaf-0');
  const expected = new Uint8Array(createHash('sha256').update(new Uint8Array([0x00])).update(preimage).digest());
  assert.deepEqual(mmrLeafHash(entry, preimage), expected);
  const bare = new Uint8Array(createHash('sha256').update(preimage).digest());
  assert.notDeepEqual(mmrLeafHash(entry, preimage), bare);
});

test('store append (§8.1): 5 leaves give size 8, 2 peaks, 5 leaves', () => {
  const store = makeStore(5);
  assert.equal(store.size, 8);
  assert.equal(store.peaks().length, 2);
  assert.equal(mmrLeafCount(store.size - 1), 5);
  assert.equal(mmrIsCompleteSize(store.size), true);
});

test('inclusion_proof_path (§4.1) + included_root (§5.2) round-trip every leaf', () => {
  const store = makeStore(8);
  const peaks = store.peaks();
  for (let leaf = 0; leaf < 8; leaf += 1) {
    const proof = store.inclusionProof(leaf);
    const root = mmrIncludedRoot(store.entry, proof.index, Buffer.from(proof.nodeHash, 'base64url'), proof.path.map((v) => Buffer.from(v, 'base64url')));
    assert.ok(peaks.some((peak) => Buffer.from(peak).equals(Buffer.from(root))), `leaf ${leaf} recomputes to a peak`);
  }
  // The §2 diagram paths, by index: leaf 0 -> [1, 5]; leaf 3 -> [4, 2]; leaf 7 -> [].
  assert.deepEqual(mmrInclusionProofPath(0, 7), [1, 5]);
  assert.deepEqual(mmrInclusionProofPath(3, 7), [4, 2]);
  assert.deepEqual(mmrInclusionProofPath(7, 7), []);
  assert.deepEqual(mmrInclusionProofPath(1, 7), [0, 5]);
});

test('consistent_roots (§7.1.1) round-trips: 0->8, 4->8, 7->8', () => {
  // 5 leaves make a tree of size 8 (2*5 - ones_count(5) = 8).
  const store = makeStore(5);
  const entry = store.entry;
  const toPeaks = store.peaks();
  for (const [fromSize, expectedRoots, expectedNright] of [
    [0, [], 2],
    [4, [store.get(6)], 1],
    [7, [store.get(6)], 1],
  ]) {
    const proof = store.consistencyProof(fromSize, 8);
    const fromPeaks = fromSize === 0 ? [] : mmrPeaks(fromSize - 1).map((i) => store.get(i));
    const result = mmrConsistentRoots(
      entry,
      fromSize,
      8,
      fromPeaks,
      proof.paths.map((path) => path.map((v) => Buffer.from(v, 'base64url'))),
    );
    assert.equal(result.ok, true, `consistent_roots ${fromSize}->8: ${result.reasons.join('; ')}`);
    assert.deepEqual(result.roots.map((v) => Buffer.from(v).toString('hex')), expectedRoots.map((v) => Buffer.from(v).toString('hex')));
    assert.equal(result.nright, expectedNright);
    assert.deepEqual(
      [...result.roots, ...proof.rightPeaks.map((v) => Buffer.from(v, 'base64url'))].map((v) => Buffer.from(v).toString('hex')),
      toPeaks.map((v) => Buffer.from(v).toString('hex')),
      `roots ++ right-peaks is the size-8 accumulator for ${fromSize}->8`,
    );
  }
});

// ---------------------------------------------------------------------------
// Registry (§3, §12.1.1, §12.1.2)
// ---------------------------------------------------------------------------

test('default registry is complete (§12.1.2): MMR_SHA256 has both proof entries', () => {
  const registry = createMmrRegistry();
  const checked = checkRegistryCompleteness(registry);
  assert.equal(checked.complete, true);
  assert.deepEqual(checked.missing, []);
  assert.equal(lookupMmrVds(registry, 'MMR_SHA256').found, true);
  assert.equal(lookupMmrVds(registry, 'MMR_SHA999').found, false);
});

test('registerMmrVds accepts a second hash only with both proof entries', () => {
  const registry = createMmrRegistry();
  const ok = registerMmrVds(registry, 'MMR_SHA512', {
    hashAlg: 'sha-512', nodeSize: 64, coseAlg: -17, proofs: { inclusion: -1, consistency: -2 },
  });
  assert.equal(ok.ok, true, ok.reasons.join('; '));
  assert.equal(checkRegistryCompleteness(registry).complete, true);
  assert.equal(lookupMmrVds(registry, 'MMR_SHA512').entry.hashAlg, 'sha-512');
});

test('registerMmrVds refuses a value without its consistency proof entry', () => {
  const registry = createMmrRegistry();
  const refused = registerMmrVds(registry, 'MMR_SHA512', {
    hashAlg: 'sha-512', nodeSize: 64, coseAlg: -17, proofs: { inclusion: -1 },
  });
  assert.equal(refused.ok, false);
  assert.match(refused.reasons.join('; '), /consistency/);
  assert.equal(lookupMmrVds(registry, 'MMR_SHA512').found, false);
});

test('registerMmrVds refuses a node size that does not equal the digest length', () => {
  const registry = createMmrRegistry();
  const refused = registerMmrVds(registry, 'MMR_SHA512', {
    hashAlg: 'sha-512', nodeSize: 32, coseAlg: -17, proofs: { inclusion: -1, consistency: -2 },
  });
  assert.equal(refused.ok, false);
  assert.match(refused.reasons.join('; '), /nodeSize/);
});

test('registerMmrVds refuses a duplicate name and an unknown hash', () => {
  const registry = createMmrRegistry();
  assert.equal(registerMmrVds(registry, 'MMR_SHA256', MMR_VDS_REGISTRY.MMR_SHA256).ok, false);
  const unknown = registerMmrVds(registry, 'MMR_BOGUS', {
    hashAlg: 'no-such-hash', nodeSize: 32, coseAlg: -99, proofs: { inclusion: -1, consistency: -2 },
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.reasons.join('; '), /not a hash this runtime supports/);
});

test('checkRegistryCompleteness lists a hand-built registry missing entries', () => {
  const registry = { MMR_SHA256: { hashAlg: 'sha-256', nodeSize: 32, coseAlg: -16, proofs: { inclusion: -1 } } };
  const checked = checkRegistryCompleteness(registry);
  assert.equal(checked.complete, false);
  assert.deepEqual(checked.missing, [{ vds: 'MMR_SHA256', missing: ['consistency'] }]);
  assert.equal(validateMmrVdsEntry(registry.MMR_SHA256).ok, false);
});

// ---------------------------------------------------------------------------
// Trusted state (§5.1, §7.1, §11.4, §11.5)
// ---------------------------------------------------------------------------

test('createTrustedState accepts a valid state; createEmptyTrustedState is empty', () => {
  const state = trustedStateFor('MMR_SHA256', 'hybrid', 0, []);
  assert.equal(validateTrustedState(state).ok, true);
  assert.equal(isEmptyTrustedState(state), false);
  const empty = createEmptyTrustedState();
  assert.equal(isEmptyTrustedState(empty), true);
  assert.equal(validateTrustedState(empty).ok, true);
  assert.deepEqual(trustedStateSnapshot(empty), {
    vds: null, hashAlg: null, canonicalizationAlg: null, signatureProfile: null, treeSize: 0, accumulator: [],
  });
});

test('createTrustedState refuses a hash that does not match the vds (§11.5)', () => {
  assert.throws(
    () => createTrustedState({ vds: 'MMR_SHA256', hashAlg: 'sha-512', canonicalizationAlg: 'rfc8785-jcs', signatureProfile: 'hybrid', treeSize: 0, accumulator: [] }),
    /does not match the hash of VDS/,
  );
});

test('validateTrustedState enforces the accumulator shape for a non-empty tree', () => {
  // 4 leaves make a tree of size 7 with a single peak.
  const store = makeStore(4);
  const peaks = store.peaks().map((v) => Buffer.from(v).toString('base64url'));
  const good = trustedStateFor('MMR_SHA256', 'hybrid', 7, peaks);
  assert.equal(validateTrustedState(good).ok, true);
  assert.equal(validateTrustedState({ ...good, accumulator: [] }).ok, false);
  assert.equal(validateTrustedState({ ...good, treeSize: 5 }).ok, false);
  assert.equal(validateTrustedState({ ...good, treeSize: 0 }).ok, false);
  assert.equal(validateTrustedState({ ...good, vds: null }).ok, false);
});

test('checkTrustedStateBinding compares every pinned field and skips unpinned ones', () => {
  const state = trustedStateFor('MMR_SHA256', 'hybrid', 0, []);
  const expected = { vds: 'MMR_SHA256', hashAlg: 'sha-256', canonicalization: 'rfc8785-jcs', signatureProfile: 'hybrid' };
  assert.equal(checkTrustedStateBinding(state, expected).ok, true);
  assert.equal(checkTrustedStateBinding(state, { ...expected, vds: 'MMR_SHA512' }).outcome, 'vds_mismatch');
  assert.equal(checkTrustedStateBinding(state, { ...expected, hashAlg: 'sha-512' }).outcome, 'hash_alg_mismatch');
  assert.equal(checkTrustedStateBinding(state, { ...expected, canonicalization: 'rfc8949-deterministic-cbor' }).outcome, 'canonicalization_mismatch');
  assert.equal(checkTrustedStateBinding(state, { ...expected, signatureProfile: 'ed25519' }).outcome, 'signature_profile_mismatch');
  // An empty state binds nothing — the bootstrap supplies the values.
  assert.equal(checkTrustedStateBinding(createEmptyTrustedState(), { ...expected, vds: 'MMR_SHA512' }).ok, true);
});

// ---------------------------------------------------------------------------
// Inclusion verification (§5.1, §5.2)
// ---------------------------------------------------------------------------

test('inclusion: hybrid mint/verify round-trips with no trusted state', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 1, keys);
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(result.outcome, 'verified');
  assert.equal(result.signatureVerified, true);
  assert.equal(result.trustedStateBound, false);
  assert.equal(result.trustedStateBootstrapped, false);
  assert.equal(result.index, 1);
  assert.equal(result.peak, Buffer.from(store.peaks()[0]).toString('base64url'));
});

test('inclusion: ed25519 mint/verify round-trips', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 3, keys, { alg: MMR_ALG_ED25519, signMlDsa65: undefined });
  assert.equal(receipt.header.alg, MMR_ALG_ED25519);
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, true, result.reasons.join('; '));
});

test('inclusion: a validly-signed wrong proof is refused by the proof math (peak_mismatch)', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const peaks = store.peaks().map((v) => Buffer.from(v).toString('base64url'));
  const state = trustedStateFor('MMR_SHA256', 'hybrid', 7, peaks);
  // Leaf 1, but with leaf 0's first path element: the signature is
  // valid (the receipt was minted this way), the proof is wrong.
  const proof0 = store.inclusionProof(0);
  const proof1 = store.inclusionProof(1);
  const receipt = mintMmrReceipt({
    kind: 'inclusion',
    index: proof1.index,
    nodeHash: proof1.nodeHash,
    path: [proof0.path[0], proof1.path[1]],
    ...signersFor(keys),
    ed25519PublicKey: keys.edPublicJwk,
    mlDsa65PublicKey: keys.mlPublicKey,
  }).receipt;
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'peak_mismatch');
  assert.equal(result.signatureVerified, true);
});

test('inclusion: a bad signature is refused as signature_invalid', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  receipt.signature.ed25519Signature = '00'.repeat(64);
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
  assert.equal(result.signatureVerified, false);
});

test('inclusion: an unknown vds is refused before the signature is read', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  receipt.header.vds = 'MMR_SHA999';
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'unknown_vds');
});

test('inclusion: a trusted state holding the accumulator binds the peak', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const peaks = store.peaks().map((v) => Buffer.from(v).toString('base64url'));
  const state = trustedStateFor('MMR_SHA256', 'hybrid', 7, peaks);
  const receipt = mintInclusion(store, 2, keys);
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(result.trustedStateBound, true);
});

test('inclusion: a peak from a different tree is refused (peak_mismatch)', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  // A genuinely different tree (different leaf pre-images): an
  // extension of the same tree would keep the old peak, so a
  // shared-prefix tree cannot serve as the "different" case.
  const other = makeStore(5, 'MMR_SHA256', undefined, 'other-leaf');
  const peaks = other.peaks().map((v) => Buffer.from(v).toString('base64url'));
  const state = trustedStateFor('MMR_SHA256', 'hybrid', other.size, peaks);
  const receipt = mintInclusion(store, 0, keys);
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'peak_mismatch');
});

test('inclusion: a receipt carrying treeSize2 is malformed', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  receipt.header.treeSize2 = 4;
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

test('inclusion: a strict-JSON string parses; a non-canonical string is refused', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  const text = JSON.stringify(receipt);
  assert.equal(verifyMmrInclusionReceipt(text, { keys: keysFor(keys) }).ok, true);
  const duplicate = text.replace('"kind":"inclusion"', '"kind":"inclusion","kind":"inclusion"');
  assert.equal(verifyMmrInclusionReceipt(duplicate, { keys: keysFor(keys) }).outcome, 'malformed');
});

// ---------------------------------------------------------------------------
// Consistency verification (§7.1) and the empty-tree rule (§11.4)
// ---------------------------------------------------------------------------

test('consistency: 0->8 advances an empty state and reports the bootstrap', () => {
  const keys = makeMmrKeys();
  const store = makeStore(5); // 5 leaves -> tree size 8
  const receipt = mintConsistency(store, 0, 8, keys);
  const state = createEmptyTrustedState();
  const result = verifyMmrConsistencyReceipt(receipt, { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(result.newTreeSize, 8);
  assert.deepEqual(result.newAccumulator, store.peaks().map((v) => Buffer.from(v).toString('base64url')));
  assert.equal(result.trustedStateBootstrapped, true);
  assert.equal(result.trustedStateBound, true);
  assert.equal(state.vds, 'MMR_SHA256');
  assert.equal(state.hashAlg, 'sha-256');
  assert.equal(state.treeSize, 8);
  assert.deepEqual(state.accumulator, result.newAccumulator);
});

test('consistency: a chain 0->4 then 4->8 advances one state forward-only', () => {
  const keys = makeMmrKeys();
  const store = makeStore(5); // 5 leaves -> tree size 8
  const state = createEmptyTrustedState();
  const chain = verifyMmrReceiptChain(
    [mintConsistency(store, 0, 4, keys), mintConsistency(store, 4, 8, keys)],
    { keys: keysFor(keys), trustedState: state },
  );
  assert.equal(chain.ok, true, chain.reasons.join('; '));
  assert.equal(chain.failedAt, null);
  assert.equal(chain.results.length, 2);
  assert.equal(chain.results[0].trustedStateBootstrapped, true);
  assert.equal(chain.results[1].trustedStateBootstrapped, false);
  assert.equal(chain.finalTrustedState.treeSize, 8);
  assert.deepEqual(chain.finalTrustedState.accumulator, store.peaks().map((v) => Buffer.from(v).toString('base64url')));
});

test('consistency: a receipt whose first tree-size-1 is not the trusted size is refused', () => {
  const keys = makeMmrKeys();
  const store = makeStore(8);
  const state = createEmptyTrustedState();
  assert.equal(verifyMmrConsistencyReceipt(mintConsistency(store, 0, 4, keys), { keys: keysFor(keys), trustedState: state }).ok, true);
  const before = trustedStateSnapshot(state);
  const result = verifyMmrConsistencyReceipt(mintConsistency(store, 0, 8, keys), { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'tree_size_mismatch');
  assert.deepEqual(trustedStateSnapshot(state), before, 'a failed receipt leaves trusted state unchanged');
});

test('consistency: a truncated right-peaks list is refused (proof_shape_mismatch)', () => {
  const keys = makeMmrKeys();
  const store = makeStore(8);
  const proof = store.consistencyProof(0, 8);
  const receipt = mintMmrReceipt({
    kind: 'consistency',
    proofs: [{ ...proof, rightPeaks: proof.rightPeaks.slice(0, 1) }],
    treeSize2: 8,
    ...signersFor(keys),
    ed25519PublicKey: keys.edPublicJwk,
    mlDsa65PublicKey: keys.mlPublicKey,
  }).receipt;
  const result = verifyMmrConsistencyReceipt(receipt, { keys: keysFor(keys), trustedState: createEmptyTrustedState() });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'proof_shape_mismatch');
  assert.equal(result.signatureVerified, true);
});

test('consistency: a tampered path element is refused (proof_shape_mismatch)', () => {
  const keys = makeMmrKeys();
  const store = makeStore(8);
  const proof = store.consistencyProof(4, 8);
  const tampered = {
    ...proof,
    paths: proof.paths.map((path, i) => (i === 1 ? [Buffer.from(store.get(0)).toString('base64url'), ...path.slice(1)] : path)),
  };
  const receipt = mintMmrReceipt({
    kind: 'consistency',
    proofs: [tampered],
    treeSize2: 8,
    ...signersFor(keys),
    ed25519PublicKey: keys.edPublicJwk,
    mlDsa65PublicKey: keys.mlPublicKey,
  }).receipt;
  const state = createEmptyTrustedState();
  assert.equal(verifyMmrConsistencyReceipt(mintConsistency(store, 0, 4, keys), { keys: keysFor(keys), trustedState: state }).ok, true);
  const result = verifyMmrConsistencyReceipt(receipt, { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'proof_shape_mismatch');
  assert.equal(result.signatureVerified, true);
  assert.equal(state.treeSize, 4, 'the failed receipt did not advance the state');
});

test('consistency: a receipt without treeSize2 in the header is malformed', () => {
  const keys = makeMmrKeys();
  const store = makeStore(8);
  const receipt = mintConsistency(store, 0, 8, keys);
  delete receipt.header.treeSize2;
  const result = verifyMmrConsistencyReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

// ---------------------------------------------------------------------------
// Item 1 + Item 2: the §11.5 failure and the empty-tree rule
// ---------------------------------------------------------------------------

test('§11.5: a chain that mixes hashes is refused — peaks under two hashes never verify', () => {
  const keys = makeMmrKeys();
  const registry = sha512Registry();
  const store256 = makeStore(4, 'MMR_SHA256', registry);
  const store512 = makeStore(4, 'MMR_SHA512', registry);
  const state = createEmptyTrustedState();
  const first = verifyMmrConsistencyReceipt(
    mintConsistency(store256, 0, 4, keys),
    { keys: keysFor(keys), trustedState: state, registry },
  );
  assert.equal(first.ok, true, first.reasons.join('; '));
  assert.equal(state.vds, 'MMR_SHA256');
  assert.equal(state.treeSize, 4);
  const before = trustedStateSnapshot(state);
  // The second receipt is fully valid under ITS OWN hash (SHA-512):
  // mint it, verify it standalone against a fresh empty state to
  // prove it would verify on its own, then refuse it in the chain.
  const sha512Receipt = mintMmrReceipt({
    kind: 'consistency',
    proofs: [store512.consistencyProof(0, 4)],
    treeSize2: 4,
    vds: 'MMR_SHA512',
    ...signersFor(keys),
    ed25519PublicKey: keys.edPublicJwk,
    mlDsa65PublicKey: keys.mlPublicKey,
    registry,
  }).receipt;
  const standalone = verifyMmrConsistencyReceipt(sha512Receipt, {
    keys: keysFor(keys), trustedState: createEmptyTrustedState(), registry,
  });
  assert.equal(standalone.ok, true, `the SHA-512 receipt is valid on its own: ${standalone.reasons.join('; ')}`);
  const chain = verifyMmrReceiptChain([sha512Receipt], { keys: keysFor(keys), trustedState: state, registry });
  assert.equal(chain.ok, false);
  assert.equal(chain.outcome, 'vds_mismatch');
  assert.equal(chain.failedAt, 0);
  assert.deepEqual(trustedStateSnapshot(state), before, 'trusted state is unchanged after the refused receipt');
});

test('empty-tree rule: the algorithm is taken from the FIRST receipt and never re-taken', () => {
  const keys = makeMmrKeys();
  const registry = sha512Registry();
  const store256 = makeStore(4, 'MMR_SHA256', registry);
  const store512 = makeStore(4, 'MMR_SHA512', registry);
  const state = createEmptyTrustedState();
  const first = verifyMmrConsistencyReceipt(
    mintConsistency(store256, 0, 4, keys),
    { keys: keysFor(keys), trustedState: state, registry },
  );
  assert.equal(first.ok, true);
  assert.equal(first.trustedStateBootstrapped, true);
  const sha512Receipt = mintMmrReceipt({
    kind: 'consistency',
    proofs: [store512.consistencyProof(0, 4)],
    treeSize2: 4,
    vds: 'MMR_SHA512',
    ...signersFor(keys),
    ed25519PublicKey: keys.edPublicJwk,
    mlDsa65PublicKey: keys.mlPublicKey,
    registry,
  }).receipt;
  const second = verifyMmrConsistencyReceipt(sha512Receipt, { keys: keysFor(keys), trustedState: state, registry });
  assert.equal(second.ok, false);
  assert.equal(second.outcome, 'vds_mismatch');
  assert.equal(second.trustedStateBootstrapped, false);
  assert.equal(state.vds, 'MMR_SHA256', 'the vds was never re-taken from the second receipt');
  assert.equal(state.treeSize, 4);
});

test('empty-tree rule: a failed receipt never poisons the state', () => {
  const keys = makeMmrKeys();
  const store = makeStore(8);
  const receipt = mintConsistency(store, 0, 8, keys);
  receipt.signature.ed25519Signature = '00'.repeat(64);
  const state = createEmptyTrustedState();
  const result = verifyMmrConsistencyReceipt(receipt, { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
  assert.deepEqual(trustedStateSnapshot(state), createEmptyTrustedState(), 'the state is still empty');
  // And the same state still bootstraps from a good receipt after.
  const good = verifyMmrConsistencyReceipt(mintConsistency(store, 0, 8, keys), { keys: keysFor(keys), trustedState: state });
  assert.equal(good.ok, true);
  assert.equal(good.trustedStateBootstrapped, true);
});

test('empty-tree rule: an inclusion receipt does NOT bootstrap the state', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const state = createEmptyTrustedState();
  const result = verifyMmrInclusionReceipt(mintInclusion(store, 0, keys), { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, true);
  assert.equal(result.trustedStateBootstrapped, false);
  assert.equal(result.trustedStateBound, true);
  assert.deepEqual(trustedStateSnapshot(state), createEmptyTrustedState(), 'the state is still empty after an inclusion receipt');
});

test('chain: requireTrustedState without a state is refused, never defaulted', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const chain = verifyMmrReceiptChain([mintConsistency(store, 0, 4, keys)], { keys: keysFor(keys) });
  assert.equal(chain.ok, false);
  assert.equal(chain.outcome, 'trusted_state_required');
  const inclusion = verifyMmrInclusionReceipt(mintInclusion(store, 0, keys), { keys: keysFor(keys), requireTrustedState: true });
  assert.equal(inclusion.ok, false);
  assert.equal(inclusion.outcome, 'trusted_state_required');
});

// ---------------------------------------------------------------------------
// Item 3: registry completeness at verification time
// ---------------------------------------------------------------------------

test('registry completeness: a registry missing the consistency entry refuses at verify', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  const registry = { MMR_SHA256: { hashAlg: 'sha-256', nodeSize: 32, coseAlg: -16, proofs: { inclusion: -1 } } };
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys), registry });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'registry_incomplete');
});

// ---------------------------------------------------------------------------
// Item 4: the Ed25519/PQC hybrid is maintained, no downgrade path
// ---------------------------------------------------------------------------

test('hybrid: an Ed25519-only receipt FAILS under a hybrid profile', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys, { alg: MMR_ALG_ED25519, signMlDsa65: undefined });
  const state = trustedStateFor('MMR_SHA256', 'hybrid', 0, []);
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_profile_mismatch');
});

test('hybrid: an ML-DSA-65-only receipt FAILS — mint throws, verify refuses', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  assert.throws(
    () => mintMmrReceipt({
      kind: 'inclusion', alg: 'ml-dsa-65', index: 0, nodeHash: store.inclusionProof(0).nodeHash, path: [],
      ...signersFor(keys), ed25519PublicKey: keys.edPublicJwk, mlDsa65PublicKey: keys.mlPublicKey,
    }),
    /not a profile/,
  );
  const receipt = mintInclusion(store, 0, keys);
  receipt.header.alg = 'ml-dsa-65';
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

test('hybrid: a receipt with the Ed25519 half invalid FAILS', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  const bad = Buffer.from(receipt.signature.ed25519Signature, 'hex');
  bad[0] ^= 0xff;
  receipt.signature.ed25519Signature = bad.toString('hex');
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('hybrid: a receipt with the ML-DSA-65 half invalid FAILS', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  const bad = Buffer.from(receipt.signature.mlDsa65Signature, 'hex');
  bad[bad.length - 1] ^= 0xff;
  receipt.signature.mlDsa65Signature = bad.toString('hex');
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('hybrid: a null ML-DSA-65 public key FAILS closed', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  const result = verifyMmrInclusionReceipt(receipt, { keys: { ed25519PublicKey: keys.edPublicJwk } });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('hybrid: no downgrade path — a caller cannot request Ed25519-only for a hybrid receipt', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  const state = trustedStateFor('MMR_SHA256', 'ed25519', 0, []);
  const result = verifyMmrInclusionReceipt(receipt, {
    keys: keysFor(keys), trustedState: state, allowEd25519Only: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_profile_mismatch');
});

test('hybrid: minting a hybrid receipt without the ML-DSA-65 callback throws', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const proof = store.inclusionProof(0);
  assert.throws(
    () => mintMmrReceipt({
      kind: 'inclusion', index: proof.index, nodeHash: proof.nodeHash, path: proof.path,
      signEd25519: signersFor(keys).signEd25519,
      ed25519PublicKey: keys.edPublicJwk, mlDsa65PublicKey: keys.mlPublicKey,
    }),
    /signMlDsa65/,
  );
});

// ---------------------------------------------------------------------------
// Canonicalization (§12.1.3, §11.5): only JCS is implemented
// ---------------------------------------------------------------------------

test('canonicalization: a receipt naming deterministic CBOR is refused, never re-interpreted', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const receipt = mintInclusion(store, 0, keys);
  receipt.header.canonicalization = MMR_CANONICALIZATION_CBOR;
  const result = verifyMmrInclusionReceipt(receipt, { keys: keysFor(keys) });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'canonicalization_mismatch');
});

test('canonicalization: a trusted state pinned to CBOR refuses a JCS receipt', () => {
  const keys = makeMmrKeys();
  const store = makeStore(4);
  const state = createTrustedState({
    vds: 'MMR_SHA256', hashAlg: 'sha-256', canonicalizationAlg: MMR_CANONICALIZATION_CBOR,
    signatureProfile: 'hybrid', treeSize: 0, accumulator: [],
  });
  const result = verifyMmrInclusionReceipt(mintInclusion(store, 0, keys), { keys: keysFor(keys), trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'canonicalization_mismatch');
});

// ---------------------------------------------------------------------------
// Threading: verifyBcRecord / verifyBatchManifest enforce trusted state
// ---------------------------------------------------------------------------

function bcKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

function bcSignWith(privateKey) {
  return (bytes) => cryptoSign(null, bytes, privateKey);
}

function bcFlow(overrides = {}) {
  return { streamId: 7, source: 'numina-bc-flow', group: 'numina-bc-group', port: 5004, ...overrides };
}

function mintBc(keys, overrides = {}) {
  const flow = bcFlow();
  const items = [0, 1, 2].map((i) => ({ seq: 100 + i, data: TEXT.encode(`bc-item-${100 + i}`) }));
  const digests = items.map((item) => batchDigest(flow, item.data));
  return mintBcRecord({
    fields: {
      kid: 'key-1', epoch: 3, mseq: 41, first_seq: 100, count: 3,
      hash_alg: BC_HASH_ALG, flags: 0, sent: NOW, flow, digests, ...overrides,
    },
    sign: bcSignWith(keys.privateKey),
    publicJwk: keys.publicJwk,
  }).manifest;
}

function batchKeys() {
  return bcKeys();
}

function mintBatch(keys, overrides = {}) {
  const flow = { streamId: 7, source: 'numina-batch-flow', group: 'numina-batch-group', port: 5004 };
  const items = [0, 1, 2].map((i) => ({ seq: 100 + i, data: TEXT.encode(`batch-item-${100 + i}`) }));
  const digests = items.map((item) => batchDigest(flow, item.data));
  return mintBatchManifest({
    fields: {
      label: BATCH_LABEL, scheme: BATCH_SCHEME, kid: 'key-1', epoch: 3, mseq: 41,
      first_seq: 100, count: 3, hash_alg: BATCH_HASH_ALG, flags: 0, sent: NOW,
      ctx: zeroCtx(), flow, digests, ...overrides,
    },
    sign: bcSignWith(keys.privateKey),
    publicJwk: keys.publicJwk,
  });
}

test('threading: verifyBcRecord with a matching trusted state verifies and reports the binding', () => {
  const keys = bcKeys();
  const { compact } = mintBc(keys);
  const result = verifyBcRecord(compact, {
    publicJwk: keys.publicJwk, nowUnixSeconds: NOW, trustedState: trustedStateFor('MMR_SHA256', 'hybrid', 0, []),
  });
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(result.trustedStateBound, true);
});

test('threading: verifyBcRecord with a SHA-512 trusted state refuses (hash_alg_mismatch)', () => {
  const keys = bcKeys();
  const { compact } = mintBc(keys);
  const registry = sha512Registry();
  const state = createTrustedState({
    vds: 'MMR_SHA512', hashAlg: 'sha-512', canonicalizationAlg: MMR_CANONICALIZATION_JCS,
    signatureProfile: 'hybrid', treeSize: 0, accumulator: [],
  }, registry);
  const result = verifyBcRecord(compact, {
    publicJwk: keys.publicJwk, nowUnixSeconds: NOW, trustedState: state, registry,
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'hash_alg_mismatch');
});

test('threading: verifyBcRecord with requireTrustedState and no state is refused', () => {
  const keys = bcKeys();
  const { compact } = mintBc(keys);
  const result = verifyBcRecord(compact, { publicJwk: keys.publicJwk, nowUnixSeconds: NOW, requireTrustedState: true });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'trusted_state_required');
});

test('threading: verifyBcRecord with a CBOR-pinned state refuses (canonicalization_mismatch)', () => {
  const keys = bcKeys();
  const { compact } = mintBc(keys);
  const state = createTrustedState({
    vds: 'MMR_SHA256', hashAlg: 'sha-256', canonicalizationAlg: MMR_CANONICALIZATION_CBOR,
    signatureProfile: 'hybrid', treeSize: 0, accumulator: [],
  });
  const result = verifyBcRecord(compact, { publicJwk: keys.publicJwk, nowUnixSeconds: NOW, trustedState: state });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'canonicalization_mismatch');
});

test('threading: verifyBatchManifest with a matching trusted state verifies and reports the binding', () => {
  const keys = batchKeys();
  const { compact } = mintBatch(keys);
  const result = verifyBatchManifest(compact, {
    trustAnchors: [{ kid: 'key-1', publicJwk: keys.publicJwk }],
    nowUnixSeconds: NOW, trustedState: trustedStateFor('MMR_SHA256', 'hybrid', 0, []),
  });
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(result.trustedStateBound, true);
});

test('threading: verifyBatchManifest with a SHA-512 trusted state refuses (hash_alg_mismatch)', () => {
  const keys = batchKeys();
  const { compact } = mintBatch(keys);
  const registry = sha512Registry();
  const state = createTrustedState({
    vds: 'MMR_SHA512', hashAlg: 'sha-512', canonicalizationAlg: MMR_CANONICALIZATION_JCS,
    signatureProfile: 'hybrid', treeSize: 0, accumulator: [],
  }, registry);
  const result = verifyBatchManifest(compact, {
    trustAnchors: [{ kid: 'key-1', publicJwk: keys.publicJwk }],
    nowUnixSeconds: NOW, trustedState: state, registry,
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'hash_alg_mismatch');
});

test('threading: verifyBatchManifest with requireTrustedState and no state is refused', () => {
  const keys = batchKeys();
  const { compact } = mintBatch(keys);
  const result = verifyBatchManifest(compact, {
    trustAnchors: [{ kid: 'key-1', publicJwk: keys.publicJwk }],
    nowUnixSeconds: NOW, requireTrustedState: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'trusted_state_required');
});

test('threading: verifyBatchManifest with a CBOR-pinned state refuses (canonicalization_mismatch)', () => {
  const keys = batchKeys();
  const { compact } = mintBatch(keys);
  const state = createTrustedState({
    vds: 'MMR_SHA256', hashAlg: 'sha-256', canonicalizationAlg: MMR_CANONICALIZATION_CBOR,
    signatureProfile: 'hybrid', treeSize: 0, accumulator: [],
  });
  const result = verifyBatchManifest(compact, {
    trustAnchors: [{ kid: 'key-1', publicJwk: keys.publicJwk }],
    nowUnixSeconds: NOW, trustedState: state,
  });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'canonicalization_mismatch');
});

test('threading: a hybrid-profile trusted state still verifies Ed25519 bc/batch records (documented boundary)', () => {
  const keys = bcKeys();
  const { compact } = mintBc(keys);
  const result = verifyBcRecord(compact, {
    publicJwk: keys.publicJwk, nowUnixSeconds: NOW, trustedState: trustedStateFor('MMR_SHA256', 'hybrid', 0, []),
  });
  assert.equal(result.ok, true, 'the profile is an MMR-receipt concept; bc records fix Ed25519');
  const batch = batchKeys();
  const minted = mintBatch(batch);
  const batchResult = verifyBatchManifest(minted.compact, {
    trustAnchors: [{ kid: 'key-1', publicJwk: batch.publicJwk }],
    nowUnixSeconds: NOW, trustedState: trustedStateFor('MMR_SHA256', 'hybrid', 0, []),
  });
  assert.equal(batchResult.ok, true);
});
