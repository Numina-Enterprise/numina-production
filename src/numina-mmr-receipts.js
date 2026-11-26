// numina-mmr-receipts.js — COSE Receipts for MMRs as an NCPS record.
//
// Owner directive Nov 21, 2026 (~13:06-13:07 CST): implement all three
// "Worth evaluating" items from the weekly verified-crypto review for
// draft-bryce-cose-receipts-mmr-profile-05, plus the standing
// requirement to maintain the Ed25519/PQC hybrid:
//   1. Bind the hash/canonicalization algorithm into trusted state and
//      compare it at every verification step (-05 §11.5 names the exact
//      failure — peaks computed under two hash algorithms — that a
//      receipt chain without algorithm binding would suffer).
//   2. Adopt the empty-tree rule (-05 §7.1/§11.4): when bootstrapping
//      from an empty accumulator, the algorithm identifier from the
//      FIRST receipt's protected header becomes trusted state, and is
//      NEVER re-taken from a later receipt.
//   3. Registry completeness checklist (-05 §12.1.2): every registered
//      VDS/algorithm value needs its corresponding proof entries
//      (inclusion -1, consistency -2), or verifiers cannot resolve
//      what a receipt proves.
//   4. Ed25519/PQC hybrid maintained: hybrid verification (Ed25519 +
//      ML-DSA-65) remains required wherever the profile is hybrid; no
//      downgrade path exists.
//
// Source: draft-bryce-cose-receipts-mmr-profile-05 (Bryce/Geater,
// posted 21 Nov 2026, ADOPTED by the SCITT WG 18:39 UTC Nov 21,
// Standards Track). The -05 text was fetched from the IETF archive
// and read in full (2,566 lines) on 21 Nov 2026 (~19:15 UTC) before
// this module was written. Implemented from the draft: §3 (VDS
// description, hash requirements), §4/§4.1 (inclusion proofs,
// inclusion_proof_path), §5/§5.1/§5.2 (receipt of inclusion, verifying
// it, included_root), §6/§6.1 (consistency proof,
// consistency_proof_paths), §7/§7.1/§7.1.1 (receipt of consistency,
// verifying it, consistent_roots), §8/§8.1/§8.2/§8.2.1 (appending a
// leaf, node values, hash_pospair64), §9.1-§9.4 (index_height, peaks,
// leaf_count, mmr_size_for_leaf_count), §11.1-§11.5 (security
// considerations, incl. the empty tree as trusted state and the hash
// algorithm rule), §12.1.1-§12.1.3 (IANA: algorithms, proofs, header
// parameters).
//
// EVIDENCE CLASS (c): the draft is an unproven claim — a design /
// proposal with full verification algorithms, no machine-checked
// proof, no test vectors, no implementation or interop result claimed.
// There are no draft test vectors to reproduce: every vector in the
// tests is an NCPS fixture constructed by this module's own MMR
// arithmetic, labelled as such, never as a draft vector. No KAT/ACVP
// pass is claimed. No interop with an external MMR implementation is
// claimed — none was tested against.
//
// JCS ADAPTATION (recorded, not silent): the draft defines COSE
// Receipts (RFC 9942 COSE_Sign1, deterministic CBOR protected
// headers, labels vds 395 / vdp 396 / inclusion-proof -1 /
// consistency-proof -2 / tree-size-2 -65933). NCPS has no COSE/CBOR
// infrastructure and its whole verification stack is JCS (RFC 8785)
// JSON — pedigree, authorization-binding, batch-signature and
// bc-provenance all canonicalize with the `canonicalize` package.
// So the NCPS MMR receipt is a JCS JSON record
// { header, payload, signature } carrying the draft's exact protected
// header fields (typ, alg, vds, canonicalization, tree-size-2) and
// the draft's exact proof encodings (index, inclusion-path,
// consistency-paths, right-peaks), signed over the JCS canonical
// text of { header, payload }. The draft's detached-payload rule
// (§5/§7: the signature is over the recomputed peak/accumulator,
// never over a presenter-supplied payload) is preserved in NCPS
// form: the peak/accumulator is ALWAYS recomputed from the proof by
// included_root / consistent_roots and compared against trusted
// state — a receipt carries no peak or accumulator of its own —
// and the signature binds the proof the peak was recomputed from.
// The one ordering difference from the draft is deliberate and is
// the NCPS verify-first rule (see numina-bc-provenance.js): the
// signature is verified BEFORE the proof math runs, because in JCS
// form the signature binds the proof itself; a tampered proof breaks
// the signature first, and a validly-signed wrong proof is refused
// by the proof math with signatureVerified: true. The draft's order
// (math, then signature over the recomputed peak) and the NCPS order
// both refuse the same receipts; only the outcome label differs
// when both the signature and the proof are wrong.
//
// VDS VALUES: the draft registers one value, MMR_SHA256, whose
// registry value is TBD_1 (unassigned by IANA at -05). NCPS names
// the VDS by its registry NAME ('MMR_SHA256') on the wire; no
// numeric value is used, because TBD_1 is not a value. The
// COSE algorithm for MMR_SHA256 is -16 (SHA-256, RFC 9054).
//
// LEAF COMMITMENT (§11.2): the draft leaves the leaf commitment
// scheme to the application and warns that leaf values are not
// domain-separated from interior values. NCPS leaf pre-images are
// H(0x00 || x) — a leading domain byte, as the draft recommends.
// An application MUST NOT admit pre-images x that could themselves
// be interior pre-images (pos || left || right); the store's
// appendLeaf takes raw pre-image bytes and the caller owns that
// choice. Interior nodes are H(pos || left || right) with pos the
// 8-byte big-endian one-based position (§8.2.1).
//
// TRUSTED STATE: a TrustedState object carries { vds, hashAlg,
// canonicalizationAlg, signatureProfile, treeSize, accumulator }.
// Every verification step compares the receipt's protected values
// against it and refuses on mismatch. The empty-tree rule: a state
// with vds null (treeSize 0, empty accumulator) takes vds, hashAlg,
// canonicalizationAlg and signatureProfile from the FIRST
// consistency receipt's protected header — staged in working
// variables and committed ONLY when the whole receipt verifies
// (signature included), so a failed receipt can never poison the
// caller's state — and never re-takes them from a later receipt.
// A state that holds a tree size and accumulator additionally
// checks an inclusion receipt's recomputed peak is a member of the
// accumulator (§5.1), and a consistency receipt advances the state
// forward-only (§7.1: a receipt whose first tree-size-1 is not the
// trusted size is refused, including a receipt from the empty tree
// once a later state is held).
//
// SIGNATURE PROFILES: 'ed25519' (single Ed25519 signature, 64
// bytes, base64url) and 'hybrid' (Ed25519 + ML-DSA-65 over the same
// canonical bytes, the numina.hybrid-signature.v1 record from
// numina-protocol-pqc.js). The profile is part of trusted state:
// a hybrid-profile state refuses an Ed25519-only receipt
// (signature_profile_mismatch), and a hybrid receipt whose ML-DSA-65
// half is missing or invalid fails. There is no downgrade path: no
// option, flag, or caller request can verify a hybrid-profile
// receipt as Ed25519-only. An ML-DSA-65-only receipt is not a
// profile at all — minting one throws, verifying one is refused.
// Where a profile is NOT pinned in trusted state (signatureProfile
// null), the verifier accepts the profile the receipt declares and
// verifies it fully; that is an unpinned verifier, not a downgrade
// of a pinned profile, and the result says so.
//
// THREADING: verifyBcRecord and verifyBatchManifest accept
// opts.trustedState (a TrustedState) and opts.requireTrustedState.
// When a trusted state is supplied, the manifest's hash_alg is
// compared against the state's vds/hashAlg and its canonicalization
// against the state's canonicalizationAlg (manifests are JCS, so a
// state pinned to deterministic CBOR cannot be satisfied by one).
// When requireTrustedState is set and no state is supplied, the
// verification is refused, never defaulted. The signature profile
// is NOT enforced on bc/batch records: their drafts fix Ed25519,
// and the profile is an MMR-receipt concept. Threading enforces
// the comparison only; it never advances MMR trusted state (a bc/
// batch record carries no tree).
//
// The module never holds or signs with keys: mint takes `sign`
// callbacks, verify takes public keys only. Private JWK members are
// rejected by decodeJwkPublicKey; ML-DSA-65 keys are KeyObjects or
// SPKI DER hex, handled by numina-protocol-pqc.js.
//
// NCPS wiring: NONE is applied by this module beyond the additive
// trusted-state threading in verifyBcRecord / verifyBatchManifest.
// Where MMR receipts gate (MERF admission, control.js delegate
// path, or both) is an owner decision, recorded in the design note,
// not decided here.
import { createHash } from 'node:crypto';
import {
  pedigreeCanonicalText,
} from './numina-pedigree.js';
import {
  decodeJwkPublicKey,
  decodeStrictBase64url,
  parseStrictJson,
  verifySignature,
} from './numina-protocol-verify.js';
import {
  HYBRID_SIGNATURE_SCHEMA,
  ML_DSA_65_SIGNATURE_BYTES,
  ED25519_SIGNATURE_BYTES,
  parseHybridSignature,
  hybridSignatureRecord,
  verifyHybridSignature,
} from './numina-protocol-pqc.js';

export const MMR_DRAFT = 'draft-bryce-cose-receipts-mmr-profile-05';
export const MMR_PROFILE = 'mmr-receipts';
export const MMR_VERSION = 5;
export const MMR_TYP = 'mmr-receipt+jwt';
/** Draft §5/§7 protected-header labels. */
export const MMR_VDS_LABEL = 395;
export const MMR_VDP_LABEL = 396;
export const MMR_INCLUSION_PROOF_LABEL = -1;
export const MMR_CONSISTENCY_PROOF_LABEL = -2;
/** Draft §12.1.3: private-use value until IANA assigns tree-size-2. */
export const MMR_TREE_SIZE_2_LABEL = -65933;
/** COSE algorithm for MMR_SHA256 (SHA-256, RFC 9054), draft §3 Table 1. */
export const MMR_SHA256_COSE_ALG = -16;
/** The only canonicalization this module implements (NCPS JCS form). */
export const MMR_CANONICALIZATION_JCS = 'rfc8785-jcs';
/** Registered canonicalization name, recognized but NOT implemented. */
export const MMR_CANONICALIZATION_CBOR = 'rfc8949-deterministic-cbor';
export const MMR_CANONICALIZATIONS = Object.freeze([
  MMR_CANONICALIZATION_JCS,
  MMR_CANONICALIZATION_CBOR,
]);
export const MMR_ALG_ED25519 = 'ed25519';
export const MMR_ALG_HYBRID = 'hybrid-ed25519-ml-dsa-65';
export const MMR_SIGNATURE_PROFILES = Object.freeze(['ed25519', 'hybrid']);
/** Draft §3: node value size must be at least 32 bytes. */
export const MMR_MIN_NODE_SIZE = 32;
/** Draft §2: maximum height of a single tree is 63 (g = 62 for its peak). */
export const MMR_MAX_HEIGHT = 63;

