// numina-bc-provenance.js — Signed provenance for Media over QUIC
// (bc-provenance v2) as an NCPS record.
//
// Owner directive Nov 21, 2026: "implement the signed provenance for
// media over QUIC".
//
// Source: draft-ramadan-moq-multicast-03 (Ramadan, header 20 Nov 2026),
// §7.2 "bc-provenance" v2 (manifest-provenance profile), §7.2.1-§7.2.10
// and Appendix A test vectors. The -03 text was fetched from the IETF
// archive and read in full (7,444 lines) on 21 Nov 2026 (~08:17 UTC);
// every value in the Appendix A vectors was recomputed independently
// before this module was written (params_hash, ctx, pseudoheader, D_0,
// D_1, signed-message prefix, Ed25519 signature — all match).
//
// EVIDENCE CLASS (c): the draft is an unproven claim. No machine-
// checked proof, no named implementation, no KAT/ACVP pass is claimed
// anywhere here. The Appendix A vectors are the draft's own vectors,
// run through this implementation where they apply (see
// tests/numina-bc-provenance.test.mjs); they are NOT NCPS vectors, and
// the draft's binary wire record is NOT built by this module.
//
// What this module implements (the provenance mechanism, NOT a MoQ
// transport):
//   1. A self-contained Ed25519 signed-provenance record: the same
//      MHM2 manifest record as numina-batch-signature.js (label
//      "mcast-manifest-v2", scheme "manifest-ed25519-2", kid, epoch,
//      mseq, first_seq, count 1..37, hash_alg, flags, sent, ctx, flow,
//      digests), carried as a compact JWS over RFC 8785 JCS — plus
//      the draft-exact bc-provenance layers: the BCPV2 ctx /
//      params_hash derivation (§7.2.4), the catalog and key-range
//      model (§7.2.6), the verify-signature-first receiver order
//      (§7.2.7 step 1), and the explicit timing model (§7.2.5/§7.2.7).
//   2. Fail-closed receiver enforcement: the signature is verified
//      FIRST, and only on success are first_seq, flags and the
//      digests read. Any failure refuses the whole record — no
//      partial acceptance, nothing admitted.
//   3. SHA-256 mandatory for digests (Named Information hash_alg
//      suite 1, §7.2.10). No other suite is implemented; a record
//      carrying any other hash_alg is refused.
//   4. Explicit timing limits: every verified record carries the
//      timing bounds it was verified under (freshness window, pending
//      expiry, admitted-until, hold expiry, previous-epoch grace),
//      computed by bcTimingBounds. A receipt never implies timing it
//      does not bind.
//   5. ctx binding over namespace/packet metadata: the signed context
//      binds namespace fields, packetIds, codec/timescale/group
//      duration and the FEC instance parameters, so a receipt cannot
//      be replayed across stream/broadcast/key/epoch (§7.2.4/§7.2.8).
//      With no context source the receiver carries ctx blind, exactly
//      as the draft allows — and says so in the result.
//
// Relation to numina-batch-signature.js: the batch module implements
// the same MHM2 manifest in JCS form from draft-ramadan-mboned-
// mcast-manifest-01/02 (37-digest cap, ctx semantics, fail-closed
// receiver). This module does NOT duplicate that machinery: minting
// and item admission delegate to mintBatchManifest / batchDigest, and
// the new code is the bc-provenance profile on top of it — the
// draft-exact BCPV2 ctx derivation, the catalog, the key ranges,
// the verify-first ordering, and the timing model. The one ordering
// difference from the batch module is deliberate and is the point of
// §7.2.7: verifyBatchManifest validates the FULL manifest shape
// (including digests) before cryptography; verifyBcRecord validates
// only the header scalars before cryptography, verifies the
// signature, and only then reads first_seq, flags and the digests.
//
// What this module does NOT implement (MoQ-transport-specific, out
// of scope for NCPS):
//   - No MoQ transport, no QUIC datagrams, no multicast join, no
//     catalog fetching or endpoint dialing (§4, §7.3: a hostile
//     catalog is an attack vector; catalogs arrive here by
//     provisioning only, never fetched).
//   - No binary wire record: the draft's 132+32*count-octet record
//     (§7.2.3) is not built or parsed by this module. NCPS records
//     are JCS JSON; the Appendix A binary record is verified in the
//     tests by direct byte reads, not by this module.
//   - No FEC (§7.2.2 digests cover datagrams, not FEC symbols; the
//     FEC instance parameters enter params_hash only as context).
//   - No record twins, no manifest track, no mirror/unicast repair,
//     no hold queues (§7.2.5/§7.2.7 step 2 queueing is transport
//     behaviour; NCPS admits a batch only as a whole — see
//     receiveBcBatch).
//   - No broadcast carriage (§7.2.9, MMTP/ATSC): a broadcast that
//     re-addresses the flow is not covered by the draft either.
//   - No DVR/replay mode: the draft's relaxed checks for DVR are not
//     implemented; a receiver that needs them must say so explicitly
//     (skipFreshness is the only relaxation, and it is recorded).
//
// The module never holds or signs with keys: mint takes a `sign`
// callback, verify takes public keys only (a catalog's raw public
// keys, or a public JWK). Private JWK members are rejected by
// decodeJwkPublicKey.
//
// NCPS wiring: NONE is applied by this module. Where a bc-provenance
// record gates (MERF admission, control.js delegate path, or both)
// is an owner decision, recorded in the design note, not decided
// here.
//
// No KAT/ACVP pass is claimed: the draft publishes no KAT/ACVP
// vectors, and this module runs no KAT/ACVP suite. The tests are
// negative-control and mutant-kill tests plus the draft's Appendix A
// vectors (informative).
import { createHash } from 'node:crypto';
import {
  pedigreeCanonicalText,
  pedigreeTokenDigest,
  verifySigningInputSignature,
  parseCompactJws,
} from './numina-pedigree.js';
import {
  decodeJwkPublicKey,
  decodeStrictBase64url,
} from './numina-protocol-verify.js';
import {
  BATCH_LABEL,
  BATCH_SCHEME,
  BATCH_TYP,
  BATCH_HASH_ALG,
  BATCH_MAX_DIGESTS,
  BATCH_MIN_DIGESTS,
  BATCH_MAX_ITEM_BYTES,
  BATCH_EPOCH_END_FLAG,
  BATCH_RESERVED_FLAGS_MASK,
  zeroCtx,
  validateFlow,
  batchDigest,
  validateManifestShape,
  mintBatchManifest,
} from './numina-batch-signature.js';
import {
  checkTrustedStateAgainstHashAlg,
  validateTrustedState,
} from './numina-mmr-receipts.js';

export const BC_DRAFT = 'draft-ramadan-moq-multicast-03';
export const BC_PROFILE = 'bc-provenance';
export const BC_VERSION = 2;
export const BC_SIG = 'ed25519';
export const BC_HASH_ALG = 'sha-256';
/** Named Information hash_alg Suite ID (§7.2.10): 1 = sha-256, mandatory. */
export const BC_HASH_ALG_ID = 1;
export const BC_MAX_DIGESTS = BATCH_MAX_DIGESTS;
export const BC_MIN_DIGESTS = BATCH_MIN_DIGESTS;
export const BC_MAX_KEYS = 4;
export const BC_MIN_KEYS = 1;
/** §7.2.6 endpoint auth defaults and ranges. */
export const BC_DEFAULT_MAX_AUTH_DELAY_MS = 200;
export const BC_MIN_MAX_AUTH_DELAY_MS = 50;
export const BC_MAX_MAX_AUTH_DELAY_MS = 1000;
export const BC_DEFAULT_MANIFEST_TIMER_MS = 20;
export const BC_MIN_MANIFEST_TIMER_MS = 1;
/** §7.2.7 freshness: sent more than 7 s + maxAuthDelayMs behind, or
 *  more than 6 s ahead of, the receiver clock is stale. */
export const BC_FRESHNESS_BEHIND_BASE_SECONDS = 7;
export const BC_FRESHNESS_AHEAD_SECONDS = 6;
/** §7.2.7 Clock paragraph: freshness needs the receiver clock within
 *  5 s of UTC. */
