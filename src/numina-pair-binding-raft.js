// numina-pair-binding-raft.js — pair-binding Raft engine on the hybrid PQC path.
//
// Adopted Nov 15, 2026 from the filed engine (~/workspace/your_files/
// pair-binding-raft-2026-11-15/rafting-resilience.mjs) with its three
// flaws fixed:
//
//   1. PINNED KEYS. The filed engine verified two signatures against the
//      keys named inside the document itself, so any fresh keypair passed.
//      This engine takes authority ONLY from the pinned keys in its
//      protocol configuration (numina-protocol.json by default): the
//      document's attestation keys must equal the pinned Authority /
//      Guardian Ed25519 keys, and both hybrid signatures are verified
//      against those pinned keys. A document that names its own keys, or
//      copies the pinned keys without the private keys, is rejected.
//   2. HYBRID VERIFICATION. The filed engine was Ed25519-only. Here both
//      the Ed25519 part and the ML-DSA-65 part (NIST FIPS 204) must verify
//      over the SAME RFC 8785 canonical bytes, through the existing PQC
//      module (src/numina-protocol-pqc.js). An unprovisioned ML-DSA-65
//      key (null in the protocol file) fails closed — no downgrade to
//      Ed25519-only, ever.
//   3. ONE CANONICALIZER. The filed engine used `canonical-json`; this
//      module uses the clone's `canonicalize` package, the same one
//      src/numina-protocol-verify.js uses, so signatures verify across
//      the same bytes everywhere. No `canonical-json`, no ajv — envelope
//      validation is plain code mirroring src/pair-binding.schema.json.
//
// v1.1.0 (Nov 15, 2026, owner-directed NOPair binding work):
//   - Multi-algorithm signature arrays: each attestation may carry a
//     `signatures` array with exactly one Ed25519 entry and one
//     ML-DSA-65 entry, instead of the legacy `hybridSignature` bundle
//     or record. Both entries are verified over the same canonical
//     bytes against the pinned keys for the role.
//   - Node-identity binding: raftContext.originNodeId /
//     counterpartyNodeId sit inside the SIGNED bytes; each attestation's
//     nodeId must equal the signed node id for its role; the two node
//     ids must be distinct; leaderId must be one of the two node ids.
//     A compromised node cannot claim another node's id: the id is
//     covered by the signature and the key is pinned.
//   - Transport frame bound: the canonical serialized envelope must fit
//     in a 16,384-byte (16 KiB) frame (PAIR_BINDING_MAX_FRAME_BYTES).
//     Larger envelopes are rejected so post-quantum signatures and keys
//     are never truncated. The engine's append path is the only frame
//     boundary that exists in code; there is no separate transport
//     layer to enforce it in.
//
// v1.2.0 (Nov 18, 2026, owner-directed NOPair binding work):
//   - Strict predecessor hash-chaining: raftContext.prevEntryHash is
//     the SHA-256 digest (64 lowercase hex) of the immediately
//     preceding committed log entry's unsigned envelope. The genesis
//     (first) entry's predecessor is the all-zero 64-hex-character
//     hash ('00' repeated 32 times, PAIR_BINDING_GENESIS_PREV_ENTRY_HASH).
//     processEntry enforces it AFTER index monotonicity and BEFORE
//     hybrid signature verification (a wrong predecessor is a
//     chain-integrity failure, cheap to check before crypto): mismatch
//     returns PREV_ENTRY_HASH_MISMATCH with expected and received
//     hashes and commits nothing. The expected hash is always the
//     stored digest of the last committed entry in this.stateLog (or
//     the all-zero hash when the log is empty) — never a
//     caller-supplied "previous digest". prevEntryHash sits inside
//     the signed bytes (raftContext), so the digest of an entry
//     automatically covers its predecessor link, and the committed
//     log entry stores prevEntryHash alongside its digest.
//
// What this engine IS: single-node validation of a pair-binding envelope
// plus an append-only in-memory log. What it is NOT: full Raft (no leader
// election, no log replication, no persistence), NOT Byzantine-fault
// tolerant, and it makes NO finality guarantees beyond "this node accepted
// and logged the entry". There are no zero-knowledge proofs and no formal
// verification here; the checks are fail-closed code, not a proof.
// There is also no append-entries RPC layer and no heartbeat protocol:
// leader election payloads, append-entries RPCs, and heartbeat scaling
// are design requirements for the multi-node transport build (see the
// NOPair binding spec), not properties of this engine.
//
// RSA: the consensus path uses no RSA anywhere — Ed25519 + ML-DSA-65
// only, verified by grep Nov 15, 2026. The only RSA in the clone is
// GitHub OIDC JWT verification (RS256) in src/control-http.js, which is
// control-plane authentication, not consensus; nothing was decoupled
// because there was nothing to decouple.
//
// The authorship block (owner "Samuel J. Kott", entity "Numina Labs",
// controlPercentage 100) is a PAYLOAD ASSERTION enforced by this engine.
// It is not a cryptographic proof of ownership: a signature proves the
// pinned key signed the document, not who owns the company.
//
// Endianness: this module defines NO new byte layout. The only multi-byte
// layout it touches is the existing NPQ1 hybrid signature bundle, whose
// length prefixes are big-endian (see src/numina-protocol-pqc.js and the
// `endianness` section of numina-protocol.json). The primitives' own
// encodings are LABELED EXCEPTIONS, never re-encoded: Ed25519 field
// elements/scalars are little-endian per RFC 8032; ML-DSA byte encodings
// are as FIPS 204 defines them.
//
// This module never signs, never generates keys, and never holds a private
// key. Signing is the owner's act, through the existing PQC sign helpers
// with keys supplied at runtime; tests use ephemeral keypairs only.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  canonicalBytes,
  hex,
  loadProtocol,
  verifySignature,
} from './numina-protocol-verify.js';
import {
  HYBRID_SIGNATURE_SCHEMA,
  ML_DSA_65_SIGNATURE_BYTES,
  HYBRID_BUNDLE_BYTES,
  pqcPublicKeyForRole,
  verifyHybridAuthoritySignature,
  verifyHybridGuardianSignature,
  verifyMlDsa65,
} from './numina-protocol-pqc.js';
import { defaultMetrology } from './numina-metrology.js';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'pair-binding.schema.json');

