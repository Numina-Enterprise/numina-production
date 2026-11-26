// numina-batch-signature.js — Batch-signature records for NCPS
// (owner directive Nov 21, 2026: "implement the batch sig").
//
// Source: draft-ramadan-mboned-mcast-manifest-01, "Signed Digest
// Manifests for Multicast Datagram Authentication", Omar Ramadan
// (Blockcast), 2 November 2026, Standards Track,
// https://www.ietf.org/archive/id/draft-ramadan-mboned-mcast-manifest-01.html
// (expires 6 May 2027). Read in full from the IETF archive, Nov 21,
// 2026, ~06:47 UTC: abstract, §3 (overview), §4 (digest), §5
// (manifest record and signature), §5.1 (signature context binding),
// §5.2 (keys, epochs, sequence numbers), §6 (sender), §7 (receiver).
// Revision status checked the same morning on the Datatracker history
// page: -02 was UPLOADED 20 Nov 2026 but its text had NOT published
// (no "New version available" entry; the document still stands at
// -01, posting confirmation pending). This module implements -01.
// -02 changes are UNESTABLISHED and are NOT implemented here; re-check
// the history page before any -02 work.
//
// EVIDENCE CLASS (c) — UNPROVEN CLAIM. The draft is an Internet-Draft
// (work in progress, Standards Track intended) with no machine-checked
// proof, no public implementation named, and no interoperability result.
// The draft DOES publish test vectors (Appendix A, shared with
// [MOQ-MULTICAST] Appendix A) — but for the draft's FIXED BINARY wire
// record, which this module does NOT build (see below), so those vectors
// are NOT reproduced here and NO KAT/ACVP pass is claimed for this
// module. The tests below prove only that THIS implementation refuses
// the draft's own failure cases (mutant-kill on every field) and
// accepts its well-formed manifests.
//
// JCS ADAPTATION (recorded, not silent): the draft defines a fixed
// binary record (Table 1, §5): magic "MHM2", kid, epoch, mseq,
// first_seq, count, hash_alg, flags, sent, ctx, 32 x count digests, and
// a 64-octet Ed25519 signature; signed_message = "mcast-manifest-v2"
// || 0x00 || u32(streamId) || S || G || u16(port) || record[0..len-64).
// NCPS has no binary-record infrastructure and its whole verification
// stack is JCS (RFC 8785) JSON — pedigree, authorization-binding and
// the NTPv5 attestation all canonicalize with the `canonicalize`
// package. So the NCPS batch record is a compact JWS (RFC 7515) whose
// payload is the draft's exact field set, signed over the JWS Signing
// Input (PureEdDSA Ed25519, no prehash, empty Ed25519 context, as the
// draft §5 requires). The draft's external signature prefix is folded
// INTO the signed payload: the payload carries `label:
// "mcast-manifest-v2"` and the full flow identity (streamId, source,
// group, port), so a signature still cannot be replayed onto another
// flow, generation, key, or epoch — the same binding, in JCS form.
// The digest pseudoheader (§4) is likewise adapted: the draft's S/G are
// fixed-width IP addresses; NCPS flows are logical, so source/group are
// UTF-8 flow identifiers, each followed by a 0x00 separator (and
// validated to contain no NUL), keeping the field boundary unambiguous.
// The 37-digest cap, the field set, the ctx semantics, the freshness
// rule, and the fail-closed receiver order are carried over faithfully.
//
// What this module does NOT do (stated, not silently absent):
//   * Binary wire encoding. No encoder/decoder for the draft's Table 1
//     layout is built; NCPS carries no multicast transport, and no
//     byte-level interop with the draft's Appendix A vectors is
//     claimed. Building one is a separate owner decision.
//   * The draft's transport/profile machinery: MoQ profile
//     ("bc-provenance"), browser profile, well-known document (§8.2),
//     DORMS delivery, FEC repair symbols, the ed25519-trailer-1 scheme
//     (§9, low-rate flows), the registries (§11), and the sender-side
//     rate envelope / verification budget (§6, §7 step 1 token bucket).
//     NCPS has no multicast flow to rate-limit; the receiver here is a
//     stateless verifier, not a real-time datagram receiver.
//   * Persistent receiver state. The draft's receiver keeps per-flow
//     state: current/previous epoch with grace periods, the mseq replay
//     floor (mseq + 64 <= highest_mseq), the per-(kid,epoch) verified
//     set, the pending table, and the hold queue (§7). This verifier is
//     STATELESS except for one caller-owned input: opts.verifiedRecords,
//     a Set of "kid:epoch:mseq" keys the caller keeps across calls.
//     Without it, a manifest can be verified twice and an epoch floor
//     cannot be enforced — the verify result says so. Epoch
//     monotonicity across records belongs to the caller (or to a future
//     receiver-state object); it is NOT claimed here.
//   * Key distribution. The draft's keys come from the flow's metadata
//     (well-known document, DORMS, catalog, or provisioning, §8) and
//     are never taken from a carrier's signaling (§7). This module
//     takes its trust anchors from the CALLER (opts.trustAnchors) and
//     verifies nothing about where they came from. A caller that takes
//     anchors from an unauthenticated source has no security at all;
//     that is the caller's responsibility, stated here.
//   * Freshness defaults are loosened, on purpose. The draft's step-1
//     freshness bound is "sent more than 7 s + maxAuthDelayMs behind,
//     or more than 6 s ahead" — a real-time multicast bound
//     (maxAuthDelayMs defaults to 200 ms). NCPS batches are verified
//     offline and asynchronously, so the default behind-bound here is
//     300 s (opts.maxBehindSeconds) with the draft's 6 s ahead-bound
//     kept (opts.maxAheadSeconds). Both are caller-configurable; the
//     deviation is this paragraph, not a silent change.
//
// INTEGRATION POINT (not applied here): wiring this verifier into a
// MERF admission check, a control.js authorize path, or a Pedigree
// chain step is an OWNER DECISION. This module is a standalone
// verifier: no NCPS record carries a batch manifest until a caller
// attaches one and a verifier calls verifyBatchManifest / receiveBatch.
// Do not report a batch as verified until that call has run.
//
// KAT/ACVP RULE (docs/numina-crypto-verification-rule-2026-11-20.md):
// passing known-answer / ACVP vectors is NECESSARY, never SUFFICIENT,
// for NCPS crypto code. No KAT/ACVP pass may be claimed for this
// module — the draft's vectors are for a wire format this module does
// not build. The sufficiency bar is assessed in the design note
// (~/workspace/your_files/
// numina-batch-signature-implementation-2026-11-21.md).
//
// Fail-closed: mint* throws on any malformed input; verify* and
// receiveBatch never throw on a malformed manifest, malformed items, or
// malformed verifier configuration — they return
// { ok: false, outcome, reasons, admitted: [] }. A failed manifest
// admits NOTHING: no partial acceptance, ever (draft §7: "there is no
// verify-and-report mode"). Amounts and times are integers (safe
// integers, never floats). No private key material is ever accepted,
// stored, or logged by this module: mint takes a `sign` callback
// supplied by the caller (the key stays with the owner, as in
// numina-protocol-sign.js and numina-pedigree.js), verify takes public
// JWKs only, and any JWK carrying a private member is rejected by
// decodeJwkPublicKey.