export const BC_CLOCK_SYNC_SECONDS = 5;
/** §7.2.7 replay floor: a record with mseq + 64 <= highest_mseq is a replay. */
export const BC_REPLAY_FLOOR = 64;
/** §7.2.7 verification budget: token bucket depth 64. */
export const BC_BUDGET_DEPTH = 64;
export const BC_EPOCH_END_FLAG = BATCH_EPOCH_END_FLAG;

export const BC_OUTCOMES = Object.freeze({
  verified: 'verified',
  admitted: 'admitted',
  malformed: 'malformed',
  non_canonical: 'non_canonical',
  unknown_key: 'unknown_key',
  epoch_out_of_range: 'epoch_out_of_range',
  already_verified: 'already_verified',
  replay_floor: 'replay_floor',
  epoch_closed: 'epoch_closed',
  stale: 'stale',
  ctx_mismatch: 'ctx_mismatch',
  hash_alg_mismatch: 'hash_alg_mismatch',
  vds_mismatch: 'vds_mismatch',
  canonicalization_mismatch: 'canonicalization_mismatch',
  trusted_state_required: 'trusted_state_required',
  signature_invalid: 'signature_invalid',
  budget_exhausted: 'budget_exhausted',
  item_not_in_manifest: 'item_not_in_manifest',
  duplicate_item: 'duplicate_item',
  item_digest_mismatch: 'item_digest_mismatch',
});

function fail(message) {
  throw new Error(`bc-provenance: ${message}`);
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

/** u16 length-prefixed UTF-8 string (lp16), big endian, as the draft uses. */
function lp16(value) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > 0xffff) fail('lp16 string is over 65535 bytes');
  return concatBytes([u16be(bytes.length), bytes]);
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

function checkU32(value, name) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    fail(`${name} must be a 32-bit unsigned integer`);
  }
}

function checkSafeNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${name} must be a safe non-negative integer`);
  }
}

/** Constant-time equality for two base64url strings (length-checked first). */
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
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const bytes = decodeStrictBase64url(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Strict dotted-quad IPv4 parse (§7.2.2: S/G are fixed-width native
 * addresses, never IPv4-mapped). Rejects leading zeros, out-of-range
 * octets, and anything that is not four decimal octets.
 */
export function parseIpv4(value) {
  if (typeof value !== 'string') fail('IPv4 address must be a string');
  const parts = value.split('.');
  if (parts.length !== 4) fail(`'${value}' is not a dotted-quad IPv4 address`);
  const octets = parts.map((part) => {
    if (!/^(0|[1-9][0-9]*)$/.test(part)) fail(`'${value}' is not a dotted-quad IPv4 address`);
    const n = Number(part);
    if (!Number.isSafeInteger(n) || n > 255) fail(`'${value}' is not a dotted-quad IPv4 address`);
    return n;
  });
  return new Uint8Array(octets);
}

// ---------------------------------------------------------------------------
// Signature context (§7.2.4): BCPV2-params and BCPV2-ctx
// ---------------------------------------------------------------------------

export const BC_PARAMS_FIELDS = Object.freeze([
  'codec',
  'timescale',
  'groupDurationTicks',
  'fecInstances',
]);

export const BC_FEC_INSTANCE_FIELDS = Object.freeze([
  'scheme',
  'sourceSymbols',
  'repairSymbols',
  'symbolSize',
  'interleaveDepthMs',
]);

export const BC_CONTEXT_FIELDS = Object.freeze([
  'namespaceFields',
  'packetIds',
  'params',
]);

function validateParams(params) {
  if (!isPlainObject(params)) fail('params must be an object');
  checkNoUnknownFields(params, BC_PARAMS_FIELDS, 'params');
  checkNonEmptyString(params.codec, 'params.codec');
  checkU32(params.timescale, 'params.timescale');
  checkU32(params.groupDurationTicks, 'params.groupDurationTicks');
  if (!Array.isArray(params.fecInstances)) fail('params.fecInstances must be an array');
  params.fecInstances.forEach((instance, i) => {
    if (!isPlainObject(instance)) fail(`params.fecInstances[${i}] must be an object`);
    checkNoUnknownFields(instance, [...BC_FEC_INSTANCE_FIELDS, 'instanceId'], `params.fecInstances[${i}]`);
    checkNonEmptyString(instance.scheme, `params.fecInstances[${i}].scheme`);
    for (const name of ['sourceSymbols', 'repairSymbols', 'symbolSize', 'interleaveDepthMs']) {
      checkU32(instance[name], `params.fecInstances[${i}].${name}`);
    }
    if (instance.instanceId !== undefined) checkU32(instance.instanceId, `params.fecInstances[${i}].instanceId`);
  });
}

/**
 * params_hash (§7.2.4, -03 text; Appendix B.1: instances in ascending
 * instanceId, each as lp16(scheme), u32(sourceSymbols),
 * u32(repairSymbols), u32(symbolSize), u32(interleaveDepthMs), with
 * no instance count and no instanceId field; an entry without FEC
 * carries lp16("none") and four u32(0)):
 *   params_hash = H("BCPV2-params" || lp16(codec) || u32(timescale)
 *     || u32(groupDurationTicks) || m*(lp16(scheme) ||
 *     u32(sourceSymbols) || u32(repairSymbols) || u32(symbolSize) ||
 *     u32(interleaveDepthMs)))
 * Returned as unpadded base64url of 32 octets.
 */
export function deriveBcParamsHash(params) {
  validateParams(params);
  const encoder = new TextEncoder();
  const parts = [
    encoder.encode('BCPV2-params'),
    lp16(params.codec),
    u32be(params.timescale),
    u32be(params.groupDurationTicks),
  ];
  const instances = [...params.fecInstances].sort(
    (a, b) => (a.instanceId ?? 0) - (b.instanceId ?? 0),
  );
  if (instances.length === 0) {
    parts.push(lp16('none'), u32be(0), u32be(0), u32be(0), u32be(0));
  } else {
    for (const instance of instances) {
      parts.push(
        lp16(instance.scheme),
        u32be(instance.sourceSymbols),
        u32be(instance.repairSymbols),
        u32be(instance.symbolSize),
        u32be(instance.interleaveDepthMs),
      );
    }
  }
  return base64urlEncode(sha256Bytes(concatBytes(parts)));
}

function validateBcContext(context) {
  if (!isPlainObject(context)) fail('context must be an object');
  checkNoUnknownFields(context, BC_CONTEXT_FIELDS, 'context');
  if (!Array.isArray(context.namespaceFields)) fail('context.namespaceFields must be an array');
  context.namespaceFields.forEach((field, i) => checkNonEmptyString(field, `context.namespaceFields[${i}]`));
  if (!Array.isArray(context.packetIds)) fail('context.packetIds must be an array');
  context.packetIds.forEach((id, i) => checkU32(id, `context.packetIds[${i}]`));
  validateParams(context.params);
}

/**
 * ctx (§7.2.4):
 *   ctx = H("BCPV2-ctx" || u16(f) || f*lp16(field) || u16(n)
 *     || n*u16(packetId) || params_hash)
 * where f is the number of namespace fields, n the number of endpoint
 * packetIds, and params_hash is the 32 raw octets of
 * deriveBcParamsHash. Returned as unpadded base64url of 32 octets.
 * A context with no catalog sets ctx to 32 zero octets (draft
 * §7.2.4) — use zeroCtx() for that; this function always derives.
 */
export function deriveBcCtx(context) {
  validateBcContext(context);
  const encoder = new TextEncoder();
  const paramsHashBytes = decodeStrictBase64url(deriveBcParamsHash(context.params));
  const parts = [
    encoder.encode('BCPV2-ctx'),
    u16be(context.namespaceFields.length),
    ...context.namespaceFields.map((field) => lp16(field)),
    u16be(context.packetIds.length),
    ...context.packetIds.map((id) => u16be(id)),
    paramsHashBytes,
  ];
  return base64urlEncode(sha256Bytes(concatBytes(parts)));
}

// ---------------------------------------------------------------------------
// Datagram digest (§7.2.2, draft-exact form)
// ---------------------------------------------------------------------------

/**
 * The item digest in the draft's exact wire form (§7.2.2):
 *   D = H(pseudoheader || payload), SHA-256
 *   pseudoheader = S || G || 0x00 || 0x11 || u16(payload_length)
 *     || u16(src_port) || u16(dst_port) || u32(streamId)
 * with S/G raw IPv4 octets and src_port == dst_port == port.
 * Returned as "sha256:" + 64 lowercase hex characters.
 *
 * This differs from batchDigest (numina-batch-signature.js), whose
 * NCPS pseudoheader carries UTF-8 source/group identifiers. The two
 * digests are NOT interchangeable: bcDatagramDigest is the digest
 * the draft's Appendix A vectors are computed over, and it is the
 * digest a receiver recomputes for a datagram arriving on a real
 * (S, G, port) endpoint. NCPS batch admission (receiveBcBatch) uses
 * batchDigest, the JCS record's digest; bcDatagramDigest exists so
 * the draft's vectors run through this implementation and so a
 * future NCPS bridge to a real endpoint can recompute the wire
 * digest without re-deriving the pseudoheader by hand.
 */
export function bcDatagramDigest({ source, group, port, streamId, data }) {
  const sourceBytes = parseIpv4(source);
  const groupBytes = parseIpv4(group);
  checkU32(port, 'port');
  if (port < 1 || port > 65535) fail('port must be an integer in 1..65535');
  checkU32(streamId, 'streamId');
  if (!(data instanceof Uint8Array)) fail('data must be bytes (Uint8Array)');
  if (data.length > BATCH_MAX_ITEM_BYTES) {
    fail(`data is ${data.length} bytes, over the ${BATCH_MAX_ITEM_BYTES}-byte bound (draft §7.2.2 u16 payload_length)`);
  }
  const pseudoheader = concatBytes([
    sourceBytes,
    groupBytes,
    new Uint8Array([0x00, 0x11]),
    u16be(data.length),
    u16be(port),
    u16be(port),
    u32be(streamId),
  ]);
  return `sha256:${hex(sha256Bytes(concatBytes([pseudoheader, data])))}`;
}

// ---------------------------------------------------------------------------
// Catalog and key ranges (§7.2.6)
// ---------------------------------------------------------------------------

export const BC_CATALOG_FIELDS = Object.freeze([
  'scheme',
  'version',
  'sig',
  'keys',
  'minEpoch',
  'endpoint',
]);

export const BC_CATALOG_KEY_FIELDS = Object.freeze([
  'kid',
  'publicKey',
  'firstEpoch',
]);

export const BC_ENDPOINT_FIELDS = Object.freeze([
  'streamId',
  'port',
  'maxAuthDelayMs',
  'manifestTimerMs',
  'manifestTrack',
  'bandwidth',
]);

/**
 * Validate a bc-provenance catalog (§7.2.6). The catalog is
 * provisioning, never fetched: scheme "bc-provenance", version 2,
 * sig "ed25519"; keys 1..4 of { kid, publicKey, firstEpoch };
 * minEpoch; optional endpoint auth { streamId (required when an
 * endpoint is present), port, maxAuthDelayMs (default 200, clamped
 * to 50..1000 per §7.2.7), manifestTimerMs (default 20, >= 1),
 * manifestTrack, bandwidth }.
 *
 * Returns { ok, reasons, normalized } — normalized has the defaults
 * applied, maxAuthDelayMs clamped, and keys sorted by firstEpoch
 * ascending. A catalog whose keys share a firstEpoch, or whose
 * endpoint carries a bad value, is invalid (the draft: a receiver
 * ignores endpoints with bad values; here the whole catalog is
 * refused, fail-closed, rather than silently dropping an endpoint).
 */
export function validateBcCatalog(catalog) {
  const reasons = [];
  if (!isPlainObject(catalog)) return { ok: false, reasons: ['catalog must be an object'], normalized: null };
  for (const key of Object.keys(catalog)) {
    if (!BC_CATALOG_FIELDS.includes(key)) reasons.push(`catalog has unknown field '${key}'`);
  }
  if (catalog.scheme !== BC_PROFILE) reasons.push(`catalog.scheme must be '${BC_PROFILE}'`);
  if (catalog.version !== BC_VERSION) reasons.push(`catalog.version must be ${BC_VERSION}`);
  if (catalog.sig !== BC_SIG) reasons.push(`catalog.sig must be '${BC_SIG}'`);
  if (!Array.isArray(catalog.keys)) {
    reasons.push('catalog.keys must be an array');
  } else {
    if (catalog.keys.length < BC_MIN_KEYS || catalog.keys.length > BC_MAX_KEYS) {
      reasons.push(`catalog.keys must hold ${BC_MIN_KEYS}..${BC_MAX_KEYS} keys (draft §7.2.6)`);
    }
    const firstEpochs = new Set();
    catalog.keys.forEach((entry, i) => {
      if (!isPlainObject(entry)) {
        reasons.push(`catalog.keys[${i}] must be an object`);
        return;
      }
      for (const key of Object.keys(entry)) {
        if (!BC_CATALOG_KEY_FIELDS.includes(key)) reasons.push(`catalog.keys[${i}] has unknown field '${key}'`);
      }
      if (typeof entry.kid !== 'string' || entry.kid.length === 0) {
        reasons.push(`catalog.keys[${i}].kid must be a non-empty string`);
      }
      if (decodeCtxBytes(entry.publicKey) === null) {
        reasons.push(`catalog.keys[${i}].publicKey must be strict unpadded base64url of 32 octets`);
      }
      if (!Number.isSafeInteger(entry.firstEpoch) || entry.firstEpoch < 0 || entry.firstEpoch > 0xffffffff) {
        reasons.push(`catalog.keys[${i}].firstEpoch must be a 32-bit unsigned integer`);
      } else if (firstEpochs.has(entry.firstEpoch)) {
        reasons.push(`catalog.keys[${i}].firstEpoch ${entry.firstEpoch} is carried by two keys — firstEpoch values must be distinct`);
      } else {
        firstEpochs.add(entry.firstEpoch);
      }
    });
  }
  if (!Number.isSafeInteger(catalog.minEpoch) || catalog.minEpoch < 0 || catalog.minEpoch > 0xffffffff) {
    reasons.push('catalog.minEpoch must be a 32-bit unsigned integer');
  }
  let endpoint = null;
  if (catalog.endpoint !== undefined) {
    if (!isPlainObject(catalog.endpoint)) {
      reasons.push('catalog.endpoint must be an object');
    } else {
      endpoint = { ...catalog.endpoint };
      for (const key of Object.keys(endpoint)) {
        if (!BC_ENDPOINT_FIELDS.includes(key)) reasons.push(`catalog.endpoint has unknown field '${key}'`);
      }
      if (!Number.isSafeInteger(endpoint.streamId) || endpoint.streamId < 0 || endpoint.streamId > 0xffffffff) {
        reasons.push('catalog.endpoint.streamId must be a 32-bit unsigned integer');
      }
      if (endpoint.port !== undefined && (!Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535)) {
        reasons.push('catalog.endpoint.port must be an integer in 1..65535');
      }
      if (endpoint.maxAuthDelayMs === undefined) {
        endpoint.maxAuthDelayMs = BC_DEFAULT_MAX_AUTH_DELAY_MS;
      } else if (!Number.isSafeInteger(endpoint.maxAuthDelayMs)) {
        reasons.push('catalog.endpoint.maxAuthDelayMs must be an integer');
      } else {
        // §7.2.7: the receiver clamps maxAuthDelayMs to 50..1000 ms.
        endpoint.maxAuthDelayMs = Math.min(
          BC_MAX_MAX_AUTH_DELAY_MS,
          Math.max(BC_MIN_MAX_AUTH_DELAY_MS, endpoint.maxAuthDelayMs),
        );
      }
      if (endpoint.manifestTimerMs === undefined) {
        endpoint.manifestTimerMs = BC_DEFAULT_MANIFEST_TIMER_MS;
      } else if (!Number.isSafeInteger(endpoint.manifestTimerMs) || endpoint.manifestTimerMs < BC_MIN_MANIFEST_TIMER_MS) {
        reasons.push(`catalog.endpoint.manifestTimerMs must be an integer >= ${BC_MIN_MANIFEST_TIMER_MS}`);
      }
      if (endpoint.manifestTrack !== undefined && (typeof endpoint.manifestTrack !== 'string' || endpoint.manifestTrack.length === 0)) {
        reasons.push('catalog.endpoint.manifestTrack must be a non-empty string');
      }
      if (endpoint.bandwidth !== undefined && (!Number.isSafeInteger(endpoint.bandwidth) || endpoint.bandwidth < 1)) {
        reasons.push('catalog.endpoint.bandwidth must be a positive integer (bits per second)');
      }
    }
  }
  if (reasons.length > 0) return { ok: false, reasons, normalized: null };
  const normalized = {
    scheme: catalog.scheme,
    version: catalog.version,
    sig: catalog.sig,
    keys: [...catalog.keys]
      .sort((a, b) => a.firstEpoch - b.firstEpoch)
      .map((entry) => ({ kid: entry.kid, publicKey: entry.publicKey, firstEpoch: entry.firstEpoch })),
    minEpoch: catalog.minEpoch,
    endpoint,
  };
  return { ok: true, reasons: [], normalized };
}

/**
 * The key that signs an epoch (§7.2.6/§7.2.7): the key with the
 * greatest firstEpoch <= epoch. The key with the largest firstEpoch
 * signs all later epochs. Returns null when no key's firstEpoch is
 * <= epoch. `keys` must be the normalized (sorted) array from
 * validateBcCatalog.
 */
export function bcKeyForEpoch(keys, epoch) {
  if (!Array.isArray(keys)) fail('keys must be an array');
  checkU32(epoch, 'epoch');
  let found = null;
  for (const entry of keys) {
    if (entry.firstEpoch <= epoch) found = entry;
    else break;
  }
  return found;
}

/**
 * Endpoint timing for a catalog: maxAuthDelayMs and manifestTimerMs
 * with the §7.2.6 defaults when the catalog carries no endpoint.
 */
export function bcEndpointTiming(catalog) {
  if (catalog === undefined || catalog === null) {
    return { maxAuthDelayMs: BC_DEFAULT_MAX_AUTH_DELAY_MS, manifestTimerMs: BC_DEFAULT_MANIFEST_TIMER_MS };
  }
  const checked = validateBcCatalog(catalog);
  if (!checked.ok) fail(`catalog is invalid: ${checked.reasons.join('; ')}`);
  const endpoint = checked.normalized.endpoint;
  return {
    maxAuthDelayMs: endpoint?.maxAuthDelayMs ?? BC_DEFAULT_MAX_AUTH_DELAY_MS,
    manifestTimerMs: endpoint?.manifestTimerMs ?? BC_DEFAULT_MANIFEST_TIMER_MS,
  };
}

// ---------------------------------------------------------------------------
// Verification budget and timing (§7.2.5, §7.2.7)
// ---------------------------------------------------------------------------

/**
 * The verification-budget refill rate V (§7.2.7): V = max(1000,
 * 1.25 * maxBitrate / (8 * 512 * 37)) verifications per second.
 * maxBitrate is bits per second.
 */
export function verificationRefillRate(maxBitrateBps) {
  if (!Number.isSafeInteger(maxBitrateBps) || maxBitrateBps < 0) {
    fail('maxBitrateBps must be a safe non-negative integer');
  }
  return Math.max(1000, (1.25 * maxBitrateBps) / (8 * 512 * 37));
}

/**
 * Token-bucket verification budget (§7.2.7): depth 64, refilled at
 * refillPerSecond. take(nowMs) refills by elapsed time, then spends
 * one token if one is available; returns false when the bucket is
 * empty. Times are milliseconds. A receiver without a budget does
 * no rate limiting — the budget is caller-owned and optional in
 * verifyBcRecord; when supplied, exhaustion refuses the record.
 */
export function createVerificationBudget({ depth = BC_BUDGET_DEPTH, refillPerSecond = 1000, nowMs = 0 } = {}) {
  if (!Number.isSafeInteger(depth) || depth < 1) fail('budget depth must be a safe integer >= 1');
  if (typeof refillPerSecond !== 'number' || !(refillPerSecond > 0)) fail('refillPerSecond must be a positive number');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail('nowMs must be a safe non-negative integer');
  const budget = {
    depth,
    refillPerSecond,
    tokens: depth,
    lastRefillMs: nowMs,
    take(atMs) {
      if (!Number.isSafeInteger(atMs) || atMs < 0) fail('take time must be a safe non-negative integer');
      if (atMs > this.lastRefillMs) {
        const elapsedSeconds = (atMs - this.lastRefillMs) / 1000;
        this.tokens = Math.min(this.depth, this.tokens + elapsedSeconds * this.refillPerSecond);
        this.lastRefillMs = atMs;
      }
      if (this.tokens < 1) return false;
      this.tokens -= 1;
      return true;
    },
  };
  return budget;
}

/**
 * The explicit timing bounds a bc-provenance receipt carries
 * (§7.2.5/§7.2.7). All bounds are milliseconds unless named
 * otherwise; nowMs is the receiver's clock in milliseconds.
 *   freshnessBehindMs: 7 s + maxAuthDelayMs — a record sent older
 *     than this behind the receiver clock is stale.
 *   freshnessAheadMs: 6 s — a record sent further than this ahead
 *     of the receiver clock is stale.
 *   pendingExpiryMs: now + maxAuthDelayMs + 2*manifestTimerMs
 *     (+ lead) — when a verified record's pending entries expire.
 *   admittedUntilMs: now + maxAuthDelayMs (+ lead) — how long an
 *     admitted digest is kept.
 *   holdExpiryMs: now + maxAuthDelayMs + widen — when a held
 *     datagram expires (widen W is the unicast-path widening,
 *     §7.2.5; 0 when no widening applies).
 *   previousEpochGraceMs: 5 s + maxAuthDelayMs + 2*manifestTimerMs
 *     — how long the previous epoch stays admissible after a new
 *     epoch becomes current (§7.2.7).
 * leadMs and widenMs are receiver-chosen, capped at 5 s by the
 * draft (§7.3); values above 5000 are refused here.
 */
export function bcTimingBounds({
  maxAuthDelayMs = BC_DEFAULT_MAX_AUTH_DELAY_MS,
  manifestTimerMs = BC_DEFAULT_MANIFEST_TIMER_MS,
  nowMs = 0,
  leadMs = 0,
  widenMs = 0,
} = {}) {
  if (!Number.isSafeInteger(maxAuthDelayMs) || maxAuthDelayMs < 1) fail('maxAuthDelayMs must be a safe integer >= 1');
  if (!Number.isSafeInteger(manifestTimerMs) || manifestTimerMs < 1) fail('manifestTimerMs must be a safe integer >= 1');
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) fail('nowMs must be a safe non-negative integer');
  if (!Number.isSafeInteger(leadMs) || leadMs < 0 || leadMs > 5000) fail('leadMs must be an integer in 0..5000');
  if (!Number.isSafeInteger(widenMs) || widenMs < 0 || widenMs > 5000) fail('widenMs must be an integer in 0..5000');
  return Object.freeze({
    maxAuthDelayMs,
    manifestTimerMs,
    leadMs,
    widenMs,
    freshnessBehindMs: BC_FRESHNESS_BEHIND_BASE_SECONDS * 1000 + maxAuthDelayMs,
    freshnessAheadMs: BC_FRESHNESS_AHEAD_SECONDS * 1000,
    freshnessBehindSeconds: BC_FRESHNESS_BEHIND_BASE_SECONDS + maxAuthDelayMs / 1000,
    freshnessAheadSeconds: BC_FRESHNESS_AHEAD_SECONDS,
    pendingExpiryMs: nowMs + maxAuthDelayMs + 2 * manifestTimerMs + leadMs,
    admittedUntilMs: nowMs + maxAuthDelayMs + leadMs,
    holdExpiryMs: nowMs + maxAuthDelayMs + widenMs,
    previousEpochGraceMs: BC_CLOCK_SYNC_SECONDS * 1000 + maxAuthDelayMs + 2 * manifestTimerMs,
  });
}

// ---------------------------------------------------------------------------
// Receiver state (§7.2.7 step 1)
// ---------------------------------------------------------------------------

/**
 * Caller-owned receiver state for verifyBcRecord. The draft's step-1
 * drops need memory: the current and previous epochs (with the
 * previous epoch's grace deadline), the closing mseq of any closed
 * epoch, the highest mseq seen per (kid, epoch), the set of verified
 * (kid, epoch, mseq) triples, the flow's fixed hash_alg, and any
 * pinned epoch floor. Without a state object, verifyBcRecord skips
 * the stateful drops and says so in the result (replayChecked:
 * false) — a stateless verifier has no replay protection, exactly
 * as the draft's Clock paragraph warns for a receiver with no
 * verified record yet.
 */
export function createBcReceiverState() {
  return {
    currentEpoch: null,
    currentKid: null,
    epochBecameCurrentMs: null,
    previousEpoch: null,
    previousKid: null,
    previousDeadlineMs: null,
    closedEpochs: new Map(),
    highestMseq: new Map(),
    verifiedRecords: new Set(),
    fixedHashAlg: null,
    pinnedEpochFloor: new Map(),
  };
}

export function bcRecordKey(kid, epoch, mseq) {
  return `${kid}:${epoch}:${mseq}`;
}

// ---------------------------------------------------------------------------
// Minting (§7.2.3/§7.2.4/§7.2.5, NCPS JCS form)
// ---------------------------------------------------------------------------

function failResult(outcome, reasons, extra = {}) {
  return {
    ok: false,
    outcome,
    reasons,
    signatureVerified: false,
    admittedDigests: [],
    recordDigest: null,
    epochEnd: false,
    timing: null,
    ...extra,
  };
}

/**
 * Mint a bc-provenance record. `fields` is the manifest record
 * WITHOUT ctx and WITHOUT a signature: kid, epoch, mseq, first_seq,
 * count, hash_alg ('sha-256'), flags, sent, flow, digests.
 * `context` (optional) is the §7.2.4 context { namespaceFields,
 * packetIds, params }; its ctx is derived by deriveBcCtx. With no
 * context the record carries 32 zero octets (draft §7.2.4: a flow
 * with no catalog sets ctx to zero octets).
 * `catalog` (optional) is validated, and the record's kid/epoch must
 * fall inside it; the publicJwk must be the catalog key's key.
 * `sign` signs the JWS Signing Input bytes and returns a 64-byte
 * Ed25519 signature; `publicJwk` is that key — the fresh signature
 * is re-verified against it before the record is returned (by
 * mintBatchManifest), and minting throws if re-verification fails.
 * Reserved flag bits (1-7) MUST be zero on send (draft §7.2.3).
 * Returns { manifest, ctx, paramsHash, timing } where manifest is
 * the mintBatchManifest result { compact, header, payload,
 * signingInput, signatureBytes }.
 */
export function mintBcRecord(args) {
  if (!args || typeof args !== 'object') fail('args must be an object');
  const { fields, sign, publicJwk, context, catalog } = args;
  if (typeof sign !== 'function') {
    fail('sign must be a function (signingInputBytes: Uint8Array) => Uint8Array signature (64 bytes)');
  }
  if (!fields || typeof fields !== 'object') fail('fields must be an object');
  let normalizedCatalog = null;
  if (catalog !== undefined) {
    const checked = validateBcCatalog(catalog);
    if (!checked.ok) fail(`catalog is invalid: ${checked.reasons.join('; ')}`);
    normalizedCatalog = checked.normalized;
    const keyEntry = normalizedCatalog.keys.find((entry) => entry.kid === fields.kid);
    if (!keyEntry) fail(`kid '${fields.kid}' is not in the catalog key set`);
    if (fields.epoch < keyEntry.firstEpoch) {
      fail(`epoch ${fields.epoch} is below key '${fields.kid}' firstEpoch ${keyEntry.firstEpoch}`);
    }
    const covering = bcKeyForEpoch(normalizedCatalog.keys, fields.epoch);
    if (!covering || covering.kid !== fields.kid) {
      fail(`epoch ${fields.epoch} is not signed by key '${fields.kid}' under this catalog`);
    }
    if (fields.epoch < normalizedCatalog.minEpoch) {
      fail(`epoch ${fields.epoch} is below the catalog minEpoch ${normalizedCatalog.minEpoch}`);
    }
    let publicKeyRaw;
    try {
      publicKeyRaw = decodeJwkPublicKey(publicJwk);
    } catch (error) {
      fail(`publicJwk is not a valid public JWK: ${error.message}`);
    }
    if (base64urlEncode(publicKeyRaw) !== keyEntry.publicKey) {
      fail('publicJwk does not match the catalog key for this kid');
    }
  }
  let ctx;
  let paramsHash = null;
  if (context !== undefined) {
    ctx = deriveBcCtx(context);
    paramsHash = deriveBcParamsHash(context.params);
  } else {
    ctx = zeroCtx();
  }
  const timing = bcTimingBounds(bcEndpointTiming(catalog ?? null));
  const manifest = mintBatchManifest({
    fields: {
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
      ctx,
      flow: fields.flow,
      digests: fields.digests,
    },
    sign,
    publicJwk,
  });
  return { manifest, ctx, paramsHash, timing };
}

// ---------------------------------------------------------------------------
// Fail-closed receiver (§7.2.7 step 1): verify FIRST, read fields after
// ---------------------------------------------------------------------------

/**
 * Validate ONLY the header scalars of a manifest payload — the
 * fields the draft's step 1 reads before any cryptography (kid,
 * epoch, mseq, count, hash_alg, sent, ctx, flow, label, scheme).
 * first_seq, flags and digests are NOT read here: in the binary
 * record they sit past the signed prefix, and in this JCS form
 * reading them before the signature verifies would break the
 * verify-first order. Their shape is checked after the signature
 * verifies, by validateManifestShape. Returns { ok, reasons }.
 */
function validateBcHeaderScalars(payload) {
  const reasons = [];
  if (!isPlainObject(payload)) return { ok: false, reasons: ['manifest payload must be an object'] };
  if (payload.label !== BATCH_LABEL) reasons.push(`label must be '${BATCH_LABEL}'`);
  if (payload.scheme !== BATCH_SCHEME) reasons.push(`scheme must be '${BATCH_SCHEME}'`);
  if (typeof payload.kid !== 'string' || payload.kid.length === 0) {
    reasons.push('kid must be a non-empty string');
  }
  for (const name of ['epoch', 'mseq']) {
    if (!Number.isSafeInteger(payload[name]) || payload[name] < 0) {
      reasons.push(`${name} must be a safe non-negative integer`);
    }
  }
  if (Number.isSafeInteger(payload.epoch) && (payload.epoch < 0 || payload.epoch > 0xffffffff)) {
    reasons.push('epoch must be a 32-bit unsigned integer');
  }
  if (!Number.isSafeInteger(payload.count) || payload.count < BC_MIN_DIGESTS || payload.count > BC_MAX_DIGESTS) {
    reasons.push(`count must be an integer in ${BC_MIN_DIGESTS}..${BC_MAX_DIGESTS} (draft §7.2.3)`);
  }
  if (typeof payload.hash_alg !== 'string') {
    reasons.push('hash_alg must be a string');
  }
  if (!Number.isSafeInteger(payload.sent) || payload.sent < 0 || payload.sent > 0xffffffff) {
    reasons.push('sent must be a 32-bit unsigned integer (POSIX seconds, draft §7.2.3)');
  }
  if (decodeCtxBytes(payload.ctx) === null) {
    reasons.push('ctx must be strict unpadded base64url of 32 octets (draft §7.2.4)');
  }
  const flowCheck = validateFlow(payload.flow);
  if (!flowCheck.ok) reasons.push(...flowCheck.reasons.map((r) => `flow: ${r}`));
  return { ok: reasons.length === 0, reasons };
}

/**
 * Verify one bc-provenance record, fail-closed, in the draft §7.2.7
 * step-1 order:
 *   1. Parse the compact JWS (typ, JCS exactness).
 *   2. Read ONLY the header scalars. Any failure here refuses the
 *      record before any cryptography.
 *   3. Catalog drops: unknown kid, epoch outside the key's range,
 *      epoch below minEpoch / a pinned floor.
 *   4. Receiver-state drops: already verified (kid, epoch, mseq),
 *      epoch below the current epoch and outside the previous
 *      epoch's grace, replay floor (mseq + 64 <= highest_mseq),
 *      mseq above a closed epoch's closing mseq, fixed hash_alg.
 *   5. Freshness (unless skipFreshness): sent more than 7 s +
 *      maxAuthDelayMs behind, or more than 6 s ahead of, the
 *      receiver clock.
 *   6. ctx recompute-and-reject, when the caller holds the context
 *      source. Without it, ctx is carried blind (and the result
 *      says so).
 *   7. Verification-budget charge, when a budget is supplied.
 *   8. The Ed25519 signature. Only on success are first_seq,
 *      flags and the digests read (full shape check) and the
 *      receiver state advanced.
 * Any failure refuses the WHOLE record: admittedDigests is [] and
 * nothing is admitted.
 *
 * opts:
 *   catalog (optional): a §7.2.6 catalog (validated here). Keys are
 *     taken ONLY from it, never from the record or any carrier.
 *   publicJwk (optional, required without a catalog): the signer's
 *     public JWK. Private JWK members are rejected.
 *   context (optional): the §7.2.4 context { namespaceFields,
 *     packetIds, params } the receiver holds. When supplied, the
 *     record's ctx MUST equal deriveBcCtx(context).
 *   receiverState (optional): a createBcReceiverState() object.
 *     Without it, the stateful drops are skipped and the result
 *     carries replayChecked: false.
 *   nowUnixSeconds (required): the receiver's clock, POSIX seconds.
 *   skipFreshness (default false): skip the freshness check alone,
 *     as the draft's Clock paragraph allows a receiver with no
 *     synchronized clock — the result records that there is no
 *     replay protection until the first verified record sets the
 *     floor.
 *   budget (optional): a createVerificationBudget() bucket; one
 *     token is charged before the signature is verified.
 *   maxAuthDelayMs / manifestTimerMs (optional): override the
 *     catalog endpoint's values (defaults 200 / 20).
 *   maxTotalSize (default 65536): compact-serialization byte bound.
 *   trustedState (optional): a TrustedState from
 *     numina-mmr-receipts.js (MMR -05 §11.5). When supplied, the
 *     manifest's hash_alg is compared against the state's
 *     vds/hashAlg and the manifest's JCS form against the state's
 *     canonicalization; a mismatch refuses the record. The state
 *     is NOT advanced by a bc record (it carries no tree).
 *   requireTrustedState (optional, default false): when true and
 *     no trustedState is supplied, the verification is refused,
 *     never defaulted.
 *   registry (optional): a VDS registry for the trusted state
 *     (default: the draft's MMR_SHA256 registry). Needed only when
 *     the trusted state names a VDS registered outside it.
 *
 * Success returns { ok: true, outcome: 'verified',
 * signatureVerified: true, recordDigest (base64url SHA-256 of the
 * signing input), epochEnd (flags bit 0), manifest (the payload),
 * admittedDigests: [{ seq, digest }], timing (bcTimingBounds),
 * replayChecked, ctxChecked, ctxCarriedBlind, freshnessChecked,
 * trustedStateBound (true when a trusted state was supplied and
 * the record's hash/canonicalization matched it), reasons: [] }.
 * Failure returns { ok: false, outcome, reasons,
 * signatureVerified (true only when the signature had verified
 * before a later, post-signature failure), admittedDigests: [],
 * recordDigest: null, epochEnd: false, timing } with outcome one
 * of BC_OUTCOMES.
 *
 * One documented adaptation: in the binary record, count is
 * checkable pre-crypto from the record length (count ==
 * (len-132)/32). In this JCS form, digests.length is only known by
 * reading the digests array, which the verify-first rule forbids
 * before the signature — so count == digests.length is enforced
 * post-signature by validateManifestShape. The count range 1..37
 * is still checked pre-crypto.
 */
export function verifyBcRecord(manifest, opts = {}) {
  const timingDefaults = (() => {
    try {
      return bcEndpointTiming(opts.catalog ?? null);
    } catch {
      return { maxAuthDelayMs: BC_DEFAULT_MAX_AUTH_DELAY_MS, manifestTimerMs: BC_DEFAULT_MANIFEST_TIMER_MS };
    }
  })();
  const maxAuthDelayMs = opts.maxAuthDelayMs === undefined ? timingDefaults.maxAuthDelayMs : opts.maxAuthDelayMs;
  const manifestTimerMs = opts.manifestTimerMs === undefined ? timingDefaults.manifestTimerMs : opts.manifestTimerMs;
  const nowMs = Number.isSafeInteger(opts.nowUnixSeconds) && opts.nowUnixSeconds >= 0
    ? opts.nowUnixSeconds * 1000
    : 0;
  // Timing is computed from sanitized values so a malformed option can
  // never make the verifier throw — the explicit validation below
  // returns the malformed result instead.
  const timing = bcTimingBounds({
    maxAuthDelayMs: Number.isSafeInteger(maxAuthDelayMs) && maxAuthDelayMs >= 1
      ? maxAuthDelayMs
      : BC_DEFAULT_MAX_AUTH_DELAY_MS,
    manifestTimerMs: Number.isSafeInteger(manifestTimerMs) && manifestTimerMs >= 1
      ? manifestTimerMs
      : BC_DEFAULT_MANIFEST_TIMER_MS,
    nowMs,
  });
  const failWith = (outcome, reasons, extra = {}) => failResult(outcome, reasons, { timing, ...extra });

  if (!opts || typeof opts !== 'object') {
    return failWith('malformed', ['verifier options must be an object']);
  }
  if (!Number.isSafeInteger(opts.nowUnixSeconds) || opts.nowUnixSeconds < 0) {
    return failWith('malformed', ['nowUnixSeconds is required and must be a safe non-negative integer']);
  }
  if (!Number.isSafeInteger(maxAuthDelayMs) || maxAuthDelayMs < 1) {
    return failWith('malformed', ['maxAuthDelayMs must be a safe integer >= 1']);
  }
  if (!Number.isSafeInteger(manifestTimerMs) || manifestTimerMs < 1) {
    return failWith('malformed', ['manifestTimerMs must be a safe integer >= 1']);
  }
  const maxTotalSize = opts.maxTotalSize === undefined ? 65536 : opts.maxTotalSize;
  if (!Number.isSafeInteger(maxTotalSize) || maxTotalSize < 1) {
    return failWith('malformed', ['maxTotalSize must be a safe integer >= 1']);
  }
  if (typeof manifest === 'string' && manifest.length > maxTotalSize) {
    return failWith('malformed', [`manifest is ${manifest.length} bytes, over the configured bound of ${maxTotalSize}`]);
  }
  let normalizedCatalog = null;
  if (opts.catalog !== undefined) {
    const checked = validateBcCatalog(opts.catalog);
    if (!checked.ok) {
      return failWith('malformed', [`catalog is invalid: ${checked.reasons.join('; ')}`]);
    }
    normalizedCatalog = checked.normalized;
  }
  let receiverState = null;
  if (opts.receiverState !== undefined) {
    if (!isPlainObject(opts.receiverState)
      || !(opts.receiverState.verifiedRecords instanceof Set)
      || !(opts.receiverState.highestMseq instanceof Map)
      || !(opts.receiverState.closedEpochs instanceof Map)
      || !(opts.receiverState.pinnedEpochFloor instanceof Map)) {
      return failWith('malformed', ['receiverState must be a createBcReceiverState() object']);
    }
    receiverState = opts.receiverState;
  }
  let budget = null;
  if (opts.budget !== undefined) {
    if (!opts.budget || typeof opts.budget.take !== 'function') {
      return failWith('malformed', ['budget must be a createVerificationBudget() object']);
    }
    budget = opts.budget;
  }
  let expectedCtx = null;
  if (opts.context !== undefined) {
    try {
      expectedCtx = deriveBcCtx(opts.context);
    } catch (error) {
      return failWith('malformed', [`context is invalid: ${error.message}`]);
    }
  }
  // Trusted-state threading (MMR -05 §11.5): a caller may bind
  // this verification to a TrustedState. When requireTrustedState
  // is set and no state is supplied, refuse rather than default.
  let trustedState = null;
  if (opts.trustedState !== undefined) {
    const checked = validateTrustedState(opts.trustedState, opts.registry);
    if (!checked.ok) {
      return failWith('malformed', [`trustedState is invalid: ${checked.reasons.join('; ')}`]);
    }
    trustedState = opts.trustedState;
  }
  if (opts.requireTrustedState === true && trustedState === null) {
    return failWith('trusted_state_required', ['requireTrustedState is set but no trustedState was supplied — refusing rather than defaulting']);
  }

  // Step 1 — Parse (compact JWS, typ, JCS exactness). Never throws.
  const parsed = parseCompactJws(manifest, BATCH_TYP);
  if (!parsed.ok) {
    return failWith(parsed.outcome, [`manifest: ${parsed.reasons.join('; ')}`]);
  }
  const payload = parsed.payload;

  // Step 2 — Header scalars ONLY, before any cryptography.
  const scalars = validateBcHeaderScalars(payload);
  if (!scalars.ok) {
    return failWith('malformed', scalars.reasons.map((r) => `manifest: ${r}`));
  }

  // Step 3 — Catalog drops: key identity and epoch range.
  let publicKeyRaw = null;
  if (normalizedCatalog !== null) {
    if (payload.epoch < normalizedCatalog.minEpoch) {
      return failWith('epoch_out_of_range', [
        `epoch ${payload.epoch} is below the catalog minEpoch ${normalizedCatalog.minEpoch} (draft §7.2.6)`,
      ]);
    }
    const keyEntry = normalizedCatalog.keys.find((entry) => entry.kid === payload.kid);
    if (!keyEntry) {
      return failWith('unknown_key', [`kid '${payload.kid}' is not in the catalog key set`]);
    }
    if (payload.epoch < keyEntry.firstEpoch) {
      return failWith('epoch_out_of_range', [
        `epoch ${payload.epoch} is below key '${payload.kid}' firstEpoch ${keyEntry.firstEpoch}`,
      ]);
    }
    const covering = bcKeyForEpoch(normalizedCatalog.keys, payload.epoch);
    if (!covering || covering.kid !== payload.kid) {
      return failWith('epoch_out_of_range', [
        `epoch ${payload.epoch} is signed by key '${covering ? covering.kid : 'none'}' under this catalog, not '${payload.kid}'`,
      ]);
    }
    publicKeyRaw = decodeStrictBase64url(keyEntry.publicKey);
  } else {
    if (opts.publicJwk === undefined) {
      return failWith('malformed', ['no public key: supply a catalog or publicJwk']);
    }
    try {
      publicKeyRaw = decodeJwkPublicKey(opts.publicJwk);
    } catch (error) {
      return failWith('malformed', [`publicJwk is not a valid public JWK: ${error.message}`]);
    }
  }

  // Step 4 — Receiver-state drops.
  const recordKey = bcRecordKey(payload.kid, payload.epoch, payload.mseq);
  if (receiverState !== null) {
    if (receiverState.verifiedRecords.has(recordKey)) {
      return failWith('already_verified', [
        `(kid, epoch, mseq) ${recordKey} is already verified — the twin or a replay (draft §7.2.7 step 1)`,
      ]);
    }
    if (receiverState.currentEpoch !== null && payload.epoch < receiverState.currentEpoch) {
      const inPreviousGrace = receiverState.previousEpoch === payload.epoch
        && receiverState.previousKid === payload.kid
        && receiverState.previousDeadlineMs !== null
        && nowMs <= receiverState.previousDeadlineMs;
      if (!inPreviousGrace) {
        return failWith('epoch_out_of_range', [
          `epoch ${payload.epoch} is below the current epoch ${receiverState.currentEpoch} and outside the previous epoch's grace (draft §7.2.7 step 1)`,
        ]);
      }
    }
    const pinnedFloor = receiverState.pinnedEpochFloor.get(payload.kid);
    if (pinnedFloor !== undefined && payload.epoch < pinnedFloor) {
      return failWith('epoch_out_of_range', [
        `epoch ${payload.epoch} is below the pinned floor ${pinnedFloor} for kid '${payload.kid}'`,
      ]);
    }
    const epochKey = `${payload.kid}:${payload.epoch}`;
    const highest = receiverState.highestMseq.get(epochKey);
    if (highest !== undefined && payload.mseq + BC_REPLAY_FLOOR <= highest) {
      return failWith('replay_floor', [
        `mseq ${payload.mseq} + ${BC_REPLAY_FLOOR} <= highest_mseq ${highest} for (kid, epoch) — replay floor (draft §7.2.7 step 1)`,
      ]);
    }
    const closingMseq = receiverState.closedEpochs.get(`${payload.kid}:${payload.epoch}`);
    if (closingMseq !== undefined && payload.mseq > closingMseq) {
      return failWith('epoch_closed', [
        `epoch ${payload.epoch} closed at mseq ${closingMseq}; this record's mseq ${payload.mseq} is above it (draft §7.2.7 step 1)`,
      ]);
    }
    if (receiverState.fixedHashAlg !== null && payload.hash_alg !== receiverState.fixedHashAlg) {
      return failWith('hash_alg_mismatch', [
        `hash_alg '${payload.hash_alg}' differs from the flow's fixed hash_alg '${receiverState.fixedHashAlg}' (draft §7.2.7 step 1)`,
      ]);
    }
  }

  // hash_alg: only SHA-256 is implemented (§7.2.10, suite 1 mandatory).
  if (payload.hash_alg !== BC_HASH_ALG) {
    return failWith('hash_alg_mismatch', [
      `hash_alg '${payload.hash_alg}' is not implemented — only '${BC_HASH_ALG}' (suite 1, mandatory, draft §7.2.10)`,
    ]);
  }
  // Trusted-state comparison (MMR -05 §11.5): the manifest's
  // hash_alg must match the trusted state's vds/hashAlg, and the
  // manifest's JCS form must match the state's canonicalization.
  // The signature profile is NOT compared here: this draft fixes
  // Ed25519, and the profile is an MMR-receipt concept.
  if (trustedState !== null) {
    const tsCheck = checkTrustedStateAgainstHashAlg(trustedState, payload.hash_alg, opts.registry);
    if (!tsCheck.ok) return failWith(tsCheck.outcome, tsCheck.reasons);
  }

  // Step 5 — Freshness (unless the receiver has no synchronized clock).
  const skipFreshness = opts.skipFreshness === true;
  if (!skipFreshness) {
    const behindSeconds = BC_FRESHNESS_BEHIND_BASE_SECONDS + maxAuthDelayMs / 1000;
    if (payload.sent > opts.nowUnixSeconds + BC_FRESHNESS_AHEAD_SECONDS) {
      return failWith('stale', [
        `sent (${payload.sent}) is more than ${BC_FRESHNESS_AHEAD_SECONDS} s ahead of the receiver clock (${opts.nowUnixSeconds})`,
      ]);
    }
    if (payload.sent < opts.nowUnixSeconds - behindSeconds) {
      return failWith('stale', [
        `sent (${payload.sent}) is more than ${behindSeconds} s behind the receiver clock (${opts.nowUnixSeconds})`,
      ]);
    }
  }

  // Step 6 — ctx recompute-and-reject, when the caller holds the context.
  if (expectedCtx !== null && !constantTimeEqualStrings(payload.ctx, expectedCtx)) {
    return failWith('ctx_mismatch', ['ctx differs from the value recomputed from the held context source (draft §7.2.4)']);
  }

  // Step 7 — Verification budget.
  if (budget !== null && !budget.take(nowMs)) {
    return failWith('budget_exhausted', ['verification budget is exhausted — record refused before cryptography (draft §7.2.7 step 1)']);
  }

  // Step 8 — The signature. Only on success are the remaining fields read.
  const signatureOk = verifySigningInputSignature({
    publicKeyRaw,
    signatureBytes: parsed.signatureBytes,
    signingInputAscii: parsed.signingInput,
  });
  if (!signatureOk) {
    return failWith('signature_invalid', ['Ed25519 signature over the record failed verification']);
  }

  // Step 9 — ONLY NOW read first_seq, flags and the digests.
  const shape = validateManifestShape(payload);
  if (!shape.ok) {
    return failWith('malformed', shape.reasons.map((r) => `manifest: ${r}`), { signatureVerified: true });
  }
  if ((payload.flags & BATCH_RESERVED_FLAGS_MASK) !== 0) {
    return failWith('malformed', ['reserved flag bits 1-7 must be zero (draft §7.2.3)'], { signatureVerified: true });
  }

  // Success — advance the receiver state.
  const recordDigest = pedigreeTokenDigest(parsed.signingInput);
  const epochEnd = (payload.flags & BC_EPOCH_END_FLAG) === BC_EPOCH_END_FLAG;
  if (receiverState !== null) {
    receiverState.verifiedRecords.add(recordKey);
    const epochKey = `${payload.kid}:${payload.epoch}`;
    const highest = receiverState.highestMseq.get(epochKey);
    if (highest === undefined || payload.mseq > highest) {
      receiverState.highestMseq.set(epochKey, payload.mseq);
    }
    if (receiverState.fixedHashAlg === null) receiverState.fixedHashAlg = payload.hash_alg;
    if (receiverState.currentEpoch === null || payload.epoch > receiverState.currentEpoch) {
      if (receiverState.currentEpoch !== null) {
        receiverState.previousEpoch = receiverState.currentEpoch;
        receiverState.previousKid = receiverState.currentKid;
        receiverState.previousDeadlineMs = nowMs + timing.previousEpochGraceMs;
      }
      receiverState.currentEpoch = payload.epoch;
      receiverState.currentKid = payload.kid;
      receiverState.epochBecameCurrentMs = nowMs;
    }
    if (epochEnd) receiverState.closedEpochs.set(epochKey, payload.mseq);
  }
  const admittedDigests = payload.digests.map((digest, i) => ({
    seq: payload.first_seq + i,
    digest,
  }));
  return {
    ok: true,
    outcome: 'verified',
    recordDigest,
    epochEnd,
    manifest: payload,
    admittedDigests,
    signatureVerified: true,
    timing,
    replayChecked: receiverState !== null,
    ctxChecked: expectedCtx !== null,
    ctxCarriedBlind: expectedCtx === null,
    trustedStateBound: trustedState !== null,
    freshnessChecked: !skipFreshness,
    freshnessSkipped: skipFreshness,
    reasons: skipFreshness
      ? ['freshness check skipped (no synchronized clock): no replay protection until the first verified record sets the floor (draft §7.2.7 Clock paragraph)']
      : [],
  };
}