export const PAIR_BINDING_SCHEMA_VERSION = '1.2.0';
// Genesis predecessor: the all-zero 64-hex-character SHA-256 hash
// ('00' repeated 32 times). The first entry in an empty log must name
// this as its prevEntryHash; any other value on an empty log fails
// with PREV_ENTRY_HASH_MISMATCH.
export const PAIR_BINDING_GENESIS_PREV_ENTRY_HASH = '00'.repeat(32);
export const PAIR_BINDING_SOLE_OWNER = 'Samuel J. Kott';
export const PAIR_BINDING_ENTITY = 'Numina Labs';
export const PAIR_BINDING_CONTROL_PERCENTAGE = 100;
// Minimum MTU for transport frames carrying a pair-binding envelope:
// 16,384 bytes (16 KiB). A worst-case envelope — both ML-DSA-65
// signatures (3,309 B each) plus both Ed25519 signatures and keys, in
// any of the three signature forms — is about 14.5 KB with a small
// payload and fits inside it. The ML-DSA-65 public keys (1,974 B SPKI
// each) are pinned, not transmitted: inlining them would push the
// envelope to about 22.5 KB, past this bound. Anything larger is
// rejected, never truncated.
export const PAIR_BINDING_MAX_FRAME_BYTES = 16384;
export const PAIR_BINDING_SIGNATURE_ALGORITHMS = ['ed25519', 'ml-dsa-65'];

const NONCE_PATTERN = /^[a-f0-9]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ED25519_PUBLIC_KEY_PATTERN = /^[a-f0-9]{64}$/;
const ED25519_SIGNATURE_PATTERN = /^[a-f0-9]{128}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const ML_DSA_65_SIGNATURE_PATTERN = new RegExp(`^[a-f0-9]{${ML_DSA_65_SIGNATURE_BYTES * 2}}$`);
const HYBRID_BUNDLE_HEX_PATTERN = new RegExp(`^[a-f0-9]{${HYBRID_BUNDLE_BYTES * 2}}$`);

/** Load the pair-binding envelope schema (data file, JSON). */
export function loadPairBindingSchema(path = SCHEMA_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(value, k));
}