export const MMR_OUTCOMES = Object.freeze({
  verified: 'verified',
  malformed: 'malformed',
  non_canonical: 'non_canonical',
  unknown_vds: 'unknown_vds',
  registry_incomplete: 'registry_incomplete',
  vds_mismatch: 'vds_mismatch',
  hash_alg_mismatch: 'hash_alg_mismatch',
  canonicalization_mismatch: 'canonicalization_mismatch',
  signature_profile_mismatch: 'signature_profile_mismatch',
  signature_invalid: 'signature_invalid',
  trusted_state_required: 'trusted_state_required',
  tree_size_mismatch: 'tree_size_mismatch',
  proof_shape_mismatch: 'proof_shape_mismatch',
  peak_mismatch: 'peak_mismatch',
  invalid_node_size: 'invalid_node_size',
  unknown_key: 'unknown_key',
});

function fail(message) {
  throw new Error(`mmr-receipts: ${message}`);
}

function base64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkSafeNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${name} must be a safe non-negative integer`);
  }
}

/** Decode a strict unpadded base64url string to bytes of exactly `size`, or null. */
function decodeNodeBytes(value, size) {
  if (typeof value !== 'string') return null;
  try {
    const bytes = decodeStrictBase64url(value);
    return bytes.length === size ? bytes : null;
  } catch {
    return null;
  }
}

function constantTimeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function constantTimeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Registry (§3, §12.1.1, §12.1.2)
// ---------------------------------------------------------------------------

/**
 * The VDS registry. Draft §3 registers exactly one value,
 * MMR_SHA256 (registry value TBD_1 — unassigned, so NCPS uses the
 * NAME on the wire). Each entry names H (by Node hash name), the
 * node value size (which MUST equal H's digest length — the draft:
 * the node value size is fixed by the vds value), the COSE
 * algorithm, and its proof entries: inclusion (-1) and consistency
 * (-2), per §12.1.2 / RFC 9942 §8.2.1. Other specifications MAY
 * register further values; in NCPS that is registerMmrVds, which
 * refuses a registration without BOTH proof entries.
 */
export const MMR_VDS_REGISTRY = Object.freeze({
  MMR_SHA256: Object.freeze({
    hashAlg: 'sha-256',
    nodeSize: 32,
    coseAlg: MMR_SHA256_COSE_ALG,
    proofs: Object.freeze({ inclusion: MMR_INCLUSION_PROOF_LABEL, consistency: MMR_CONSISTENCY_PROOF_LABEL }),
  }),
});

/** A fresh, mutable registry holding exactly the draft's MMR_SHA256 entry. */
export function createMmrRegistry() {
  return {
    MMR_SHA256: {
      hashAlg: 'sha-256',
      nodeSize: 32,
      coseAlg: MMR_SHA256_COSE_ALG,
      proofs: { inclusion: MMR_INCLUSION_PROOF_LABEL, consistency: MMR_CONSISTENCY_PROOF_LABEL },
    },
  };
}

function digestLength(hashAlg) {
  try {
    return createHash(hashAlg).update(new Uint8Array(0)).digest().length;
  } catch {
    return null;
  }
}

/**
 * Validate one registry entry (draft §3 requirements). Returns
 * { ok, reasons }. The entry asserts, by being registered, that H
 * is deterministic, computable from public inputs alone, and
 * collision- and second-preimage-resistant at >= 128 bits — that
 * assertion is the registering specification's, not something this
 * code can check; what IS checked here is the machine-checkable
 * part: H exists in Node, its digest length is fixed and >= 32
 * bytes, and nodeSize equals that digest length.
 */
export function validateMmrVdsEntry(entry) {
  const reasons = [];
  if (!isPlainObject(entry)) return { ok: false, reasons: ['registry entry must be an object'] };
  for (const key of Object.keys(entry)) {
    if (!['hashAlg', 'nodeSize', 'coseAlg', 'proofs'].includes(key)) {
      reasons.push(`registry entry has unknown field '${key}'`);
    }
  }
  if (typeof entry.hashAlg !== 'string' || entry.hashAlg.length === 0) {
    reasons.push('registry entry hashAlg must be a non-empty string');
  } else {
    const length = digestLength(entry.hashAlg);
    if (length === null) {
      reasons.push(`registry entry hashAlg '${entry.hashAlg}' is not a hash this runtime supports`);
    } else if (length < MMR_MIN_NODE_SIZE) {
      reasons.push(`registry entry hashAlg '${entry.hashAlg}' has digest length ${length}, below the draft §3 minimum of ${MMR_MIN_NODE_SIZE} bytes`);
    } else if (entry.nodeSize !== length) {
      reasons.push(`registry entry nodeSize ${entry.nodeSize} must equal the digest length of '${entry.hashAlg}' (${length}) — the draft fixes the node value size by the vds value`);
    }
  }
  if (!Number.isSafeInteger(entry.nodeSize) || entry.nodeSize < MMR_MIN_NODE_SIZE) {
    reasons.push(`registry entry nodeSize must be a safe integer >= ${MMR_MIN_NODE_SIZE}`);
  }
  if (!Number.isSafeInteger(entry.coseAlg)) {
    reasons.push('registry entry coseAlg must be a safe integer (its COSE Algorithms registry value)');
  }
  if (!isPlainObject(entry.proofs)) {
    reasons.push('registry entry proofs must be an object');
  } else {
    for (const key of Object.keys(entry.proofs)) {
      if (!['inclusion', 'consistency'].includes(key)) {
        reasons.push(`registry entry proofs has unknown field '${key}'`);
      }
    }
    if (entry.proofs.inclusion !== MMR_INCLUSION_PROOF_LABEL) {
      reasons.push(`registry entry proofs.inclusion must be ${MMR_INCLUSION_PROOF_LABEL} (draft §12.1.2)`);
    }
    if (entry.proofs.consistency !== MMR_CONSISTENCY_PROOF_LABEL) {
      reasons.push(`registry entry proofs.consistency must be ${MMR_CONSISTENCY_PROOF_LABEL} (draft §12.1.2)`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Register a further VDS value in a registry (draft §3: other
 * specifications MAY register further values). Refuses — returns
 * { ok: false, reasons } and registers nothing — when the entry is
 * invalid or lacks either proof entry. On success the registry
 * gains a frozen copy of the entry and the call returns { ok: true,
 * reasons: [] }. The built-in frozen registry cannot be registered
 * into (it is frozen); pass a createMmrRegistry() registry.
 */
export function registerMmrVds(registry, name, entry) {
  if (!isPlainObject(registry)) return { ok: false, reasons: ['registry must be an object'] };
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reasons: ['VDS name must be a non-empty string'] };
  }
  if (Object.prototype.hasOwnProperty.call(registry, name)) {
    return { ok: false, reasons: [`VDS '${name}' is already registered`] };
  }
  const checked = validateMmrVdsEntry(entry);
  if (!checked.ok) return checked;
  try {
    registry[name] = Object.freeze({
      hashAlg: entry.hashAlg,
      nodeSize: entry.nodeSize,
      coseAlg: entry.coseAlg,
      proofs: Object.freeze({ inclusion: entry.proofs.inclusion, consistency: entry.proofs.consistency }),
    });
  } catch (error) {
    return { ok: false, reasons: [`registry cannot take a new entry: ${error.message}`] };
  }
  return { ok: true, reasons: [] };
}

/** Look a VDS value up in a registry: { found, entry, reasons }. */
export function lookupMmrVds(registry, name) {
  if (!isPlainObject(registry)) return { found: false, entry: null, reasons: ['registry must be an object'] };
  if (typeof name !== 'string' || name.length === 0) {
    return { found: false, entry: null, reasons: ['VDS name must be a non-empty string'] };
  }
  const entry = registry[name];
  if (entry === undefined) {
    return { found: false, entry: null, reasons: [`VDS '${name}' is not registered`] };
  }
  const checked = validateMmrVdsEntry(entry);
  if (!checked.ok) {
    return { found: false, entry: null, reasons: [`registered VDS '${name}' is invalid: ${checked.reasons.join('; ')}`] };
  }
  return { found: true, entry, reasons: [] };
}

/**
 * Registry completeness checklist (draft §12.1.2 / RFC 9942
 * §8.2.1): every registered VDS value needs its corresponding
 * proof entries, inclusion (-1) and consistency (-2). Returns
 * { complete, missing: [{ vds, missing: ['inclusion'|'consistency'] }] }.
 * A registry with an unknown entry shape is reported, not thrown
 * over: the entry is listed with both proofs missing and the reason
 * in `reasons`.
 */
export function checkRegistryCompleteness(registry) {
  const missing = [];
  const reasons = [];
  if (!isPlainObject(registry)) {
    return { complete: false, missing: [], reasons: ['registry must be an object'] };
  }
  for (const name of Object.keys(registry)) {
    const entry = registry[name];
    if (!isPlainObject(entry) || !isPlainObject(entry.proofs)) {
      missing.push({ vds: name, missing: ['inclusion', 'consistency'] });
      reasons.push(`VDS '${name}' has no usable proofs object`);
      continue;
    }
    const absent = [];
    if (entry.proofs.inclusion !== MMR_INCLUSION_PROOF_LABEL) absent.push('inclusion');
    if (entry.proofs.consistency !== MMR_CONSISTENCY_PROOF_LABEL) absent.push('consistency');
    if (absent.length > 0) missing.push({ vds: name, missing: absent });
  }
  return { complete: missing.length === 0, missing, reasons };
}

// ---------------------------------------------------------------------------
// MMR arithmetic — draft §8/§9, transcribed literally.
// Indices are 0-based; "pos" is the 1-based position (pos = index + 1).
// All sizes are counts of nodes in the tree. Trees in NCPS tests are
// small; Number math with 2** is used throughout (no 32-bit shifts),
// and every public entry point rejects unsafe integers.
// ---------------------------------------------------------------------------

function bitLength(value) {
  if (value <= 0) return 0;
  return Math.floor(Math.log2(value)) + 1;
}

function log2floor(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('log2floor needs a safe integer >= 1');
  return Math.floor(Math.log2(value));
}

function mostSigBit(value) {
  if (!Number.isSafeInteger(value) || value < 1) fail('mostSigBit needs a safe integer >= 1');
  return 2 ** Math.floor(Math.log2(value));
}

/** True when value + 1 is a power of two (value is all-ones in binary). */
function allOnes(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('allOnes needs a safe non-negative integer');
  const next = value + 1;
  return next > 0 && Math.log2(next) % 1 === 0;
}

function onesCount(value) {
  checkSafeNonNegativeInteger(value, 'onesCount input');
  let count = 0;
  let rest = value;
  while (rest > 0) {
    count += rest % 2;
    rest = Math.floor(rest / 2);
  }
  return count;
}

function trailingZeros(value) {
  checkSafeNonNegativeInteger(value, 'trailingZeros input');
  if (value === 0) return 0;
  let count = 0;
  let rest = value;
  while (rest % 2 === 0) {
    count += 1;
    rest = Math.floor(rest / 2);
  }
  return count;
}

/** Draft §9.1: height of the node at index i (leaves are height 0). */
export function mmrIndexHeight(i) {
  checkSafeNonNegativeInteger(i, 'index');
  let pos = i + 1;
  while (!allOnes(pos)) {
    pos = pos - mostSigBit(pos) + 1;
  }
  return bitLength(pos) - 1;
}

/** Draft §9.2: indices of the peaks of the tree ending at index i. */
export function mmrPeaks(i) {
  checkSafeNonNegativeInteger(i, 'index');
  const peaks = [];
  let peak = 0;
  let s = i + 1;
  while (s !== 0) {
    const highestSize = 2 ** log2floor(s + 1) - 1;
    peak += highestSize;
    peaks.push(peak - 1);
    s -= highestSize;
  }
  return peaks;
}

/** Draft §9.3: number of leaves in the tree ending at index i. */
export function mmrLeafCount(i) {
  checkSafeNonNegativeInteger(i, 'index');
  const s0 = i + 1;
  let peakSize = 2 ** bitLength(s0) - 1;
  let peakMap = 0;
  let s = s0;
  while (peakSize > 0) {
    peakMap *= 2;
    if (s >= peakSize) {
      s -= peakSize;
      peakMap |= 1;
    }
    peakSize = Math.floor(peakSize / 2);
  }
  return peakMap;
}

/** Draft §9.4: number of nodes in a tree with the given leaf count. */
export function mmrSizeForLeafCount(leaves) {
  checkSafeNonNegativeInteger(leaves, 'leaf count');
  if (leaves === 0) return 0;
  return 2 * leaves - onesCount(leaves);
}

/** True when `size` is the node count of a complete MMR (no gap). */
export function mmrIsCompleteSize(size) {
  if (!Number.isSafeInteger(size) || size < 0) return false;
  if (size === 0) return true;
  return mmrSizeForLeafCount(mmrLeafCount(size - 1)) === size;
}

/**
 * Draft §8.2.1: hash_pospair64 — H(u64be(pos) || a || b), where a
 * and b are node values and pos is the 1-based position of the
 * resulting node. `hashAlg` is the Node name ('sha-256' for
 * MMR_SHA256); `a`/`b` must be exactly nodeSize bytes.
 */
export function mmrHashPosPair(entry, pos, a, b) {
  if (!isPlainObject(entry)) fail('hash_pospair64 needs a VDS entry');
  if (!Number.isSafeInteger(pos) || pos < 1) fail('hash_pospair64 pos must be a safe integer >= 1');
  if (!(a instanceof Uint8Array) || a.length !== entry.nodeSize) {
    fail(`hash_pospair64 left value must be exactly ${entry.nodeSize} bytes`);
  }
  if (!(b instanceof Uint8Array) || b.length !== entry.nodeSize) {
    fail(`hash_pospair64 right value must be exactly ${entry.nodeSize} bytes`);
  }
  const position = new DataView(new ArrayBuffer(8));
  position.setBigUint64(0, BigInt(pos), false);
  const hash = createHash(entry.hashAlg);
  hash.update(new Uint8Array(position.buffer));
  hash.update(a);
  hash.update(b);
  return new Uint8Array(hash.digest());
}

/** Leaf commitment: H(0x00 || preimage), the §11.2 leading domain byte. */
export function mmrLeafHash(entry, preimage) {
  if (!isPlainObject(entry)) fail('leaf hash needs a VDS entry');
  if (!(preimage instanceof Uint8Array)) fail('leaf preimage must be bytes');
  const hash = createHash(entry.hashAlg);
  hash.update(new Uint8Array([0x00]));
  hash.update(preimage);
  return new Uint8Array(hash.digest());
}

/**
 * Draft §4.1 inclusion_proof_path: indices of the sibling nodes
 * that prove the node at index i inside the tree ending at index
 * c. Returns the path as indices, in order from the leaf upward.
 */
export function mmrInclusionProofPath(i, c) {
  checkSafeNonNegativeInteger(i, 'index');
  checkSafeNonNegativeInteger(c, 'last index');
  if (i > c) fail('inclusion_proof_path: index is past the last index of the tree');
  const path = [];
  let index = i;
  let g = mmrIndexHeight(index);
  for (;;) {
    const siblingOffset = 2 ** (g + 1);
    let isibling;
    if (mmrIndexHeight(index + 1) > g) {
      isibling = index - siblingOffset + 1;
      index += 1;
    } else {
      isibling = index + siblingOffset - 1;
      index += siblingOffset;
    }
    if (isibling > c) return path;
    path.push(isibling);
    g += 1;
  }
}

/**
 * Draft §5.2 included_root: recompute the peak containing the node
 * at index i, from the node value and its inclusion-path sibling
 * values. `proof` is an array of node-value bytes. Throws on a
 * proof whose element is not exactly nodeSize bytes.
 */
export function mmrIncludedRoot(entry, i, nodeHash, proof) {
  if (!isPlainObject(entry)) fail('included_root needs a VDS entry');
  checkSafeNonNegativeInteger(i, 'index');
  if (!(nodeHash instanceof Uint8Array) || nodeHash.length !== entry.nodeSize) {
    fail(`included_root node value must be exactly ${entry.nodeSize} bytes`);
  }
  if (!Array.isArray(proof)) fail('included_root proof must be an array of node values');
  for (const element of proof) {
    if (!(element instanceof Uint8Array) || element.length !== entry.nodeSize) {
      fail(`included_root proof element must be exactly ${entry.nodeSize} bytes`);
    }
  }
  let root = nodeHash;
  let index = i;
  let g = mmrIndexHeight(index);
  for (const sibling of proof) {
    if (mmrIndexHeight(index + 1) > g) {
      index = index + 1;
      root = mmrHashPosPair(entry, index + 1, sibling, root);
    } else {
      index = index + 2 ** (g + 1);
      root = mmrHashPosPair(entry, index + 1, root, sibling);
    }
    g = g + 1;
  }
  return root;
}

/**
 * Draft §7.1.1 consistent_roots: recompute the roots of tree A
 * (treeSizeFrom) inside tree B (treeSizeTo), from A's accumulator
 * and the proof paths, and count the right-peaks. Returns
 * { ok, roots, nright, reasons } — proof-shape failures are
 * returned, not thrown, because they are verification failures.
 * `proofs` is an array (one entry per accumulator value) of arrays
 * of node-value bytes. `accumulatorFrom` is an array of node-value
 * bytes (A's peaks, descending height order).
 */
export function mmrConsistentRoots(entry, sizeFrom, sizeTo, accumulatorFrom, proofs) {
  if (!isPlainObject(entry)) {
    return { ok: false, roots: [], nright: 0, reasons: ['consistent_roots needs a VDS entry'] };
  }
  if (!Number.isSafeInteger(sizeFrom) || sizeFrom < 0) {
    return { ok: false, roots: [], nright: 0, reasons: ['consistent_roots tree-size-1 must be a safe non-negative integer'] };
  }
  if (!Number.isSafeInteger(sizeTo) || sizeTo < 1) {
    return { ok: false, roots: [], nright: 0, reasons: ['consistent_roots tree-size-2 must be a safe integer >= 1'] };
  }
  if (!Array.isArray(accumulatorFrom) || !Array.isArray(proofs)) {
    return { ok: false, roots: [], nright: 0, reasons: ['consistent_roots accumulator and proofs must be arrays'] };
  }
  const leavesTo = mmrLeafCount(sizeTo - 1);
  if (mmrSizeForLeafCount(leavesTo) !== sizeTo) {
    return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots tree-size-2 ${sizeTo} is not a complete tree size`] };
  }
  const leavesFrom = sizeFrom > 0 ? mmrLeafCount(sizeFrom - 1) : 0;
  if (sizeFrom > 0 && mmrSizeForLeafCount(leavesFrom) !== sizeFrom) {
    return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots tree-size-1 ${sizeFrom} is not a complete tree size`] };
  }
  const n = onesCount(leavesFrom);
  if (accumulatorFrom.length !== n) {
    return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots accumulator has ${accumulatorFrom.length} peaks but a tree of size ${sizeFrom} has ${n}`] };
  }
  if (proofs.length !== n) {
    return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots proofs has ${proofs.length} paths but the accumulator has ${n} peaks`] };
  }
  for (const value of accumulatorFrom) {
    if (!(value instanceof Uint8Array) || value.length !== entry.nodeSize) {
      return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots accumulator value must be exactly ${entry.nodeSize} bytes`] };
    }
  }
  for (const path of proofs) {
    if (!Array.isArray(path)) {
      return { ok: false, roots: [], nright: 0, reasons: ['consistent_roots proof path must be an array of node values'] };
    }
    for (const element of path) {
      if (!(element instanceof Uint8Array) || element.length !== entry.nodeSize) {
        return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots proof element must be exactly ${entry.nodeSize} bytes`] };
      }
    }
  }
  const nto = onesCount(leavesTo);
  if (n === 0) return { ok: true, roots: [], nright: nto, reasons: [] };
  // Split point: highest bit where leavesFrom and leavesTo differ.
  const split = bitLength(Number(BigInt(leavesFrom) ^ BigInt(leavesTo))) - 1;
  const roots = [];
  let offset = 0;
  let i = 0;
  // Peaks of A that survive unchanged in B (above the split).
  for (let h = bitLength(leavesFrom) - 1; h > split; h -= 1) {
    if (Math.floor(leavesFrom / 2 ** h) % 2 !== 1) continue;
    if (proofs[i].length !== 0) {
      return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots proof path ${i} must be empty (the peak at height ${h} survives unchanged)`] };
    }
    roots.push(accumulatorFrom[i]);
    offset += 2 ** (h + 1) - 1;
    i += 1;
  }
  const above = roots.length;
  let root = null;
  // Peaks of A at or below the split: recompute their roots in B.
  for (let h = split - 1; h >= 0; h -= 1) {
    if (Math.floor(leavesFrom / 2 ** h) % 2 !== 1) continue;
    if (proofs[i].length !== split - h) {
      return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots proof path ${i} must have ${split - h} elements (peak at height ${h}, split ${split})`] };
    }
    const subtree = 2 ** (h + 1) - 1;
    const proven = mmrIncludedRoot(entry, offset + subtree - 1, accumulatorFrom[i], proofs[i]);
    if (i === above) {
      root = proven;
    } else if (!constantTimeEqualBytes(proven, root)) {
      return { ok: false, roots: [], nright: 0, reasons: [`consistent_roots recomputed root for proof path ${i} does not match the root proven by path ${above}`] };
    }
    offset += subtree;
    i += 1;
  }
  if (n > above) roots.push(root);
  return { ok: true, roots, nright: nto - roots.length, reasons: [] };
}

// ---------------------------------------------------------------------------
// MMR store — draft §8.1 add_leaf_hash, as a test/prover helper.
// The store is a proof-construction aid (a log's append-only
// backing store). It is NOT trusted state and NOT a verifier input:
// verifiers take receipts and a TrustedState only, and recompute
// every peak from the proof.
// ---------------------------------------------------------------------------

/**
 * Create an in-memory append-only MMR store for one VDS value
 * (by registry name, e.g. 'MMR_SHA256').
 * `appendLeaf(preimage)` appends H(0x00 || preimage) and returns
 * { leafIndex, size }. `peaks()` returns the accumulator (peak
 * values, descending height order) as bytes. `inclusionProof(index)`
 * and `consistencyProof(fromSize, toSize)` return proof values as
 * base64url strings, matching the receipt wire form.
 */
export function createMmrStore(vdsName, registry = MMR_VDS_REGISTRY) {
  const lookedUp = lookupMmrVds(registry, vdsName);
  if (!lookedUp.found) fail(`createMmrStore: ${lookedUp.reasons.join('; ')}`);
  const vdsEntry = lookedUp.entry;
  const nodes = [];
  const store = {
    entry: vdsEntry,
    nodes,
    get size() {
      return nodes.length;
    },
    append(value) {
      if (!(value instanceof Uint8Array) || value.length !== vdsEntry.nodeSize) {
        fail(`store append needs a node value of exactly ${vdsEntry.nodeSize} bytes`);
      }
      nodes.push(value);
      return nodes.length;
    },
    get(index) {
      if (!Number.isSafeInteger(index) || index < 0 || index >= nodes.length) {
        fail(`store get: index ${index} is out of range (size ${nodes.length})`);
      }
      return nodes[index];
    },
    appendLeaf(preimage) {
      const leafHash = mmrLeafHash(vdsEntry, preimage);
      const leafIndex = nodes.length;
      let g = 0;
      let i = store.append(leafHash);
      while (mmrIndexHeight(i) > g) {
        const ileft = i - 2 ** (g + 1);
        const iright = i - 1;
        i = store.append(mmrHashPosPair(vdsEntry, i + 1, store.get(ileft), store.get(iright)));
        g += 1;
      }
      return { leafIndex, size: i };
    },
    peaks() {
      if (nodes.length === 0) return [];
      return mmrPeaks(nodes.length - 1).map((index) => nodes[index]);
    },
    inclusionProof(leafIndex) {
      checkSafeNonNegativeInteger(leafIndex, 'leaf index');
      if (leafIndex >= nodes.length) fail('inclusionProof: leaf index is past the end of the tree');
      const pathIndices = mmrInclusionProofPath(leafIndex, nodes.length - 1);
      return {
        index: leafIndex,
        nodeHash: base64urlEncode(nodes[leafIndex]),
        path: pathIndices.map((index) => base64urlEncode(nodes[index])),
      };
    },
    consistencyProof(fromSize, toSize) {
      checkSafeNonNegativeInteger(fromSize, 'tree-size-1');
      checkSafeNonNegativeInteger(toSize, 'tree-size-2');
      if (toSize < 1) fail('consistencyProof: tree-size-2 must be >= 1');
      if (fromSize > toSize) fail('consistencyProof: tree-size-1 must not exceed tree-size-2');
      if (fromSize > 0 && !mmrIsCompleteSize(fromSize)) {
        fail(`consistencyProof: tree-size-1 ${fromSize} is not a complete tree size`);
      }
      if (!mmrIsCompleteSize(toSize)) {
        fail(`consistencyProof: tree-size-2 ${toSize} is not a complete tree size`);
      }
      if (toSize > nodes.length) fail('consistencyProof: tree-size-2 is past the end of the store');
      const fromPeaks = fromSize === 0 ? [] : mmrPeaks(fromSize - 1);
      const paths = fromPeaks.map((peakIndex) =>
        mmrInclusionProofPath(peakIndex, toSize - 1).map((index) => base64urlEncode(nodes[index])),
      );
      const toPeaks = mmrPeaks(toSize - 1).map((index) => nodes[index]);
      const rootsResult = mmrConsistentRoots(
        vdsEntry,
        fromSize,
        toSize,
        fromPeaks.map((index) => nodes[index]),
        paths.map((path) => path.map((value) => decodeNodeBytes(value, vdsEntry.nodeSize))),
      );
      if (!rootsResult.ok) fail(`consistencyProof: ${rootsResult.reasons.join('; ')}`);
      return {
        treeSize1: fromSize,
        treeSize2: toSize,
        paths,
        rightPeaks: toPeaks.slice(rootsResult.roots.length).map((value) => base64urlEncode(value)),
      };
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Trusted state (§5.1, §7.1, §11.4, §11.5)
// ---------------------------------------------------------------------------

/**
 * Validate a TrustedState object. Returns { ok, reasons }.
 * Invariants (all machine-checkable):
 * - vds is null (empty tree) or a registered value with complete
 *   proof entries;
 * - when vds is set, hashAlg equals the registry entry's hashAlg
 *   (the vds fixes H — §11.5: one hash per log lifetime);
 * - when vds is null, hashAlg, canonicalizationAlg and
 *   signatureProfile are also null and the accumulator is empty
 *   (nothing is pinned yet);
 * - canonicalizationAlg, when set, is a registered canonicalization
 *   name; signatureProfile, when set, is 'ed25519' or 'hybrid';
 * - treeSize is a safe integer >= 0 and a complete tree size when
 *   > 0; the accumulator has exactly the peak count that treeSize
 *   implies, every element a node-sized base64url string;
 * - treeSize 0 implies an empty accumulator.
 * This is a shape-and-consistency check on the caller's object,
 * not a check against any log: a forged accumulator of the right
 * shape still passes validation and is only refused by receipt
 * verification. Trust in the state comes from where it was
 * bootstrapped (the first verified consistency receipt) and from
 * forward-only advances, never from this function.
 */
export function validateTrustedState(trustedState, registry = MMR_VDS_REGISTRY) {
  const reasons = [];
  if (!isPlainObject(trustedState)) return { ok: false, reasons: ['trustedState must be an object'] };
  for (const key of Object.keys(trustedState)) {
    if (!['vds', 'hashAlg', 'canonicalizationAlg', 'signatureProfile', 'treeSize', 'accumulator'].includes(key)) {
      reasons.push(`trustedState has unknown field '${key}'`);
    }
  }
  const { vds, hashAlg, canonicalizationAlg, signatureProfile, treeSize, accumulator } = trustedState;
  if (vds !== null && (typeof vds !== 'string' || vds.length === 0)) {
    reasons.push('trustedState vds must be null (empty tree) or a non-empty string');
  }
  let entry = null;
  if (typeof vds === 'string' && vds.length > 0) {
    const lookedUp = lookupMmrVds(registry, vds);
    if (!lookedUp.found) {
      reasons.push(`trustedState vds '${vds}' is not registered: ${lookedUp.reasons.join('; ')}`);
    } else {
      entry = lookedUp.entry;
      const completeness = checkRegistryCompleteness(registry);
      if (!completeness.complete) {
        reasons.push(`trustedState registry is incomplete: ${completeness.missing.map((m) => `${m.vds} missing ${m.missing.join('/')}`).join('; ')}`);
      }
      if (hashAlg !== entry.hashAlg) {
        reasons.push(`trustedState hashAlg '${hashAlg}' does not match the hash of VDS '${vds}' ('${entry.hashAlg}') — §11.5, one hash per log lifetime`);
      }
    }
  } else if (hashAlg !== null || canonicalizationAlg !== null || signatureProfile !== null) {
    reasons.push('an empty trustedState (vds null) must have null hashAlg, canonicalizationAlg and signatureProfile — nothing is pinned before the first receipt');
  }
  if (hashAlg !== null && (typeof hashAlg !== 'string' || hashAlg.length === 0)) {
    reasons.push('trustedState hashAlg must be null or a non-empty string');
  }
  if (canonicalizationAlg !== null && !MMR_CANONICALIZATIONS.includes(canonicalizationAlg)) {
    reasons.push(`trustedState canonicalizationAlg '${canonicalizationAlg}' is not a registered canonicalization (${MMR_CANONICALIZATIONS.join(', ')})`);
  }
  if (signatureProfile !== null && !MMR_SIGNATURE_PROFILES.includes(signatureProfile)) {
    reasons.push(`trustedState signatureProfile '${signatureProfile}' must be one of ${MMR_SIGNATURE_PROFILES.join(', ')}`);
  }
  if (!Number.isSafeInteger(treeSize) || treeSize < 0) {
    reasons.push('trustedState treeSize must be a safe non-negative integer');
  } else if (treeSize > 0) {
    if (vds === null) {
      reasons.push('trustedState with treeSize > 0 must have a vds (an accumulator without a hash is meaningless)');
    }
    if (!mmrIsCompleteSize(treeSize)) {
      reasons.push(`trustedState treeSize ${treeSize} is not a complete tree size`);
    } else {
      const expectedPeaks = onesCount(mmrLeafCount(treeSize - 1));
      if (!Array.isArray(accumulator)) {
        reasons.push('trustedState accumulator must be an array');
      } else if (accumulator.length !== expectedPeaks) {
        reasons.push(`trustedState accumulator has ${accumulator.length} peaks but a tree of size ${treeSize} has ${expectedPeaks}`);
      }
    }
  }
  if (Array.isArray(accumulator)) {
    if (treeSize === 0 && accumulator.length !== 0) {
      reasons.push('trustedState with treeSize 0 must have an empty accumulator');
    }
    if (entry !== null) {
      for (const [index, value] of accumulator.entries()) {
        if (decodeNodeBytes(value, entry.nodeSize) === null) {
          reasons.push(`trustedState accumulator[${index}] is not a strict base64url string of exactly ${entry.nodeSize} bytes`);
        }
      }
    }
  } else {
    reasons.push('trustedState accumulator must be an array');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Create a TrustedState from explicit values. Throws when invalid
 * (a caller constructing a bad state is a programming error, not a
 * verification failure). Use createEmptyTrustedState() for the
 * bootstrap case.
 */
export function createTrustedState(values, registry = MMR_VDS_REGISTRY) {
  if (!isPlainObject(values)) fail('createTrustedState needs an object');
  const state = {
    vds: values.vds ?? null,
    hashAlg: values.hashAlg ?? null,
    canonicalizationAlg: values.canonicalizationAlg ?? null,
    signatureProfile: values.signatureProfile ?? null,
    treeSize: values.treeSize ?? 0,
    accumulator: Array.isArray(values.accumulator) ? [...values.accumulator] : [],
  };
  const checked = validateTrustedState(state, registry);
  if (!checked.ok) fail(`createTrustedState: invalid trusted state: ${checked.reasons.join('; ')}`);
  return state;
}

/** The empty-tree trusted state (§11.4): nothing pinned yet. */
export function createEmptyTrustedState() {
  return {
    vds: null,
    hashAlg: null,
    canonicalizationAlg: null,
    signatureProfile: null,
    treeSize: 0,
    accumulator: [],
  };
}

/** True when the state is the empty tree (vds not yet pinned). */
export function isEmptyTrustedState(trustedState) {
  return isPlainObject(trustedState) && trustedState.vds === null;
}

/** A plain snapshot copy of a trusted state (for results / logging). */
export function trustedStateSnapshot(trustedState) {
  if (!isPlainObject(trustedState)) return null;
  return {
    vds: trustedState.vds ?? null,
    hashAlg: trustedState.hashAlg ?? null,
    canonicalizationAlg: trustedState.canonicalizationAlg ?? null,
    signatureProfile: trustedState.signatureProfile ?? null,
    treeSize: trustedState.treeSize ?? 0,
    accumulator: Array.isArray(trustedState.accumulator) ? [...trustedState.accumulator] : [],
  };
}

/**
 * Compare a receipt's protected values against trusted state.
 * Returns { ok, outcome, reasons }. `expected` carries the values
 * from the receipt's protected header (vds, hashAlg, canonicalization,
 * signatureProfile, plus the receipt's alg for the profile check).
 * An empty trusted state (vds null) passes here — the bootstrap
 * supplies the values before this comparison runs (see
 * verifyMmrConsistencyReceipt); an unpinned FIELD (null) is skipped
 * — the field is not yet pinned, it is not a mismatch.
 */
export function checkTrustedStateBinding(trustedState, expected) {
  if (!isPlainObject(trustedState)) {
    return { ok: false, outcome: 'malformed', reasons: ['trustedState must be an object'] };
  }
  if (!isPlainObject(expected)) {
    return { ok: false, outcome: 'malformed', reasons: ['expected protected values must be an object'] };
  }
  if (trustedState.vds !== null && trustedState.vds !== expected.vds) {
    return { ok: false, outcome: 'vds_mismatch', reasons: [`receipt vds '${expected.vds}' does not match trusted vds '${trustedState.vds}' — §11.5, one hash per log lifetime`] };
  }
  if (trustedState.hashAlg !== null && trustedState.hashAlg !== expected.hashAlg) {
    return { ok: false, outcome: 'hash_alg_mismatch', reasons: [`receipt hash '${expected.hashAlg}' does not match trusted hash '${trustedState.hashAlg}' — §11.5, one hash per log lifetime`] };
  }
  if (trustedState.canonicalizationAlg !== null && trustedState.canonicalizationAlg !== expected.canonicalization) {
    return { ok: false, outcome: 'canonicalization_mismatch', reasons: [`receipt canonicalization '${expected.canonicalization}' does not match trusted canonicalization '${trustedState.canonicalizationAlg}'`] };
  }
  if (trustedState.signatureProfile !== null && trustedState.signatureProfile !== expected.signatureProfile) {
    return { ok: false, outcome: 'signature_profile_mismatch', reasons: [`receipt signature profile '${expected.signatureProfile}' does not match trusted profile '${trustedState.signatureProfile}' — no downgrade path exists`] };
  }
  return { ok: true, outcome: 'verified', reasons: [] };
}

/**
 * Threading helper for verifyBcRecord / verifyBatchManifest:
 * compare a manifest's hash_alg (and its fixed JCS form) against a
 * TrustedState. Returns { ok, outcome, reasons }. A null state
 * passes (the caller decides whether a state is required, via
 * requireTrustedState). The signature profile is NOT compared here:
 * bc/batch drafts fix Ed25519, and the profile is an MMR-receipt
 * concept — the boundary is documented in the module header.
 */
export function checkTrustedStateAgainstHashAlg(trustedState, hashAlg, registry = MMR_VDS_REGISTRY) {
  if (trustedState === null || trustedState === undefined) {
    return { ok: true, outcome: 'verified', reasons: [] };
  }
  const checked = validateTrustedState(trustedState, registry);
  if (!checked.ok) {
    return { ok: false, outcome: 'malformed', reasons: [`trustedState is invalid: ${checked.reasons.join('; ')}`] };
  }
  if (trustedState.vds !== null) {
    const lookedUp = lookupMmrVds(registry, trustedState.vds);
    if (!lookedUp.found) {
      return { ok: false, outcome: 'vds_mismatch', reasons: [`trusted vds '${trustedState.vds}' is not registered: ${lookedUp.reasons.join('; ')}`] };
    }
    if (lookedUp.entry.hashAlg !== hashAlg) {
      return { ok: false, outcome: 'hash_alg_mismatch', reasons: [`manifest hash_alg '${hashAlg}' does not match the hash of trusted VDS '${trustedState.vds}' ('${lookedUp.entry.hashAlg}') — §11.5`] };
    }
  }
  if (trustedState.hashAlg !== null && trustedState.hashAlg !== hashAlg) {
    return { ok: false, outcome: 'hash_alg_mismatch', reasons: [`manifest hash_alg '${hashAlg}' does not match trusted hash '${trustedState.hashAlg}' — §11.5`] };
  }
  if (trustedState.canonicalizationAlg !== null && trustedState.canonicalizationAlg !== MMR_CANONICALIZATION_JCS) {
    return { ok: false, outcome: 'canonicalization_mismatch', reasons: [`manifest is a JCS record but trusted canonicalization is '${trustedState.canonicalizationAlg}'`] };
  }
  return { ok: true, outcome: 'verified', reasons: [] };
}

// ---------------------------------------------------------------------------
// Receipt shape, minting, signature verification
// ---------------------------------------------------------------------------

const MMR_HEADER_FIELDS = ['typ', 'alg', 'vds', 'canonicalization', 'treeSize2'];
const MMR_INCLUSION_PAYLOAD_FIELDS = ['kind', 'index', 'nodeHash', 'path'];
const MMR_CONSISTENCY_PAYLOAD_FIELDS = ['kind', 'proofs'];
const MMR_CONSISTENCY_PROOF_FIELDS = ['treeSize1', 'treeSize2', 'paths', 'rightPeaks'];

function failResult(outcome, reasons, extra = {}) {
  return {
    ok: false,
    outcome,
    reasons,
    signatureVerified: false,
    trustedStateBound: false,
    trustedStateBootstrapped: false,
    ...extra,
  };
}

/**
 * Parse a receipt from an object or a strict-JSON string. Returns
 * { ok, receipt, reasons } — a string is parsed with
 * parseStrictJson (duplicate members and lone surrogates refused,
 * same as every other NCPS record).
 */
function parseReceiptInput(receipt) {
  if (typeof receipt === 'string') {
    try {
      return { ok: true, receipt: parseStrictJson(receipt), reasons: [] };
    } catch (error) {
      return { ok: false, receipt: null, reasons: [`receipt is not strict JSON: ${error.message}`] };
    }
  }
  if (isPlainObject(receipt)) return { ok: true, receipt, reasons: [] };
  return { ok: false, receipt: null, reasons: ['receipt must be an object or a strict-JSON string'] };
}

/**
 * Validate the receipt's shape (before any trust or signature
 * check). Returns { ok, reasons, header, payload, signature,
 * kind }. A consistency receipt MUST carry treeSize2 in the
 * protected header (draft §7.1 step 1: tree-size-2 is present);
 * an inclusion receipt MUST NOT (its tree size is the caller's
 * trusted size, or none). Field sets are exact — unknown fields
 * are refused, same as the other NCPS verifiers.
 */
function validateReceiptShape(receipt) {
  const reasons = [];
  if (!isPlainObject(receipt)) return { ok: false, reasons: ['receipt must be an object'], header: null, payload: null, signature: null, kind: null };
  for (const key of Object.keys(receipt)) {
    if (!['header', 'payload', 'signature'].includes(key)) {
      reasons.push(`receipt has unknown field '${key}'`);
    }
  }
  const { header, payload, signature } = receipt;
  if (!isPlainObject(header)) reasons.push('receipt header must be an object');
  if (!isPlainObject(payload)) reasons.push('receipt payload must be an object');
  if (signature === undefined) reasons.push('receipt signature is missing');
  if (reasons.length > 0) {
    return { ok: false, reasons, header: null, payload: null, signature: null, kind: null };
  }
  for (const key of Object.keys(header)) {
    if (!MMR_HEADER_FIELDS.includes(key)) reasons.push(`receipt header has unknown field '${key}'`);
  }
  if (header.typ !== MMR_TYP) reasons.push(`receipt header typ must be '${MMR_TYP}'`);
  if (header.alg !== MMR_ALG_ED25519 && header.alg !== MMR_ALG_HYBRID) {
    reasons.push(`receipt header alg must be '${MMR_ALG_ED25519}' or '${MMR_ALG_HYBRID}'`);
  }
  if (typeof header.vds !== 'string' || header.vds.length === 0) {
    reasons.push('receipt header vds must be a non-empty string');
  }
  if (typeof header.canonicalization !== 'string' || header.canonicalization.length === 0) {
    reasons.push('receipt header canonicalization must be a non-empty string');
  }
  if (header.treeSize2 !== undefined && (!Number.isSafeInteger(header.treeSize2) || header.treeSize2 < 0)) {
    reasons.push('receipt header treeSize2 must be a safe non-negative integer');
  }
  if (payload.kind !== 'inclusion' && payload.kind !== 'consistency') {
    reasons.push("receipt payload kind must be 'inclusion' or 'consistency'");
  }
  if (payload.kind === 'inclusion') {
    for (const key of Object.keys(payload)) {
      if (!MMR_INCLUSION_PAYLOAD_FIELDS.includes(key)) reasons.push(`inclusion payload has unknown field '${key}'`);
    }
    if (header.treeSize2 !== undefined) {
      reasons.push('an inclusion receipt must not carry treeSize2 in the protected header');
    }
    if (!Number.isSafeInteger(payload.index) || payload.index < 0) {
      reasons.push('inclusion payload index must be a safe non-negative integer');
    }
    if (typeof payload.nodeHash !== 'string') reasons.push('inclusion payload nodeHash must be a base64url string');
    if (!Array.isArray(payload.path)) reasons.push('inclusion payload path must be an array of base64url strings');
  }
  if (payload.kind === 'consistency') {
    for (const key of Object.keys(payload)) {
      if (!MMR_CONSISTENCY_PAYLOAD_FIELDS.includes(key)) reasons.push(`consistency payload has unknown field '${key}'`);
    }
    if (header.treeSize2 === undefined) {
      reasons.push('a consistency receipt must carry treeSize2 in the protected header (draft §7.1 step 1)');
    }
    if (!Array.isArray(payload.proofs)) reasons.push('consistency payload proofs must be an array');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    header,
    payload,
    signature,
    kind: payload.kind,
  };
}

/** The protected-header values a receipt binds, for trusted-state comparison. */
function receiptProtectedValues(header, entry) {
  return {
    vds: header.vds,
    hashAlg: entry.hashAlg,
    canonicalization: header.canonicalization,
    signatureProfile: header.alg === MMR_ALG_HYBRID ? 'hybrid' : 'ed25519',
  };
}

/**
 * Verify the receipt signature over the JCS canonical text of
 * { header, payload }. Returns { ok, outcome, reasons }. The
 * public keys come from the CALLER (trust anchors), never from
 * the receipt — a receipt carries no keys of its own.
 */
function verifyReceiptSignature(record, header, signature, keys) {
  if (!isPlainObject(keys)) {
    return { ok: false, outcome: 'malformed', reasons: ['verification needs a keys object with the Ed25519 public key'] };
  }
  let ed25519PublicKey;
  try {
    ed25519PublicKey = decodeJwkPublicKey(keys.ed25519PublicKey);
  } catch (error) {
    return { ok: false, outcome: 'malformed', reasons: [`ed25519PublicKey is not a usable Ed25519 public key: ${error.message}`] };
  }
  if (header.alg === MMR_ALG_ED25519) {
    if (typeof signature !== 'string') {
      return { ok: false, outcome: 'malformed', reasons: ['an ed25519 receipt signature must be a base64url string'] };
    }
    const signatureBytes = decodeNodeBytes(signature, ED25519_SIGNATURE_BYTES);
    if (signatureBytes === null) {
      return { ok: false, outcome: 'malformed', reasons: [`an ed25519 receipt signature must be a strict base64url string of exactly ${ED25519_SIGNATURE_BYTES} bytes`] };
    }
    let ok = false;
    try {
      ok = verifySignature({ publicKey: ed25519PublicKey, signature: signatureBytes, payload: record });
    } catch (error) {
      return { ok: false, outcome: 'malformed', reasons: [`ed25519 signature verification failed to run: ${error.message}`] };
    }
    return ok
      ? { ok: true, outcome: 'verified', reasons: [] }
      : { ok: false, outcome: 'signature_invalid', reasons: ['ed25519 signature does not verify over the canonical { header, payload }'] };
  }
  // Hybrid: Ed25519 + ML-DSA-65 over the same canonical bytes.
  // A receipt carries the hybrid signature as the record form
  // { schema, ed25519Signature, mlDsa65Signature } — a raw bundle
  // or bundle hex is not a receipt signature.
  if (!isPlainObject(signature)) {
    return { ok: false, outcome: 'malformed', reasons: ['a hybrid receipt signature must be a record { schema, ed25519Signature, mlDsa65Signature }'] };
  }
  let parts;
  try {
    parts = parseHybridSignature(signature);
  } catch (error) {
    return { ok: false, outcome: 'malformed', reasons: [`hybrid signature is malformed: ${error.message}`] };
  }
  if (parts.schema !== HYBRID_SIGNATURE_SCHEMA) {
    return { ok: false, outcome: 'malformed', reasons: [`hybrid signature schema must be '${HYBRID_SIGNATURE_SCHEMA}'`] };
  }
  let ok = false;
  try {
    ok = verifyHybridSignature({
      ed25519PublicKey,
      mlDsa65PublicKey: keys.mlDsa65PublicKey ?? null,
      hybridSignature: signature,
      payload: record,
    });
  } catch (error) {
    return { ok: false, outcome: 'malformed', reasons: [`hybrid signature verification failed to run: ${error.message}`] };
  }
  return ok
    ? { ok: true, outcome: 'verified', reasons: [] }
    : { ok: false, outcome: 'signature_invalid', reasons: ['hybrid signature does not verify — the Ed25519 half, the ML-DSA-65 half, or both did not verify over the same canonical bytes (a null ML-DSA-65 key fails closed)'] };
}

/**
 * Mint an MMR receipt (a prover/log helper, not a verifier).
 * Arguments:
 *   kind: 'inclusion' | 'consistency'
 *   vds: registry name, default 'MMR_SHA256'
 *   alg: 'ed25519' | 'hybrid-ed25519-ml-dsa-65' (default hybrid)
 *   inclusion: { index, nodeHash, path } (base64url strings)
 *   consistency: { proofs: [{ treeSize1, treeSize2, paths, rightPeaks }] } (base64url strings)
 *   treeSize2: required for consistency (protected header), must
 *     equal the last proof's treeSize2; must be absent for inclusion
 *   signEd25519(recordObject) -> Uint8Array(64)
 *   signMlDsa65(recordObject) -> Uint8Array(3309) (hybrid only)
 *   ed25519PublicKey, mlDsa65PublicKey: the caller's public keys,
 *     used to re-verify the fresh signature before returning
 * Returns { receipt, signingInput }. Throws on any bad argument,
 * on a missing callback for the chosen alg, on an ML-DSA-65-only
 * request (not a profile), and when the fresh signature does not
 * verify — a mint that cannot verify is never returned.
 * The module never holds or signs with keys: the callbacks do the
 * signing, outside this module.
 */
export function mintMmrReceipt(args) {
  if (!isPlainObject(args)) fail('mintMmrReceipt needs an argument object');
  const {
    kind,
    vds = 'MMR_SHA256',
    alg = MMR_ALG_HYBRID,
    index,
    nodeHash,
    path,
    proofs,
    treeSize2,
    signEd25519,
    signMlDsa65,
    ed25519PublicKey,
    mlDsa65PublicKey,
    registry = MMR_VDS_REGISTRY,
  } = args;
  const lookedUp = lookupMmrVds(registry, vds);
  if (!lookedUp.found) fail(`mintMmrReceipt: ${lookedUp.reasons.join('; ')}`);
  const entry = lookedUp.entry;
  if (kind !== 'inclusion' && kind !== 'consistency') {
    fail("mintMmrReceipt: kind must be 'inclusion' or 'consistency'");
  }
  if (alg !== MMR_ALG_ED25519 && alg !== MMR_ALG_HYBRID) {
    fail(`mintMmrReceipt: alg must be '${MMR_ALG_ED25519}' or '${MMR_ALG_HYBRID}' — an ML-DSA-65-only receipt is not a profile and is refused`);
  }
  if (typeof signEd25519 !== 'function') fail('mintMmrReceipt: signEd25519 callback is required (the module never holds keys)');
  if (alg === MMR_ALG_HYBRID && typeof signMlDsa65 !== 'function') {
    fail('mintMmrReceipt: a hybrid receipt needs a signMlDsa65 callback — an Ed25519-only receipt is never minted under a hybrid profile');
  }
  if (alg === MMR_ALG_ED25519 && typeof signMlDsa65 === 'function') {
    fail('mintMmrReceipt: signMlDsa65 was supplied for an ed25519 receipt — supply one signing path per receipt');
  }
  let header;
  let payload;
  if (kind === 'inclusion') {
    if (treeSize2 !== undefined) fail('mintMmrReceipt: an inclusion receipt must not carry treeSize2');
    if (!Number.isSafeInteger(index) || index < 0) fail('mintMmrReceipt: inclusion index must be a safe non-negative integer');
    if (decodeNodeBytes(nodeHash, entry.nodeSize) === null) {
      fail(`mintMmrReceipt: inclusion nodeHash must be a base64url string of exactly ${entry.nodeSize} bytes`);
    }
    if (!Array.isArray(path)) fail('mintMmrReceipt: inclusion path must be an array');
    for (const element of path) {
      if (decodeNodeBytes(element, entry.nodeSize) === null) {
        fail(`mintMmrReceipt: inclusion path element must be a base64url string of exactly ${entry.nodeSize} bytes`);
      }
    }
    header = { typ: MMR_TYP, alg, vds, canonicalization: MMR_CANONICALIZATION_JCS };
    payload = { kind, index, nodeHash, path: [...path] };
  } else {
    if (!Number.isSafeInteger(treeSize2) || treeSize2 < 1) {
      fail('mintMmrReceipt: a consistency receipt needs treeSize2 >= 1 in the protected header');
    }
    if (!Array.isArray(proofs) || proofs.length === 0) {
      fail('mintMmrReceipt: a consistency receipt needs a non-empty proofs array');
    }
    for (const proof of proofs) {
      if (!isPlainObject(proof)) fail('mintMmrReceipt: each consistency proof must be an object');
      for (const key of Object.keys(proof)) {
        if (!MMR_CONSISTENCY_PROOF_FIELDS.includes(key)) fail(`mintMmrReceipt: consistency proof has unknown field '${key}'`);
      }
      if (!Number.isSafeInteger(proof.treeSize1) || proof.treeSize1 < 0) fail('mintMmrReceipt: consistency proof treeSize1 must be a safe non-negative integer');
      if (!Number.isSafeInteger(proof.treeSize2) || proof.treeSize2 < 1) fail('mintMmrReceipt: consistency proof treeSize2 must be a safe integer >= 1');
      if (!Array.isArray(proof.paths)) fail('mintMmrReceipt: consistency proof paths must be an array');
      if (!Array.isArray(proof.rightPeaks)) fail('mintMmrReceipt: consistency proof rightPeaks must be an array');
      for (const pathElements of proof.paths) {
        if (!Array.isArray(pathElements)) fail('mintMmrReceipt: consistency proof path must be an array of base64url strings');
        for (const element of pathElements) {
          if (decodeNodeBytes(element, entry.nodeSize) === null) {
            fail(`mintMmrReceipt: consistency proof path element must be a base64url string of exactly ${entry.nodeSize} bytes`);
          }
        }
      }
      for (const peak of proof.rightPeaks) {
        if (decodeNodeBytes(peak, entry.nodeSize) === null) {
          fail(`mintMmrReceipt: consistency proof rightPeak must be a base64url string of exactly ${entry.nodeSize} bytes`);
        }
      }
    }
    if (proofs[proofs.length - 1].treeSize2 !== treeSize2) {
      fail('mintMmrReceipt: header treeSize2 must equal the last proof\'s treeSize2');
    }
    header = { typ: MMR_TYP, alg, vds, canonicalization: MMR_CANONICALIZATION_JCS, treeSize2 };
    payload = { kind, proofs: proofs.map((proof) => ({ ...proof, paths: proof.paths.map((p) => [...p]), rightPeaks: [...proof.rightPeaks] })) };
  }
  const record = { header, payload };
  let signature;
  if (alg === MMR_ALG_ED25519) {
    const signatureBytes = signEd25519(record);
    if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length !== ED25519_SIGNATURE_BYTES) {
      fail(`mintMmrReceipt: signEd25519 must return exactly ${ED25519_SIGNATURE_BYTES} bytes`);
    }
    signature = base64urlEncode(signatureBytes);
  } else {
    const ed25519Bytes = signEd25519(record);
    if (!(ed25519Bytes instanceof Uint8Array) || ed25519Bytes.length !== ED25519_SIGNATURE_BYTES) {
      fail(`mintMmrReceipt: signEd25519 must return exactly ${ED25519_SIGNATURE_BYTES} bytes`);
    }
    const dsaBytes = signMlDsa65(record);
    if (!(dsaBytes instanceof Uint8Array) || dsaBytes.length !== ML_DSA_65_SIGNATURE_BYTES) {
      fail(`mintMmrReceipt: signMlDsa65 must return exactly ${ML_DSA_65_SIGNATURE_BYTES} bytes`);
    }
    signature = hybridSignatureRecord(ed25519Bytes, dsaBytes);
  }
  const receipt = { header, payload, signature };
  // Re-verify the fresh signature before returning: a mint that
  // cannot verify is never handed out.
  const check = verifyReceiptSignature(record, header, signature, { ed25519PublicKey, mlDsa65PublicKey });
  if (!check.ok) {
    fail(`mintMmrReceipt: fresh signature failed to verify (${check.outcome}: ${check.reasons.join('; ')})`);
  }
  return { receipt, signingInput: pedigreeCanonicalText(record) };
}

// ---------------------------------------------------------------------------
// Verification — draft §5.1 (inclusion), §7.1 (consistency)
// ---------------------------------------------------------------------------

/**
 * Shared pre-steps for both receipt kinds. Returns a working
 * object or a failure result:
 *   { ok: false, outcome, reasons, ... } on any refusal, or
 *   { ok: true, receipt, header, payload, signature, record, entry,
 *     registry, trustedState, requireTrustedState, keys }
 * Order (NCPS verify-first, documented in the header): parse ->
 * shape -> registry (unknown vds, incomplete proofs) -> node-size
 * checks -> trusted-state requirement and binding -> signature ->
 * (caller runs the proof math).
 * `opts`: { trustedState, requireTrustedState, registry, keys }.
 * `keys`: { ed25519PublicKey (JWK, required), mlDsa65PublicKey
 * (KeyObject or SPKI DER hex, hybrid only) }.
 */
function verifyReceiptPreamble(receipt, opts, kind) {
  if (!isPlainObject(opts)) {
    return failResult('malformed', ['verification options must be an object']);
  }
  const registry = opts.registry ?? MMR_VDS_REGISTRY;
  if (!isPlainObject(registry)) {
    return failResult('malformed', ['registry must be an object']);
  }
  if (opts.requireTrustedState !== undefined && typeof opts.requireTrustedState !== 'boolean') {
    return failResult('malformed', ['requireTrustedState must be a boolean']);
  }
  let trustedState = null;
  if (opts.trustedState !== undefined && opts.trustedState !== null) {
    const checked = validateTrustedState(opts.trustedState, registry);
    if (!checked.ok) {
      return failResult('malformed', [`trustedState is invalid: ${checked.reasons.join('; ')}`]);
    }
    trustedState = opts.trustedState;
  }
  if (opts.requireTrustedState === true && trustedState === null) {
    return failResult('trusted_state_required', ['requireTrustedState is set but no trustedState was supplied — refusing rather than defaulting']);
  }
  const parsed = parseReceiptInput(receipt);
  if (!parsed.ok) return failResult('malformed', parsed.reasons);
  const shape = validateReceiptShape(parsed.receipt);
  if (!shape.ok) return failResult('malformed', shape.reasons);
  if (shape.kind !== kind) {
    return failResult('malformed', [`receipt kind is '${shape.kind}' but this verifier handles '${kind}' receipts`]);
  }
  const { header, payload, signature } = shape;
  // Registry lookup: distinguish "the vds is not registered at
  // all" (unknown_vds) from "the vds is registered but its entry
  // is incomplete or invalid" (registry_incomplete, §12.1.2) —
  // the two failures have different remedies.
  if (registry[header.vds] === undefined) {
    return failResult('unknown_vds', [`VDS '${header.vds}' is not registered`]);
  }
  const entryCheck = validateMmrVdsEntry(registry[header.vds]);
  if (!entryCheck.ok) {
    return failResult('registry_incomplete', [`registered VDS '${header.vds}' is incomplete or invalid (§12.1.2): ${entryCheck.reasons.join('; ')}`]);
  }
  const entry = registry[header.vds];
  const completeness = checkRegistryCompleteness(registry);
  if (!completeness.complete) {
    const missing = completeness.missing.map((m) => `${m.vds} missing ${m.missing.join('/')}`).join('; ');
    return failResult('registry_incomplete', [`registry is incomplete (§12.1.2): ${missing}`]);
  }
  // Node-size checks on every node value the receipt carries,
  // before any trust or signature comparison (a receipt whose
  // proof elements are the wrong size can never verify).
  const nodeSizeReasons = [];
  if (kind === 'inclusion') {
    if (decodeNodeBytes(payload.nodeHash, entry.nodeSize) === null) {
      nodeSizeReasons.push(`inclusion nodeHash must be a strict base64url string of exactly ${entry.nodeSize} bytes`);
    }
    for (const [index, element] of payload.path.entries()) {
      if (decodeNodeBytes(element, entry.nodeSize) === null) {
        nodeSizeReasons.push(`inclusion path[${index}] must be a strict base64url string of exactly ${entry.nodeSize} bytes`);
      }
    }
  } else {
    for (const [proofIndex, proof] of payload.proofs.entries()) {
      if (!isPlainObject(proof)) {
        nodeSizeReasons.push(`consistency proofs[${proofIndex}] must be an object`);
        continue;
      }
      for (const key of Object.keys(proof)) {
        if (!MMR_CONSISTENCY_PROOF_FIELDS.includes(key)) nodeSizeReasons.push(`consistency proofs[${proofIndex}] has unknown field '${key}'`);
      }
      if (!Number.isSafeInteger(proof.treeSize1) || proof.treeSize1 < 0) {
        nodeSizeReasons.push(`consistency proofs[${proofIndex}].treeSize1 must be a safe non-negative integer`);
      }
      if (!Number.isSafeInteger(proof.treeSize2) || proof.treeSize2 < 1) {
        nodeSizeReasons.push(`consistency proofs[${proofIndex}].treeSize2 must be a safe integer >= 1`);
      }
      if (!Array.isArray(proof.paths)) nodeSizeReasons.push(`consistency proofs[${proofIndex}].paths must be an array`);
      if (!Array.isArray(proof.rightPeaks)) nodeSizeReasons.push(`consistency proofs[${proofIndex}].rightPeaks must be an array`);
      if (Array.isArray(proof.paths)) {
        for (const [pathIndex, pathElements] of proof.paths.entries()) {
          if (!Array.isArray(pathElements)) {
            nodeSizeReasons.push(`consistency proofs[${proofIndex}].paths[${pathIndex}] must be an array of base64url strings`);
            continue;
          }
          for (const [elementIndex, element] of pathElements.entries()) {
            if (decodeNodeBytes(element, entry.nodeSize) === null) {
              nodeSizeReasons.push(`consistency proofs[${proofIndex}].paths[${pathIndex}][${elementIndex}] must be a strict base64url string of exactly ${entry.nodeSize} bytes`);
            }
          }
        }
      }
      if (Array.isArray(proof.rightPeaks)) {
        for (const [peakIndex, peak] of proof.rightPeaks.entries()) {
          if (decodeNodeBytes(peak, entry.nodeSize) === null) {
            nodeSizeReasons.push(`consistency proofs[${proofIndex}].rightPeaks[${peakIndex}] must be a strict base64url string of exactly ${entry.nodeSize} bytes`);
          }
        }
      }
    }
  }
  if (nodeSizeReasons.length > 0) {
    return failResult('invalid_node_size', nodeSizeReasons);
  }
  // Canonicalization: only the implemented JCS form verifies.
  // A receipt naming deterministic CBOR is recognized (it is a
  // registered canonicalization name) and refused, never silently
  // re-interpreted as JCS.
  if (header.canonicalization !== MMR_CANONICALIZATION_JCS) {
    return failResult('canonicalization_mismatch', [`receipt canonicalization '${header.canonicalization}' is not implemented — this module verifies only '${MMR_CANONICALIZATION_JCS}'`]);
  }
  // Trusted-state binding (the comparison itself; the bootstrap
  // for an empty state happens in the consistency verifier, which
  // supplies the receipt's own values as the effective state).
  const binding = checkTrustedStateBinding(trustedState ?? createEmptyTrustedState(), receiptProtectedValues(header, entry));
  if (!binding.ok) return failResult(binding.outcome, binding.reasons);
  // Signature, before the proof math (NCPS verify-first).
  const record = { header, payload };
  const signatureCheck = verifyReceiptSignature(record, header, signature, opts.keys ?? {});
  if (!signatureCheck.ok) return failResult(signatureCheck.outcome, signatureCheck.reasons);
  return {
    ok: true,
    receipt: parsed.receipt,
    header,
    payload,
    signature,
    record,
    entry,
    registry,
    trustedState,
    requireTrustedState: opts.requireTrustedState === true,
    keys: opts.keys ?? {},
  };
}

/**
 * Verify a receipt of inclusion (draft §5.1). Returns
 * { ok, outcome, reasons, signatureVerified, peak, index,
 *   trustedStateBound, trustedStateBootstrapped, trustedState }.
 * The peak is recomputed with included_root (§5.2) from the
 * proof — never taken from the receipt — and, when the trusted
 * state holds an accumulator, the peak MUST be a member of it
 * (§5.1). An inclusion receipt does NOT bootstrap an empty
 * trusted state and does NOT advance it; it only binds against
 * what the caller already holds (trustedStateBound: true when a
 * state was supplied and the receipt's protected values matched
 * it; false when no state was supplied).
 */
export function verifyMmrInclusionReceipt(receipt, opts = {}) {
  const preamble = verifyReceiptPreamble(receipt, opts, 'inclusion');
  if (!preamble.ok) return preamble;
  const { header, payload, entry, trustedState } = preamble;
  const nodeHash = decodeNodeBytes(payload.nodeHash, entry.nodeSize);
  const path = payload.path.map((element) => decodeNodeBytes(element, entry.nodeSize));
  let peak;
  try {
    peak = mmrIncludedRoot(entry, payload.index, nodeHash, path);
  } catch (error) {
    return failResult('proof_shape_mismatch', [`included_root failed: ${error.message}`], { signatureVerified: true });
  }
  const peakBase64url = base64urlEncode(peak);
  let bound = false;
  if (trustedState !== null) {
    bound = true;
    if (trustedState.accumulator.length > 0) {
      const member = trustedState.accumulator.some((value) => constantTimeEqualStrings(value, peakBase64url));
      if (!member) {
        return failResult('peak_mismatch', ['the recomputed peak is not a member of the trusted accumulator'], { signatureVerified: true, trustedStateBound: true, peak: peakBase64url, index: payload.index });
      }
    } else if (trustedState.treeSize > 0) {
      return failResult('peak_mismatch', ['trusted state holds a tree size but an empty accumulator'], { signatureVerified: true, trustedStateBound: true, peak: peakBase64url, index: payload.index });
    }
    // treeSize 0 + empty accumulator: the state pins the algorithm
    // only (no peak to check against); the receipt binds to it.
  }
  return {
    ok: true,
    outcome: 'verified',
    reasons: [],
    signatureVerified: true,
    peak: peakBase64url,
    index: payload.index,
    trustedStateBound: bound,
    trustedStateBootstrapped: false,
    trustedState: trustedStateSnapshot(trustedState),
  };
}

/**
 * Verify a receipt of consistency (draft §7.1). Returns
 * { ok, outcome, reasons, signatureVerified, newTreeSize,
 *   newAccumulator, trustedStateBound, trustedStateBootstrapped,
 *   trustedState }.
 * Steps 1-7, in the draft's order but with the NCPS verify-first
 * signature (see the module header): the protected header is
 * decoded (tree-size-2 present — enforced by the shape check);
 * the protected vds MUST equal the trusted vds; the protected
 * tree-size-2 MUST equal the last proof's tree-size-2; the first
 * proof's tree-size-1 MUST equal the trusted tree size; every
 * proof applies consistent_roots (§7.1.1) and its right-peaks
 * length MUST equal nright; the final accumulator is the detached
 * payload (recomputed, never taken from the receipt); the
 * signature is verified over it. Trusted state advances only on
 * full success, and only forwards.
 *
 * EMPTY-TREE BOOTSTRAP (§7.1, §11.4): when the caller's trusted
 * state is empty, the vds, hashAlg, canonicalizationAlg and
 * signatureProfile are taken from THIS receipt's protected header
 * — staged in working variables, committed to the caller's state
 * object only after the whole receipt verifies — and are NEVER
 * re-taken from a later receipt. The bootstrap is reported in
 * trustedStateBootstrapped: true.
 */
export function verifyMmrConsistencyReceipt(receipt, opts = {}) {
  if (!isPlainObject(opts)) {
    return failResult('malformed', ['verification options must be an object']);
  }
  // The bootstrap needs the receipt's protected values BEFORE the
  // preamble's binding check, so an empty state is staged as a
  // working copy first: the preamble then compares against the
  // working values (which are the receipt's own — the comparison
  // passes trivially) and the real commit happens only below, on
  // full success. A receipt that fails at any step leaves the
  // caller's state untouched.
  let workingTrustedState = null;
  let bootstrapping = false;
  if (opts.trustedState !== undefined && opts.trustedState !== null) {
    const registry = opts.registry ?? MMR_VDS_REGISTRY;
    const checked = validateTrustedState(opts.trustedState, registry);
    if (!checked.ok) {
      return failResult('malformed', [`trustedState is invalid: ${checked.reasons.join('; ')}`]);
    }
    if (isEmptyTrustedState(opts.trustedState)) {
      const parsed = parseReceiptInput(receipt);
      if (!parsed.ok) return failResult('malformed', parsed.reasons);
      const shape = validateReceiptShape(parsed.receipt);
      if (!shape.ok) return failResult('malformed', shape.reasons);
      const lookedUp = lookupMmrVds(registry, shape.header.vds);
      if (!lookedUp.found) return failResult('unknown_vds', lookedUp.reasons);
      workingTrustedState = {
        vds: shape.header.vds,
        hashAlg: lookedUp.entry.hashAlg,
        canonicalizationAlg: shape.header.canonicalization,
        signatureProfile: shape.header.alg === MMR_ALG_HYBRID ? 'hybrid' : 'ed25519',
        treeSize: 0,
        accumulator: [],
      };
      bootstrapping = true;
    }
  }
  const preambleOpts = bootstrapping
    ? { ...opts, trustedState: workingTrustedState }
    : opts;
  const preamble = verifyReceiptPreamble(receipt, preambleOpts, 'consistency');
  if (!preamble.ok) return preamble;
  const { header, payload, entry, trustedState } = preamble;
  // Effective state for the proof math: the caller's state, or
  // the bootstrapped working values.
  const effectiveState = trustedState ?? workingTrustedState ?? createEmptyTrustedState();
  const sizeFrom0 = effectiveState.treeSize;
  const accumulatorFrom0 = effectiveState.accumulator.map((value) => decodeNodeBytes(value, entry.nodeSize));
  // Draft §7.1 steps 3-5: tree-size-2 and the first tree-size-1.
  if (payload.proofs.length === 0) {
    return failResult('proof_shape_mismatch', ['consistency proofs must be non-empty'], { signatureVerified: true, trustedStateBound: trustedState !== null, trustedStateBootstrapped: false });
  }
  const lastProof = payload.proofs[payload.proofs.length - 1];
  if (header.treeSize2 !== lastProof.treeSize2) {
    return failResult('tree_size_mismatch', [`protected tree-size-2 ${header.treeSize2} does not equal the last proof's tree-size-2 ${lastProof.treeSize2}`], { signatureVerified: true, trustedStateBound: trustedState !== null, trustedStateBootstrapped: false });
  }
  if (payload.proofs[0].treeSize1 !== sizeFrom0) {
    return failResult('tree_size_mismatch', [`first proof's tree-size-1 ${payload.proofs[0].treeSize1} does not equal the trusted tree size ${sizeFrom0} — trusted state advances forward-only (§7.1)`], { signatureVerified: true, trustedStateBound: trustedState !== null, trustedStateBootstrapped: false });
  }
  // Draft §7.1 steps 6-7: apply consistent_roots to every proof.
  let sizeFrom = sizeFrom0;
  let accumulatorFrom = accumulatorFrom0;
  for (const [proofIndex, proof] of payload.proofs.entries()) {
    if (proof.treeSize1 !== sizeFrom) {
      return failResult('tree_size_mismatch', [`proof ${proofIndex} tree-size-1 ${proof.treeSize1} does not equal the running tree size ${sizeFrom}`], { signatureVerified: true, trustedStateBound: trustedState !== null, trustedStateBootstrapped: false });
    }
    if (proof.treeSize2 !== header.treeSize2) {
      return failResult('tree_size_mismatch', [`proof ${proofIndex} tree-size-2 ${proof.treeSize2} does not equal the protected tree-size-2 ${header.treeSize2}`], { signatureVerified: true, trustedStateBound: trustedState !== null, trustedStateBootstrapped: false });
    }
    const paths = proof.paths.map((pathElements) => pathElements.map((element) => decodeNodeBytes(element, entry.nodeSize)));
    const rootsResult = mmrConsistentRoots(entry, proof.treeSize1, proof.treeSize2, accumulatorFrom, paths);
    if (!rootsResult.ok) {
      return failResult('proof_shape_mismatch', [`proof ${proofIndex}: ${rootsResult.reasons.join('; ')}`], { signatureVerified: true, trustedStateBound: trustedState !== null, trustedStateBootstrapped: false });
    }
    const rightPeaks = proof.rightPeaks.map((value) => decodeNodeBytes(value, entry.nodeSize));
    if (rightPeaks.length !== rootsResult.nright) {
      return failResult('proof_shape_mismatch', [`proof ${proofIndex} right-peaks length ${rightPeaks.length} does not equal nright ${rootsResult.nright}`], { signatureVerified: true, trustedStateBound: trustedState !== null, trustedStateBootstrapped: false });
    }
    accumulatorFrom = [...rootsResult.roots, ...rightPeaks];
    sizeFrom = proof.treeSize2;
  }
  const newAccumulator = accumulatorFrom.map((value) => base64urlEncode(value));
  // Commit, only now, on full success: the bootstrap values plus
  // the advanced tree size and accumulator. A failure above leaves
  // the caller's state exactly as it was.
  if (opts.trustedState !== undefined && opts.trustedState !== null) {
    opts.trustedState.vds = effectiveState.vds;
    opts.trustedState.hashAlg = effectiveState.hashAlg;
    opts.trustedState.canonicalizationAlg = effectiveState.canonicalizationAlg;
    opts.trustedState.signatureProfile = effectiveState.signatureProfile;
    opts.trustedState.treeSize = sizeFrom;
    opts.trustedState.accumulator = [...newAccumulator];
  }
  return {
    ok: true,
    outcome: 'verified',
    reasons: [],
    signatureVerified: true,
    newTreeSize: sizeFrom,
    newAccumulator,
    trustedStateBound: opts.trustedState !== undefined && opts.trustedState !== null,
    trustedStateBootstrapped: bootstrapping,
    trustedState: trustedStateSnapshot(opts.trustedState ?? effectiveState),
  };
}