// ---------------------------------------------------------------------------
// Batch admission (§7.2.7 step 2, NCPS form: no partial acceptance)
// ---------------------------------------------------------------------------

/**
 * Admit a batch of items against a bc-provenance record, fail-closed.
 * The record is verified first (verifyBcRecord, same opts); if it
 * fails, the WHOLE batch is refused and admitted is []. Then EVERY
 * presented item's digest is recomputed (batchDigest, the JCS
 * record's digest) and checked against the record entry for its
 * sequence; any mismatch, any item whose sequence the record does
 * not cover, or any duplicated sequence refuses the WHOLE batch.
 * This is stricter than the draft's per-datagram admission (§7.2.7
 * step 2 admits datagrams as they arrive): NCPS admits a batch only
 * as a whole, so a receiver never holds a partially-authenticated
 * batch. Items need not cover the whole record: sequences the caller
 * did not present are reported as `pending`, not as failures.
 *
 * items: [{ seq, data }] with data a Uint8Array (<= 65535 bytes).
 * opts: as verifyBcRecord.
 *
 * Success returns { ok: true, outcome: 'admitted',
 * admitted: [{ seq, digest }], pending: [seq, ...], recordDigest,
 * epochEnd, manifest, timing, signatureVerified: true }.
 * Failure returns { ok: false, outcome, reasons, admitted: [],
 * pending: [], signatureVerified } with outcome one of the
 * verifyBcRecord outcomes or item_not_in_manifest | duplicate_item |
 * item_digest_mismatch | malformed.
 */