function isValidHybridSignature(value) {
  if (typeof value === 'string') return HYBRID_BUNDLE_HEX_PATTERN.test(value);
  if (isPlainObject(value)) {
    return (
      hasExactKeys(value, ['schema', 'ed25519Signature', 'mlDsa65Signature']) &&
      value.schema === HYBRID_SIGNATURE_SCHEMA &&
      typeof value.ed25519Signature === 'string' &&
      ED25519_SIGNATURE_PATTERN.test(value.ed25519Signature) &&
      typeof value.mlDsa65Signature === 'string' &&
      ML_DSA_65_SIGNATURE_PATTERN.test(value.mlDsa65Signature)
    );
  }
  return false;
}

/**
 * Validate the multi-algorithm signature array: exactly two entries, one
 * Ed25519 and one ML-DSA-65, each with the right algorithm, signature
 * length, and public-key shape. The ML-DSA-65 public key must carry the
 * FIPS 204 SPKI DER prefix. Returns the two entries { ed25519, mlDsa65 }
 * or null.
 */
function parseSignatureArray(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  let ed25519 = null;
  let mlDsa65 = null;
  for (const entry of value) {
    if (!isPlainObject(entry)) return null;
    if (entry.algorithm === 'ed25519') {
      if (ed25519 !== null) return null; // duplicate algorithm
      if (!hasExactKeys(entry, ['algorithm', 'signature', 'publicKey'])) return null;
      if (
        typeof entry.signature !== 'string' ||
        !ED25519_SIGNATURE_PATTERN.test(entry.signature) ||
        typeof entry.publicKey !== 'string' ||
        !ED25519_PUBLIC_KEY_PATTERN.test(entry.publicKey)
      ) {
        return null;
      }
      ed25519 = entry;
    } else if (entry.algorithm === 'ml-dsa-65') {
      if (mlDsa65 !== null) return null; // duplicate algorithm
      // The ML-DSA-65 entry carries the signature only. Its public key
      // is pinned in the protocol configuration for the role and is never
      // transmitted: inlining both 1,974-byte SPKI keys would push the
      // envelope past the 16,384-byte frame bound (about 22.5 KB).
      if (!hasExactKeys(entry, ['algorithm', 'signature'])) return null;
      if (
        typeof entry.signature !== 'string' ||
        !ML_DSA_65_SIGNATURE_PATTERN.test(entry.signature)
      ) {
        return null;
      }
      mlDsa65 = entry;
    } else {
      return null; // unknown algorithm
    }
  }
  if (ed25519 === null || mlDsa65 === null) return null; // one algorithm missing
  return { ed25519, mlDsa65 };
}

/**
 * Validate one attestation structurally: publicKey + nodeId + exactly
 * one signature form (legacy hybridSignature or the signatures array).
 * In array form the Ed25519 entry's public key must equal the
 * attestation's publicKey — the two fields name the same key.
 * Returns issues (possibly empty); the parsed array, when present, is
 * returned so the caller does not re-parse it.
 */
function validateAttestation(attestation, role) {
  const issues = [];
  if (!isPlainObject(attestation)) return { issues: [`attestations.${role} must be an object`], array: null };
  const keys = Object.keys(attestation);
  const hasHybrid = Object.prototype.hasOwnProperty.call(attestation, 'hybridSignature');
  const hasArray = Object.prototype.hasOwnProperty.call(attestation, 'signatures');
  if (
    keys.length !== 3 ||
    !Object.prototype.hasOwnProperty.call(attestation, 'publicKey') ||
    !Object.prototype.hasOwnProperty.call(attestation, 'nodeId') ||
    hasHybrid === hasArray
  ) {
    issues.push(
      `attestations.${role} must have exactly publicKey, nodeId, and one of hybridSignature or signatures`,
    );
    return { issues, array: null };
  }
  if (typeof attestation.publicKey !== 'string' || !ED25519_PUBLIC_KEY_PATTERN.test(attestation.publicKey)) {
    issues.push(`attestations.${role}.publicKey must be 64 lowercase hex characters`);
  }
  if (typeof attestation.nodeId !== 'string' || attestation.nodeId.length === 0) {
    issues.push(`attestations.${role}.nodeId must be a non-empty string`);
  }
  let array = null;
  if (hasHybrid) {
    if (!isValidHybridSignature(attestation.hybridSignature)) {
      issues.push(
        `attestations.${role}.hybridSignature must be a hybrid signature record or a ${HYBRID_BUNDLE_BYTES}-byte bundle hex`,
      );
    }
  } else {
    array = parseSignatureArray(attestation.signatures);
    if (array === null) {
      issues.push(
        `attestations.${role}.signatures must be exactly one Ed25519 entry and one ML-DSA-65 entry`,
      );
    } else if (array.ed25519.publicKey.toLowerCase() !== attestation.publicKey.toLowerCase()) {
      issues.push(
        `attestations.${role}.signatures Ed25519 entry publicKey must equal the attestation publicKey`,
      );
    }
  }
  return { issues, array };
}