/**
 * Verify a chain of consistency receipts against ONE trusted
 * state, in order (draft §7.1, applied repeatedly). Stops at the
 * first failure and returns { ok, outcome, reasons, results,
 * failedAt, finalTrustedState }. The caller's trusted state is
 * advanced only by receipts that verify; a failing receipt leaves
 * it at the last verified receipt's state. A chain requires a
 * trusted state object (create one with createTrustedState or
 * createEmptyTrustedState); without one the chain is refused,
 * never defaulted.
 */
export function verifyMmrReceiptChain(receipts, opts = {}) {
  if (!Array.isArray(receipts)) {
    return { ok: false, outcome: 'malformed', reasons: ['receipts must be an array'], results: [], failedAt: null, finalTrustedState: null };
  }
  if (!isPlainObject(opts) || opts.trustedState === undefined || opts.trustedState === null) {
    return { ok: false, outcome: 'trusted_state_required', reasons: ['a receipt chain requires a trusted state object (create one with createTrustedState or createEmptyTrustedState) — refusing rather than defaulting'], results: [], failedAt: null, finalTrustedState: null };
  }
  const results = [];
  for (let index = 0; index < receipts.length; index += 1) {
    const result = verifyMmrConsistencyReceipt(receipts[index], opts);
    results.push(result);
    if (!result.ok) {
      return {
        ok: false,
        outcome: result.outcome,
        reasons: [`receipt ${index}: ${result.reasons.join('; ')}`],
        results,
        failedAt: index,
        finalTrustedState: trustedStateSnapshot(opts.trustedState),
      };
    }
  }
  return {
    ok: true,
    outcome: 'verified',
    reasons: [],
    results,
    failedAt: null,
    finalTrustedState: trustedStateSnapshot(opts.trustedState),
  };
}