export function receiveBcBatch(manifest, items, opts = {}) {
  const verified = verifyBcRecord(manifest, opts);
  if (!verified.ok) {
    return {
      ok: false,
      outcome: verified.outcome,
      reasons: verified.reasons,
      admitted: [],
      pending: [],
      signatureVerified: verified.signatureVerified,
      timing: verified.timing,
    };
  }
  if (!Array.isArray(items)) {
    return { ok: false, outcome: 'malformed', reasons: ['items must be an array'], admitted: [], pending: [], signatureVerified: true, timing: verified.timing };
  }
  const flow = verified.manifest.flow;
  const firstSeq = verified.manifest.first_seq;
  const count = verified.manifest.count;
  const seenSeq = new Set();
  const admitted = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item)) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}] must be an object`], admitted: [], pending: [], signatureVerified: true, timing: verified.timing };
    }
    if (!Number.isSafeInteger(item.seq) || item.seq < 0) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}].seq must be a safe non-negative integer`], admitted: [], pending: [], signatureVerified: true, timing: verified.timing };
    }
    if (!(item.data instanceof Uint8Array)) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}].data must be bytes (Uint8Array)`], admitted: [], pending: [], signatureVerified: true, timing: verified.timing };
    }
    if (item.data.length > BATCH_MAX_ITEM_BYTES) {
      return {
        ok: false,
        outcome: 'malformed',
        reasons: [`items[${i}].data is ${item.data.length} bytes, over the ${BATCH_MAX_ITEM_BYTES}-byte bound`],
        admitted: [],
        pending: [],
        signatureVerified: true,
        timing: verified.timing,
      };
    }
    if (item.seq < firstSeq || item.seq >= firstSeq + count) {
      return {
        ok: false,
        outcome: 'item_not_in_manifest',
        reasons: [`items[${i}].seq ${item.seq} is not covered by this record (sequences ${firstSeq}..${firstSeq + count - 1})`],
        admitted: [],
        pending: [],
        signatureVerified: true,
        timing: verified.timing,
      };
    }
    if (seenSeq.has(item.seq)) {
      return { ok: false, outcome: 'duplicate_item', reasons: [`items[${i}].seq ${item.seq} is presented twice`], admitted: [], pending: [], signatureVerified: true, timing: verified.timing };
    }
    seenSeq.add(item.seq);
    let digest;
    try {
      digest = batchDigest(flow, item.data);
    } catch (error) {
      return { ok: false, outcome: 'malformed', reasons: [`items[${i}]: ${error.message}`], admitted: [], pending: [], signatureVerified: true, timing: verified.timing };
    }
    const expected = verified.manifest.digests[item.seq - firstSeq];
    if (!constantTimeEqualStrings(digest, expected)) {
      return {
        ok: false,
        outcome: 'item_digest_mismatch',
        reasons: [
          `items[${i}].seq ${item.seq} digest does not match the record entry — the whole batch is refused (no partial acceptance)`,
        ],
        admitted: [],
        pending: [],
        signatureVerified: true,
        timing: verified.timing,
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
    timing: verified.timing,
    signatureVerified: true,
    reasons: [],
  };
}