/**
 * Validate a pair-binding envelope structurally, in plain code, mirroring
 * src/pair-binding.schema.json (no ajv in this clone). Returns
 * { ok: true, issues: [] } or { ok: false, issues: [...] }.
 * Authorship SHAPE is checked here; authorship VALUES are enforced by
 * processEntry's authorship step, so the two failures stay distinct.
 * This function never throws.
 */
export function validatePairBindingEnvelope(document) {
  const issues = [];
  if (!isPlainObject(document)) return { ok: false, issues: ['document must be an object'] };
  if (
    !hasExactKeys(document, [
      'version',
      'timestamp',
      'nonce',
      'authorship',
      'raftContext',
      'payload',
      'attestations',
    ])
  ) {
    issues.push(
      'document must have exactly version, timestamp, nonce, authorship, raftContext, payload, attestations',
    );
  }
  if (document.version !== PAIR_BINDING_SCHEMA_VERSION) {
    issues.push(`version must be '${PAIR_BINDING_SCHEMA_VERSION}'`);
  }
  if (
    typeof document.timestamp !== 'string' ||
    !TIMESTAMP_PATTERN.test(document.timestamp) ||
    Number.isNaN(Date.parse(document.timestamp))
  ) {
    issues.push('timestamp must be an ISO 8601 date-time string');
  }
  if (typeof document.nonce !== 'string' || !NONCE_PATTERN.test(document.nonce)) {
    issues.push('nonce must be 32 lowercase hex characters');
  }
  const authorship = document.authorship;
  if (!hasExactKeys(authorship, ['owner', 'entity', 'controlPercentage'])) {
    issues.push('authorship must have exactly owner, entity, controlPercentage');
  } else {
    if (typeof authorship.owner !== 'string' || authorship.owner.length === 0) {
      issues.push('authorship.owner must be a non-empty string');
    }
    if (typeof authorship.entity !== 'string' || authorship.entity.length === 0) {
      issues.push('authorship.entity must be a non-empty string');
    }
    if (typeof authorship.controlPercentage !== 'number') {
      issues.push('authorship.controlPercentage must be a number');
    }
  }
  const ctx = document.raftContext;
  if (
    !hasExactKeys(ctx, [
      'term',
      'index',
      'leaderId',
      'clusterId',
      'originNodeId',
      'counterpartyNodeId',
      'prevEntryHash',
    ])
  ) {
    issues.push(
      'raftContext must have exactly term, index, leaderId, clusterId, originNodeId, counterpartyNodeId, prevEntryHash',
    );
  } else {
    if (!Number.isInteger(ctx.term) || ctx.term < 0) {
      issues.push('raftContext.term must be an integer >= 0');
    }
    if (!Number.isInteger(ctx.index) || ctx.index < 0) {
      issues.push('raftContext.index must be an integer >= 0');
    }
    if (typeof ctx.leaderId !== 'string' || ctx.leaderId.length === 0) {
      issues.push('raftContext.leaderId must be a non-empty string');
    }
    if (typeof ctx.clusterId !== 'string' || !UUID_PATTERN.test(ctx.clusterId)) {
      issues.push('raftContext.clusterId must be a UUID');
    }
    if (typeof ctx.originNodeId !== 'string' || ctx.originNodeId.length === 0) {
      issues.push('raftContext.originNodeId must be a non-empty string');
    }
    if (typeof ctx.counterpartyNodeId !== 'string' || ctx.counterpartyNodeId.length === 0) {
      issues.push('raftContext.counterpartyNodeId must be a non-empty string');
    }
    if (typeof ctx.prevEntryHash !== 'string' || !SHA256_HEX_PATTERN.test(ctx.prevEntryHash)) {
      issues.push('raftContext.prevEntryHash must be 64 lowercase hex characters');
    }
    if (
      typeof ctx.originNodeId === 'string' &&
      typeof ctx.counterpartyNodeId === 'string' &&
      ctx.originNodeId === ctx.counterpartyNodeId
    ) {
      issues.push('raftContext.originNodeId and counterpartyNodeId must be distinct');
    }
    // The leader is one of the two bound nodes. The node ids sit inside
    // the signed bytes, so this rule is cryptographically covered.
    if (
      typeof ctx.leaderId === 'string' &&
      typeof ctx.originNodeId === 'string' &&
      typeof ctx.counterpartyNodeId === 'string' &&
      ctx.leaderId !== ctx.originNodeId &&
      ctx.leaderId !== ctx.counterpartyNodeId
    ) {
      issues.push('raftContext.leaderId must equal originNodeId or counterpartyNodeId');
    }
  }
  if (!isPlainObject(document.payload) || Object.keys(document.payload).length < 1) {
    issues.push('payload must be an object with at least one property');
  }
  const attestations = document.attestations;
  if (!hasExactKeys(attestations, ['origin', 'counterparty'])) {
    issues.push('attestations must have exactly origin and counterparty');
  } else {
    for (const role of ['origin', 'counterparty']) {
      const { issues: attestationIssues } = validateAttestation(attestations[role], role);
      issues.push(...attestationIssues);
    }
  }
  return issues.length === 0 ? { ok: true, issues: [] } : { ok: false, issues };
}