import { createHash } from 'node:crypto';
import {
  pedigreeCanonicalText,
  pedigreeSigningInput,
  pedigreeTokenDigest,
  verifySigningInputSignature,
  parseCompactJws,
} from './numina-pedigree.js';
import {
  decodeJwkPublicKey,
  decodeStrictBase64url,
} from './numina-protocol-verify.js';
import {
  checkTrustedStateAgainstHashAlg,
  validateTrustedState,
} from './numina-mmr-receipts.js';

export const BATCH_DRAFT = 'draft-ramadan-mboned-mcast-manifest-01';
export const BATCH_SCHEME = 'manifest-ed25519-2';
export const BATCH_TYP = 'numina-batch-manifest+jwt';
export const BATCH_LABEL = 'mcast-manifest-v2';
export const BATCH_HASH_ALG = 'sha-256';
export const BATCH_MAX_DIGESTS = 37;
export const BATCH_MIN_DIGESTS = 1;
export const BATCH_MAX_ITEM_BYTES = 65535;
export const BATCH_MAX_TOTAL_SIZE = 65536;
export const BATCH_DEFAULT_MAX_BEHIND_SECONDS = 300;
export const BATCH_DEFAULT_MAX_AHEAD_SECONDS = 6;
export const BATCH_EPOCH_END_FLAG = 0x01;
export const BATCH_RESERVED_FLAGS_MASK = 0xfe;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const BASE64URL_32_RE = /^[A-Za-z0-9_-]{43}$/;

function fail(message) {
  throw new Error(`batch-signature: ${message}`);
}

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function base64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function sha256Bytes(data) {
  return new Uint8Array(createHash('sha256').update(data).digest());
}

function u16be(value) {
  const out = new Uint8Array(2);
  out[0] = (value >> 8) & 0xff;
  out[1] = value & 0xff;
  return out;
}

function u32be(value) {
  const out = new Uint8Array(4);
  out[0] = (value >>> 24) & 0xff;
  out[1] = (value >>> 16) & 0xff;
  out[2] = (value >>> 8) & 0xff;
  out[3] = value & 0xff;
  return out;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkNoUnknownFields(obj, allowed, what) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${what} has unknown field '${key}'`);
  }
}

function checkNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a non-empty string`);
}

function checkSafeNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${name} must be a safe non-negative integer`);
  }
}

function checkU32(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    fail(`${name} must be a 32-bit unsigned integer`);
  }
}

/** Constant-time equality for two strings (length-checked first). */
function constantTimeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

/** Decode a strict unpadded base64url string to exactly 32 bytes, or null. */
function decodeCtxBytes(value) {
  if (typeof value !== 'string' || !BASE64URL_32_RE.test(value)) return null;
  try {
    const bytes = decodeStrictBase64url(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

/** The 32 zero octets of draft §5.1 (a flow with no profile). */
export function zeroCtx() {
  return base64urlEncode(new Uint8Array(32));
}

// ---------------------------------------------------------------------------
// Flow identity and the digest pseudoheader (draft §4)
// ---------------------------------------------------------------------------

export const BATCH_FLOW_FIELDS = Object.freeze(['streamId', 'source', 'group', 'port']);

/**
 * Validate a flow identity { streamId, source, group, port }.
 * Returns { ok, reasons }. The draft's S/G are fixed-width IP addresses
 * (draft §4); NCPS source/group are UTF-8 flow identifiers, validated
 * to contain no NUL so the 0x00 separators in the pseudoheader below
 * keep every field boundary unambiguous.
 */
export function validateFlow(flow) {
  const reasons = [];
  if (!isPlainObject(flow)) return { ok: false, reasons: ['flow must be an object'] };
  for (const key of Object.keys(flow)) {
    if (!BATCH_FLOW_FIELDS.includes(key)) reasons.push(`flow has unknown field '${key}'`);
  }
  if (!Number.isSafeInteger(flow.streamId) || flow.streamId < 0 || flow.streamId > 0xffffffff) {
    reasons.push('flow.streamId must be a 32-bit unsigned integer');
  }
  for (const name of ['source', 'group']) {
    if (typeof flow[name] !== 'string' || flow[name].length === 0) {
      reasons.push(`flow.${name} must be a non-empty string`);
    } else if (flow[name].includes('\0')) {
      reasons.push(`flow.${name} must not contain a NUL character`);
    }
  }
  if (!Number.isSafeInteger(flow.port) || flow.port < 0 || flow.port > 65535) {
    reasons.push('flow.port must be an integer in 0..65535');
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * The digest pseudoheader (draft §4, adapted): the draft's is
 *   S || G || 0x00 || 0x11 || u16(payload_length) ||
 *   u16(src_port) || u16(dst_port) || u32(streamId)
 * with S/G fixed-width addresses and src_port == dst_port == the
 * flow's port. The NCPS form keeps the same shape with UTF-8
 * source/group, each followed by a 0x00 separator:
 *   UTF8(source) || 0x00 || UTF8(group) || 0x00 || 0x11 ||
 *   u16(data_length) || u16(port) || u16(port) || u32(streamId)
 * Nothing but the data's length is read from the item itself, so one
 * digest verifies the same bytes whatever carrier delivers the item.
 */
export function batchPseudoheader(flow, dataLength) {
  const flowCheck = validateFlow(flow);
  if (!flowCheck.ok) fail(`flow is invalid: ${flowCheck.reasons.join('; ')}`);
  if (!Number.isSafeInteger(dataLength) || dataLength < 0 || dataLength > BATCH_MAX_ITEM_BYTES) {
    fail(`data length must be an integer in 0..${BATCH_MAX_ITEM_BYTES}`);
  }
  const encoder = new TextEncoder();
  return concatBytes([
    encoder.encode(flow.source),
    new Uint8Array([0x00]),
    encoder.encode(flow.group),
    new Uint8Array([0x00]),
    new Uint8Array([0x11]),
    u16be(dataLength),
    u16be(flow.port),
    u16be(flow.port),
    u32be(flow.streamId),
  ]);
}

/**
 * The item digest (draft §4): D = H(pseudoheader || data), SHA-256
 * (suite 1, mandatory to implement). Returned as
 * "sha256:" + 64 lowercase hex characters. The sequence is NOT in the
 * pseudoheader — as in the draft, an item's sequence is bound by its
 * position in the manifest (digest i covers sequence first_seq + i),
 * so byte-identical items in one flow share one digest (the draft's
 * carousel rule, §5.2).
 */
export function batchDigest(flow, data) {
  if (!(data instanceof Uint8Array)) fail('data must be bytes (Uint8Array)');
  if (data.length > BATCH_MAX_ITEM_BYTES) {
    fail(`data is ${data.length} bytes, over the ${BATCH_MAX_ITEM_BYTES}-byte bound (draft §4 u16 payload_length)`);
  }
  const pseudoheader = batchPseudoheader(flow, data.length);
  return `sha256:${hex(sha256Bytes(concatBytes([pseudoheader, data])))}`;
}

// ---------------------------------------------------------------------------
// Signature context (draft §5.1)
// ---------------------------------------------------------------------------

/**
 * Derive the 32-octet ctx for a manifest (draft §5.1): `ctx` is 32
 * octets that a profile MAY derive from the application context it binds
 * the flow to, "under a label of the profile's choosing and with the
 * record's hash_alg". The NCPS derivation is
 *   ctx = SHA-256( UTF8(label) || 0x00 || UTF8(JCS(context)) )
 * returned as unpadded base64url. A manifest with no context uses
 * zeroCtx() (32 zero octets, draft §5.1: "A flow with no such profile
 * sets ctx to 32 zero octets"). `context` must be JSON-canonicalizable.
 */
export function deriveCtx(label, context) {
  checkNonEmptyString(label, 'ctx label');
  let contextText;
  try {
    contextText = pedigreeCanonicalText(context);
  } catch {
    fail('ctx context must be JSON-canonicalizable');
  }
  const encoder = new TextEncoder();
  const bytes = sha256Bytes(concatBytes([
    encoder.encode(label),
    new Uint8Array([0x00]),
    encoder.encode(contextText),
  ]));
  return base64urlEncode(bytes);
}

// ---------------------------------------------------------------------------
// Manifest record shape (draft §5)
// ---------------------------------------------------------------------------

export const BATCH_MANIFEST_FIELDS = Object.freeze([
  'label',
  'scheme',
  'kid',
  'epoch',
  'mseq',
  'first_seq',
  'count',
  'hash_alg',
  'flags',
  'sent',
  'ctx',
  'flow',
  'digests',
]);

/**
 * Validate a manifest payload object. Returns { ok, reasons }. Checks
 * the closed field set, every field's shape, count == digests.length,
 * digests well-formed, and (where checkable without a key) nothing
 * else. Signature verification is NOT done here — it is a separate
 * step in verifyBatchManifest, after the structural checks, exactly
 * as draft §7 step 1 orders it.
 */
export function validateManifestShape(payload) {
  const reasons = [];
  if (!isPlainObject(payload)) return { ok: false, reasons: ['manifest payload must be an object'] };
  checkNoUnknownFieldsShim(payload, reasons);
  if (payload.label !== BATCH_LABEL) reasons.push(`label must be '${BATCH_LABEL}'`);
  if (payload.scheme !== BATCH_SCHEME) reasons.push(`scheme must be '${BATCH_SCHEME}'`);
  if (typeof payload.kid !== 'string' || payload.kid.length === 0) {
    reasons.push('kid must be a non-empty string');
  }
  for (const name of ['epoch', 'mseq', 'first_seq']) {
    if (!Number.isSafeInteger(payload[name]) || payload[name] < 0) {
      reasons.push(`${name} must be a safe non-negative integer`);
    }
  }
  if (Number.isSafeInteger(payload.epoch) && (payload.epoch < 0 || payload.epoch > 0xffffffff)) {
    reasons.push('epoch must be a 32-bit unsigned integer');
  }
  if (!Number.isSafeInteger(payload.count) || payload.count < BATCH_MIN_DIGESTS || payload.count > BATCH_MAX_DIGESTS) {
    reasons.push(`count must be an integer in ${BATCH_MIN_DIGESTS}..${BATCH_MAX_DIGESTS} (draft §5)`);
  }
  if (payload.hash_alg !== BATCH_HASH_ALG) {
    reasons.push(`hash_alg must be '${BATCH_HASH_ALG}' (draft §4.1: SHA-256 is mandatory to implement)`);
  }
  if (!Number.isSafeInteger(payload.flags) || payload.flags < 0 || payload.flags > 255) {
    reasons.push('flags must be an integer in 0..255');
  }
  if (!Number.isSafeInteger(payload.sent) || payload.sent < 0 || payload.sent > 0xffffffff) {
    reasons.push('sent must be a 32-bit unsigned integer (POSIX seconds, draft §5)');
  }
  if (decodeCtxBytes(payload.ctx) === null) {
    reasons.push('ctx must be strict unpadded base64url of 32 octets (draft §5.1)');
  }
  const flowCheck = validateFlow(payload.flow);
  if (!flowCheck.ok) reasons.push(...flowCheck.reasons.map((r) => `flow: ${r}`));
  if (!Array.isArray(payload.digests)) {
    reasons.push('digests must be an array');
  } else {
    if (Number.isSafeInteger(payload.count) && payload.digests.length !== payload.count) {
      reasons.push(`count (${payload.count}) must equal the number of digests (${payload.digests.length})`);
    }
    payload.digests.forEach((digest, i) => {
      if (typeof digest !== 'string' || !DIGEST_RE.test(digest)) {
        reasons.push(`digests[${i}] must be "sha256:" followed by 64 lowercase hex characters`);
      }
    });
  }
  return { ok: reasons.length === 0, reasons };
}

function checkNoUnknownFieldsShim(obj, reasons) {
  for (const key of Object.keys(obj)) {
    if (!BATCH_MANIFEST_FIELDS.includes(key)) reasons.push(`manifest has unknown field '${key}'`);
  }
}

function checkSignCallback(sign) {
  if (typeof sign !== 'function') {
    fail('sign must be a function (signingInputBytes: Uint8Array) => Uint8Array signature (64 bytes)');
  }
}

/**
 * Mint a batch manifest (draft §5/§6, NCPS JCS form). `fields` is the
 * manifest record WITHOUT a signature: label, scheme, kid, epoch, mseq,
 * first_seq, count, hash_alg, flags, sent, ctx, flow, digests.
 * `sign` signs the JWS Signing Input bytes with the key named by kid
 * and returns a 64-byte Ed25519 signature; `publicJwk` is that key —
 * the fresh signature is re-verified against it before the manifest is
 * returned, and minting throws if re-verification fails. Reserved
 * flag bits (1-7) MUST be zero on send (draft §5); a manifest that
 * sets them is refused at mint. Throws on any violation.
 */
export function mintBatchManifest(args) {
  if (!args || typeof args !== 'object') fail('args must be an object');
  const { fields, sign, publicJwk } = args;
  checkSignCallback(sign);
  if (!fields || typeof fields !== 'object') fail('fields must be an object');
  const shape = validateManifestShape(fields);
  if (!shape.ok) fail(`manifest fields are malformed: ${shape.reasons.join('; ')}`);
  if ((fields.flags & BATCH_RESERVED_FLAGS_MASK) !== 0) {
    fail('reserved flag bits 1-7 must be zero on send (draft §5)');
  }
  let publicKeyRaw;
  try {
    publicKeyRaw = decodeJwkPublicKey(publicJwk);
  } catch (error) {
    fail(`publicJwk is not a valid public JWK: ${error.message}`);
  }
  const header = { typ: BATCH_TYP, alg: 'Ed25519' };
  const payload = {
    label: fields.label,
    scheme: fields.scheme,
    kid: fields.kid,
    epoch: fields.epoch,
    mseq: fields.mseq,
    first_seq: fields.first_seq,
    count: fields.count,
    hash_alg: fields.hash_alg,
    flags: fields.flags,
    sent: fields.sent,
    ctx: fields.ctx,
    flow: {
      streamId: fields.flow.streamId,
      source: fields.flow.source,
      group: fields.flow.group,
      port: fields.flow.port,
    },
    digests: [...fields.digests],
  };
  const { ascii, bytes } = pedigreeSigningInput(header, payload);
  const signature = sign(bytes);
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    fail('sign callback must return a 64-byte Ed25519 signature');
  }
  if (!verifySigningInputSignature({ publicKeyRaw, signatureBytes: signature, signingInputAscii: ascii })) {
    fail('fresh signature failed re-verification — refusing to return it');
  }
  const compact =
    `${base64urlEncode(new TextEncoder().encode(pedigreeCanonicalText(header)))}.` +
    `${base64urlEncode(new TextEncoder().encode(pedigreeCanonicalText(payload)))}.` +
    `${base64urlEncode(signature)}`;
  return { compact, header, payload, signingInput: ascii, signatureBytes: signature };
}

// ---------------------------------------------------------------------------
// Fail-closed receiver (draft §7 step 1, NCPS form)
// ---------------------------------------------------------------------------

function failResult(outcome, reasons) {
  return { ok: false, outcome, reasons, admittedDigests: [], recordDigest: null, epochEnd: false };
}

function normalizeTrustAnchors(trustAnchors) {
  if (!Array.isArray(trustAnchors) || trustAnchors.length === 0) {
    throw new Error('trustAnchors must be a non-empty array of { kid, publicJwk }');
  }
  return trustAnchors.map((entry, i) => {
    if (!isPlainObject(entry)) throw new Error(`trustAnchors[${i}] must be an object`);
    if (typeof entry.kid !== 'string' || entry.kid.length === 0) {
      throw new Error(`trustAnchors[${i}].kid must be a non-empty string`);
    }
    let publicKeyRaw;
    try {
      publicKeyRaw = decodeJwkPublicKey(entry.publicJwk);
    } catch (error) {
      throw new Error(`trustAnchors[${i}].publicJwk is not a valid public JWK: ${error.message}`);
    }
    return { kid: entry.kid, publicKeyRaw };
  });
}

/**
 * Verify one batch manifest, fail-closed, in the draft §7 step-1
 * order: structural checks before any cryptography (length/count/
 * hash_alg/flow/kid/freshness/ctx), then the Ed25519 signature, and
 * only on signature success are the digests read (admitted). Any
 * failure refuses the WHOLE manifest: the result carries
 * admittedDigests: [] and nothing is admitted.
 *
 * opts:
 *   trustAnchors (required): [{ kid, publicJwk }] — the flow's key
 *     set. Keys are taken ONLY from here, never from the manifest or
 *     any carrier (draft §7).
 *   nowUnixSeconds (required): the receiver's clock, POSIX seconds.
 *   expectedCtx (optional): base64url 32 bytes. When supplied, the
 *     receiver HOLDS the context source (draft §5.1) and MUST reject a
 *     record whose ctx differs. When absent, ctx is carried blind.
 *   maxBehindSeconds (default 300): sent older than
 *     nowUnixSeconds - maxBehindSeconds is stale. The draft's bound is
 *     7 s + maxAuthDelayMs (real-time multicast); see the header for
 *     why the NCPS default is looser.
 *   maxAheadSeconds (default 6): sent more than this far ahead of the
 *     receiver's clock is stale (draft §7 step 1, kept exactly).
 *   verifiedRecords (optional): a caller-owned Set of
 *     "kid:epoch:mseq" keys. A manifest whose key is already present
 *     is refused as already_verified (the draft's twin / replay drop,
 *     §7 step 1); on success the key is added. Without it, replay
 *     detection is NOT performed and the result says so.
 *   maxTotalSize (default 65536): compact-serialization byte bound.
 *   trustedState (optional): a TrustedState from
 *     numina-mmr-receipts.js (MMR -05 §11.5). When supplied, the
 *     manifest's hash_alg is compared against the state's
 *     vds/hashAlg and the manifest's JCS form against the state's
 *     canonicalization; a mismatch refuses the manifest. The state
 *     is NOT advanced by a batch manifest (it carries no tree).
 *   requireTrustedState (optional, default false): when true and
 *     no trustedState is supplied, the verification is refused,
 *     never defaulted.
 *   registry (optional): a VDS registry for the trusted state
 *     (default: the draft's MMR_SHA256 registry). Needed only when
 *     the trusted state names a VDS registered outside it.
 *
 * Success returns { ok: true, outcome: 'verified', recordDigest
 * (base64url SHA-256 of the signing input — the draft's per-record
 * digest, §7), epochEnd (flags bit 0), manifest (the payload),
 * admittedDigests: [{ seq, digest }], trustedStateBound (true when
 * a trusted state was supplied and the manifest's hash/
 * canonicalization matched it) }.
 * Failure returns { ok: false, outcome, reasons, admittedDigests: [],
 * recordDigest: null, epochEnd: false } with outcome one of:
 * malformed | non_canonical | unknown_key | signature_invalid |
 * ctx_mismatch | stale | already_verified | hash_alg_mismatch |
 * vds_mismatch | canonicalization_mismatch | trusted_state_required.
 */
export function verifyBatchManifest(manifest, opts = {}) {
  if (!opts || typeof opts !== 'object') {
    return failResult('malformed', ['verifier options must be an object']);
  }
  if (!Number.isSafeInteger(opts.nowUnixSeconds) || opts.nowUnixSeconds < 0) {
    return failResult('malformed', ['nowUnixSeconds is required and must be a safe non-negative integer']);
  }
  const maxBehindSeconds =
    opts.maxBehindSeconds === undefined ? BATCH_DEFAULT_MAX_BEHIND_SECONDS : opts.maxBehindSeconds;
  const maxAheadSeconds =
    opts.maxAheadSeconds === undefined ? BATCH_DEFAULT_MAX_AHEAD_SECONDS : opts.maxAheadSeconds;
  if (!Number.isSafeInteger(maxBehindSeconds) || maxBehindSeconds < 0) {
    return failResult('malformed', ['maxBehindSeconds must be a safe non-negative integer']);
  }
  if (!Number.isSafeInteger(maxAheadSeconds) || maxAheadSeconds < 0) {
    return failResult('malformed', ['maxAheadSeconds must be a safe non-negative integer']);
  }
  const maxTotalSize = opts.maxTotalSize === undefined ? BATCH_MAX_TOTAL_SIZE : opts.maxTotalSize;
  if (!Number.isSafeInteger(maxTotalSize) || maxTotalSize < 1) {
    return failResult('malformed', ['maxTotalSize must be a safe integer >= 1']);
  }
  if (typeof manifest === 'string' && manifest.length > maxTotalSize) {
    return failResult('malformed', [`manifest is ${manifest.length} bytes, over the configured bound of ${maxTotalSize}`]);
  }
  let anchors;
  try {
    anchors = normalizeTrustAnchors(opts.trustAnchors);
  } catch (error) {
    return failResult('malformed', [`trust anchor configuration is malformed: ${error.message}`]);
  }
  let expectedCtxBytes = null;
  if (opts.expectedCtx !== undefined) {
    expectedCtxBytes = decodeCtxBytes(opts.expectedCtx);
    if (expectedCtxBytes === null) {
      return failResult('malformed', ['expectedCtx must be strict unpadded base64url of 32 octets']);
    }
  }
  let verifiedRecords = null;
  if (opts.verifiedRecords !== undefined) {
    if (!(opts.verifiedRecords instanceof Set)) {
      return failResult('malformed', ['verifiedRecords must be a Set']);
    }
    verifiedRecords = opts.verifiedRecords;
  }
  // Trusted-state threading (MMR -05 §11.5): a caller may bind
  // this verification to a TrustedState. When requireTrustedState
  // is set and no state is supplied, refuse rather than default.
  let trustedState = null;
  if (opts.trustedState !== undefined) {
    const checked = validateTrustedState(opts.trustedState, opts.registry);
    if (!checked.ok) {
      return failResult('malformed', [`trustedState is invalid: ${checked.reasons.join('; ')}`]);
    }
    trustedState = opts.trustedState;
  }
  if (opts.requireTrustedState === true && trustedState === null) {
    return failResult('trusted_state_required', ['requireTrustedState is set but no trustedState was supplied — refusing rather than defaulting']);
  }

  // Step 1 — Parse (compact JWS, typ, JCS exactness). Never throws.
  const parsed = parseCompactJws(manifest, BATCH_TYP);
  if (!parsed.ok) {
    return failResult(parsed.outcome, [`manifest: ${parsed.reasons.join('; ')}`]);
  }
  const payload = parsed.payload;

  // Structural checks BEFORE any cryptography (draft §7 step 1).
  const shape = validateManifestShape(payload);
  if (!shape.ok) {
    return failResult('malformed', shape.reasons.map((r) => `manifest: ${r}`));
  }
  // Trusted-state comparison (MMR -05 §11.5): the manifest's
  // hash_alg must match the trusted state's vds/hashAlg, and the
  // manifest's JCS form must match the state's canonicalization.
  // The signature profile is NOT compared here: this draft fixes
  // Ed25519, and the profile is an MMR-receipt concept.
  if (trustedState !== null) {
    const tsCheck = checkTrustedStateAgainstHashAlg(trustedState, payload.hash_alg, opts.registry);
    if (!tsCheck.ok) return failResult(tsCheck.outcome, tsCheck.reasons);
  }
  const anchor = anchors.find((entry) => entry.kid === payload.kid);
  if (!anchor) {
    return failResult('unknown_key', [`kid '${payload.kid}' is not in the configured key set`]);
  }
  if (payload.sent > opts.nowUnixSeconds + maxAheadSeconds) {
    return failResult('stale', [
      `sent (${payload.sent}) is more than ${maxAheadSeconds} s ahead of the receiver clock (${opts.nowUnixSeconds})`,
    ]);
  }
  if (payload.sent < opts.nowUnixSeconds - maxBehindSeconds) {
    return failResult('stale', [
      `sent (${payload.sent}) is more than ${maxBehindSeconds} s behind the receiver clock (${opts.nowUnixSeconds})`,
    ]);
  }
  if (expectedCtxBytes !== null) {
    const ctxBytes = decodeCtxBytes(payload.ctx);
    if (
      ctxBytes === null ||
      !constantTimeEqualStrings(
        Buffer.from(ctxBytes).toString('hex'),
        Buffer.from(expectedCtxBytes).toString('hex'),
      )
    ) {
      return failResult('ctx_mismatch', ['ctx differs from the value recomputed from the held context source (draft §5.1)']);
    }
  }
  const recordKey = `${payload.kid}:${payload.epoch}:${payload.mseq}`;
  if (verifiedRecords !== null && verifiedRecords.has(recordKey)) {
    return failResult('already_verified', [
      `(kid, epoch, mseq) ${recordKey} is already verified — the twin or a replay (draft §7 step 1)`,
    ]);
  }

  // The signature. Only on success are the digests read (draft §7).
  const signatureOk = verifySigningInputSignature({
    publicKeyRaw: anchor.publicKeyRaw,
    signatureBytes: parsed.signatureBytes,
    signingInputAscii: parsed.signingInput,
  });
  if (!signatureOk) {
    return failResult('signature_invalid', ['Ed25519 signature over the manifest failed verification']);
  }
  const recordDigest = pedigreeTokenDigest(parsed.signingInput);
  if (verifiedRecords !== null) verifiedRecords.add(recordKey);
  const admittedDigests = payload.digests.map((digest, i) => ({
    seq: payload.first_seq + i,
    digest,
  }));
  return {
    ok: true,
    outcome: 'verified',
    recordDigest,
    epochEnd: (payload.flags & BATCH_EPOCH_END_FLAG) === BATCH_EPOCH_END_FLAG,
    manifest: payload,
    admittedDigests,
    replayChecked: verifiedRecords !== null,
    ctxChecked: expectedCtxBytes !== null,
    trustedStateBound: trustedState !== null,
    reasons: [],
  };
}

// ---------------------------------------------------------------------------
// Batch admission (draft §7 step 2, NCPS form: no partial acceptance)
// ---------------------------------------------------------------------------

/**
 * Admit a batch of items against a manifest, fail-closed. The manifest
 * is verified first (verifyBatchManifest, same opts); if it fails, the
 * WHOLE batch is refused and admitted is []. Then EVERY presented
 * item's digest is recomputed and checked against the manifest entry
 * for its sequence; any mismatch, any item whose sequence the manifest
 * does not cover, or any duplicated sequence refuses the WHOLE batch.
 * This is stricter than the draft's per-datagram admission (§7 step 2
 * admits datagrams as they arrive): NCPS admits a batch only as a
 * whole, so a receiver never holds a partially-authenticated batch.
 * Items need not cover the whole manifest: sequences the caller did
 * not present are reported as `pending`, not as failures.
 *
 * items: [{ seq, data }] with data a Uint8Array (<= 65535 bytes).
 * opts: as verifyBatchManifest (trustAnchors, nowUnixSeconds, ...).
 *
 * Success returns { ok: true, outcome: 'admitted',
 * admitted: [{ seq, digest }], pending: [seq, ...], recordDigest,
 * epochEnd, manifest }.
 * Failure returns { ok: false, outcome, reasons, admitted: [],
 * pending: [] } with outcome one of the verifyBatchManifest outcomes
 * or item_not_in_manifest | duplicate_item | item_digest_mismatch |
 * malformed.
 */
export function receiveBatch(manifest, items, opts = {}) {
  const verified = verifyBatchManifest(manifest, opts);
  if (!verified.ok) {
    return { ok: false, outcome: verified.outcome, reasons: verified.reasons, admitted: [], pending: [] };
  }
  if (!Array.isArray(items)) {
    return { ok: false, outcome: 'malformed', reasons: ['items must be an array'], admitted: [], pending: [] };
  }
  const flow = verified.manifest.flow;
  const firstSeq = verified.manifest.first_seq;
  const count = verified.manifest.count;
  const seenSeq = new Set();
  const admitted = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item)) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}] must be an object`], admitted: [], pending: [] };
    }
    if (!Number.isSafeInteger(item.seq) || item.seq < 0) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}].seq must be a safe non-negative integer`], admitted: [], pending: [] };
    }
    if (!(item.data instanceof Uint8Array)) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}].data must be bytes (Uint8Array)`], admitted: [], pending: [] };
    }
    if (item.data.length > BATCH_MAX_ITEM_BYTES) {
      return {
        ok: false,
        outcome: 'malformed',
        reasons: [`items[${i}].data is ${item.data.length} bytes, over the ${BATCH_MAX_ITEM_BYTES}-byte bound`],
        admitted: [],
        pending: [],
      };
    }
    if (item.seq < firstSeq || item.seq >= firstSeq + count) {
      return {
        ok: false,
        outcome: 'item_not_in_manifest',
        reasons: [`items[${i}].seq ${item.seq} is not covered by this manifest (sequences ${firstSeq}..${firstSeq + count - 1})`],
        admitted: [],
        pending: [],
      };
    }
    if (seenSeq.has(item.seq)) {
      return { ok: false, outcome: 'duplicate_item', reasons: [`items[${i}].seq ${item.seq} is presented twice`], admitted: [], pending: [] };
    }
    seenSeq.add(item.seq);
    let digest;
    try {
      digest = batchDigest(flow, item.data);
    } catch (error) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}]: ${error.message}`], admitted: [], pending: [] };
    }
    const expected = verified.manifest.digests[item.seq - firstSeq];
    if (!constantTimeEqualStrings(digest, expected)) {
      return {
        ok: false,
        outcome: 'item_digest_mismatch',
        reasons: [
          `items[${i}].seq ${item.seq} digest does not match the manifest entry — the whole batch is refused (no partial acceptance)`,
        ],
        admitted: [],
        pending: [],
      };
    }
    admitted.push({ seq: item.seq, digest });
  }
  const pending = [];
  for (let seq = firstSeq; seq < firstSeq + count; seq++) {
    if (!seenSeq.has(seq)) pending.push(seq);
  }
  return {
    ok: true,
    outcome: 'admitted',
    admitted,
    pending,
    recordDigest: verified.recordDigest,
    epochEnd: verified.epochEnd,
    manifest: verified.manifest,
    reasons: [],
  };
}