/**
 * Verify a multi-algorithm signature array for one role: the Ed25519
 * entry and the ML-DSA-65 entry must BOTH verify over the same canonical
 * bytes, against the PINNED keys for the role — never against the
 * document-supplied entry keys (those were checked against the pinned
 * keys in the pinned-key gate). Returns true/false; never throws.
 * Telemetry only: the verifies are counted on `meter`.
 */
function verifySignatureArrayForRole(array, role, unsigned, protocol, meter = defaultMetrology) {
  const pinnedEd = protocol?.[role]?.rawPublicKey;
  const pinnedPqc = pqcPublicKeyForRole(role, protocol);
  if (typeof pinnedEd !== 'string' || typeof pinnedPqc !== 'string') return false;
  const edOk = verifySignature({
    publicKey: pinnedEd,
    signature: array.ed25519.signature,
    payload: unsigned,
    meter,
  });
  if (!edOk) return false;
  return verifyMlDsa65({
    publicKey: pinnedPqc,
    signature: array.mlDsa65.signature,
    payload: unsigned,
    meter,
  });
}

export class NuminaPairBindingRaftEngine {
  constructor(nodeId, { currentTerm = 1, commitIndex = 0, protocol = loadProtocol(), meter = defaultMetrology } = {}) {
    if (typeof nodeId !== 'string' || nodeId.length === 0) {
      throw new Error('nodeId must be a non-empty string');
    }
    this.nodeId = nodeId;
    this.currentTerm = currentTerm;
    this.commitIndex = commitIndex;
    this.protocol = protocol;
    this.stateLog = [];
    // Telemetry only: this engine records its measurements on this
    // meter (default: the module default meter). Counting never
    // changes whether an entry is accepted or rejected.
    this.meter = meter;
  }

  /** The envelope without attestations — the bytes both roles hybrid-sign. */
  static unsignedEnvelope(document) {
    const { attestations, ...unsigned } = document;
    return unsigned;
  }

  /**
   * Canonical bytes + SHA-256 digest of the unsigned envelope.
   * Telemetry only: the canonical byte count is recorded and the
   * digest computation is counted on this engine's meter.
   */
  envelopeDigest(document) {
    const bytes = canonicalBytes(NuminaPairBindingRaftEngine.unsignedEnvelope(document));
    this.meter.recordCanonical(bytes.length);
    this.meter.record('sha256');
    return { canonicalBytesHex: hex(bytes), sha256Hex: hex(sha256(bytes)) };
  }

  /** Pinned Ed25519 raw public key hex for a role, or null. */
  pinnedEd25519PublicKey(role) {
    const key = this.protocol?.[role]?.rawPublicKey;
    return typeof key === 'string' ? key.toLowerCase() : null;
  }

  /** Pinned ML-DSA-65 SPKI DER hex for a role, or null when unprovisioned. */
  pinnedMlDsa65PublicKey(role) {
    return pqcPublicKeyForRole(role, this.protocol);
  }

  /**
   * Evaluate one envelope and, if it passes every gate, append it to the
   * in-memory log. Gates, in order: structural validation, transport
   * frame bound, authorship assertion, node-identity binding, pinned-key
   * match, distinct signers, PQC provisioning, Raft term, index
   * monotonicity, predecessor hash-chaining, hybrid verification of
   * BOTH parts against the PINNED keys. Any failure returns
   * { success: false, error } and commits nothing.
   */
  processEntry(document) {
    // 1. Structural validation (plain code; the schema file is the contract).
    const validation = validatePairBindingEnvelope(document);
    if (!validation.ok) {
      return { success: false, error: 'SCHEMA_VALIDATION_FAILED', details: validation.issues };
    }

    // 2. Transport frame bound. The canonical serialized envelope is the
    // frame; it must fit in a 16,384-byte MTU. Oversized envelopes are
    // rejected, never truncated — post-quantum signatures and keys are
    // too large to risk a silent cut. Telemetry only: the frame's
    // canonical byte count is recorded on this engine's meter.
    const frameBytes = canonicalBytes(document).length;
    this.meter.recordCanonical(frameBytes);
    if (frameBytes > PAIR_BINDING_MAX_FRAME_BYTES) {
      return {
        success: false,
        error: 'FRAME_EXCEEDS_MTU',
        frameBytes,
        maxFrameBytes: PAIR_BINDING_MAX_FRAME_BYTES,
      };
    }

    // 3. Authorship assertion. This is a payload assertion, not a
    // cryptographic proof of ownership: it says the envelope claims the
    // sole owner, not that the signer owns anything.
    const authorship = document.authorship;
    if (
      authorship.owner !== PAIR_BINDING_SOLE_OWNER ||
      authorship.entity !== PAIR_BINDING_ENTITY ||
      authorship.controlPercentage !== PAIR_BINDING_CONTROL_PERCENTAGE
    ) {
      return { success: false, error: 'AUTHORSHIP_OWNERSHIP_MISMATCH' };
    }

    // 4. Node-identity binding. Each attestation's nodeId must equal the
    // node id signed for its role in raftContext. The node ids sit inside
    // the signed bytes, so a compromised node cannot re-label itself as
    // the other node without invalidating the signatures — and the keys
    // are pinned (gate 5), so it cannot borrow the other node's key
    // either. Either failure breaks the chain of custody for the entry.
    const { originNodeId, counterpartyNodeId } = document.raftContext;
    if (
      document.attestations.origin.nodeId !== originNodeId ||
      document.attestations.counterparty.nodeId !== counterpartyNodeId
    ) {
      return {
        success: false,
        error: 'NODE_ID_BINDING_MISMATCH',
        expected: { origin: originNodeId, counterparty: counterpartyNodeId },
        received: {
          origin: document.attestations.origin.nodeId,
          counterparty: document.attestations.counterparty.nodeId,
        },
      };
    }

    // 5. Pinned keys. The document's attestation keys must BE the pinned
    // Authority / Guardian Ed25519 keys. A document naming its own keys
    // is rejected here, before any signature is checked. In array form
    // the ML-DSA-65 entry carries no public key — its key is the pinned
    // ML-DSA-65 key for the role, checked at verification (gate 11);
    // an unprovisioned pinned key is reported by gate 7.
    const originKey = document.attestations.origin.publicKey.toLowerCase();
    const counterpartyKey = document.attestations.counterparty.publicKey.toLowerCase();
    const pinnedOrigin = this.pinnedEd25519PublicKey('authority');
    const pinnedCounterparty = this.pinnedEd25519PublicKey('guardian');
    if (originKey !== pinnedOrigin || counterpartyKey !== pinnedCounterparty) {
      return { success: false, error: 'PINNED_KEY_MISMATCH' };
    }

    // 6. The two signers must be distinct keys.
    if (originKey === counterpartyKey) {
      return { success: false, error: 'DUPLICATE_SIGNER_KEYS' };
    }

    // 7. PQC provisioning. An unprovisioned (null) ML-DSA-65 key fails
    // closed: there is no pinned key to check the lattice part against,
    // so the entry cannot verify hybridly. No downgrade to Ed25519-only.
    const originPqc = this.pinnedMlDsa65PublicKey('authority');
    const counterpartyPqc = this.pinnedMlDsa65PublicKey('guardian');
    if (typeof originPqc !== 'string' || typeof counterpartyPqc !== 'string') {
      return { success: false, error: 'PQC_KEYS_UNPROVISIONED' };
    }

    // 8. Raft term. A stale term is rejected; a newer term is adopted.
    const { term, index } = document.raftContext;
    if (term < this.currentTerm) {
      return {
        success: false,
        error: 'STALE_RAFT_TERM',
        currentTerm: this.currentTerm,
        receivedTerm: term,
      };
    }
    if (term > this.currentTerm) {
      this.currentTerm = term;
    }

    // 9. Index monotonicity: each committed index must exceed the last.
    if (index <= this.commitIndex && this.stateLog.length > 0) {
      return {
        success: false,
        error: 'INDEX_NOT_MONOTONIC',
        commitIndex: this.commitIndex,
        receivedIndex: index,
      };
    }

    // 10. Predecessor hash-chaining. The entry's prevEntryHash must
    // equal the digest of the last committed entry — the SHA-256 of
    // that entry's canonical unsigned envelope, as STORED in
    // this.stateLog — or the all-zero genesis hash when the log is
    // empty. A caller-supplied "previous digest" is never trusted:
    // the expected value comes only from committed state. This gate
    // sits after index monotonicity and before hybrid verification
    // because a wrong predecessor is a chain-integrity failure, cheap
    // to check before any crypto runs. prevEntryHash is inside the
    // signed bytes, so a tampered link also breaks the signatures —
    // but this gate is what names the failure as a chain failure.
    const expectedPrevEntryHash =
      this.stateLog.length === 0
        ? PAIR_BINDING_GENESIS_PREV_ENTRY_HASH
        : this.stateLog[this.stateLog.length - 1].digest;
    if (document.raftContext.prevEntryHash !== expectedPrevEntryHash) {
      return {
        success: false,
        error: 'PREV_ENTRY_HASH_MISMATCH',
        expected: expectedPrevEntryHash,
        received: document.raftContext.prevEntryHash,
      };
    }

    // 11. Hybrid verification against the PINNED keys: BOTH the Ed25519
    // part and the ML-DSA-65 part must verify over the same canonical
    // bytes of the unsigned envelope. The document's key fields are not
    // trusted here — verification uses the pinned keys. In array form
    // each entry is verified separately; in legacy form the bundle or
    // record is verified through the PQC module.
    const unsigned = NuminaPairBindingRaftEngine.unsignedEnvelope(document);
    const verifyRole = (role, protocolRole) => {
      const attestation = document.attestations[role];
      if (Object.prototype.hasOwnProperty.call(attestation, 'signatures')) {
        const array = parseSignatureArray(attestation.signatures);
        if (array === null) return false;
        return verifySignatureArrayForRole(array, protocolRole, unsigned, this.protocol, this.meter);
      }
      const verifier =
        protocolRole === 'authority' ? verifyHybridAuthoritySignature : verifyHybridGuardianSignature;
      return verifier(attestation.hybridSignature, unsigned, this.protocol, this.meter);
    };
    const originValid = verifyRole('origin', 'authority');
    const counterpartyValid = verifyRole('counterparty', 'guardian');
    if (!originValid || !counterpartyValid) {
      return {
        success: false,
        error: 'CRYPTOGRAPHIC_SIGNATURE_MISMATCH',
        checks: { originValid, counterpartyValid },
      };
    }

    // 12. Commit the state transition to the append-only log.
    const { sha256Hex } = this.envelopeDigest(document);
    this.commitIndex = index;
    this.stateLog.push({
      index,
      term,
      digest: sha256Hex,
      prevEntryHash: document.raftContext.prevEntryHash,
      owner: PAIR_BINDING_SOLE_OWNER,
      payload: document.payload,
    });

    return {
      success: true,
      soleOwner: PAIR_BINDING_SOLE_OWNER,
      ownershipShare: `${PAIR_BINDING_CONTROL_PERCENTAGE}%`,
      commitIndex: this.commitIndex,
      term,
      index,
      digest: sha256Hex,
      prevEntryHash: document.raftContext.prevEntryHash,
    };
  }
}
