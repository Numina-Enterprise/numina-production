// numina-moq-transport.js — Media over QUIC Transport (MOQT) session,
// relay and multicast join, at the NETWORK level.
//
// Owner directive Nov 21, 2026 (~10:31 CST): "Implement MoQ transport
// and multicast join. This must be applied on a network level, not just
// a provenance record."
//
// Sources (read in full from the IETF archive, 21 Nov 2026):
//   - draft-ietf-moq-transport-23 (Nandakumar et al., 2 Nov 2026, 176 pp.,
//     16,589 lines; expires 6 May 2027) — the MoQ session, relay,
//     control-message and data-plane wire formats implemented here.
//     SETUP (§9.1), GOAWAY (§9.2), REQUEST_OK/ERROR (§9.3/§9.4),
//     REQUEST_UPDATE (§9.5), SUBSCRIBE (§9.6), SUBSCRIBE_OK (§9.7),
//     PUBLISH (§9.8), PUBLISH_DONE (§9.9), PUBLISH_STATE_NOTIFY (§9.10),
//     FETCH (§9.11), TRACK_STATUS (§9.12), PUBLISH_NAMESPACE (§9.13),
//     SUBSCRIBE_NAMESPACE (§9.14), NAMESPACE (§9.15), NAMESPACE_DONE
//     (§9.16), SUBSCRIBE_TRACKS (§9.17), PUBLISH_SKIPPED (§9.18),
//     parameters (§9.19), priorities (§5.1), delivery timeouts (§5.2),
//     sessions (§6), relays (§7), common structures (§8), object
//     datagrams / subgroups / fetch streams / padding (§11), malformed
//     tracks (§12.1) and error codes (§12.2–§12.5).
//   - draft-ramadan-moq-multicast-02 (Ramadan, Nov 2026; -03 text read
//     in full in the prior session, 7,444 lines) §4.1 multicast
//     endpoints and join rules, §4.2 AMT/ATSC3 network sources.
//   - draft-ramadan-moq-mmt-02 §3.1 MMTP packet header and §4.1/§4.2
//     MoQ mapping (Package → Namespace, Asset by Packet ID → Track,
//     MPU → Group, MPU data unit → Subgroup ID, MMTP packet → Object).
//
// CRITICAL NAMING CHANGE (-23 vs the older names in the task brief):
// CLIENT_SETUP / SERVER_SETUP (0x40/0x41), SUBSCRIBE_ERROR,
// UNSUBSCRIBE and the ANNOUNCE family do NOT exist in -23. They are
// RESERVED legacy types (Table 5). The -23 equivalents are:
//   - SETUP (0x2F00), one message in both directions; version
//     negotiation happens at the QUIC/WebTransport layer (ALPN
//     "moqt-23"), NOT in the SETUP body, which is Setup Options KVPs
//     only (§9.1). There is no ROLE parameter in -23.
//   - Errors are REQUEST_ERROR (0x05), named SUBSCRIBE_ERROR etc. in
//     prose per §1.5; PUBLISH errors are REQUEST_ERROR with the
//     PUBLISH request ID.
//   - Announce is PUBLISH_NAMESPACE / SUBSCRIBE_NAMESPACE / NAMESPACE /
//     NAMESPACE_DONE (§9.13–§9.16).
//   - Unsubscribing is ending the request stream (STOP_SENDING /
//     PUBLISH_DONE path, §6.4.2.3); there is no UNSUBSCRIBE message.
// The legacy names are kept only in MOQ_LEGACY_NAME_MAP so callers
// using the old names get the -23 mapping, and the decoder refuses the
// reserved legacy type codes with UNEXPECTED_MESSAGE.
//
// EVIDENCE CLASS (c): the drafts are unproven claims. No machine-
// checked proof, no named implementation, no KAT/ACVP pass is claimed
// anywhere here. No interop with any external MoQ implementation is
// claimed: the wire codecs are tested against the draft's own examples
// (varint Table 4, range-filter §8.6 example, namespace rendering
// §8.8 example) and against round-trips through this implementation.
// They are NOT interop vectors.
//
// What this module implements (transport + join, NOT just a record):
//   1. Draft-exact wire codecs: varints (§8.1), KVPs (§8.3), track
//      namespaces (§8.7) and rendering (§8.8), Locations (§8.2),
//      reason phrases (§8.5), range filters (§8.6), auth tokens
//      (§8.9), setup options (§9.1), all 18 Table 5 control messages
//      (§9.1–§9.18), message parameters (§9.19, incl. nested
//      FILL_PARAMETERS), object datagrams (§11.2), subgroup headers
//      and subgroup objects (§11.3), fetch headers and fetch objects
//      (§11.4), padding (§11.5).
//   2. A MoQ session state machine: SETUP handshake, request-ID
//      allocation and parity (§6.4.2.1), track-alias registry (§3.1.3),
//      subscription lifecycle (§3.1), REQUEST_UPDATE coalescing and
//      MAX_REQUEST_UPDATES enforcement (§9.1.7/§9.5), EXPIRES (§9.19.16),
//      MAX_CONTROL_MESSAGE_SIZE (§9.1.8), GOAWAY (§9.2) and session
//      close. Requests before SETUP, duplicate request IDs, wrong
//      parity, duplicate track aliases and oversize control messages
//      are refused with named session errors.
//   3. Group/object sequencing with malformed-track detection (§12.1):
//      strict in-order admission per subgroup, duplicate-with-
//      different-payload/mode refusal, object-beyond-final refusal,
//      group regression refusal.
//   4. §5.1 scheduling order and §5.2 delivery-timeout rules as pure
//      functions (smaller non-zero timeout wins; 0 = none).
//   5. A caching relay (§7): track registry, object cache keyed by
//      Full Track Name + Group ID + Object ID, namespace advertisement,
//      fan-out to downstream subscriptions, paused handling (§7.2:
//      upstream stays unpaused while any downstream is unpaused),
//      malformed-track handling (§12.1: downstream PUBLISH_DONE
//      MALFORMED_TRACK, fetch streams reset, triggering objects not
//      cached).
//   6. Multicast join (ramadan §4.1): endpoint validation (protocol /
//      sourceAddress consistency, group-address ranges for SSM/ASM,
//      packetId 1..65535, bandwidth required on protected endpoints,
//      auth consistency, one (S,G,port) tuple → one namespace and one
//      endpoint), join/leave lifecycle over real UDP sockets
//      (addMembership / addSourceSpecificMembership), per-packet_id
//      MMTP sequence tracking with gap detection, unlisted packet_id
//      discard, packet_id 0 routed to the signaling path only, and
//      hysteresis for unicast fallback / switch-back.
//   7. MMTP packet codec (moq-mmt-02 §3.1): 12-byte header, version 00
//      enforced, packet-counter flag C=0 enforced, FEC types, packet
//      types, signaling-message header; and the MoQ mapping
//      (§4.1/§4.2) as an explicit caller-supplied group/object
//      wrapper (MPU sequence → group/object needs the MPU-mode payload
//      header, §4.4/§5 — out of scope, see limits).
//   8. Catalog handling: parse the MSF catalog track's `multicast`
//      member, validate its endpoints, and fetch the catalog over an
//      established MoQ session by SUBSCRIBE to the track named
//      `catalog`. There is deliberately NO out-of-band catalog fetch
//      (no HTTP, no dial-out): a hostile catalog is an attack vector
//      (multicast -03 §7.3), so catalogs arrive by provisioning or
//      over the session, never by fetching a URL.
//   9. bc-provenance admission on the multicast leg: a manifest
//      record is verified FIRST (verifyBcRecord) and only then are
//      datagrams admitted — per-packet digest comparison against the
//      verified manifest, or whole-batch admission via receiveBcBatch.
//      A failed verification refuses the datagram(s) and records the
//      reason; nothing is admitted. IPv6 protected endpoints are
//      refused for bc admission (the bc digest is defined over an
//      IPv4 pseudoheader).
//  10. Transports: a QUIC probe (detectQuicSupport) that reports
//      honestly — node:quic / WebTransport are NOT available in the
//      pinned Node 26.13.1 build, so createQuicTransport refuses with
//      `quic_unavailable` and probe evidence; a real TCP loopback
//      transport carrying draft-exact MoQ wire bytes inside an
//      NCPS-internal frame (the draft defines no TCP carriage, §6.2);
//      and a real UDP multicast socket transport. End-to-end tests
//      run publisher → relay → subscriber over real TCP loopback
//      sockets. UDP loopback delivery does NOT work in this VM
//      (sandbox blocks UDP socket creation/delivery — verified by
//      probe, see design note); UDP join/membership is live, UDP
//      datagram delivery is transport-abstraction-only here and is
//      recorded as such, never presented as a live result.
//
// This module NEVER holds or signs keys: verification uses public
// keys / sign callbacks only, exactly as numina-bc-provenance.js
// does. It moves no funds, commits nothing, and performs no network
// dial-out beyond the loopback/multicast sockets its caller asks for.
//
// Wiring/gating: NOT applied. Where this module's session, relay,
// multicast join or bc-provenance admission gates (MERF admission,
// control.js delegate path, or both) is an OWNER decision — recorded
// in the design note, not applied here.
//
// Honest limits (see the design note for the full list):
//   - No QUIC/WebTransport in this Node build; the QUIC transport is
//     a refused stub with probe evidence, and the transport interface
//     is shaped so a QUIC transport can be added later.
//   - UDP datagram delivery cannot be verified live in this VM.
//   - No AMT relay implementation (discovery/validation out of scope);
//     ATSC 3.0 broadcast carriage out of scope (§7.2.9).
//   - No FEC symbol handling ([MOQ-FEC-CORE] not implemented): FEC
//     Type 1 source packets expose the trailing 4-byte Source FEC
//     Payload ID opaquely; repair-symbol parsing and the
//     SS_ID/(SS_Start, RS_ID) dedup are out of scope.
//   - No MPU-mode parsing (moq-mmt-02 §4.4/§5): MPU sequence →
//     group/object mapping is caller-supplied.
//   - No DVR/replay mode; no manifest track / twins / mirror.
//   - The MSF catalog JSON shape (draft-ietf-moq-msf) is not pinned
//     here: the `multicast` member and its endpoints are parsed
//     strictly, the rest of the catalog is treated opaquely.
//   - Range-filter parameters carry a SetID (8 bytes) whenever the
//     filter Length is non-zero (§3.3.2: "Each Range Filter parameter
//     carries a SetID"); a non-zero-length filter value shorter than
//     8 bytes is refused with INVALID_FILTER. This is the module's
//     reading of §8.6 + §9.19.10–§9.19.14, recorded in the design
//     note; it is not independently confirmed against another
//     implementation.
//   - Duplicate known Setup Options are refused with INVALID_FIELD
//     (the draft forbids the sender repeating them but names no close
//     code; this is an NCPS choice, recorded in the design note).

import net from 'node:net';
import dgram from 'node:dgram';
import {
  verifyBcRecord,
  receiveBcBatch,
  validateBcCatalog,
  createBcReceiverState,
  createVerificationBudget,
  bcDatagramDigest,
  parseIpv4,
  BC_DRAFT,
} from './numina-bc-provenance.js';
import { batchDigest } from './numina-batch-signature.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MOQ_DRAFT = 'draft-ietf-moq-transport-23';
export const MOQ_DRAFT_NUMBER = 23;
export const MOQ_ALPN = 'moqt-23';
export const MOQ_MULTICAST_DRAFT = 'draft-ramadan-moq-multicast-02';
export const MOQ_MMT_DRAFT = 'draft-ramadan-moq-mmt-02';
export const MOQ_BC_DRAFT = BC_DRAFT;

export const MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE = 65535;
export const MOQ_MIN_MAX_CONTROL_MESSAGE_SIZE = 65535;
export const MOQ_MAX_NAMESPACE_FIELDS = 32;
export const MOQ_MAX_FULL_TRACK_NAME_BYTES = 4096;
export const MOQ_MAX_REASON_PHRASE_BYTES = 1024;
export const MOQ_MAX_KVP_VALUE_BYTES = 65535;
export const MOQ_DEFAULT_SUBSCRIBER_PRIORITY = 128;
export const MOQ_SESSION_NAMESPACE = ['.session'];
export const MOQ_CATALOG_TRACK_NAME = 'catalog';

// Control message types, draft-ietf-moq-transport-23 Table 5 (§9).
export const MOQ_MESSAGE_TYPES = Object.freeze({
  SETUP: 0x2f00,
  GOAWAY: 0x10,
  SUBSCRIBE: 0x03,
  SUBSCRIBE_OK: 0x04,
  REQUEST_OK: 0x07,
  REQUEST_ERROR: 0x05,
  REQUEST_UPDATE: 0x02,
  PUBLISH: 0x1d,
  PUBLISH_DONE: 0x0b,
  PUBLISH_STATE_NOTIFY: 0x22,
  FETCH: 0x16,
  TRACK_STATUS: 0x0d,
  PUBLISH_NAMESPACE: 0x06,
  SUBSCRIBE_NAMESPACE: 0x50,
  SUBSCRIBE_TRACKS: 0x51,
  NAMESPACE: 0x08,
  NAMESPACE_DONE: 0x0e,
  PUBLISH_SKIPPED: 0x0f,
});
export const MOQ_MESSAGE_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(MOQ_MESSAGE_TYPES).map(([name, value]) => [value, name])),
);

// Reserved legacy type codes (Table 5). Receiving any of these is
// UNEXPECTED_MESSAGE (§9). The old names they carried are mapped in
// MOQ_LEGACY_NAME_MAP.
export const MOQ_RESERVED_MESSAGE_TYPES = Object.freeze({
  0x01: 'SETUP for version 00',
  0x40: 'CLIENT_SETUP for <= 10',
  0x41: 'SERVER_SETUP for <= 10',
  0x20: 'CLIENT_SETUP in <= 16',
  0x21: 'SERVER_SETUP in <= 16',
  0x1e: 'PUBLISH_OK in <= 17',
  0x18: 'FETCH_OK in <= 22',
});

// Old (pre-23) names → their -23 equivalents. The old messages do not
// exist on the wire in -23; this map exists so callers using the old
// names are pointed at the right -23 mechanism instead of silently
// building a non-conformant message.
export const MOQ_LEGACY_NAME_MAP = Object.freeze({
  CLIENT_SETUP: { replacedBy: 'SETUP', note: 'one SETUP (0x2F00) in both directions; version negotiated by ALPN moqt-23' },
  SERVER_SETUP: { replacedBy: 'SETUP', note: 'one SETUP (0x2F00) in both directions; version negotiated by ALPN moqt-23' },
  SUBSCRIBE_ERROR: { replacedBy: 'REQUEST_ERROR', note: 'REQUEST_ERROR (0x05) with the SUBSCRIBE request ID; error code DOES_NOT_EXIST etc.' },
  PUBLISH_OK: { replacedBy: 'REQUEST_OK', note: 'REQUEST_OK (0x07) with the PUBLISH request ID' },
  FETCH_OK: { replacedBy: 'REQUEST_OK', note: 'REQUEST_OK (0x07) with the FETCH request ID' },
  UNSUBSCRIBE: { replacedBy: 'STOP_SENDING / PUBLISH_DONE', note: 'end the request stream; publisher answers PUBLISH_DONE (§6.4.2.3)' },
  ANNOUNCE: { replacedBy: 'PUBLISH_NAMESPACE', note: 'PUBLISH_NAMESPACE (0x06) advertises a namespace prefix' },
  ANNOUNCE_OK: { replacedBy: 'REQUEST_OK', note: 'REQUEST_OK (0x07) with the PUBLISH_NAMESPACE request ID' },
  ANNOUNCE_ERROR: { replacedBy: 'REQUEST_ERROR', note: 'REQUEST_ERROR (0x05) with the PUBLISH_NAMESPACE request ID' },
  UNANNOUNCE: { replacedBy: 'NAMESPACE_DONE', note: 'NAMESPACE_DONE (0x0E) ends a namespace advertisement' },
});

// Setup option types (§9.1).
export const MOQ_SETUP_OPTIONS = Object.freeze({
  PATH: 0x01,
  AUTHORIZATION_TOKEN: 0x03,
  MAX_AUTH_TOKEN_CACHE_SIZE: 0x04,
  AUTHORITY: 0x05,
  MAX_FILTER_RANGES: 0x06,
  MOQT_IMPLEMENTATION: 0x07,
  MAX_REQUEST_UPDATES: 0x08,
  MAX_CONTROL_MESSAGE_SIZE: 0x09,
});

// Message parameter types (§9.19).
export const MOQ_PARAMETERS = Object.freeze({
  OBJECT_DELIVERY_TIMEOUT: 0x02,
  AUTHORIZATION_TOKEN: 0x03,
  RENDEZVOUS_TIMEOUT: 0x04,
  SUBGROUP_DELIVERY_TIMEOUT: 0x06,
  EXPIRES: 0x08,
  LARGEST_OBJECT: 0x09,
  FILL_TIMEOUT: 0x0a,
  PAUSED: 0x11,
  SUBSCRIBER_PRIORITY: 0x20,
  LOCATION_FILTER: 0x21,
  GROUP_ORDER: 0x22,
  FILL_PARAMETERS: 0x23,
  SUBGROUP_FILTER: 0x25,
  OBJECTID_FILTER: 0x26,
  PRIORITY_FILTER: 0x27,
  OBJECT_PROPERTY_FILTER: 0x28,
  TRACK_PROPERTY_FILTER: 0x29,
  NEW_GROUP_REQUEST: 0x32,
  TRACK_NAMESPACE_PREFIX: 0x34,
  INCLUDE_PROPERTIES: 0x35,
  SUBSCRIBE_TRACKS_ID: 0x36,
});

// Which parameters may appear in which message (§9.19 per-message lists).
// FILL_PARAMETERS is handled separately (nested scope, §9.19.15).
export const MOQ_PARAMETER_SCOPE = Object.freeze({
  SUBSCRIBE: [0x02, 0x03, 0x04, 0x06, 0x11, 0x20, 0x21, 0x22, 0x23, 0x25, 0x26, 0x27, 0x28, 0x32, 0x35],
  SUBSCRIBE_OK: [0x08, 0x09],
  PUBLISH: [0x02, 0x03, 0x06, 0x08, 0x09, 0x11, 0x20, 0x21, 0x22, 0x23, 0x36],
  FETCH: [0x03, 0x0a, 0x20, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x35],
  TRACK_STATUS: [0x03, 0x35],
  PUBLISH_NAMESPACE: [0x03],
  SUBSCRIBE_NAMESPACE: [0x03],
  SUBSCRIBE_TRACKS: [0x03, 0x06, 0x02, 0x11, 0x20, 0x21, 0x22, 0x23, 0x25, 0x26, 0x27, 0x28, 0x29, 0x35],
  REQUEST_UPDATE: [0x02, 0x03, 0x06, 0x08, 0x09, 0x11, 0x20, 0x21, 0x22, 0x23, 0x25, 0x26, 0x27, 0x28, 0x29, 0x32, 0x34, 0x35],
  PUBLISH_STATE_NOTIFY: [0x09, 0x11, 0x21],
  REQUEST_OK: [0x08, 0x09],
});
// Parameters allowed inside FILL_PARAMETERS (§9.19.15 Table 7).
export const MOQ_FILL_PARAMETER_TYPES = Object.freeze([0x0a, 0x20, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28]);
// Parameters that make a REQUEST_UPDATE non-coalescible (§9.5).
export const MOQ_NON_COALESCIBLE_PARAMETERS = Object.freeze([0x23, 0x34]);

// Session termination error codes (§12.2).
export const MOQ_SESSION_ERROR_CODES = Object.freeze({
  NO_ERROR: 0x0,
  INTERNAL_ERROR: 0x1,
  UNAUTHORIZED: 0x2,
  PROTOCOL_VIOLATION: 0x3,
  INVALID_REQUEST_ID: 0x4,
  DUPLICATE_TRACK_ALIAS: 0x5,
  MALFORMED_KEY_VALUE: 0x6,
  INVALID_PATH: 0x8,
  MALFORMED_PATH: 0x9,
  GOAWAY_TIMEOUT: 0x10,
  CONTROL_MESSAGE_TIMEOUT: 0x11,
  DATA_STREAM_TIMEOUT: 0x12,
  AUTH_TOKEN_CACHE_OVERFLOW: 0x13,
  DUPLICATE_AUTH_TOKEN_ALIAS: 0x14,
  MALFORMED_AUTH_TOKEN: 0x16,
  UNKNOWN_AUTH_TOKEN_ALIAS: 0x17,
  EXPIRED_AUTH_TOKEN: 0x18,
  INVALID_AUTHORITY: 0x19,
  MALFORMED_AUTHORITY: 0x1a,
  TOO_MANY_REQUEST_UPDATES: 0x1b,
  INVALID_STREAM_HEADER: 0x200,
  MALFORMED_OBJECT: 0x201,
  INVALID_OBJECT_STATUS: 0x202,
  TRUNCATED_OBJECT: 0x203,
  MALFORMED_MESSAGE: 0x300,
  INVALID_FIELD: 0x301,
  INVALID_TRACK_NAMESPACE: 0x302,
  UNEXPECTED_MESSAGE: 0x303,
  ROLE_VIOLATION: 0x304,
  INVALID_PARAMETER: 0x305,
  CLOSED_CONTROL_STREAM: 0x306,
  DELTA_ENCODING_OVERFLOW: 0x400,
  FIELD_LENGTH_EXCEEDED: 0x401,
});

// Request error codes (§12.3 / §16.12.2).
export const MOQ_REQUEST_ERROR_CODES = Object.freeze({
  INTERNAL_ERROR: 0x0,
  UNAUTHORIZED: 0x1,
  TIMEOUT: 0x2,
  NOT_SUPPORTED: 0x3,
  MALFORMED_AUTH_TOKEN: 0x4,
  EXPIRED_AUTH_TOKEN: 0x5,
  GOING_AWAY: 0x6,
  EXCESSIVE_LOAD: 0x9,
  UNAVAILABLE: 0xa,
  DOES_NOT_EXIST: 0x10,
  INVALID_RANGE: 0x11,
  MALFORMED_TRACK: 0x12,
  UNINTERESTED: 0x20,
  NAMESPACE_TOO_LARGE: 0x31,
  UNSUPPORTED_EXTENSION: 0x33,
  REDIRECT: 0x34,
  CONFLICTING_FILTERS: 0x35,
  INVALID_FILTER: 0x36,
});

// PUBLISH_DONE status codes (§12.4).
export const MOQ_PUBLISH_DONE_CODES = Object.freeze({
  INTERNAL_ERROR: 0x0,
  UNAUTHORIZED: 0x1,
  TRACK_ENDED: 0x2,
  GOING_AWAY: 0x4,
  TOO_FAR_BEHIND: 0x5,
  EXPIRED: 0x6,
  EXPIRED_AUTH_TOKEN: 0x7,
  UPDATE_FAILED: 0x8,
  EXCESSIVE_LOAD: 0x9,
  MALFORMED_TRACK: 0x12,
});

// Stream reset codes (§12.5).
export const MOQ_STREAM_RESET_CODES = Object.freeze({
  INTERNAL_ERROR: 0x0,
  CANCELLED: 0x1,
  DELIVERY_TIMEOUT: 0x2,
  SESSION_CLOSED: 0x3,
  GOING_AWAY: 0x4,
  TOO_FAR_BEHIND: 0x5,
  EXPIRED_AUTH_TOKEN: 0x7,
  EXCESSIVE_LOAD: 0x9,
  MALFORMED_TRACK: 0x12,
});

// Object status (§11.1.1).
export const MOQ_OBJECT_STATUS = Object.freeze({
  NORMAL: 0x0,
  END_OF_GROUP: 0x3,
  END_OF_TRACK: 0x4,
});

// Stream types (§6.4.1) and fetch indicators (§11.4 Table 8).
export const MOQ_STREAM_TYPES = Object.freeze({
  FETCH_HEADER: 0x05,
  SETUP: 0x2f00,
  PADDING_STREAM: 0x132b3e28,
  PADDING_DATAGRAM: 0x132b3e29,
});
export const MOQ_FETCH_INDICATORS = Object.freeze({
  END_OF_GROUP: 0x80,
  END_OF_TRACK: 0x81,
  END_OF_NON_EXISTENT_RANGE: 0x8c,
  END_OF_UNKNOWN_RANGE: 0x10c,
  END_OF_TIMED_OUT_RANGE: 0x20c,
  END_OF_GONE_RANGE: 0x40c,
});

// Location filter types (§9.19.9).
export const MOQ_LOCATION_FILTER_TYPES = Object.freeze({
  NONE: 0x00,
  RELATIVE_START: 0x01,
  ABSOLUTE_START: 0x02,
  ABSOLUTE_START_GROUP_END: 0x03,
  ABSOLUTE_RANGE: 0x04,
  NEXT_OBJECT: 0x05,
});

// Group order values (§9.19.8).
export const MOQ_GROUP_ORDER = Object.freeze({ ASCENDING: 0x1, DESCENDING: 0x2 });

// Auth token alias types (§8.9).
export const MOQ_AUTH_TOKEN_ALIAS_TYPES = Object.freeze({
  DELETE: 0x0,
  REGISTER: 0x1,
  USE_ALIAS: 0x2,
  USE_VALUE: 0x3,
});

// MMTP (draft-ramadan-moq-mmt-02 §3.1).
export const MMTP_PACKET_TYPES = Object.freeze({
  MEDIA: 0x00,
  SIGNALING: 0x02,
  REPAIR: 0x03,
});
export const MMTP_FEC_TYPES = Object.freeze({
  NONE: 0,
  SOURCE: 1,
  REPAIR_MODE_0: 2,
  REPAIR_MODE_1: 3,
});
export const MMTP_SIGNALING_PACKET_ID = 0;

// Multicast (draft-ramadan-moq-multicast-02 §4.1).
export const MULTICAST_SSM_IPV4_PREFIX = '232.0.0.0/8';
export const MULTICAST_AMT_DEFAULT_PORT = 2268;
export const MULTICAST_JOIN_LATENCY_MS = { MIN: 1000, MAX: 3000 };

// TCP loopback transport frame kinds (NCPS-internal framing; the draft
// defines no TCP carriage, §6.2 — see the module header).
export const TCP_FRAME_KINDS = Object.freeze({
  CONTROL: 0x01,
  DATAGRAM: 0x02,
  SUBGROUP_DATA: 0x03,
  SUBGROUP_FIN: 0x04,
  SUBGROUP_RESET: 0x05,
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MoqError extends Error {
  constructor(code, reason, opts = {}) {
    super(`${code}: ${reason}`);
    this.name = 'MoqError';
    this.code = code;
    this.codeValue = MOQ_SESSION_ERROR_CODES[code] ?? null;
    this.reason = reason;
    // sessionError: the session MUST close with this code (§12.2).
    this.sessionError = opts.sessionError !== false;
    // requestErrorCode / requestErrorReason: for request-level refusals
    // (§12.3) that do NOT close the session — carried so the caller can
    // encode a REQUEST_ERROR instead of closing the session.
    this.requestErrorCode = opts.requestErrorCode ?? null;
    this.requestErrorReason = opts.requestErrorReason ?? null;
  }
}

function fail(code, reason, opts) {
  throw new MoqError(code, reason, opts);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toBuffer(value, what) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  fail('INVALID_FIELD', `${what} must be bytes (Buffer/Uint8Array) or a string`);
  return null; // unreachable
}

function checkU64(value, what) {
  if (typeof value === 'bigint') {
    if (value < 0n || value > 0xffffffffffffffffn) {
      fail('INVALID_FIELD', `${what} must be in 0..2^64-1`);
    }
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      fail('INVALID_FIELD', `${what} must be a safe non-negative integer`);
    }
    return BigInt(value);
  }
  fail('INVALID_FIELD', `${what} must be a non-negative integer (number or bigint)`);
  return 0n; // unreachable
}

function checkU32(value, what) {
  const v = checkU64(value, what);
  if (v > 0xffffffffn) fail('INVALID_FIELD', `${what} must fit in 32 bits`);
  return Number(v);
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Variable-length integers (§8.1)
// Leading-1-bits encoding, 1–9 bytes, up to 64 bits. Non-minimal
// encodings are valid and are accepted on decode.
// ---------------------------------------------------------------------------

// Value-bit capacity of each encoded length: L=1 → 7 bits, L=2 → 14,
// L=3 → 21, L=4 → 28, L=5 → 35, L=6 → 42, L=7 → 49, L=8 → 56,
// L=9 → 64.
const VARINT_BITS = [0, 7, 14, 21, 28, 35, 42, 49, 56, 64];

export function varintLength(value) {
  const v = checkU64(value, 'varint value');
  for (let length = 1; length <= 9; length++) {
    if (v < (1n << BigInt(VARINT_BITS[length]))) return length;
  }
  return 9;
}

export function encodeVarint(value) {
  const v = checkU64(value, 'varint value');
  const length = varintLength(v);
  const out = Buffer.alloc(length);
  if (length === 9) {
    out[0] = 0xff;
    for (let i = 0; i < 8; i++) {
      out[1 + i] = Number((v >> BigInt(8 * (7 - i))) & 0xffn);
    }
    return out;
  }
  // First byte: (length-1) leading 1-bits, one 0 bit, then (8-length)
  // value bits holding the top value bits.
  const firstValueBits = 8 - length;
  const prefix = length === 1 ? 0x00 : (0xff << (9 - length)) & 0xff;
  // Value bits in the first byte are the top (8-length) bits of the
  // value's top byte-group: shift the value right by 8*(length-1) and
  // mask to (8-length) bits.
  const firstByteValue = Number((v >> BigInt(8 * (length - 1))) & BigInt((1 << firstValueBits) - 1));
  out[0] = prefix | firstByteValue;
  for (let i = 1; i < length; i++) {
    out[i] = Number((v >> BigInt(8 * (length - 1 - i))) & 0xffn);
  }
  return out;
}

export function decodeVarint(bytes, offset = 0) {
  const buf = toBuffer(bytes, 'varint bytes');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= buf.length) {
    fail('MALFORMED_MESSAGE', 'varint read past the end of the buffer');
  }
  const first = buf[offset];
  let length;
  if (first === 0xff) {
    length = 9;
  } else {
    // Count leading 1-bits; length = count + 1.
    let ones = 0;
    for (let bit = 7; bit >= 0; bit--) {
      if ((first >> bit) & 1) ones++;
      else break;
    }
    length = ones + 1;
  }
  if (offset + length > buf.length) {
    fail('MALFORMED_MESSAGE', `truncated varint: need ${length} bytes, have ${buf.length - offset}`);
  }
  let value;
  if (length === 9) {
    value = 0n;
    for (let i = 1; i < 9; i++) value = (value << 8n) | BigInt(buf[offset + i]);
  } else {
    const firstValueBits = 8 - length;
    value = BigInt(first & ((1 << firstValueBits) - 1));
    for (let i = 1; i < length; i++) value = (value << 8n) | BigInt(buf[offset + i]);
  }
  return { value, length };
}

// ---------------------------------------------------------------------------
// ByteReader — fail-closed sequential reader over a Buffer.
// ---------------------------------------------------------------------------

export class ByteReader {
  constructor(bytes, what = 'message') {
    this.buf = toBuffer(bytes, what);
    this.what = what;
    this.offset = 0;
  }

  get remaining() {
    return this.buf.length - this.offset;
  }

  get consumed() {
    return this.offset;
  }

  require(count, field) {
    if (this.remaining < count) {
      fail('MALFORMED_MESSAGE', `${this.what}: truncated ${field}: need ${count} bytes, have ${this.remaining}`);
    }
  }

  varint(field = 'varint') {
    const { value, length } = decodeVarint(this.buf, this.offset);
    this.offset += length;
    return value;
  }

  u8(field = 'uint8') {
    this.require(1, field);
    return this.buf[this.offset++];
  }

  bytes(count, field = 'bytes') {
    this.require(count, field);
    const out = this.buf.subarray(this.offset, this.offset + count);
    this.offset += count;
    return Buffer.from(out);
  }

  rest(field = 'trailing bytes') {
    const out = this.buf.subarray(this.offset);
    this.offset = this.buf.length;
    return Buffer.from(out);
  }

  // Length-prefixed bytes: varint length + that many bytes.
  lengthPrefixed(field = 'length-prefixed bytes') {
    const length = this.varint(`${field} length`);
    if (length > BigInt(Number.MAX_SAFE_INTEGER)) {
      fail('FIELD_LENGTH_EXCEEDED', `${field} length ${length} exceeds the addressable bound`);
    }
    return this.bytes(Number(length), field);
  }

  finish(field = 'message') {
    if (this.remaining !== 0) {
      fail('MALFORMED_MESSAGE', `${this.what}: ${this.remaining} trailing bytes after ${field}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Key-Value Pairs (§8.3)
// Type is delta-encoded from the previous Type (or from 0 for the
// first). When Type is even the Value is a single varint; when Type is
// odd the Value is Length (vi64) + that many bytes. Max value length
// 2^16-1 bytes.
// ---------------------------------------------------------------------------

export function encodeKvpList(kvps) {
  if (!Array.isArray(kvps)) fail('INVALID_FIELD', 'kvps must be an array');
  let prevType = 0n;
  const parts = [];
  for (let i = 0; i < kvps.length; i++) {
    const kvp = kvps[i];
    if (!isPlainObject(kvp)) fail('INVALID_FIELD', `kvps[${i}] must be an object`);
    const type = checkU64(kvp.type, `kvps[${i}].type`);
    if (type < prevType) {
      fail('DELTA_ENCODING_OVERFLOW', `kvps[${i}].type ${type} is below the previous type ${prevType}: KVP types must be non-decreasing`);
    }
    const delta = type - prevType;
    if (delta > 0xffffffffffffffffn) fail('DELTA_ENCODING_OVERFLOW', `kvps[${i}] type delta overflows 2^64-1`);
    parts.push(encodeVarint(delta));
    if (type % 2n === 0n) {
      if (typeof kvp.value !== 'bigint' && typeof kvp.value !== 'number') {
        fail('MALFORMED_KEY_VALUE', `kvps[${i}] with even type ${type} must carry a varint value`);
      }
      parts.push(encodeVarint(kvp.value));
    } else {
      const valueBytes = toBuffer(kvp.value, `kvps[${i}].value`);
      if (valueBytes.length > MOQ_MAX_KVP_VALUE_BYTES) {
        fail('FIELD_LENGTH_EXCEEDED', `kvps[${i}] value is ${valueBytes.length} bytes, over the 2^16-1 bound`);
      }
      parts.push(encodeVarint(valueBytes.length));
      parts.push(valueBytes);
    }
    prevType = type;
  }
  return Buffer.concat(parts);
}

export function decodeKvpList(bytes, opts = {}) {
  const reader = new ByteReader(bytes, 'KVP list');
  const kvps = [];
  let prevType = 0n;
  while (reader.remaining > 0) {
    const delta = reader.varint('KVP type delta');
    const type = prevType + delta;
    if (type > 0xffffffffffffffffn) {
      fail('DELTA_ENCODING_OVERFLOW', `KVP type ${prevType} + delta ${delta} overflows 2^64-1`);
    }
    let value;
    if (type % 2n === 0n) {
      value = reader.varint(`KVP value (type ${type})`);
    } else {
      const length = reader.varint(`KVP value length (type ${type})`);
      if (length > BigInt(MOQ_MAX_KVP_VALUE_BYTES)) {
        fail('FIELD_LENGTH_EXCEEDED', `KVP value (type ${type}) is ${length} bytes, over the 2^16-1 bound`);
      }
      value = reader.bytes(Number(length), `KVP value (type ${type})`);
    }
    kvps.push({ type, value });
    prevType = type;
  }
  return kvps;
}

// Properties are serialized as KVPs (§8.4). Track Properties are the
// final field of a message (length = remaining bytes); Object
// Properties are preceded by an explicit length.
export function encodeProperties(properties) {
  return encodeKvpList(properties ?? []);
}

export function decodeProperties(bytes, opts = {}) {
  // Duplicate single-instance properties and out-of-scope properties
  // are malformed (§8.4 / §12.1 condition 8). The caller supplies
  // the single-instance set and the allowed scope when known.
  const kvps = decodeKvpList(bytes);
  const seen = new Set();
  const singleInstance = opts.singleInstanceTypes ?? null;
  for (const kvp of kvps) {
    const key = kvp.type.toString();
    if (singleInstance && singleInstance.has(key) && seen.has(key)) {
      fail('MALFORMED_KEY_VALUE', `duplicate single-instance property type ${kvp.type}`);
    }
    seen.add(key);
  }
  return kvps;
}

// Validate a KVP value's shape against its type parity (§8.3): a
// type/value mismatch is MALFORMED_KEY_VALUE.
export function checkKvpValueShape(kvp) {
  const type = checkU64(kvp.type, 'KVP type');
  if (type % 2n === 0n) {
    if (typeof kvp.value !== 'bigint') {
      fail('MALFORMED_KEY_VALUE', `even KVP type ${type} must carry a varint value`);
    }
  } else if (!Buffer.isBuffer(kvp.value) && !(kvp.value instanceof Uint8Array)) {
    fail('MALFORMED_KEY_VALUE', `odd KVP type ${type} must carry length-prefixed bytes`);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Track namespaces, track names, Locations, reason phrases, range
// filters, auth tokens (§8.2, §8.5–§8.9; §2.4)
// ---------------------------------------------------------------------------

export function encodeTrackNamespace(fields) {
  if (!Array.isArray(fields)) fail('INVALID_TRACK_NAMESPACE', 'track namespace must be an array of fields');
  if (fields.length > MOQ_MAX_NAMESPACE_FIELDS) {
    fail('INVALID_TRACK_NAMESPACE', `track namespace has ${fields.length} fields, over the 32-field bound`);
  }
  const parts = [encodeVarint(fields.length)];
  let total = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = toBuffer(fields[i], `namespace field ${i}`);
    if (field.length === 0) {
      fail('INVALID_TRACK_NAMESPACE', `track namespace field ${i} is empty`);
    }
    total += field.length;
    if (total > MOQ_MAX_FULL_TRACK_NAME_BYTES) {
      fail('FIELD_LENGTH_EXCEEDED', 'track namespace exceeds the 4,096-byte Full Track Name bound');
    }
    parts.push(encodeVarint(field.length));
    parts.push(field);
  }
  return Buffer.concat(parts);
}

export function decodeTrackNamespace(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'track namespace'), 'track namespace');
  reader.offset = offset;
  const count = reader.varint('number of namespace fields');
  if (count > BigInt(MOQ_MAX_NAMESPACE_FIELDS)) {
    fail('INVALID_TRACK_NAMESPACE', `track namespace has ${count} fields, over the 32-field bound`);
  }
  const fields = [];
  let total = 0;
  for (let i = 0; i < Number(count); i++) {
    const length = reader.varint(`namespace field ${i} length`);
    if (length === 0n) {
      fail('INVALID_TRACK_NAMESPACE', `track namespace field ${i} has length 0`);
    }
    total += Number(length);
    if (total > MOQ_MAX_FULL_TRACK_NAME_BYTES) {
      fail('FIELD_LENGTH_EXCEEDED', 'track namespace exceeds the 4,096-byte Full Track Name bound');
    }
    fields.push(reader.bytes(Number(length), `namespace field ${i}`));
  }
  return { fields, length: reader.consumed - offset };
}

export function fullTrackNameLength(fields, trackName) {
  const name = toBuffer(trackName, 'track name');
  let total = name.length;
  for (const field of fields ?? []) total += toBuffer(field, 'namespace field').length;
  return total;
}

export function checkFullTrackNameLength(fields, trackName) {
  if (fullTrackNameLength(fields, trackName) > MOQ_MAX_FULL_TRACK_NAME_BYTES) {
    fail('FIELD_LENGTH_EXCEEDED', 'Full Track Name exceeds 4,096 bytes');
  }
  return true;
}

export function checkTrackName(trackName) {
  const name = toBuffer(trackName, 'track name');
  if (name.length === 0) {
    fail('INVALID_FIELD', 'track name must be at least 1 byte (0 → PROTOCOL_VIOLATION, §2.4.1)');
  }
  return name;
}

// Reserved namespaces (§2.4.3): a namespace whose first field begins
// with '.' (0x2E). The first field exactly '.' MUST NOT be used; a
// request for it is rejected with DOES_NOT_EXIST.
export function isReservedNamespace(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return false;
  const first = toBuffer(fields[0], 'first namespace field');
  return first.length > 0 && first[0] === 0x2e;
}

export function isDotSessionNamespace(fields) {
  return Array.isArray(fields)
    && fields.length === 1
    && bytesEqual(toBuffer(fields[0], 'namespace field'), Buffer.from('.session', 'utf8'));
}

// §2.4.2 namespace prefix matching: every field of the prefix must
// equal the corresponding field of the namespace.
export function namespacePrefixMatches(prefixFields, namespaceFields) {
  if (!Array.isArray(prefixFields) || !Array.isArray(namespaceFields)) return false;
  if (prefixFields.length > namespaceFields.length) return false;
  for (let i = 0; i < prefixFields.length; i++) {
    if (!bytesEqual(toBuffer(prefixFields[i], 'prefix field'), toBuffer(namespaceFields[i], 'namespace field'))) {
      return false;
    }
  }
  return true;
}

export function namespaceEquals(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return namespacePrefixMatches(a, b);
}

export function namespaceKey(fields) {
  return (fields ?? []).map((field) => toBuffer(field, 'namespace field').toString('hex')).join('/');
}

export function fullTrackNameKey(fields, trackName) {
  return `${namespaceKey(fields)}--${toBuffer(trackName, 'track name').toString('hex')}`;
}

// §8.8 rendering: hyphen between namespace fields, double hyphen
// before the track name, non-alphanumeric (except _) as .xx lowercase
// hex. Example: (example.net, team2, project_x) + report →
// "example.2enet-team2-project_x--report".
function renderNameBytes(bytes) {
  let out = '';
  for (const byte of bytes) {
    const isAlnum = (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x41 && byte <= 0x5a)
      || (byte >= 0x30 && byte <= 0x39) || byte === 0x5f;
    out += isAlnum ? String.fromCharCode(byte) : `.${byte.toString(16).padStart(2, '0')}`;
  }
  return out;
}

export function renderFullTrackName(fields, trackName) {
  const parts = (fields ?? []).map((field) => renderNameBytes(toBuffer(field, 'namespace field')));
  return `${parts.join('-')}--${renderNameBytes(toBuffer(trackName, 'track name'))}`;
}

// Location (§8.2): {Group (vi64), Object (vi64)}, lexicographic order.
export function encodeLocation(location) {
  if (!isPlainObject(location)) fail('INVALID_FIELD', 'location must be an object {group, object}');
  return Buffer.concat([encodeVarint(location.group), encodeVarint(location.object)]);
}

export function decodeLocation(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'location'), 'location');
  reader.offset = offset;
  const group = reader.varint('location group');
  const object = reader.varint('location object');
  return { location: { group, object }, length: reader.consumed - offset };
}

export function compareLocation(a, b) {
  const ga = checkU64(a.group, 'location.group');
  const gb = checkU64(b.group, 'location.group');
  if (ga < gb) return -1;
  if (ga > gb) return 1;
  const oa = checkU64(a.object, 'location.object');
  const ob = checkU64(b.object, 'location.object');
  if (oa < ob) return -1;
  if (oa > ob) return 1;
  return 0;
}

// Reason Phrase (§8.5): Length (vi64) + UTF-8, max 1,024 bytes.
export function encodeReasonPhrase(reason) {
  const bytes = Buffer.from(reason ?? '', 'utf8');
  if (bytes.length > MOQ_MAX_REASON_PHRASE_BYTES) {
    fail('FIELD_LENGTH_EXCEEDED', `reason phrase is ${bytes.length} bytes, over the 1,024-byte bound`);
  }
  return Buffer.concat([encodeVarint(bytes.length), bytes]);
}

export function decodeReasonPhrase(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'reason phrase'), 'reason phrase');
  reader.offset = offset;
  const length = reader.varint('reason phrase length');
  if (length > BigInt(MOQ_MAX_REASON_PHRASE_BYTES)) {
    fail('FIELD_LENGTH_EXCEEDED', `reason phrase is ${length} bytes, over the 1,024-byte bound`);
  }
  const value = reader.bytes(Number(length), 'reason phrase');
  return { reason: value.toString('utf8'), length: reader.consumed - offset };
}

// Range Filter (§8.6): Length (vi64) = byte count of all fields after
// itself; 0 = no filter. Each Range = Start (vi64) + optional End
// (vi64), inclusive. Start is delta-encoded from the prior Range's
// End (or 0 for the first); End is delta-encoded from its own Start.
// End is optional ONLY in the last pair; if omitted the last Range is
// open-ended. Decoding is therefore unique: after a Start, a further
// varint can only be that Range's End (a Range with no End cannot be
// followed by more bytes).
export function encodeRangeFilter(ranges) {
  if (!Array.isArray(ranges)) fail('INVALID_FIELD', 'ranges must be an array');
  if (ranges.length === 0) return encodeVarint(0);
  const parts = [];
  let prevEnd = 0n;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (!isPlainObject(range)) fail('INVALID_FIELD', `ranges[${i}] must be an object`);
    const start = checkU64(range.start, `ranges[${i}].start`);
    if (start < prevEnd) {
      fail('INVALID_FILTER', `ranges[${i}].start ${start} is below the previous end ${prevEnd}: ranges must be non-decreasing`);
    }
    parts.push(encodeVarint(start - prevEnd));
    if (range.end !== undefined && range.end !== null) {
      const end = checkU64(range.end, `ranges[${i}].end`);
      if (end < start) fail('INVALID_FILTER', `ranges[${i}].end ${end} is below its start ${start}`);
      parts.push(encodeVarint(end - start));
      prevEnd = end;
    } else {
      if (i !== ranges.length - 1) {
        fail('INVALID_FILTER', `ranges[${i}] omits End but is not the last range: End is optional only in the last pair`);
      }
      prevEnd = start;
    }
  }
  const body = Buffer.concat(parts);
  return Buffer.concat([encodeVarint(body.length), body]);
}

export function decodeRangeFilter(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'range filter'), 'range filter');
  reader.offset = offset;
  const length = reader.varint('range filter length');
  if (length === 0n) return { ranges: [], length: reader.consumed - offset };
  const endOffset = reader.offset + Number(length);
  if (endOffset > reader.buf.length) {
    fail('INVALID_FILTER', `range filter length ${length} runs past the end of the buffer`);
  }
  const ranges = [];
  let prevEnd = 0n;
  while (reader.offset < endOffset) {
    const startDelta = reader.varint('range start delta');
    const start = prevEnd + startDelta;
    if (start > 0xffffffffffffffffn) {
      fail('DELTA_ENCODING_OVERFLOW', `range start ${prevEnd} + delta ${startDelta} overflows 2^64-1`);
    }
    if (reader.offset >= endOffset) {
      // Last range, open-ended.
      ranges.push({ start, end: null });
      prevEnd = start;
    } else {
      const endDelta = reader.varint('range end delta');
      const end = start + endDelta;
      if (end > 0xffffffffffffffffn) {
        fail('DELTA_ENCODING_OVERFLOW', `range end ${start} + delta ${endDelta} overflows 2^64-1`);
      }
      ranges.push({ start, end });
      prevEnd = end;
    }
  }
  return { ranges, length: reader.consumed - offset };
}

export function rangeFilterMatches(ranges, value) {
  const v = checkU64(value, 'filter value');
  for (const range of ranges ?? []) {
    const start = checkU64(range.start, 'range.start');
    if (v < start) continue;
    if (range.end === null || range.end === undefined) return true;
    if (v <= checkU64(range.end, 'range.end')) return true;
  }
  return false;
}

// Authorization Token (§8.9).
// Token { Alias Type (vi64), [Token Alias (vi64)], [Token Type (vi64)],
// [Token Value (..)] }. Token Value is the rest of the enclosing
// length-prefixed container: DELETE (0x0) and USE_ALIAS (0x2) carry an
// alias only; REGISTER (0x1) carries alias + type + value; USE_VALUE
// (0x3) carries type + value.
export function encodeAuthToken(token) {
  if (!isPlainObject(token)) fail('MALFORMED_AUTH_TOKEN', 'token must be an object');
  const aliasType = checkU64(token.aliasType, 'token.aliasType');
  if (aliasType > 3n) fail('MALFORMED_AUTH_TOKEN', `unknown auth token alias type ${aliasType}`);
  const parts = [encodeVarint(aliasType)];
  if (aliasType === 0n || aliasType === 1n || aliasType === 2n) {
    if (token.tokenAlias === undefined) fail('MALFORMED_AUTH_TOKEN', `alias type ${aliasType} requires tokenAlias`);
    parts.push(encodeVarint(token.tokenAlias));
  }
  if (aliasType === 1n || aliasType === 3n) {
    if (token.tokenType === undefined) fail('MALFORMED_AUTH_TOKEN', `alias type ${aliasType} requires tokenType`);
    parts.push(encodeVarint(token.tokenType));
    if (token.tokenValue === undefined) fail('MALFORMED_AUTH_TOKEN', `alias type ${aliasType} requires tokenValue`);
    parts.push(toBuffer(token.tokenValue, 'token.tokenValue'));
  }
  return Buffer.concat(parts);
}

export function decodeAuthToken(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'auth token'), 'auth token');
  reader.offset = offset;
  const aliasType = reader.varint('token alias type');
  if (aliasType > 3n) {
    fail('MALFORMED_AUTH_TOKEN', `unknown auth token alias type ${aliasType}`);
  }
  const token = { aliasType };
  if (aliasType === 0n || aliasType === 1n || aliasType === 2n) {
    token.tokenAlias = reader.varint('token alias');
  }
  if (aliasType === 1n || aliasType === 3n) {
    token.tokenType = reader.varint('token type');
    token.tokenValue = reader.rest('token value');
  } else if (reader.remaining !== 0) {
    fail('MALFORMED_AUTH_TOKEN', `alias type ${aliasType} carries trailing bytes`);
  }
  return { token, length: reader.consumed - offset };
}

// ---------------------------------------------------------------------------
// Setup Options (§9.1)
// Serialized as KVPs spanning the entire SETUP payload. Unknown options
// are ignored by receivers; senders MUST NOT repeat a known option
// type. Option values: even types carry a bare varint; odd types carry
// Length + bytes (per §8.3), and the bytes for MAX_CONTROL_MESSAGE_SIZE
// (0x09, odd) are themselves a varint.
// ---------------------------------------------------------------------------

const SETUP_OPTION_VALUE_KIND = Object.freeze({
  0x01: 'string', // PATH
  0x03: 'token', // AUTHORIZATION TOKEN (multiple instances allowed)
  0x04: 'varint', // MAX_AUTH_TOKEN_CACHE_SIZE
  0x05: 'string', // AUTHORITY
  0x06: 'varint', // MAX_FILTER_RANGES
  0x07: 'string', // MOQT_IMPLEMENTATION
  0x08: 'varint', // MAX_REQUEST_UPDATES
  0x09: 'varint-bytes', // MAX_CONTROL_MESSAGE_SIZE (odd type: length-prefixed varint bytes)
});

export function encodeSetupOptions(options) {
  if (!Array.isArray(options)) fail('INVALID_FIELD', 'setup options must be an array');
  const kvps = [];
  const seenKnown = new Set();
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    if (!isPlainObject(option)) fail('INVALID_FIELD', `setup options[${i}] must be an object`);
    const type = checkU64(option.type, `setup options[${i}].type`);
    const kind = SETUP_OPTION_VALUE_KIND[Number(type)];
    if (kind !== undefined && type !== 0x03n) {
      if (seenKnown.has(type.toString())) {
        fail('INVALID_FIELD', `duplicate setup option type ${type}: senders MUST NOT repeat a known option type`);
      }
      seenKnown.add(type.toString());
    }
    if (kind === 'string') {
      kvps.push({ type, value: Buffer.from(String(option.value ?? ''), 'utf8') });
    } else if (kind === 'token') {
      kvps.push({ type, value: encodeAuthToken(option.value) });
    } else if (kind === 'varint') {
      kvps.push({ type, value: checkU64(option.value, `setup option ${type} value`) });
    } else if (kind === 'varint-bytes') {
      kvps.push({ type, value: encodeVarint(option.value) });
    } else {
      // Unknown option: carried opaquely as raw bytes (odd) or a
      // varint (even), per §8.3 parity.
      if (type % 2n === 0n) {
        kvps.push({ type, value: checkU64(option.value, `setup option ${type} value`) });
      } else {
        kvps.push({ type, value: toBuffer(option.value, `setup option ${type} value`) });
      }
    }
  }
  // KVP types must be non-decreasing (§8.3 delta encoding).
  kvps.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return encodeKvpList(kvps);
}

export function decodeSetupOptions(bytes) {
  const kvps = decodeKvpList(bytes);
  const options = [];
  const seenKnown = new Set();
  for (const kvp of kvps) {
    const kind = SETUP_OPTION_VALUE_KIND[Number(kvp.type)];
    if (kind === undefined) {
      // Unknown option: ignored by the receiver (§9.1), carried
      // through opaquely so the caller can see what was ignored.
      options.push({ type: kvp.type, value: kvp.value, unknown: true });
      continue;
    }
    if (kvp.type !== 0x03n && seenKnown.has(kvp.type.toString())) {
      fail('INVALID_FIELD', `duplicate setup option type ${kvp.type}: senders MUST NOT repeat a known option type`);
    }
    seenKnown.add(kvp.type.toString());
    if (kind === 'string') {
      options.push({ type: kvp.type, value: kvp.value.toString('utf8') });
    } else if (kind === 'token') {
      const { token } = decodeAuthToken(kvp.value);
      options.push({ type: kvp.type, value: token });
    } else if (kind === 'varint') {
      if (typeof kvp.value !== 'bigint') fail('MALFORMED_KEY_VALUE', `setup option ${kvp.type} must carry a varint value`);
      options.push({ type: kvp.type, value: kvp.value });
    } else if (kind === 'varint-bytes') {
      const { value } = decodeVarint(kvp.value);
      options.push({ type: kvp.type, value });
    }
  }
  return options;
}

export function setupOption(options, type) {
  const found = (options ?? []).find((option) => option.type === BigInt(type));
  return found ? found.value : undefined;
}

// ---------------------------------------------------------------------------
// Message Parameters (§9.19)
// Serialized as Type Delta (vi64) + Value, ascending order by Type.
// Unknown parameter → INVALID_PARAMETER; duplicates → INVALID_PARAMETER;
// parameter in the wrong message → INVALID_PARAMETER.
// Encodings: uint8 / varint / Location / length-prefixed / namespace.
// ---------------------------------------------------------------------------

const PARAMETER_VALUE_KIND = Object.freeze({
  0x02: 'varint', // OBJECT_DELIVERY_TIMEOUT
  0x03: 'token', // AUTHORIZATION TOKEN (length-prefixed)
  0x04: 'varint', // RENDEZVOUS_TIMEOUT
  0x06: 'varint', // SUBGROUP_DELIVERY_TIMEOUT
  0x08: 'varint', // EXPIRES
  0x09: 'location', // LARGEST_OBJECT
  0x0a: 'varint', // FILL_TIMEOUT
  0x11: 'uint8', // PAUSED
  0x20: 'uint8', // SUBSCRIBER_PRIORITY
  0x21: 'location-filter', // LOCATION_FILTER
  0x22: 'uint8', // GROUP_ORDER
  0x23: 'fill-parameters', // FILL_PARAMETERS (length-prefixed nested scope)
  0x25: 'range-filter', // SUBGROUP_FILTER
  0x26: 'range-filter', // OBJECTID_FILTER
  0x27: 'range-filter', // PRIORITY_FILTER
  0x28: 'property-range-filter', // OBJECT_PROPERTY_FILTER
  0x29: 'property-range-filter', // TRACK_PROPERTY_FILTER
  0x32: 'varint', // NEW_GROUP_REQUEST
  0x34: 'namespace', // TRACK_NAMESPACE_PREFIX
  0x35: 'uint8', // INCLUDE_PROPERTIES
  0x36: 'varint', // SUBSCRIBE_TRACKS_ID
});

// Filter parameters whose (type, SetID, propertyType) combination must
// not repeat in a message (§3.3.2).
const FILTER_PARAMETER_TYPES = new Set([0x25, 0x26, 0x27, 0x28, 0x29]);

function encodeFilterParameterValue(param) {
  // Value = SetID (8 bytes) + [Property Type (vi64)] + Range Filter
  // (§8.6, Length + ranges). The SetID is always present when the
  // filter Length is non-zero (§3.3.2: "Each Range Filter parameter
  // carries a SetID"). Length 0 (empty ranges, no SetID) removes the
  // filter in REQUEST_UPDATE (§3.3.2).
  const ranges = param.ranges ?? [];
  if (ranges.length === 0 && param.setId === undefined) return Buffer.alloc(0);
  const setId = param.setId === undefined ? 0 : checkU32(param.setId, 'filter setId');
  const setIdBytes = Buffer.alloc(8);
  setIdBytes.writeBigUInt64BE(BigInt(setId));
  const parts = [setIdBytes];
  if (param.type === 0x28n || param.type === 0x29n) {
    if (param.propertyType === undefined) {
      fail('INVALID_PARAMETER', `filter parameter ${param.type} requires propertyType`);
    }
    const propertyType = checkU64(param.propertyType, 'filter propertyType');
    if (propertyType % 2n !== 0n) {
      fail('INVALID_PARAMETER', `filter parameter ${param.type} propertyType ${propertyType} must be even (a single integer value)`);
    }
    parts.push(encodeVarint(propertyType));
  }
  parts.push(encodeRangeFilter(ranges));
  return Buffer.concat(parts);
}

function decodeFilterParameterValue(bytes, type) {
  if (bytes.length === 0) return { setId: null, ranges: [] };
  if (bytes.length < 8) {
    fail('INVALID_FILTER', `filter parameter ${type} value is ${bytes.length} bytes, shorter than the 8-byte SetID`);
  }
  const setId = Number(bytes.readBigUInt64BE(0));
  let offset = 8;
  let propertyType;
  if (type === 0x28n || type === 0x29n) {
    const decoded = decodeVarint(bytes, offset);
    propertyType = decoded.value;
    offset += decoded.length;
    if (propertyType % 2n !== 0n) {
      fail('INVALID_PARAMETER', `filter parameter ${type} propertyType ${propertyType} must be even`);
    }
  }
  const { ranges } = decodeRangeFilter(bytes, offset);
  return { setId, propertyType, ranges };
}

export function encodeParameters(params, opts = {}) {
  if (!Array.isArray(params)) fail('INVALID_FIELD', 'parameters must be an array');
  const messageName = opts.messageName ?? null;
  const allowed = messageName ? MOQ_PARAMETER_SCOPE[messageName] : null;
  const sorted = [...params].sort((a, b) => {
    const ta = checkU64(a.type, 'parameter.type');
    const tb = checkU64(b.type, 'parameter.type');
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const parts = [];
  let prevType = 0n;
  const seen = new Set();
  const seenFilterKeys = new Set();
  for (let i = 0; i < sorted.length; i++) {
    const param = sorted[i];
    const type = checkU64(param.type, `parameters[${i}].type`);
    const kind = PARAMETER_VALUE_KIND[Number(type)];
    if (kind === undefined) {
      fail('INVALID_PARAMETER', `unknown message parameter type ${type}`);
    }
    if (allowed && !allowed.includes(Number(type))) {
      fail('INVALID_PARAMETER', `parameter ${type} may not appear in ${messageName}`);
    }
    if (seen.has(type.toString()) && type !== 0x03n && !FILTER_PARAMETER_TYPES.has(Number(type))) {
      fail('INVALID_PARAMETER', `duplicate parameter type ${type}`);
    }
    seen.add(type.toString());
    if (FILTER_PARAMETER_TYPES.has(Number(type))) {
      const filterKey = `${type}:${param.setId ?? 0}:${param.propertyType ?? ''}`;
      if (seenFilterKeys.has(filterKey)) {
        fail('INVALID_PARAMETER', `repeated filter parameter combination (type ${type}, setId ${param.setId ?? 0}, propertyType ${param.propertyType ?? ''})`);
      }
      seenFilterKeys.add(filterKey);
    }
    // Value validation that the draft pins to INVALID_PARAMETER.
    // uint8 values arrive as Numbers from the decoder but callers
    // naturally pass BigInts (the module's dominant value type), so
    // accept both forms; the strict !== against a Number rejected a
    // valid BigInt 1n with a misleading message.
    if (type === 0x11n && param.value !== 0 && param.value !== 1 && param.value !== 0n && param.value !== 1n) {
      fail('INVALID_PARAMETER', `PAUSED must be 0 or 1, got ${param.value}`);
    }
    if (type === 0x22n && param.value !== 0x1 && param.value !== 0x2 && param.value !== 1n && param.value !== 2n) {
      fail('INVALID_PARAMETER', `GROUP_ORDER must be 0x1 (Ascending) or 0x2 (Descending), got ${param.value}`);
    }
    if (type === 0x35n && param.value !== 0 && param.value !== 1 && param.value !== 0n && param.value !== 1n) {
      fail('INVALID_PARAMETER', `INCLUDE_PROPERTIES must be 0 or 1, got ${param.value}`);
    }
    if (type === 0x27n) {
      for (const range of param.ranges ?? []) {
        if (range.start !== undefined && BigInt(range.start) > 255n) {
          fail('INVALID_PARAMETER', `PRIORITY_FILTER range start ${range.start} exceeds 255`);
        }
        if (range.end !== undefined && range.end !== null && BigInt(range.end) > 255n) {
          fail('INVALID_PARAMETER', `PRIORITY_FILTER range end ${range.end} exceeds 255`);
        }
      }
    }
    if (type === 0x23n) {
      // FILL_PARAMETERS: only the Table 7 types may appear inside.
      for (const inner of param.value ?? []) {
        if (!MOQ_FILL_PARAMETER_TYPES.includes(Number(checkU64(inner.type, 'fill parameter type')))) {
          fail('INVALID_PARAMETER', `parameter ${inner.type} may not appear inside FILL_PARAMETERS`);
        }
      }
    }
    parts.push(encodeVarint(type - prevType));
    if (kind === 'uint8') {
      const value = checkU32(param.value, `parameter ${type} value`);
      if (value > 255) fail('INVALID_PARAMETER', `parameter ${type} is uint8, got ${value}`);
      parts.push(Buffer.from([value]));
    } else if (kind === 'varint') {
      parts.push(encodeVarint(param.value));
    } else if (kind === 'location') {
      parts.push(encodeLocation(param.value));
    } else if (kind === 'token') {
      const tokenBytes = encodeAuthToken(param.value);
      parts.push(encodeVarint(tokenBytes.length));
      parts.push(tokenBytes);
    } else if (kind === 'location-filter') {
      parts.push(encodeLocationFilter(param.value));
    } else if (kind === 'range-filter' || kind === 'property-range-filter') {
      const valueBytes = encodeFilterParameterValue({ ...param, type });
      parts.push(encodeVarint(valueBytes.length));
      parts.push(valueBytes);
    } else if (kind === 'fill-parameters') {
      const innerBytes = encodeParameters(param.value ?? [], { nested: true });
      const valueBytes = Buffer.concat([encodeVarint((param.value ?? []).length), innerBytes]);
      parts.push(encodeVarint(valueBytes.length));
      parts.push(valueBytes);
    } else if (kind === 'namespace') {
      parts.push(encodeTrackNamespace(param.value));
    }
    prevType = type;
  }
  return Buffer.concat(parts);
}

export function encodeLocationFilter(filter) {
  if (!isPlainObject(filter)) fail('INVALID_PARAMETER', 'location filter must be an object');
  const filterType = checkU64(filter.type, 'location filter type');
  if (filterType > 5n) {
    fail('INVALID_PARAMETER', `unknown location filter type ${filterType}`);
  }
  const parts = [encodeVarint(filterType)];
  if (filterType === 0x01n) {
    if (filter.startGroup === undefined) fail('INVALID_PARAMETER', 'relative-start location filter requires startGroup');
    parts.push(encodeVarint(filter.startGroup));
  } else if (filterType === 0x02n) {
    if (filter.startGroup === undefined || filter.startObject === undefined) {
      fail('INVALID_PARAMETER', 'absolute-start location filter requires startGroup and startObject');
    }
    parts.push(encodeVarint(filter.startGroup));
    parts.push(encodeVarint(filter.startObject));
  } else if (filterType === 0x03n) {
    if (filter.startGroup === undefined || filter.startObject === undefined || filter.endGroupDelta === undefined) {
      fail('INVALID_PARAMETER', 'absolute-start+group-end location filter requires startGroup, startObject and endGroupDelta');
    }
    parts.push(encodeVarint(filter.startGroup));
    parts.push(encodeVarint(filter.startObject));
    parts.push(encodeVarint(filter.endGroupDelta));
  } else if (filterType === 0x04n) {
    if (filter.startGroup === undefined || filter.startObject === undefined
      || filter.endGroupDelta === undefined || filter.endObject === undefined) {
      fail('INVALID_PARAMETER', 'absolute-range location filter requires startGroup, startObject, endGroupDelta and endObject');
    }
    parts.push(encodeVarint(filter.startGroup));
    parts.push(encodeVarint(filter.startObject));
    parts.push(encodeVarint(filter.endGroupDelta));
    parts.push(encodeVarint(filter.endObject));
  }
  // Types 0x00 (None) and 0x05 (Next Object) carry no further fields.
  return Buffer.concat(parts);
}

export function decodeLocationFilter(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'location filter'), 'location filter');
  reader.offset = offset;
  const type = reader.varint('location filter type');
  if (type > 5n) {
    fail('INVALID_PARAMETER', `unknown location filter type ${type}`);
  }
  const filter = { type };
  if (type === 0x01n) {
    filter.startGroup = reader.varint('location filter startGroup');
  } else if (type === 0x02n) {
    filter.startGroup = reader.varint('location filter startGroup');
    filter.startObject = reader.varint('location filter startObject');
  } else if (type === 0x03n) {
    filter.startGroup = reader.varint('location filter startGroup');
    filter.startObject = reader.varint('location filter startObject');
    filter.endGroupDelta = reader.varint('location filter endGroupDelta');
    if (filter.startGroup + filter.endGroupDelta > 0xffffffffffffffffn) {
      fail('DELTA_ENCODING_OVERFLOW', 'location filter end group overflows 2^64-1');
    }
  } else if (type === 0x04n) {
    filter.startGroup = reader.varint('location filter startGroup');
    filter.startObject = reader.varint('location filter startObject');
    filter.endGroupDelta = reader.varint('location filter endGroupDelta');
    filter.endObject = reader.varint('location filter endObject');
    if (filter.startGroup + filter.endGroupDelta > 0xffffffffffffffffn) {
      fail('DELTA_ENCODING_OVERFLOW', 'location filter end group overflows 2^64-1');
    }
  }
  return { filter, length: reader.consumed - offset };
}

// Resolve a LOCATION_FILTER against a Largest Object (§9.19.9):
// returns {start: {group, object} | null, end: {group, object} | null}
// with null end meaning open-ended. Type 0x00 → no filter (null start).
export function resolveLocationFilter(filter, largestObject) {
  if (!filter || filter.type === 0x00n) return { start: null, end: null };
  const type = checkU64(filter.type, 'location filter type');
  if (type === 0x01n) {
    if (!largestObject) return { start: { group: 0n, object: 0n }, end: null };
    const startGroup = largestObject.group + 1n - checkU64(filter.startGroup, 'startGroup');
    const clamped = startGroup < 0n ? 0n : startGroup;
    return { start: { group: clamped, object: 0n }, end: null };
  }
  if (type === 0x02n) {
    return { start: { group: checkU64(filter.startGroup, 'startGroup'), object: checkU64(filter.startObject, 'startObject') }, end: null };
  }
  if (type === 0x03n) {
    const startGroup = checkU64(filter.startGroup, 'startGroup');
    const endGroup = startGroup + checkU64(filter.endGroupDelta, 'endGroupDelta');
    if (endGroup > 0xffffffffffffffffn) fail('DELTA_ENCODING_OVERFLOW', 'location filter end group overflows 2^64-1');
    return {
      start: { group: startGroup, object: checkU64(filter.startObject, 'startObject') },
      end: { group: endGroup, object: largestObject ? largestObject.object : 0xffffffffffffffffn },
    };
  }
  if (type === 0x04n) {
    const startGroup = checkU64(filter.startGroup, 'startGroup');
    const endGroup = startGroup + checkU64(filter.endGroupDelta, 'endGroupDelta');
    if (endGroup > 0xffffffffffffffffn) fail('DELTA_ENCODING_OVERFLOW', 'location filter end group overflows 2^64-1');
    return {
      start: { group: startGroup, object: checkU64(filter.startObject, 'startObject') },
      end: { group: endGroup, object: checkU64(filter.endObject, 'endObject') },
    };
  }
  // 0x05 Next Object.
  if (!largestObject) return { start: { group: 0n, object: 0n }, end: null };
  return { start: { group: largestObject.group, object: largestObject.object + 1n }, end: null };
}

export function decodeParameters(bytes, count, opts = {}) {
  // Single implementation lives in decodeParametersFromReader; this
  // wrapper decodes a standalone parameter block (e.g. the nested
  // FILL_PARAMETERS scope, which is decoded from its own buffer).
  const reader = new ByteReader(toBuffer(bytes, 'parameters'), 'parameters');
  return decodeParametersFromReader(reader, count, opts);
}

export function getParameter(params, type) {
  const found = (params ?? []).find((param) => param.type === BigInt(type));
  return found ? found.value : undefined;
}

// ---------------------------------------------------------------------------
// Control messages (§9)
// Every message: Type (vi64), Length (vi64), Body. Length mismatch →
// MALFORMED_MESSAGE; length over the peer's MAX_CONTROL_MESSAGE_SIZE →
// FIELD_LENGTH_EXCEEDED; unknown type → UNEXPECTED_MESSAGE.
// ---------------------------------------------------------------------------

export function encodeControlMessage(type, body) {
  const typeValue = checkU64(type, 'control message type');
  const bodyBytes = toBuffer(body, 'control message body');
  return Buffer.concat([encodeVarint(typeValue), encodeVarint(bodyBytes.length), bodyBytes]);
}

export function decodeControlMessage(bytes, opts = {}) {
  const maxSize = opts.maxControlMessageSize === undefined
    ? MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE
    : checkU32(opts.maxControlMessageSize, 'maxControlMessageSize');
  const reader = new ByteReader(bytes, 'control message');
  const type = reader.varint('control message type');
  const length = reader.varint('control message length');
  if (length > BigInt(maxSize)) {
    fail('FIELD_LENGTH_EXCEEDED', `control message length ${length} exceeds MAX_CONTROL_MESSAGE_SIZE ${maxSize}`);
  }
  if (length > BigInt(reader.remaining)) {
    fail('MALFORMED_MESSAGE', `control message length ${length} exceeds the ${reader.remaining} available bytes`);
  }
  const body = reader.bytes(Number(length), 'control message body');
  const typeNumber = Number(type);
  if (MOQ_RESERVED_MESSAGE_TYPES[typeNumber] !== undefined) {
    fail('UNEXPECTED_MESSAGE', `reserved legacy message type 0x${typeNumber.toString(16)} (${MOQ_RESERVED_MESSAGE_TYPES[typeNumber]}) received: not a -23 message`);
  }
  const typeName = MOQ_MESSAGE_NAMES[typeNumber];
  if (typeName === undefined) {
    fail('UNEXPECTED_MESSAGE', `unknown control message type 0x${typeNumber.toString(16)}`);
  }
  return { type, typeName, body, length: reader.consumed };
}

// --- SETUP (§9.1) ---
export function encodeSetupMessage(options) {
  return encodeControlMessage(MOQ_MESSAGE_TYPES.SETUP, encodeSetupOptions(options ?? []));
}

export function decodeSetupMessage(body) {
  return decodeSetupOptions(body);
}

// --- GOAWAY (§9.2) ---
export function encodeGoawayMessage({ newSessionUri = '', timeoutMs = 0 }) {
  const uriBytes = Buffer.from(newSessionUri, 'utf8');
  if (uriBytes.length > 8192) {
    fail('FIELD_LENGTH_EXCEEDED', `GOAWAY new session URI is ${uriBytes.length} bytes, over the 8,192-byte bound`);
  }
  const body = Buffer.concat([encodeVarint(uriBytes.length), uriBytes, encodeVarint(timeoutMs)]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.GOAWAY, body);
}

export function decodeGoawayMessage(body) {
  const reader = new ByteReader(body, 'GOAWAY');
  const uriLength = reader.varint('GOAWAY new session URI length');
  if (uriLength > 8192n) {
    fail('FIELD_LENGTH_EXCEEDED', `GOAWAY new session URI is ${uriLength} bytes, over the 8,192-byte bound`);
  }
  const uri = reader.bytes(Number(uriLength), 'GOAWAY new session URI').toString('utf8');
  const timeoutMs = reader.varint('GOAWAY timeout');
  reader.finish('GOAWAY');
  return { newSessionUri: uri, timeoutMs };
}

// --- SUBSCRIBE / FETCH / TRACK_STATUS (§9.6, §9.11, §9.12) ---
// Same shape: Request ID, Track Namespace, Track Name Length + Name,
// Number of Parameters, Parameters. TRACK_STATUS allows only
// AUTHORIZATION_TOKEN + INCLUDE_PROPERTIES.
export function encodeRequestMessage(messageType, { requestId, namespace, trackName, parameters = [] }) {
  const typeName = MOQ_MESSAGE_NAMES[Number(checkU64(messageType, 'message type'))];
  const name = checkTrackName(trackName);
  checkFullTrackNameLength(namespace, name);
  const parts = [
    encodeVarint(requestId),
    encodeTrackNamespace(namespace),
    encodeVarint(name.length),
    name,
    encodeVarint(parameters.length),
    encodeParameters(parameters, { messageName: typeName }),
  ];
  return encodeControlMessage(messageType, Buffer.concat(parts));
}

export function decodeRequestMessage(body, messageType) {
  const typeName = MOQ_MESSAGE_NAMES[Number(checkU64(messageType, 'message type'))];
  const reader = new ByteReader(body, typeName);
  const requestId = reader.varint('request ID');
  const namespace = decodeTrackNamespace(reader.buf, reader.offset);
  reader.offset += namespace.length;
  const trackNameLength = reader.varint('track name length');
  const trackName = reader.bytes(Number(trackNameLength), 'track name');
  if (trackName.length === 0) {
    fail('INVALID_FIELD', `${typeName}: track name must be at least 1 byte`);
  }
  checkFullTrackNameLength(namespace.fields, trackName);
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), { messageName: typeName });
  reader.finish(typeName);
  return { requestId, namespace: namespace.fields, trackName, parameters };
}

// Shared-reader variant used when a message has fields after the
// parameters (Track Properties). Returns the decoded parameters and
// leaves the reader positioned after them.
export function decodeParametersFromReader(reader, count, opts = {}) {
  const messageName = opts.messageName ?? null;
  const allowed = messageName ? MOQ_PARAMETER_SCOPE[messageName] : null;
  const nested = opts.nested === true;
  const params = [];
  let prevType = 0n;
  const seen = new Set();
  const seenFilterKeys = new Set();
  for (let i = 0; i < count; i++) {
    const delta = reader.varint('parameter type delta');
    const type = prevType + delta;
    if (type > 0xffffffffffffffffn) {
      fail('DELTA_ENCODING_OVERFLOW', `parameter type ${prevType} + delta ${delta} overflows 2^64-1`);
    }
    if (type <= prevType && i > 0) {
      fail('INVALID_PARAMETER', `parameter type ${type} is not strictly greater than the previous type ${prevType}`);
    }
    const kind = PARAMETER_VALUE_KIND[Number(type)];
    if (kind === undefined) {
      fail('INVALID_PARAMETER', `unknown message parameter type ${type}`);
    }
    if (allowed && !allowed.includes(Number(type))) {
      fail('INVALID_PARAMETER', `parameter ${type} may not appear in ${messageName}`);
    }
    if (nested && !MOQ_FILL_PARAMETER_TYPES.includes(Number(type))) {
      fail('INVALID_PARAMETER', `parameter ${type} may not appear inside FILL_PARAMETERS`);
    }
    if (seen.has(type.toString()) && type !== 0x03n && !FILTER_PARAMETER_TYPES.has(Number(type))) {
      fail('INVALID_PARAMETER', `duplicate parameter type ${type}`);
    }
    seen.add(type.toString());
    let value;
    if (kind === 'uint8') {
      value = reader.u8(`parameter ${type} value`);
      if (type === 0x11n && value !== 0 && value !== 1) fail('INVALID_PARAMETER', `PAUSED must be 0 or 1, got ${value}`);
      if (type === 0x22n && value !== 0x1 && value !== 0x2) fail('INVALID_PARAMETER', `GROUP_ORDER must be 0x1 or 0x2, got ${value}`);
      if (type === 0x35n && value !== 0 && value !== 1) fail('INVALID_PARAMETER', `INCLUDE_PROPERTIES must be 0 or 1, got ${value}`);
    } else if (kind === 'varint') {
      value = reader.varint(`parameter ${type} value`);
    } else if (kind === 'location') {
      const decoded = decodeLocation(reader.buf, reader.offset);
      value = decoded.location;
      reader.offset += decoded.length;
    } else if (kind === 'token') {
      const tokenBytes = reader.lengthPrefixed(`parameter ${type} value`);
      const { token } = decodeAuthToken(tokenBytes);
      value = token;
    } else if (kind === 'location-filter') {
      const decoded = decodeLocationFilter(reader.buf, reader.offset);
      value = decoded.filter;
      reader.offset += decoded.length;
    } else if (kind === 'range-filter' || kind === 'property-range-filter') {
      const valueBytes = reader.lengthPrefixed(`parameter ${type} value`);
      const decoded = decodeFilterParameterValue(valueBytes, type);
      if (type === 0x27n) {
        for (const range of decoded.ranges) {
          if (range.start > 255n || (range.end !== null && range.end > 255n)) {
            fail('INVALID_PARAMETER', 'PRIORITY_FILTER range exceeds 255');
          }
        }
      }
      value = decoded;
    } else if (kind === 'fill-parameters') {
      const valueBytes = reader.lengthPrefixed('FILL_PARAMETERS value');
      const innerReader = new ByteReader(valueBytes, 'FILL_PARAMETERS');
      const innerCount = innerReader.varint('FILL_PARAMETERS parameter count');
      value = decodeParametersFromReader(innerReader, Number(innerCount), { nested: true });
      innerReader.finish('FILL_PARAMETERS');
    } else if (kind === 'namespace') {
      const decoded = decodeTrackNamespace(reader.buf, reader.offset);
      value = decoded.fields;
      reader.offset += decoded.length;
    }
    if (FILTER_PARAMETER_TYPES.has(Number(type))) {
      const filterKey = `${type}:${value.setId ?? 0}:${value.propertyType ?? ''}`;
      if (seenFilterKeys.has(filterKey)) {
        fail('INVALID_PARAMETER', `repeated filter parameter combination (type ${type}, setId ${value.setId ?? 0})`);
      }
      seenFilterKeys.add(filterKey);
    }
    params.push({ type, value });
    prevType = type;
  }
  return params;
}

// --- SUBSCRIBE_OK (§9.7) ---
export function encodeSubscribeOkMessage({ trackAlias, parameters = [], properties = [] }) {
  const body = Buffer.concat([
    encodeVarint(trackAlias),
    encodeVarint(parameters.length),
    encodeParameters(parameters, { messageName: 'SUBSCRIBE_OK' }),
    encodeProperties(properties),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.SUBSCRIBE_OK, body);
}

export function decodeSubscribeOkMessage(body) {
  const reader = new ByteReader(body, 'SUBSCRIBE_OK');
  const trackAlias = reader.varint('track alias');
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), { messageName: 'SUBSCRIBE_OK' });
  const properties = decodeProperties(reader.rest('track properties'));
  return { trackAlias, parameters, properties };
}

// --- REQUEST_OK (§9.3) ---
// Serves PUBLISH_OK, FETCH_OK, REQUEST_UPDATE_OK, TRACK_STATUS_OK,
// SUBSCRIBE_NAMESPACE_OK, SUBSCRIBE_TRACKS_OK, PUBLISH_NAMESPACE_OK.
// Track Properties are populated ONLY in TRACK_STATUS_OK / FETCH_OK;
// properties in any other REQUEST_OK → INVALID_FIELD (§9.3).
export function encodeRequestOkMessage({ parameters = [], properties = [], okKind = 'request_update' }) {
  if (properties.length > 0 && okKind !== 'fetch' && okKind !== 'track_status') {
    fail('INVALID_FIELD', `REQUEST_OK (${okKind}) must not carry track properties`);
  }
  const body = Buffer.concat([
    encodeVarint(parameters.length),
    encodeParameters(parameters, { messageName: 'REQUEST_OK' }),
    encodeProperties(properties),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.REQUEST_OK, body);
}

export function decodeRequestOkMessage(body, okKind = 'request_update') {
  const reader = new ByteReader(body, 'REQUEST_OK');
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), { messageName: 'REQUEST_OK' });
  const properties = decodeProperties(reader.rest('track properties'));
  if (properties.length > 0 && okKind !== 'fetch' && okKind !== 'track_status') {
    fail('INVALID_FIELD', `REQUEST_OK (${okKind}) must not carry track properties`);
  }
  return { parameters, properties };
}

// --- REQUEST_ERROR (§9.4) ---
// Error Code (vi64), Retry Interval (vi64; 0 = do not retry, 1 = retry
// immediately), Error Reason (Reason Phrase), Error Details (KVPs).
// The REDIRECT detail (0x01) MUST be present when the error code is
// REDIRECT, else MALFORMED_MESSAGE. Its value is the redirect payload:
// Connect URI Length (vi64) + URI + Track Name Length (vi64) + Name
// (the module's reading of §9.4.2; the draft names the fields but the
// layout is the draft's standard length-prefixed form).
export function encodeRedirectDetail({ connectUri = '', trackName = null }) {
  const uriBytes = Buffer.from(connectUri, 'utf8');
  const nameBytes = trackName === null ? Buffer.alloc(0) : toBuffer(trackName, 'redirect track name');
  return Buffer.concat([encodeVarint(uriBytes.length), uriBytes, encodeVarint(nameBytes.length), nameBytes]);
}

export function decodeRedirectDetail(bytes) {
  const reader = new ByteReader(bytes, 'REDIRECT detail');
  const uriLength = reader.varint('redirect connect URI length');
  const connectUri = reader.bytes(Number(uriLength), 'redirect connect URI').toString('utf8');
  const nameLength = reader.varint('redirect track name length');
  const trackName = reader.bytes(Number(nameLength), 'redirect track name');
  reader.finish('REDIRECT detail');
  return { connectUri, trackName };
}

export function encodeRequestErrorMessage({ errorCode, retryIntervalMs = 0, reason = '', details = [] }) {
  const code = checkU64(errorCode, 'request error code');
  const detailList = details ?? [];
  const hasRedirect = detailList.some((detail) => BigInt(detail.type) === 0x01n);
  if (code === BigInt(MOQ_REQUEST_ERROR_CODES.REDIRECT) && !hasRedirect) {
    fail('MALFORMED_MESSAGE', 'REQUEST_ERROR with code REDIRECT must carry the REDIRECT (0x01) error detail');
  }
  const body = Buffer.concat([
    encodeVarint(code),
    encodeVarint(retryIntervalMs),
    encodeReasonPhrase(reason),
    encodeKvpList(detailList.map((detail) => ({ type: checkU64(detail.type, 'error detail type'), value: toBuffer(detail.value, 'error detail value') }))),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.REQUEST_ERROR, body);
}

export function decodeRequestErrorMessage(body) {
  const reader = new ByteReader(body, 'REQUEST_ERROR');
  const errorCode = reader.varint('request error code');
  const retryIntervalMs = reader.varint('retry interval');
  const reasonDecoded = decodeReasonPhrase(reader.buf, reader.offset);
  reader.offset += reasonDecoded.length;
  const details = decodeKvpList(reader.rest('error details'));
  if (errorCode === BigInt(MOQ_REQUEST_ERROR_CODES.REDIRECT)
    && !details.some((detail) => detail.type === 0x01n)) {
    fail('MALFORMED_MESSAGE', 'REQUEST_ERROR with code REDIRECT must carry the REDIRECT (0x01) error detail');
  }
  return { errorCode, retryIntervalMs, reason: reasonDecoded.reason, details };
}

// --- REQUEST_UPDATE (§9.5) ---
export function encodeRequestUpdateMessage({ requestId, parameters = [] }) {
  const body = Buffer.concat([
    encodeVarint(requestId),
    encodeVarint(parameters.length),
    encodeParameters(parameters, { messageName: 'REQUEST_UPDATE' }),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.REQUEST_UPDATE, body);
}

export function decodeRequestUpdateMessage(body) {
  const reader = new ByteReader(body, 'REQUEST_UPDATE');
  const requestId = reader.varint('request ID');
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), { messageName: 'REQUEST_UPDATE' });
  reader.finish('REQUEST_UPDATE');
  return { requestId, parameters };
}

// --- PUBLISH (§9.8) ---
export function encodePublishMessage({ requestId, namespace, trackName, trackAlias, parameters = [], properties = [] }) {
  const name = checkTrackName(trackName);
  checkFullTrackNameLength(namespace, name);
  const body = Buffer.concat([
    encodeVarint(requestId),
    encodeTrackNamespace(namespace),
    encodeVarint(name.length),
    name,
    encodeVarint(trackAlias),
    encodeVarint(parameters.length),
    encodeParameters(parameters, { messageName: 'PUBLISH' }),
    encodeProperties(properties),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.PUBLISH, body);
}

export function decodePublishMessage(body) {
  const reader = new ByteReader(body, 'PUBLISH');
  const requestId = reader.varint('request ID');
  const namespace = decodeTrackNamespace(reader.buf, reader.offset);
  reader.offset += namespace.length;
  const trackNameLength = reader.varint('track name length');
  const trackName = reader.bytes(Number(trackNameLength), 'track name');
  if (trackName.length === 0) fail('INVALID_FIELD', 'PUBLISH: track name must be at least 1 byte');
  checkFullTrackNameLength(namespace.fields, trackName);
  const trackAlias = reader.varint('track alias');
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), { messageName: 'PUBLISH' });
  const properties = decodeProperties(reader.rest('track properties'));
  return { requestId, namespace: namespace.fields, trackName, trackAlias, parameters, properties };
}

// --- PUBLISH_DONE (§9.9) ---
export function encodePublishDoneMessage({ statusCode, streamCount = 0, reason = '' }) {
  const body = Buffer.concat([
    encodeVarint(statusCode),
    encodeVarint(streamCount),
    encodeReasonPhrase(reason),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.PUBLISH_DONE, body);
}

export function decodePublishDoneMessage(body) {
  const reader = new ByteReader(body, 'PUBLISH_DONE');
  const statusCode = reader.varint('status code');
  const streamCount = reader.varint('stream count');
  const reasonDecoded = decodeReasonPhrase(reader.buf, reader.offset);
  reader.offset += reasonDecoded.length;
  reader.finish('PUBLISH_DONE');
  return { statusCode, streamCount, reason: reasonDecoded.reason };
}

// --- PUBLISH_STATE_NOTIFY (§9.10) ---
export function encodePublishStateNotifyMessage({ parameters = [] }) {
  const body = Buffer.concat([
    encodeVarint(parameters.length),
    encodeParameters(parameters, { messageName: 'PUBLISH_STATE_NOTIFY' }),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.PUBLISH_STATE_NOTIFY, body);
}

export function decodePublishStateNotifyMessage(body) {
  const reader = new ByteReader(body, 'PUBLISH_STATE_NOTIFY');
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), { messageName: 'PUBLISH_STATE_NOTIFY' });
  reader.finish('PUBLISH_STATE_NOTIFY');
  return { parameters };
}

// --- Namespace messages (§9.13–§9.18) ---
// PUBLISH_NAMESPACE / SUBSCRIBE_NAMESPACE: Request ID, Track Namespace
// Prefix, Number of Parameters, Parameters (AUTHORIZATION_TOKEN only).
export function encodeNamespaceRequestMessage(messageType, { requestId, namespacePrefix, parameters = [] }) {
  const typeName = MOQ_MESSAGE_NAMES[Number(checkU64(messageType, 'message type'))];
  const body = Buffer.concat([
    encodeVarint(requestId),
    encodeTrackNamespace(namespacePrefix),
    encodeVarint(parameters.length),
    encodeParameters(parameters, { messageName: typeName }),
  ]);
  return encodeControlMessage(messageType, body);
}

export function decodeNamespaceRequestMessage(body, messageType) {
  const typeName = MOQ_MESSAGE_NAMES[Number(checkU64(messageType, 'message type'))];
  const reader = new ByteReader(body, typeName);
  const requestId = reader.varint('request ID');
  const prefix = decodeTrackNamespace(reader.buf, reader.offset);
  reader.offset += prefix.length;
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), { messageName: typeName });
  reader.finish(typeName);
  return { requestId, namespacePrefix: prefix.fields, parameters };
}

// SUBSCRIBE_TRACKS: Request ID, Track Namespace Prefix, Number of
// Parameters, Parameters.
export function encodeSubscribeTracksMessage({ requestId, namespacePrefix, parameters = [] }) {
  return encodeNamespaceRequestMessage(
    MOQ_MESSAGE_TYPES.SUBSCRIBE_TRACKS,
    { requestId, namespacePrefix, parameters },
  );
}

export function decodeSubscribeTracksMessage(body) {
  return decodeNamespaceRequestMessage(body, MOQ_MESSAGE_TYPES.SUBSCRIBE_TRACKS);
}

// NAMESPACE: Track Namespace Suffix, Number of Parameters, Parameters.
export function encodeNamespaceMessage({ namespaceSuffix, parameters = [] }) {
  const body = Buffer.concat([
    encodeTrackNamespace(namespaceSuffix),
    encodeVarint(parameters.length),
    encodeParameters(parameters, {}),
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.NAMESPACE, body);
}

export function decodeNamespaceMessage(body) {
  const reader = new ByteReader(body, 'NAMESPACE');
  const suffix = decodeTrackNamespace(reader.buf, reader.offset);
  reader.offset += suffix.length;
  const paramCount = reader.varint('number of parameters');
  const parameters = decodeParametersFromReader(reader, Number(paramCount), {});
  reader.finish('NAMESPACE');
  return { namespaceSuffix: suffix.fields, parameters };
}

// NAMESPACE_DONE: Track Namespace Suffix only.
export function encodeNamespaceDoneMessage({ namespaceSuffix }) {
  return encodeControlMessage(MOQ_MESSAGE_TYPES.NAMESPACE_DONE, encodeTrackNamespace(namespaceSuffix));
}

export function decodeNamespaceDoneMessage(body) {
  const reader = new ByteReader(body, 'NAMESPACE_DONE');
  const suffix = decodeTrackNamespace(reader.buf, reader.offset);
  reader.offset += suffix.length;
  reader.finish('NAMESPACE_DONE');
  return { namespaceSuffix: suffix.fields };
}

// PUBLISH_SKIPPED: Track Namespace Suffix, Track Name Length + Name.
export function encodePublishSkippedMessage({ namespaceSuffix, trackName }) {
  const name = checkTrackName(trackName);
  const body = Buffer.concat([
    encodeTrackNamespace(namespaceSuffix),
    encodeVarint(name.length),
    name,
  ]);
  return encodeControlMessage(MOQ_MESSAGE_TYPES.PUBLISH_SKIPPED, body);
}

export function decodePublishSkippedMessage(body) {
  const reader = new ByteReader(body, 'PUBLISH_SKIPPED');
  const suffix = decodeTrackNamespace(reader.buf, reader.offset);
  reader.offset += suffix.length;
  const trackNameLength = reader.varint('track name length');
  const trackName = reader.bytes(Number(trackNameLength), 'track name');
  if (trackName.length === 0) fail('INVALID_FIELD', 'PUBLISH_SKIPPED: track name must be at least 1 byte');
  reader.finish('PUBLISH_SKIPPED');
  return { namespaceSuffix: suffix.fields, trackName };
}

// ---------------------------------------------------------------------------
// Data plane (§11)
// ---------------------------------------------------------------------------

// Object Properties (§11.1.2): Properties Length (vi64) + KVPs.
export function encodeObjectProperties(properties) {
  const kvpBytes = encodeProperties(properties ?? []);
  return Buffer.concat([encodeVarint(kvpBytes.length), kvpBytes]);
}

export function decodeObjectProperties(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'object properties'), 'object properties');
  reader.offset = offset;
  const length = reader.varint('properties length');
  const valueBytes = reader.bytes(Number(length), 'properties');
  return { properties: decodeProperties(valueBytes), length: reader.consumed - offset };
}

function checkObjectStatus(status, what = 'object status') {
  const value = checkU64(status, what);
  if (value !== 0n && value !== 3n && value !== 4n) {
    fail('INVALID_OBJECT_STATUS', `${what} ${value} is not Normal (0x0), End of Group (0x3) or End of Track (0x4)`);
  }
  return value;
}

// OBJECT_DATAGRAM (§11.2.1).
// Flags: PROPERTIES 0x01, END_OF_GROUP 0x02, ZERO_OBJECT_ID 0x04,
// DEFAULT_PRIORITY 0x08, bit 4 (0x10) reserved MUST be 0, STATUS 0x20.
export function encodeObjectDatagram(object) {
  if (!isPlainObject(object)) fail('INVALID_FIELD', 'object datagram must be an object');
  const payload = toBuffer(object.payload ?? Buffer.alloc(0), 'object payload');
  const status = object.objectStatus === undefined || object.objectStatus === null
    ? null
    : checkObjectStatus(object.objectStatus);
  if (status !== null && payload.length > 0) {
    fail('INVALID_OBJECT_STATUS', 'an object datagram carrying a status must not carry a payload');
  }
  if (status !== null && status !== 0n && object.properties && object.properties.length > 0) {
    fail('INVALID_OBJECT_STATUS', 'only Normal objects can have properties');
  }
  const objectId = checkU64(object.objectId ?? 0, 'object ID');
  let flags = 0n;
  if (object.properties && object.properties.length > 0) flags |= 0x01n;
  if (object.endOfGroup && status === null) flags |= 0x02n;
  if (objectId === 0n) flags |= 0x04n;
  if (object.publisherPriority === undefined || object.publisherPriority === null) flags |= 0x08n;
  if (status !== null) flags |= 0x20n;
  if (object.endOfGroup && status !== null) {
    fail('INVALID_STREAM_HEADER', 'OBJECT_DATAGRAM must not set both STATUS and END_OF_GROUP');
  }
  const parts = [encodeVarint(flags), encodeVarint(object.trackAlias), encodeVarint(object.groupId)];
  if (objectId !== 0n) parts.push(encodeVarint(objectId));
  if (object.publisherPriority !== undefined && object.publisherPriority !== null) {
    const priority = checkU32(object.publisherPriority, 'publisher priority');
    if (priority > 255) fail('INVALID_FIELD', 'publisher priority must fit in 8 bits');
    parts.push(Buffer.from([priority]));
  }
  if (flags & 0x01n) parts.push(encodeObjectProperties(object.properties));
  if (status !== null) {
    parts.push(encodeVarint(status));
  } else {
    parts.push(payload);
  }
  return Buffer.concat(parts);
}

export function decodeObjectDatagram(bytes) {
  // Single implementation: decodeObjectDatagramStrict enforces the
  // PROPERTIES-bit + zero-length-properties rule (§11.2.1).
  return decodeObjectDatagramStrict(bytes);
}

// The strict decoder (PROPERTIES bit set + Properties Length 0 →
// MALFORMED_OBJECT; STATUS + trailing bytes → MALFORMED_OBJECT;
// STATUS + non-Normal properties → INVALID_OBJECT_STATUS).
export function decodeObjectDatagramStrict(bytes) {
  const reader = new ByteReader(bytes, 'OBJECT_DATAGRAM');
  const flags = reader.varint('datagram type flags');
  if (flags >= 128n) fail('INVALID_STREAM_HEADER', `OBJECT_DATAGRAM flags ${flags} do not fit in a single-byte encoding`);
  const flagsNumber = Number(flags);
  if (flagsNumber & 0x10) fail('INVALID_STREAM_HEADER', 'OBJECT_DATAGRAM flags have bit 4 set (reserved, must be 0)');
  if (flagsNumber & ~0x2f) fail('INVALID_STREAM_HEADER', `OBJECT_DATAGRAM flags 0x${flagsNumber.toString(16)} have unspecified bits set`);
  if ((flagsNumber & 0x20) && (flagsNumber & 0x02)) {
    fail('INVALID_STREAM_HEADER', 'OBJECT_DATAGRAM flags have both STATUS (0x20) and END_OF_GROUP (0x02) set');
  }
  const trackAlias = reader.varint('track alias');
  const groupId = reader.varint('group ID');
  const objectId = (flagsNumber & 0x04) ? 0n : reader.varint('object ID');
  const publisherPriority = (flagsNumber & 0x08) ? null : reader.u8('publisher priority');
  let properties = null;
  if (flagsNumber & 0x01) {
    const propsLength = reader.varint('properties length');
    if (propsLength === 0n) {
      fail('MALFORMED_OBJECT', 'OBJECT_DATAGRAM has the PROPERTIES bit set with Properties Length 0');
    }
    const valueBytes = reader.bytes(Number(propsLength), 'properties');
    properties = decodeProperties(valueBytes);
  }
  let objectStatus = null;
  let payload = Buffer.alloc(0);
  if (flagsNumber & 0x20) {
    objectStatus = checkObjectStatus(reader.varint('object status'));
    if (reader.remaining !== 0) {
      fail('MALFORMED_OBJECT', 'OBJECT_DATAGRAM with STATUS set carries trailing bytes after the status');
    }
    if (properties && properties.length > 0 && objectStatus !== 0n) {
      fail('INVALID_OBJECT_STATUS', 'only Normal objects can have properties');
    }
  } else {
    payload = reader.rest('object payload');
  }
  return {
    trackAlias, groupId, objectId, publisherPriority, properties,
    objectStatus, endOfGroup: Boolean(flagsNumber & 0x02), payload,
  };
}

// Datagram dispatch: a datagram starting with 0x132B3E29 is a padding
// datagram (§11.5.2); anything else is an OBJECT_DATAGRAM.
export function decodeDatagram(bytes) {
  const buf = toBuffer(bytes, 'datagram');
  if (buf.length === 0) fail('MALFORMED_OBJECT', 'empty datagram');
  const { value: first, length: typeLength } = decodeVarint(buf, 0);
  if (first === BigInt(MOQ_STREAM_TYPES.PADDING_DATAGRAM)) {
    // The padding-datagram type 0x132B3E29 encodes as a 5-byte
    // varint under the draft's leading-1-bits scheme (f0 13 2b 3e
    // 29) — the length must come from the varint itself, not a
    // hardcoded 3.
    const rest = buf.subarray(typeLength);
    for (const byte of rest) {
      if (byte !== 0) fail('MALFORMED_OBJECT', 'padding datagram carries non-zero bytes');
    }
    return { kind: 'padding', paddingLength: rest.length };
  }
  return { kind: 'object', ...decodeObjectDatagramStrict(buf) };
}

export function encodePaddingDatagram(paddingLength = 0) {
  if (!Number.isSafeInteger(paddingLength) || paddingLength < 0) {
    fail('INVALID_FIELD', 'padding length must be a safe non-negative integer');
  }
  return Buffer.concat([encodeVarint(MOQ_STREAM_TYPES.PADDING_DATAGRAM), Buffer.alloc(paddingLength)]);
}

export function encodePaddingStream(paddingLength = 0) {
  if (!Number.isSafeInteger(paddingLength) || paddingLength < 0) {
    fail('INVALID_FIELD', 'padding length must be a safe non-negative integer');
  }
  return Buffer.concat([encodeVarint(MOQ_STREAM_TYPES.PADDING_STREAM), Buffer.alloc(paddingLength)]);
}

// SUBGROUP_HEADER (§11.3.1).
// Flags: PROPERTIES 0x01, SUBGROUP_ID_MODE bits 1–2 (mask 0x06),
// END_OF_GROUP 0x08, bit 4 (0x10) MUST be 1, DEFAULT_PRIORITY 0x20,
// FIRST_OBJECT 0x40; values ≥128 → INVALID_STREAM_HEADER.
export function encodeSubgroupHeader(header) {
  if (!isPlainObject(header)) fail('INVALID_FIELD', 'subgroup header must be an object');
  const subgroupIdMode = header.subgroupIdMode === undefined ? 0 : checkU32(header.subgroupIdMode, 'subgroup ID mode');
  if (subgroupIdMode > 2) {
    fail('INVALID_STREAM_HEADER', `SUBGROUP_ID_MODE ${subgroupIdMode} is reserved (0b11)`);
  }
  let flags = 0x10; // bit 4 always set
  if (header.propertiesBit) flags |= 0x01;
  flags |= (subgroupIdMode << 1) & 0x06;
  if (header.endOfGroup) flags |= 0x08;
  if (header.publisherPriority === undefined || header.publisherPriority === null) flags |= 0x20;
  if (header.firstObject) flags |= 0x40;
  const parts = [encodeVarint(flags), encodeVarint(header.trackAlias), encodeVarint(header.groupId)];
  if (subgroupIdMode === 2) {
    if (header.subgroupId === undefined) fail('INVALID_FIELD', 'SUBGROUP_ID_MODE 0b10 requires subgroupId');
    parts.push(encodeVarint(header.subgroupId));
  }
  if (header.publisherPriority !== undefined && header.publisherPriority !== null) {
    const priority = checkU32(header.publisherPriority, 'publisher priority');
    if (priority > 255) fail('INVALID_FIELD', 'publisher priority must fit in 8 bits');
    parts.push(Buffer.from([priority]));
  }
  return Buffer.concat(parts);
}

export function decodeSubgroupHeader(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'SUBGROUP_HEADER'), 'SUBGROUP_HEADER');
  reader.offset = offset;
  const flags = reader.varint('subgroup header type flags');
  if (flags >= 128n) {
    fail('INVALID_STREAM_HEADER', `SUBGROUP_HEADER flags ${flags} do not fit in a single-byte encoding`);
  }
  const flagsNumber = Number(flags);
  if ((flagsNumber & 0x10) === 0) {
    fail('INVALID_STREAM_HEADER', 'SUBGROUP_HEADER flags have bit 4 unset (must be 1)');
  }
  const subgroupIdMode = (flagsNumber & 0x06) >> 1;
  if (subgroupIdMode === 3) {
    fail('INVALID_STREAM_HEADER', 'SUBGROUP_HEADER SUBGROUP_ID_MODE 0b11 is reserved');
  }
  const trackAlias = reader.varint('track alias');
  const groupId = reader.varint('group ID');
  let subgroupId = null;
  if (subgroupIdMode === 2) subgroupId = reader.varint('subgroup ID');
  const publisherPriority = (flagsNumber & 0x20) ? null : reader.u8('publisher priority');
  return {
    header: {
      flags: flagsNumber,
      propertiesBit: Boolean(flagsNumber & 0x01),
      subgroupIdMode,
      subgroupId,
      endOfGroup: Boolean(flagsNumber & 0x08),
      publisherPriority,
      firstObject: Boolean(flagsNumber & 0x40),
      trackAlias,
      groupId,
    },
    length: reader.consumed - offset,
  };
}

// Subgroup object (§11.3.1 Figure 27):
// Object ID Delta (vi64), [Properties (..)] — present in every object
// iff the header PROPERTIES bit is set (length 0 when no properties
// or non-Normal status) — Object Payload Length (vi64), [Object
// Status (vi64) iff payload length is 0], [Object Payload].
// Object ID = delta if the first object in the stream, else
// prev + delta + 1.
export function encodeSubgroupObject(object, opts = {}) {
  if (!isPlainObject(object)) fail('INVALID_FIELD', 'subgroup object must be an object');
  const payload = toBuffer(object.payload ?? Buffer.alloc(0), 'object payload');
  const status = object.objectStatus === undefined || object.objectStatus === null
    ? null
    : checkObjectStatus(object.objectStatus);
  if (status !== null && payload.length > 0) {
    fail('INVALID_OBJECT_STATUS', 'a subgroup object carrying a status must not carry a payload');
  }
  if (payload.length === 0 && status === null) {
    fail('INVALID_OBJECT_STATUS', 'a subgroup object with zero-length payload must carry an object status');
  }
  const parts = [encodeVarint(object.objectIdDelta)];
  if (opts.propertiesBit) {
    parts.push(encodeObjectProperties(object.properties ?? []));
  }
  parts.push(encodeVarint(payload.length));
  if (payload.length === 0) parts.push(encodeVarint(status));
  else parts.push(payload);
  return Buffer.concat(parts);
}

export function decodeSubgroupObject(bytes, offset = 0, opts = {}) {
  const reader = new ByteReader(toBuffer(bytes, 'subgroup object'), 'subgroup object');
  reader.offset = offset;
  const objectIdDelta = reader.varint('object ID delta');
  let objectId;
  if (opts.firstInStream) {
    objectId = objectIdDelta;
  } else if (opts.prevObjectId === undefined || opts.prevObjectId === null) {
    fail('MALFORMED_OBJECT', 'subgroup object is not the first in the stream but no previous object ID was supplied');
  } else {
    objectId = checkU64(opts.prevObjectId, 'previous object ID') + objectIdDelta + 1n;
    if (objectId > 0xffffffffffffffffn) {
      fail('DELTA_ENCODING_OVERFLOW', 'subgroup object ID overflows 2^64-1');
    }
  }
  let properties = null;
  if (opts.propertiesBit) {
    const decoded = decodeObjectProperties(reader.buf, reader.offset);
    reader.offset += decoded.length;
    properties = decoded.properties;
  }
  const payloadLength = reader.varint('object payload length');
  let objectStatus = null;
  let payload = Buffer.alloc(0);
  if (payloadLength === 0n) {
    objectStatus = checkObjectStatus(reader.varint('object status'));
    if (properties && properties.length > 0 && objectStatus !== 0n) {
      fail('INVALID_OBJECT_STATUS', 'only Normal objects can have properties');
    }
  } else {
    payload = reader.bytes(Number(payloadLength), 'object payload');
  }
  return {
    object: { objectId, objectIdDelta, properties, objectStatus, payload },
    length: reader.consumed - offset,
  };
}

// FETCH_HEADER (§11.4.1): Type (vi64) = 0x05, Request ID (vi64).
export function encodeFetchHeader({ requestId }) {
  return Buffer.concat([encodeVarint(MOQ_STREAM_TYPES.FETCH_HEADER), encodeVarint(requestId)]);
}

export function decodeFetchHeader(bytes, offset = 0) {
  const reader = new ByteReader(toBuffer(bytes, 'FETCH_HEADER'), 'FETCH_HEADER');
  reader.offset = offset;
  const type = reader.varint('fetch header type');
  if (type !== 5n) {
    fail('INVALID_STREAM_HEADER', `FETCH_HEADER type must be 0x05, got 0x${type.toString(16)}`);
  }
  const requestId = reader.varint('request ID');
  return { requestId, length: reader.consumed - offset };
}

// Fetch object (§11.4.1 Figure 29 + §11.4.1.1 flags).
// Serialization Flags < 128: subgroup ID mode bits 0–1 (0x00 zero,
// 0x01 prior, 0x02 prior+1, 0x03 present), 0x04 object ID delta
// present, 0x08 group ID delta present, 0x10 priority present, 0x20
// properties present, 0x40 datagram (ignore subgroup ID bits).
// Flags ≥ 128 are indicators (Table 8): 0x80 End of Group, 0x81 End
// of Track, 0x8C/0x10C/0x20C/0x40C End of Range (with Group ID Delta
// + Object ID Delta always present); any other value ≥ 128 →
// MALFORMED_OBJECT.
export function encodeFetchObject(object, opts = {}) {
  if (!isPlainObject(object)) fail('INVALID_FIELD', 'fetch object must be an object');
  if (object.indicator !== undefined && object.indicator !== null) {
    const indicator = checkU64(object.indicator, 'fetch indicator');
    const known = Object.values(MOQ_FETCH_INDICATORS).map((value) => BigInt(value));
    if (!known.includes(indicator)) {
      fail('MALFORMED_OBJECT', `unknown fetch indicator 0x${indicator.toString(16)}`);
    }
    const parts = [encodeVarint(indicator)];
    if (indicator === 0x80n || indicator === 0x81n) return Buffer.concat(parts);
    // End of Range indicators always carry Group ID Delta + Object ID
    // Delta (§11.4.2).
    if (object.groupIdDelta === undefined || object.objectIdDelta === undefined) {
      fail('INVALID_FIELD', 'End of Range indicator requires groupIdDelta and objectIdDelta');
    }
    parts.push(encodeVarint(object.groupIdDelta));
    parts.push(encodeVarint(object.objectIdDelta));
    return Buffer.concat(parts);
  }
  const subgroupIdMode = object.subgroupIdMode === undefined ? 0 : checkU32(object.subgroupIdMode, 'subgroup ID mode');
  if (subgroupIdMode > 3) fail('INVALID_FIELD', 'fetch subgroup ID mode must be 0..3');
  let flags = subgroupIdMode & 0x03;
  if (object.objectIdDelta !== undefined) flags |= 0x04;
  if (object.groupIdDelta !== undefined) flags |= 0x08;
  if (object.publisherPriority !== undefined && object.publisherPriority !== null) flags |= 0x10;
  if (object.properties) flags |= 0x20;
  if (object.datagram) flags |= 0x40;
  if (object.firstInStream && (object.groupIdDelta === undefined || object.objectIdDelta === undefined)) {
    fail('MALFORMED_OBJECT', 'the first fetch object MUST include a Group ID Delta and Object ID Delta');
  }
  const parts = [encodeVarint(flags)];
  if (object.groupIdDelta !== undefined) parts.push(encodeVarint(object.groupIdDelta));
  if (subgroupIdMode === 3) {
    if (object.subgroupId === undefined) fail('INVALID_FIELD', 'fetch subgroup ID mode 0x03 requires subgroupId');
    parts.push(encodeVarint(object.subgroupId));
  }
  if (object.objectIdDelta !== undefined) parts.push(encodeVarint(object.objectIdDelta));
  if (object.publisherPriority !== undefined && object.publisherPriority !== null) {
    const priority = checkU32(object.publisherPriority, 'publisher priority');
    if (priority > 255) fail('INVALID_FIELD', 'publisher priority must fit in 8 bits');
    parts.push(Buffer.from([priority]));
  }
  if (object.properties) parts.push(encodeObjectProperties(object.properties));
  const payload = toBuffer(object.payload ?? Buffer.alloc(0), 'fetch object payload');
  parts.push(encodeVarint(payload.length));
  parts.push(payload);
  return Buffer.concat(parts);
}

export function decodeFetchObject(bytes, offset = 0, opts = {}) {
  const reader = new ByteReader(toBuffer(bytes, 'fetch object'), 'fetch object');
  reader.offset = offset;
  const flags = reader.varint('fetch serialization flags');
  if (flags >= 128n) {
    const known = Object.values(MOQ_FETCH_INDICATORS).map((value) => BigInt(value));
    if (!known.includes(flags)) {
      fail('MALFORMED_OBJECT', `unknown fetch indicator 0x${flags.toString(16)}`);
    }
    if (flags === 0x80n || flags === 0x81n) {
      return { object: { indicator: flags }, length: reader.consumed - offset };
    }
    // End of Range: Group ID Delta + Object ID Delta always present.
    const groupIdDelta = reader.varint('end-of-range group ID delta');
    const objectIdDelta = reader.varint('end-of-range object ID delta');
    const resolved = resolveFetchRangeIds({ groupIdDelta, objectIdDelta }, opts);
    return {
      object: { indicator: flags, groupIdDelta, objectIdDelta, groupId: resolved.groupId, objectId: resolved.objectId },
      length: reader.consumed - offset,
    };
  }
  const flagsNumber = Number(flags);
  const subgroupIdMode = flagsNumber & 0x03;
  const hasObjectIdDelta = Boolean(flagsNumber & 0x04);
  const hasGroupIdDelta = Boolean(flagsNumber & 0x08);
  const hasPriority = Boolean(flagsNumber & 0x10);
  const hasProperties = Boolean(flagsNumber & 0x20);
  const isDatagram = Boolean(flagsNumber & 0x40);
  const firstInStream = opts.firstInStream === true;
  if (firstInStream && (!hasGroupIdDelta || !hasObjectIdDelta)) {
    fail('MALFORMED_OBJECT', 'the first fetch object MUST include a Group ID Delta and Object ID Delta');
  }
  if (firstInStream && !isDatagram && (subgroupIdMode === 1 || subgroupIdMode === 2)) {
    fail('MALFORMED_OBJECT', 'the first fetch object references a prior object subgroup ID');
  }
  let groupIdDelta;
  if (hasGroupIdDelta) groupIdDelta = reader.varint('group ID delta');
  let subgroupId = null;
  if (!isDatagram) {
    if (subgroupIdMode === 0) subgroupId = 0n;
    else if (subgroupIdMode === 1) {
      if (opts.prevSubgroupId === undefined || opts.prevSubgroupId === null) {
        fail('MALFORMED_OBJECT', 'fetch object references a prior subgroup ID but there is no prior object');
      }
      subgroupId = checkU64(opts.prevSubgroupId, 'previous subgroup ID');
    } else if (subgroupIdMode === 2) {
      if (opts.prevSubgroupId === undefined || opts.prevSubgroupId === null) {
        fail('MALFORMED_OBJECT', 'fetch object references a prior subgroup ID but there is no prior object');
      }
      subgroupId = checkU64(opts.prevSubgroupId, 'previous subgroup ID') + 1n;
    } else subgroupId = reader.varint('subgroup ID');
  }
  let objectIdDelta;
  if (hasObjectIdDelta) objectIdDelta = reader.varint('object ID delta');
  let publisherPriority = null;
  if (hasPriority) publisherPriority = reader.u8('publisher priority');
  else if (opts.prevPublisherPriority !== undefined && opts.prevPublisherPriority !== null) {
    publisherPriority = opts.prevPublisherPriority;
  }
  let properties = null;
  if (hasProperties) {
    const decoded = decodeObjectProperties(reader.buf, reader.offset);
    reader.offset += decoded.length;
    properties = decoded.properties;
  }
  const payloadLength = reader.varint('object payload length');
  const payload = reader.bytes(Number(payloadLength), 'object payload');
  // Resolve absolute IDs (§11.4.1.1).
  const groupOrder = opts.groupOrder ?? MOQ_GROUP_ORDER.ASCENDING;
  let groupId;
  let objectId;
  if (firstInStream) {
    groupId = groupIdDelta;
    objectId = objectIdDelta;
  } else {
    const prevGroup = checkU64(opts.prevGroupId, 'previous group ID');
    const prevObject = checkU64(opts.prevObjectId, 'previous object ID');
    if (hasGroupIdDelta) {
      groupId = groupOrder === MOQ_GROUP_ORDER.DESCENDING
        ? prevGroup - (groupIdDelta + 1n)
        : prevGroup + groupIdDelta + 1n;
      if (groupId < 0n || groupId > 0xffffffffffffffffn) {
        fail('DELTA_ENCODING_OVERFLOW', 'fetch group ID overflows 2^64-1 or goes below 0');
      }
      objectId = objectIdDelta !== undefined ? objectIdDelta : 0n;
    } else {
      groupId = prevGroup;
      objectId = objectIdDelta !== undefined ? prevObject + objectIdDelta + 2n : prevObject + 1n;
    }
    if (objectId > 0xffffffffffffffffn) {
      fail('DELTA_ENCODING_OVERFLOW', 'fetch object ID overflows 2^64-1');
    }
  }
  return {
    object: {
      groupId, objectId, subgroupId, publisherPriority, properties, payload,
      groupIdDelta, objectIdDelta, datagram: isDatagram,
    },
    length: reader.consumed - offset,
  };
}

// Resolve End-of-Range indicator IDs (§11.4.2.1): first entry after
// the FETCH_HEADER encodes absolute IDs; later entries are relative
// to the prior decoded IDs (Group ID Delta added for Ascending, or
// subtracted for Descending; Object ID Delta + 1 when Group ID Delta
// is 0, else the absolute Object ID in the new group).
function resolveFetchRangeIds({ groupIdDelta, objectIdDelta }, opts = {}) {
  const groupOrder = opts.groupOrder ?? MOQ_GROUP_ORDER.ASCENDING;
  if (opts.firstInStream) {
    return { groupId: checkU64(groupIdDelta, 'group ID delta'), objectId: checkU64(objectIdDelta, 'object ID delta') };
  }
  const prevGroup = checkU64(opts.prevGroupId, 'previous group ID');
  const prevObject = checkU64(opts.prevObjectId, 'previous object ID');
  const delta = checkU64(groupIdDelta, 'group ID delta');
  let groupId;
  let objectId;
  if (groupOrder === MOQ_GROUP_ORDER.DESCENDING) {
    groupId = prevGroup - delta;
  } else {
    groupId = prevGroup + delta;
  }
  if (groupId < 0n || groupId > 0xffffffffffffffffn) {
    fail('DELTA_ENCODING_OVERFLOW', 'fetch end-of-range group ID overflows 2^64-1 or goes below 0');
  }
  if (delta === 0n) {
    objectId = prevObject + checkU64(objectIdDelta, 'object ID delta') + 1n;
  } else {
    objectId = checkU64(objectIdDelta, 'object ID delta');
  }
  if (objectId > 0xffffffffffffffffn) {
    fail('DELTA_ENCODING_OVERFLOW', 'fetch end-of-range object ID overflows 2^64-1');
  }
  return { groupId, objectId };
}

// ---------------------------------------------------------------------------
// MMTP packet codec (draft-ramadan-moq-mmt-02 §3.1)
// 12-byte minimum header:
//   byte 0: version(2) | C packet-counter flag(1) | FEC_type(2) |
//           reserved(1) | X extension flag(1) | RAP flag(1)
//   byte 1: reserved(2) | type(6)
//   bytes 2-3: Packet ID (16)
//   bytes 4-7: Timestamp (32, NTP short format)
//   bytes 8-11: Packet Sequence Number (32, per packet_id, +1 mod 2^32)
//   [Packet Counter (32)] if C=1 — this profile fixes C=0 always;
//   packets with C=1 MUST be rejected.
//   [Header Extension] if X=1 — parsed as ISO 23008-1 header extension
//   (type u16, length u16, value bytes); no extension semantics are
//   defined here.
// FEC Type 1 (source): a 4-byte Source FEC Payload ID trails the
// payload. FEC Type 2/3 (repair): the payload is the repair symbol;
// repair-symbol parsing needs [MOQ-FEC-CORE] and is out of scope.
// ---------------------------------------------------------------------------

export function buildMmtpPacket(packet) {
  if (!isPlainObject(packet)) fail('INVALID_FIELD', 'MMTP packet must be an object');
  const fecType = checkU32(packet.fecType ?? 0, 'MMTP FEC type');
  if (fecType > 3) fail('INVALID_FIELD', `MMTP FEC type ${fecType} is out of range 0..3`);
  const type = checkU32(packet.type ?? 0, 'MMTP packet type');
  if (type > 63) fail('INVALID_FIELD', `MMTP packet type ${type} is out of range 0..63`);
  const packetId = checkU32(packet.packetId, 'MMTP packet ID');
  if (packetId > 65535) fail('INVALID_FIELD', `MMTP packet ID ${packetId} is out of range 0..65535`);
  if (packetId === 0 && (type === MMTP_PACKET_TYPES.MEDIA || type === MMTP_PACKET_TYPES.REPAIR)) {
    fail('INVALID_FIELD', 'media (0x00) / repair (0x03) MMTP packets MUST NOT use packet_id 0');
  }
  if (type === MMTP_PACKET_TYPES.SIGNALING && packetId !== 0) {
    fail('INVALID_FIELD', 'signaling MMTP packets use packet_id 0');
  }
  const timestamp = checkU32(packet.timestamp ?? 0, 'MMTP timestamp');
  const sequenceNumber = checkU32(packet.packetSequenceNumber ?? 0, 'MMTP packet sequence number');
  const rapFlag = packet.rapFlag ? 1 : 0;
  const payload = toBuffer(packet.payload ?? Buffer.alloc(0), 'MMTP payload');
  let sourceFecPayloadId = null;
  if (fecType === MMTP_FEC_TYPES.SOURCE) {
    if (packet.sourceFecPayloadId === undefined) {
      fail('INVALID_FIELD', 'MMTP FEC type 1 (source) requires a 4-byte sourceFecPayloadId');
    }
    sourceFecPayloadId = toBuffer(packet.sourceFecPayloadId, 'source FEC payload ID');
    if (sourceFecPayloadId.length !== 4) {
      fail('INVALID_FIELD', `source FEC payload ID must be 4 bytes, got ${sourceFecPayloadId.length}`);
    }
  }
  let headerExtension = null;
  if (packet.headerExtension !== undefined && packet.headerExtension !== null) {
    headerExtension = {
      type: checkU32(packet.headerExtension.type, 'header extension type'),
      value: toBuffer(packet.headerExtension.value ?? Buffer.alloc(0), 'header extension value'),
    };
    if (headerExtension.type > 65535) fail('INVALID_FIELD', 'header extension type must fit in 16 bits');
    if (headerExtension.value.length > 65535) fail('INVALID_FIELD', 'header extension value must fit in 16 bits of length');
  }
  const header = Buffer.alloc(12);
  header[0] = (0 << 6) | (0 << 5) | ((fecType & 0x3) << 3) | (0 << 2) | ((headerExtension ? 1 : 0) << 1) | rapFlag;
  header[1] = type & 0x3f;
  header.writeUInt16BE(packetId, 2);
  header.writeUInt32BE(timestamp, 4);
  header.writeUInt32BE(sequenceNumber, 8);
  const parts = [header];
  if (headerExtension) {
    const ext = Buffer.alloc(4 + headerExtension.value.length);
    ext.writeUInt16BE(headerExtension.type, 0);
    ext.writeUInt16BE(headerExtension.value.length, 2);
    headerExtension.value.copy(ext, 4);
    parts.push(ext);
  }
  parts.push(payload);
  if (sourceFecPayloadId) parts.push(sourceFecPayloadId);
  return Buffer.concat(parts);
}

export function parseMmtpPacket(bytes) {
  const buf = toBuffer(bytes, 'MMTP packet');
  if (buf.length < 12) {
    fail('MALFORMED_OBJECT', `MMTP packet is ${buf.length} bytes, below the 12-byte minimum header`);
  }
  const byte0 = buf[0];
  const version = (byte0 >> 6) & 0x3;
  if (version !== 0) {
    fail('INVALID_FIELD', `MMTP version must be 00, got ${version}`);
  }
  const packetCounterFlag = (byte0 >> 5) & 0x1;
  if (packetCounterFlag !== 0) {
    fail('INVALID_FIELD', 'MMTP packet-counter flag C must be 0 in this profile; packets with C=1 MUST be rejected');
  }
  const fecType = (byte0 >> 3) & 0x3;
  const extensionFlag = (byte0 >> 1) & 0x1;
  const rapFlag = byte0 & 0x1;
  const type = buf[1] & 0x3f;
  const packetId = buf.readUInt16BE(2);
  const timestamp = buf.readUInt32BE(4);
  const packetSequenceNumber = buf.readUInt32BE(8);
  if (packetId === 0 && (type === MMTP_PACKET_TYPES.MEDIA || type === MMTP_PACKET_TYPES.REPAIR)) {
    fail('INVALID_FIELD', 'media (0x00) / repair (0x03) MMTP packets MUST NOT use packet_id 0');
  }
  if (type === MMTP_PACKET_TYPES.SIGNALING && packetId !== 0) {
    fail('INVALID_FIELD', 'signaling MMTP packets use packet_id 0');
  }
  let offset = 12;
  let headerExtension = null;
  if (extensionFlag) {
    if (buf.length < offset + 4) {
      fail('MALFORMED_OBJECT', 'MMTP header extension flag is set but the packet is too short for the extension header');
    }
    const extType = buf.readUInt16BE(offset);
    const extLength = buf.readUInt16BE(offset + 2);
    offset += 4;
    if (buf.length < offset + extLength) {
      fail('MALFORMED_OBJECT', `MMTP header extension length ${extLength} runs past the end of the packet`);
    }
    headerExtension = { type: extType, value: Buffer.from(buf.subarray(offset, offset + extLength)) };
    offset += extLength;
  }
  let payload = buf.subarray(offset);
  let sourceFecPayloadId = null;
  if (fecType === MMTP_FEC_TYPES.SOURCE) {
    if (payload.length < 4) {
      fail('MALFORMED_OBJECT', 'MMTP FEC type 1 (source) packet is too short for the trailing 4-byte Source FEC Payload ID');
    }
    sourceFecPayloadId = Buffer.from(payload.subarray(payload.length - 4));
    payload = payload.subarray(0, payload.length - 4);
  }
  return {
    version,
    packetCounterFlag,
    fecType,
    extensionFlag,
    rapFlag,
    type,
    packetId,
    timestamp,
    packetSequenceNumber,
    headerExtension,
    sourceFecPayloadId,
    payload: Buffer.from(payload),
  };
}

// Signaling packet payload header (moq-mmt-02 §3.1): the payload of a
// signaling (type 0x02) packet begins with a 2-byte header:
// f_i (2 bits) | RES (4) | H (1) | A (1) | frag_count (8).
// A complete message without aggregation: f_i=00, A=0, frag_count=0,
// H=0 → header bytes 0x00 0x00, then message_id (u16).
export function parseMmtpSignalingHeader(payload) {
  const buf = toBuffer(payload, 'MMTP signaling payload');
  if (buf.length < 2) {
    fail('MALFORMED_OBJECT', 'MMTP signaling payload is too short for the 2-byte signaling message payload header');
  }
  const first = buf[0];
  const fragmentIndicator = (first >> 6) & 0x3;
  const hasHeaderExtension = (first >> 1) & 0x1;
  const hasAggregation = first & 0x1;
  const fragmentCount = buf[1];
  let messageId = null;
  let messageBytes = buf.subarray(2);
  if (fragmentIndicator === 0 && !hasAggregation && fragmentCount === 0 && !hasHeaderExtension) {
    if (messageBytes.length < 2) {
      fail('MALFORMED_OBJECT', 'complete MMTP signaling message is too short for message_id');
    }
    messageId = messageBytes.readUInt16BE(0);
    messageBytes = messageBytes.subarray(2);
  }
  return {
    fragmentIndicator,
    hasHeaderExtension,
    hasAggregation,
    fragmentCount,
    messageId,
    messageBytes: Buffer.from(messageBytes),
  };
}

export function buildMmtpSignalingHeader(messageId) {
  const id = checkU32(messageId, 'MMTP signaling message_id');
  if (id > 65535) fail('INVALID_FIELD', 'MMTP signaling message_id must fit in 16 bits');
  const header = Buffer.alloc(4);
  header[0] = 0x00;
  header[1] = 0x00;
  header.writeUInt16BE(id, 2);
  return header;
}

// MoQ mapping (moq-mmt-02 §4.1/§4.2): each MoQ object carries one
// complete MMTP packet (header preserved, no envelope). The
// group/object assignment needs the MPU sequence from the MPU-mode
// payload header (§4.4/§5) and is caller-supplied here.
export function mmtpPacketToMoqObject(packetBytes, { groupId, objectId, trackAlias = 0, publisherPriority = null } = {}) {
  const packet = parseMmtpPacket(packetBytes);
  if (groupId === undefined || objectId === undefined) {
    fail('INVALID_FIELD', 'mmtpPacketToMoqObject requires groupId and objectId (MPU sequence → group/object mapping is caller-supplied; moq-mmt-02 §4.4/§5 MPU-mode parsing is out of scope)');
  }
  return {
    trackAlias: checkU64(trackAlias, 'track alias'),
    groupId: checkU64(groupId, 'group ID'),
    objectId: checkU64(objectId, 'object ID'),
    publisherPriority,
    payload: Buffer.from(packetBytes),
    packet,
  };
}

export function moqObjectToMmtpPacket(object) {
  if (!isPlainObject(object)) fail('INVALID_FIELD', 'MoQ object must be an object');
  return parseMmtpPacket(object.payload);
}

// ---------------------------------------------------------------------------
// MoQ session (§6, §3.1, §9)
// One endpoint's view of a session. Deterministic and timer-free: the
// caller drives time via nowMs arguments. Request IDs: the client uses
// even IDs from 0, the server odd IDs from 1, +2 each (§6.4.2.1).
// Track aliases are tracked per direction (aliasesOut = aliases we
// assigned as publisher; aliasesIn = aliases the peer assigned).
// ---------------------------------------------------------------------------

export function createMoqSession(config = {}) {
  if (!isPlainObject(config)) fail('INVALID_FIELD', 'session config must be an object');
  const role = config.role;
  if (role !== 'client' && role !== 'server') {
    fail('INVALID_FIELD', `session role must be 'client' or 'server', got '${role}'`);
  }
  const peerRole = role === 'client' ? 'server' : 'client';
  const implementation = config.implementation ?? 'numina-moq-transport/1.0';
  const ourMaxControlMessageSize = config.maxControlMessageSize === undefined
    ? MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE
    : checkU32(config.maxControlMessageSize, 'maxControlMessageSize');
  if (ourMaxControlMessageSize < MOQ_MIN_MAX_CONTROL_MESSAGE_SIZE) {
    fail('INVALID_FIELD', `maxControlMessageSize must be at least ${MOQ_MIN_MAX_CONTROL_MESSAGE_SIZE}`);
  }
  const ourMaxFilterRanges = config.maxFilterRanges === undefined ? 0 : checkU32(config.maxFilterRanges, 'maxFilterRanges');
  const ourMaxRequestUpdates = config.maxRequestUpdates === undefined ? 0 : checkU32(config.maxRequestUpdates, 'maxRequestUpdates');
  const ourMaxAuthTokenCacheSize = config.maxAuthTokenCacheSize === undefined ? 0 : checkU32(config.maxAuthTokenCacheSize, 'maxAuthTokenCacheSize');
  const isTokenExpired = typeof config.isTokenExpired === 'function' ? config.isTokenExpired : null;

  const session = {
    role,
    peerRole,
    implementation,
    state: 'idle',
    setupSent: false,
    setupReceived: false,
    peerOptions: null,
    peerMaxControlMessageSize: MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE,
    peerMaxFilterRanges: 0,
    peerMaxRequestUpdates: 0,
    peerMaxAuthTokenCacheSize: 0,
    goawaySentCount: 0,
    goawayReceivedCount: 0,
    goawaySentAtMs: null,
    goawayReceivedAtMs: null,
    closed: null,
    events: [],
    nextLocalRequestId: role === 'client' ? 0n : 1n,
    nextTrackAlias: 0n,
    usedLocalRequestIds: new Set(),
    usedPeerRequestIds: new Set(),
    subscriptions: new Map(),
    aliasesOut: new Map(),
    aliasesIn: new Map(),
    tokenCache: new Map(),
    tokenCacheBytes: 0,
  };

  function event(type, detail = {}) {
    session.events.push({ type, atMs: Date.now(), ...detail });
    return session.events[session.events.length - 1];
  }

  function requireOpen() {
    if (session.closed) {
      fail('PROTOCOL_VIOLATION', `session is closed (${session.closed.code}: ${session.closed.reason})`);
    }
  }

  function requireEstablished(what) {
    requireOpen();
    if (session.state !== 'established' && session.state !== 'goaway_sent' && session.state !== 'goaway_received') {
      fail('PROTOCOL_VIOLATION', `${what} requires an established session (state is ${session.state})`);
    }
  }

  // Closure-level form of the public canInitiateNewRequests(): the
  // create* methods call this, not session.canInitiateNewRequests —
  // `session` is the internal state object and has no such method
  // (the public method lives on the returned API object).
  function canInitiateNewRequests() {
    return !session.closed && session.state === 'established';
  }

  function recordSubscription(requestId, kind, fields) {
    const sub = {
      requestId,
      kind,
      state: 'pending',
      direction: 'out',
      namespace: fields.namespace ?? null,
      trackName: fields.trackName ?? null,
      trackAlias: fields.trackAlias ?? null,
      parameters: fields.parameters ?? [],
      expiresAtMs: null,
      requestUpdatesOutstanding: 0,
      createdAtMs: fields.nowMs ?? Date.now(),
      streamCount: 0,
      paused: false,
    };
    session.subscriptions.set(requestId.toString(), sub);
    return sub;
  }

  function allocateRequestId() {
    const id = session.nextLocalRequestId;
    if (id > 0xffffffffffffffffn) {
      fail('INVALID_REQUEST_ID', 'request ID space exhausted');
    }
    session.nextLocalRequestId += 2n;
    session.usedLocalRequestIds.add(id.toString());
    return id;
  }

  function allocateTrackAlias() {
    const alias = session.nextTrackAlias;
    session.nextTrackAlias += 1n;
    return alias;
  }

  function validatePeerRequestId(id) {
    const value = checkU64(id, 'request ID');
    const peerEven = peerRole === 'client';
    if ((value % 2n === 0n) !== peerEven) {
      fail('INVALID_REQUEST_ID', `request ID ${value} has the wrong parity for the ${peerRole} (expected ${peerEven ? 'even' : 'odd'})`);
    }
    if (session.usedPeerRequestIds.has(value.toString())) {
      fail('INVALID_REQUEST_ID', `request ID ${value} was already used`);
    }
    session.usedPeerRequestIds.add(value.toString());
    return value;
  }

  function countFilterRanges(parameters) {
    let total = 0;
    for (const param of parameters ?? []) {
      if (FILTER_PARAMETER_TYPES.has(Number(param.type))) {
        total += (param.value?.ranges ?? []).length;
      }
    }
    return total;
  }

  function checkFilterRangeLimit(parameters, limit, what) {
    const total = countFilterRanges(parameters);
    if (total > limit) {
      return { ok: false, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.INVALID_FILTER), requestErrorReason: `${what} carries ${total} filter ranges, over the MAX_FILTER_RANGES limit ${limit}` };
    }
    return { ok: true };
  }

  function registerToken(token, { fromSetup = false } = {}) {
    // Returns {ok, downgraded} or throws a session MoqError.
    // REGISTER: duplicate alias → DUPLICATE_AUTH_TOKEN_ALIAS;
    // exceeding the cache size → AUTH_TOKEN_CACHE_OVERFLOW, except in
    // SETUP where it is downgraded to USE_VALUE (§9.1.4).
    // USE_ALIAS: unknown alias → UNKNOWN_AUTH_TOKEN_ALIAS (session
    // close, §8.9); expired alias → request-level EXPIRED_AUTH_TOKEN.
    const aliasType = checkU64(token.aliasType, 'token alias type');
    if (aliasType === 0n) { // DELETE
      const key = token.tokenAlias.toString();
      const entry = session.tokenCache.get(key);
      if (entry) {
        session.tokenCacheBytes -= entry.size;
        session.tokenCache.delete(key);
      }
      return { ok: true };
    }
    if (aliasType === 1n) { // REGISTER
      const key = token.tokenAlias.toString();
      if (session.tokenCache.has(key)) {
        fail('DUPLICATE_AUTH_TOKEN_ALIAS', `token alias ${token.tokenAlias} is already registered`);
      }
      const valueLength = toBuffer(token.tokenValue, 'token value').length;
      const size = 16 + valueLength;
      if (session.tokenCacheBytes + size > ourMaxAuthTokenCacheSize) {
        if (fromSetup) return { ok: true, downgraded: true };
        fail('AUTH_TOKEN_CACHE_OVERFLOW', `registering token alias ${token.tokenAlias} would exceed MAX_AUTH_TOKEN_CACHE_SIZE ${ourMaxAuthTokenCacheSize}`);
      }
      session.tokenCache.set(key, { tokenType: token.tokenType, tokenValue: Buffer.from(token.tokenValue), size, registeredAtMs: Date.now() });
      session.tokenCacheBytes += size;
      return { ok: true };
    }
    if (aliasType === 2n) { // USE_ALIAS
      const key = token.tokenAlias.toString();
      const entry = session.tokenCache.get(key);
      if (!entry) {
        fail('UNKNOWN_AUTH_TOKEN_ALIAS', `token alias ${token.tokenAlias} is not registered`);
      }
      if (isTokenExpired && isTokenExpired({ alias: token.tokenAlias, tokenType: entry.tokenType, tokenValue: entry.tokenValue })) {
        return { ok: false, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.EXPIRED_AUTH_TOKEN), requestErrorReason: `token alias ${token.tokenAlias} has expired` };
      }
      return { ok: true, resolved: { tokenType: entry.tokenType, tokenValue: entry.tokenValue } };
    }
    // USE_VALUE: nothing to register.
    return { ok: true };
  }

  function applySetupOptions(options, { fromPeer }) {
    const applied = {};
    for (const option of options) {
      if (option.unknown) continue;
      const type = Number(option.type);
      if (type === MOQ_SETUP_OPTIONS.MAX_CONTROL_MESSAGE_SIZE) {
        if (option.value < BigInt(MOQ_MIN_MAX_CONTROL_MESSAGE_SIZE)) {
          fail('INVALID_FIELD', `MAX_CONTROL_MESSAGE_SIZE ${option.value} is below the ${MOQ_MIN_MAX_CONTROL_MESSAGE_SIZE} minimum`);
        }
        applied.maxControlMessageSize = Number(option.value);
      } else if (type === MOQ_SETUP_OPTIONS.MAX_FILTER_RANGES) {
        applied.maxFilterRanges = Number(option.value);
      } else if (type === MOQ_SETUP_OPTIONS.MAX_REQUEST_UPDATES) {
        applied.maxRequestUpdates = Number(option.value);
      } else if (type === MOQ_SETUP_OPTIONS.MAX_AUTH_TOKEN_CACHE_SIZE) {
        applied.maxAuthTokenCacheSize = Number(option.value);
      } else if (type === MOQ_SETUP_OPTIONS.AUTHORITY) {
        if (fromPeer && role === 'client') {
          fail('INVALID_AUTHORITY', 'AUTHORITY option received from the server');
        }
        applied.authority = option.value;
      } else if (type === MOQ_SETUP_OPTIONS.PATH) {
        if (fromPeer && role === 'client') {
          fail('INVALID_PATH', 'PATH option received from the server');
        }
        applied.path = option.value;
      } else if (type === MOQ_SETUP_OPTIONS.AUTHORIZATION_TOKEN) {
        if (fromPeer && role === 'server' && (option.value.aliasType === 0n || option.value.aliasType === 2n)) {
          fail('ROLE_VIOLATION', 'server received DELETE (0x0) or USE_ALIAS (0x2) AUTHORIZATION TOKEN in SETUP');
        }
        const registered = registerToken(option.value, { fromSetup: true });
        applied.tokenRegistration = registered;
      } else if (type === MOQ_SETUP_OPTIONS.MOQT_IMPLEMENTATION) {
        applied.implementation = option.value;
      }
    }
    return applied;
  }

  function buildLocalSetupOptions(extra = {}) {
    const options = [];
    if (role === 'client') {
      if (config.authority !== undefined) options.push({ type: BigInt(MOQ_SETUP_OPTIONS.AUTHORITY), value: config.authority });
      if (config.path !== undefined) options.push({ type: BigInt(MOQ_SETUP_OPTIONS.PATH), value: config.path });
    }
    if (ourMaxAuthTokenCacheSize > 0) options.push({ type: BigInt(MOQ_SETUP_OPTIONS.MAX_AUTH_TOKEN_CACHE_SIZE), value: BigInt(ourMaxAuthTokenCacheSize) });
    if (ourMaxFilterRanges > 0) options.push({ type: BigInt(MOQ_SETUP_OPTIONS.MAX_FILTER_RANGES), value: BigInt(ourMaxFilterRanges) });
    options.push({ type: BigInt(MOQ_SETUP_OPTIONS.MOQT_IMPLEMENTATION), value: implementation });
    if (ourMaxRequestUpdates > 0) options.push({ type: BigInt(MOQ_SETUP_OPTIONS.MAX_REQUEST_UPDATES), value: BigInt(ourMaxRequestUpdates) });
    if (ourMaxControlMessageSize !== MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE) {
      options.push({ type: BigInt(MOQ_SETUP_OPTIONS.MAX_CONTROL_MESSAGE_SIZE), value: BigInt(ourMaxControlMessageSize) });
    }
    for (const option of extra.options ?? []) options.push(option);
    return options;
  }

  const api = {
    session,
    role,
    peerRole,

    createSetup(extra = {}) {
      requireOpen();
      if (session.setupSent) fail('PROTOCOL_VIOLATION', 'SETUP was already sent on this control stream');
      const bytes = encodeSetupMessage(buildLocalSetupOptions(extra));
      session.setupSent = true;
      // The session is established once BOTH SETUPs have been
      // exchanged, regardless of order: a server that received the
      // client's SETUP first must become established when it sends
      // its own (the previous code left it stuck at 'setup_sent',
      // which also blocked every requireEstablished call after it).
      if (session.setupReceived) session.state = 'established';
      else if (session.state === 'idle') session.state = 'setup_sent';
      event('setup_sent', { bytes: bytes.length });
      return bytes;
    },

    receiveSetup(bytes) {
      requireOpen();
      if (session.setupReceived) {
        fail('UNEXPECTED_MESSAGE', 'a second SETUP was received on this control stream');
      }
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'SETUP') {
        fail('UNEXPECTED_MESSAGE', `the first control-stream message must be SETUP, got ${decoded.typeName}`);
      }
      const options = decodeSetupMessage(decoded.body);
      const applied = applySetupOptions(options, { fromPeer: true });
      session.peerOptions = options;
      session.peerMaxControlMessageSize = applied.maxControlMessageSize ?? MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE;
      session.peerMaxFilterRanges = applied.maxFilterRanges ?? 0;
      session.peerMaxRequestUpdates = applied.maxRequestUpdates ?? 0;
      session.peerMaxAuthTokenCacheSize = applied.maxAuthTokenCacheSize ?? 0;
      session.setupReceived = true;
      if (session.setupSent) session.state = 'established';
      event('setup_received', { peerImplementation: applied.implementation ?? null, established: session.state === 'established' });
      return { options, applied, established: session.state === 'established' };
    },

    get state() {
      return session.state;
    },

    isEstablished() {
      return session.state === 'established' || session.state === 'goaway_sent' || session.state === 'goaway_received';
    },

    canInitiateNewRequests() {
      return canInitiateNewRequests();
    },

    allocateRequestId,
    allocateTrackAlias,

    createSubscribe({ namespace, trackName, parameters = [], nowMs = Date.now() }) {
      requireEstablished('SUBSCRIBE');
      if (!canInitiateNewRequests()) {
        fail('PROTOCOL_VIOLATION', 'new requests must not be initiated after GOAWAY');
      }
      const requestId = allocateRequestId();
      const bytes = encodeRequestMessage(MOQ_MESSAGE_TYPES.SUBSCRIBE, { requestId, namespace, trackName, parameters });
      recordSubscription(requestId, 'subscribe', { namespace, trackName, parameters, nowMs });
      event('subscribe_sent', { requestId: requestId.toString() });
      return { requestId, bytes };
    },

    receiveSubscribe(bytes) {
      requireEstablished('SUBSCRIBE');
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'SUBSCRIBE') {
        fail('UNEXPECTED_MESSAGE', `expected SUBSCRIBE, got ${decoded.typeName}`);
      }
      const message = decodeRequestMessage(decoded.body, MOQ_MESSAGE_TYPES.SUBSCRIBE);
      validatePeerRequestId(message.requestId);
      if (isReservedNamespace(message.namespace) && !isDotSessionNamespace(message.namespace)) {
        return { ok: false, requestId: message.requestId, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST), requestErrorReason: 'track namespace is reserved' };
      }
      const limitCheck = checkFilterRangeLimit(message.parameters, ourMaxFilterRanges, 'SUBSCRIBE');
      if (!limitCheck.ok) {
        return { ok: false, requestId: message.requestId, ...limitCheck };
      }
      const sub = recordSubscription(message.requestId, 'subscribe', {
        namespace: message.namespace, trackName: message.trackName, parameters: message.parameters,
      });
      sub.direction = 'in';
      event('subscribe_received', { requestId: message.requestId.toString() });
      return { ok: true, ...message, subscription: sub };
    },

    createSubscribeOk({ requestId, trackAlias, parameters = [], properties = [], nowMs = Date.now() }) {
      requireEstablished('SUBSCRIBE_OK');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub || sub.kind !== 'subscribe' || sub.direction !== 'in' || sub.state !== 'pending') {
        fail('UNEXPECTED_MESSAGE', `SUBSCRIBE_OK for request ${requestId} has no pending inbound subscription`);
      }
      const alias = trackAlias === undefined ? allocateTrackAlias() : checkU64(trackAlias, 'track alias');
      const aliasKey = alias.toString();
      if (session.aliasesOut.has(aliasKey)) {
        fail('DUPLICATE_TRACK_ALIAS', `track alias ${alias} is already in use`);
      }
      const expires = getParameter(parameters, MOQ_PARAMETERS.EXPIRES);
      const bytes = encodeSubscribeOkMessage({ trackAlias: alias, parameters, properties });
      session.aliasesOut.set(aliasKey, { requestId: BigInt(requestId), namespace: sub.namespace, trackName: sub.trackName });
      sub.state = 'established';
      sub.trackAlias = alias;
      if (expires !== undefined) sub.expiresAtMs = nowMs + Number(expires);
      event('subscribe_ok_sent', { requestId: BigInt(requestId).toString(), trackAlias: alias.toString() });
      return { bytes, trackAlias: alias };
    },

    receiveSubscribeOk(requestId, bytes) {
      requireEstablished('SUBSCRIBE_OK');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub || sub.kind !== 'subscribe' || sub.direction !== 'out' || sub.state !== 'pending') {
        fail('UNEXPECTED_MESSAGE', `SUBSCRIBE_OK for request ${requestId} has no pending outbound subscription`);
      }
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'SUBSCRIBE_OK') {
        fail('UNEXPECTED_MESSAGE', `expected SUBSCRIBE_OK, got ${decoded.typeName}`);
      }
      const message = decodeSubscribeOkMessage(decoded.body);
      const aliasKey = message.trackAlias.toString();
      if (session.aliasesIn.has(aliasKey)) {
        fail('DUPLICATE_TRACK_ALIAS', `track alias ${message.trackAlias} is already in use`);
      }
      session.aliasesIn.set(aliasKey, { requestId: BigInt(requestId), namespace: sub.namespace, trackName: sub.trackName });
      sub.state = 'established';
      sub.trackAlias = message.trackAlias;
      const expires = getParameter(message.parameters, MOQ_PARAMETERS.EXPIRES);
      if (expires !== undefined) sub.expiresAtMs = Date.now() + Number(expires);
      event('subscribe_ok_received', { requestId: BigInt(requestId).toString(), trackAlias: message.trackAlias.toString() });
      return { ...message, subscription: sub };
    },

    createRequestError({ requestId, errorCode, retryIntervalMs = 0, reason = '', details = [] }) {
      requireEstablished('REQUEST_ERROR');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (sub) sub.state = 'terminated';
      const bytes = encodeRequestErrorMessage({ errorCode, retryIntervalMs, reason, details });
      event('request_error_sent', { requestId: BigInt(requestId).toString(), errorCode: BigInt(errorCode).toString() });
      return bytes;
    },

    receiveRequestError(requestId, bytes) {
      requireEstablished('REQUEST_ERROR');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub) {
        fail('UNEXPECTED_MESSAGE', `REQUEST_ERROR for unknown request ${requestId}`);
      }
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'REQUEST_ERROR') {
        fail('UNEXPECTED_MESSAGE', `expected REQUEST_ERROR, got ${decoded.typeName}`);
      }
      const message = decodeRequestErrorMessage(decoded.body);
      sub.state = 'terminated';
      event('request_error_received', { requestId: BigInt(requestId).toString(), errorCode: message.errorCode.toString() });
      return { ...message, subscription: sub };
    },

    createRequestUpdate({ requestId, parameters = [] }) {
      requireEstablished('REQUEST_UPDATE');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub || sub.state !== 'established') {
        fail('UNEXPECTED_MESSAGE', `REQUEST_UPDATE for request ${requestId} has no established subscription`);
      }
      if (session.peerMaxRequestUpdates > 0 && sub.requestUpdatesOutstanding >= session.peerMaxRequestUpdates) {
        fail('TOO_MANY_REQUEST_UPDATES', `request ${requestId} already has ${sub.requestUpdatesOutstanding} outstanding REQUEST_UPDATEs (peer limit ${session.peerMaxRequestUpdates})`);
      }
      const bytes = encodeRequestUpdateMessage({ requestId, parameters });
      sub.requestUpdatesOutstanding += 1;
      event('request_update_sent', { requestId: BigInt(requestId).toString() });
      return bytes;
    },

    receiveRequestUpdate(requestId, bytes) {
      requireEstablished('REQUEST_UPDATE');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub) {
        fail('UNEXPECTED_MESSAGE', `REQUEST_UPDATE for unknown request ${requestId}`);
      }
      if (ourMaxRequestUpdates > 0 && sub.requestUpdatesOutstanding >= ourMaxRequestUpdates) {
        fail('TOO_MANY_REQUEST_UPDATES', `request ${requestId} already has ${sub.requestUpdatesOutstanding} outstanding REQUEST_UPDATEs (our limit ${ourMaxRequestUpdates})`);
      }
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'REQUEST_UPDATE') {
        fail('UNEXPECTED_MESSAGE', `expected REQUEST_UPDATE, got ${decoded.typeName}`);
      }
      const message = decodeRequestUpdateMessage(decoded.body);
      sub.requestUpdatesOutstanding += 1;
      event('request_update_received', { requestId: BigInt(requestId).toString() });
      return { ...message, subscription: sub };
    },

    respondToRequestUpdate(requestId, { ok, errorCode = 0, reason = '', parameters = [], properties = [], okKind = 'request_update' } = {}) {
      requireEstablished('REQUEST_OK/REQUEST_ERROR');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub) fail('UNEXPECTED_MESSAGE', `response to REQUEST_UPDATE for unknown request ${requestId}`);
      if (sub.requestUpdatesOutstanding > 0) sub.requestUpdatesOutstanding -= 1;
      if (ok) {
        const bytes = encodeRequestOkMessage({ parameters, properties, okKind });
        event('request_update_ok_sent', { requestId: BigInt(requestId).toString() });
        return { bytes };
      }
      const requestErrorBytes = encodeRequestErrorMessage({ errorCode, reason });
      // §9.5: a failed subscription update ends the subscription with
      // PUBLISH_DONE UPDATE_FAILED; a failed FETCH update resets the
      // FETCH stream; a failed namespace/track update closes the bidi
      // stream. The caller performs the stream action; this returns
      // the PUBLISH_DONE bytes for the subscription case.
      let publishDoneBytes = null;
      if (sub.kind === 'subscribe') {
        publishDoneBytes = encodePublishDoneMessage({ statusCode: MOQ_PUBLISH_DONE_CODES.UPDATE_FAILED, streamCount: sub.streamCount, reason });
        sub.state = 'terminated';
      }
      event('request_update_error_sent', { requestId: BigInt(requestId).toString(), errorCode: BigInt(errorCode).toString() });
      return { bytes: requestErrorBytes, publishDoneBytes };
    },

    createPublish({ namespace, trackName, parameters = [], properties = [], nowMs = Date.now() }) {
      requireEstablished('PUBLISH');
      if (!canInitiateNewRequests()) {
        fail('PROTOCOL_VIOLATION', 'new requests must not be initiated after GOAWAY');
      }
      const requestId = allocateRequestId();
      const trackAlias = allocateTrackAlias();
      const bytes = encodePublishMessage({ requestId, namespace, trackName, trackAlias, parameters, properties });
      const sub = recordSubscription(requestId, 'publish', { namespace, trackName, parameters, trackAlias, nowMs });
      session.aliasesOut.set(trackAlias.toString(), { requestId, namespace, trackName });
      event('publish_sent', { requestId: requestId.toString(), trackAlias: trackAlias.toString() });
      return { requestId, trackAlias, bytes, subscription: sub };
    },

    receivePublish(bytes) {
      requireEstablished('PUBLISH');
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'PUBLISH') {
        fail('UNEXPECTED_MESSAGE', `expected PUBLISH, got ${decoded.typeName}`);
      }
      const message = decodePublishMessage(decoded.body);
      validatePeerRequestId(message.requestId);
      const aliasKey = message.trackAlias.toString();
      if (session.aliasesIn.has(aliasKey)) {
        fail('DUPLICATE_TRACK_ALIAS', `track alias ${message.trackAlias} is already in use`);
      }
      if (isReservedNamespace(message.namespace) && !isDotSessionNamespace(message.namespace)) {
        return { ok: false, requestId: message.requestId, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST), requestErrorReason: 'track namespace is reserved' };
      }
      const limitCheck = checkFilterRangeLimit(message.parameters, ourMaxFilterRanges, 'PUBLISH');
      if (!limitCheck.ok) {
        return { ok: false, requestId: message.requestId, ...limitCheck };
      }
      session.aliasesIn.set(aliasKey, { requestId: message.requestId, namespace: message.namespace, trackName: message.trackName });
      const sub = recordSubscription(message.requestId, 'publish', {
        namespace: message.namespace, trackName: message.trackName, parameters: message.parameters, trackAlias: message.trackAlias,
      });
      sub.direction = 'in';
      event('publish_received', { requestId: message.requestId.toString(), trackAlias: message.trackAlias.toString() });
      return { ok: true, ...message, subscription: sub };
    },

    createPublishDone({ requestId, statusCode, streamCount = 0, reason = '' }) {
      requireEstablished('PUBLISH_DONE');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      // Two legs send PUBLISH_DONE: the publisher on its publish
      // request stream (direction 'out'), and the relay to a
      // subscriber on that subscriber's subscribe stream (the relay
      // holds the subscribe subscription as direction 'in').
      const isPublishLeg = sub && sub.direction === 'out';
      const isRelayToSubscriberLeg = sub && sub.direction === 'in' && sub.kind === 'subscribe';
      if (!sub || (!isPublishLeg && !isRelayToSubscriberLeg)) {
        fail('INVALID_FIELD', `PUBLISH_DONE for request ${requestId} has no outbound publish or inbound subscribe subscription`);
      }
      const bytes = encodePublishDoneMessage({ statusCode, streamCount, reason });
      sub.state = 'terminated';
      event('publish_done_sent', { requestId: BigInt(requestId).toString(), statusCode: BigInt(statusCode).toString() });
      return bytes;
    },

    receivePublishDone(requestId, bytes) {
      requireEstablished('PUBLISH_DONE');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      // Two legs receive PUBLISH_DONE: the relay on the publish
      // request stream (direction 'in'), and the subscriber on its
      // subscribe request stream (direction 'out', kind 'subscribe').
      const isPublishLeg = sub && sub.direction === 'in';
      const isSubscriberLeg = sub && sub.direction === 'out' && sub.kind === 'subscribe';
      if (!sub || (!isPublishLeg && !isSubscriberLeg)) {
        fail('UNEXPECTED_MESSAGE', `PUBLISH_DONE for request ${requestId} has no inbound publish or outbound subscribe subscription`);
      }
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'PUBLISH_DONE') {
        fail('UNEXPECTED_MESSAGE', `expected PUBLISH_DONE, got ${decoded.typeName}`);
      }
      const message = decodePublishDoneMessage(decoded.body);
      sub.state = 'terminated';
      event('publish_done_received', { requestId: BigInt(requestId).toString(), statusCode: message.statusCode.toString() });
      return { ...message, subscription: sub };
    },

    createPublishStateNotify({ requestId, parameters = [] }) {
      requireEstablished('PUBLISH_STATE_NOTIFY');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub || sub.direction !== 'out' || sub.kind !== 'publish') {
        fail('ROLE_VIOLATION', `PUBLISH_STATE_NOTIFY for request ${requestId} is not an outbound publish subscription`);
      }
      const bytes = encodePublishStateNotifyMessage({ parameters });
      event('publish_state_notify_sent', { requestId: BigInt(requestId).toString() });
      return bytes;
    },

    receivePublishStateNotify(requestId, bytes) {
      requireEstablished('PUBLISH_STATE_NOTIFY');
      const sub = session.subscriptions.get(BigInt(requestId).toString());
      if (!sub || sub.direction !== 'in' || sub.kind !== 'publish') {
        fail('ROLE_VIOLATION', `PUBLISH_STATE_NOTIFY received for request ${requestId}, which is not an inbound publish subscription`);
      }
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'PUBLISH_STATE_NOTIFY') {
        fail('UNEXPECTED_MESSAGE', `expected PUBLISH_STATE_NOTIFY, got ${decoded.typeName}`);
      }
      const message = decodePublishStateNotifyMessage(decoded.body);
      event('publish_state_notify_received', { requestId: BigInt(requestId).toString() });
      return { ...message, subscription: sub };
    },

    createFetch({ namespace, trackName, parameters = [], nowMs = Date.now() }) {
      requireEstablished('FETCH');
      if (!canInitiateNewRequests()) {
        fail('PROTOCOL_VIOLATION', 'new requests must not be initiated after GOAWAY');
      }
      const requestId = allocateRequestId();
      const bytes = encodeRequestMessage(MOQ_MESSAGE_TYPES.FETCH, { requestId, namespace, trackName, parameters });
      recordSubscription(requestId, 'fetch', { namespace, trackName, parameters, nowMs });
      event('fetch_sent', { requestId: requestId.toString() });
      return { requestId, bytes };
    },

    receiveFetch(bytes) {
      requireEstablished('FETCH');
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'FETCH') {
        fail('UNEXPECTED_MESSAGE', `expected FETCH, got ${decoded.typeName}`);
      }
      const message = decodeRequestMessage(decoded.body, MOQ_MESSAGE_TYPES.FETCH);
      validatePeerRequestId(message.requestId);
      const limitCheck = checkFilterRangeLimit(message.parameters, ourMaxFilterRanges, 'FETCH');
      if (!limitCheck.ok) {
        return { ok: false, requestId: message.requestId, ...limitCheck };
      }
      const sub = recordSubscription(message.requestId, 'fetch', {
        namespace: message.namespace, trackName: message.trackName, parameters: message.parameters,
      });
      sub.direction = 'in';
      event('fetch_received', { requestId: message.requestId.toString() });
      return { ok: true, ...message, subscription: sub };
    },

    createTrackStatus({ namespace, trackName, parameters = [], nowMs = Date.now() }) {
      requireEstablished('TRACK_STATUS');
      if (!canInitiateNewRequests()) {
        fail('PROTOCOL_VIOLATION', 'new requests must not be initiated after GOAWAY');
      }
      const requestId = allocateRequestId();
      const bytes = encodeRequestMessage(MOQ_MESSAGE_TYPES.TRACK_STATUS, { requestId, namespace, trackName, parameters });
      recordSubscription(requestId, 'track_status', { namespace, trackName, parameters, nowMs });
      event('track_status_sent', { requestId: requestId.toString() });
      return { requestId, bytes };
    },

    receiveTrackStatus(bytes) {
      requireEstablished('TRACK_STATUS');
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'TRACK_STATUS') {
        fail('UNEXPECTED_MESSAGE', `expected TRACK_STATUS, got ${decoded.typeName}`);
      }
      const message = decodeRequestMessage(decoded.body, MOQ_MESSAGE_TYPES.TRACK_STATUS);
      validatePeerRequestId(message.requestId);
      const sub = recordSubscription(message.requestId, 'track_status', {
        namespace: message.namespace, trackName: message.trackName, parameters: message.parameters,
      });
      sub.direction = 'in';
      event('track_status_received', { requestId: message.requestId.toString() });
      return { ok: true, ...message, subscription: sub };
    },

    createPublishNamespace({ namespacePrefix, parameters = [], nowMs = Date.now() }) {
      requireEstablished('PUBLISH_NAMESPACE');
      if (!canInitiateNewRequests()) {
        fail('PROTOCOL_VIOLATION', 'new requests must not be initiated after GOAWAY');
      }
      const requestId = allocateRequestId();
      const bytes = encodeNamespaceRequestMessage(MOQ_MESSAGE_TYPES.PUBLISH_NAMESPACE, { requestId, namespacePrefix, parameters });
      recordSubscription(requestId, 'publish_namespace', { namespace: namespacePrefix, parameters, nowMs });
      event('publish_namespace_sent', { requestId: requestId.toString() });
      return { requestId, bytes };
    },

    receivePublishNamespace(bytes) {
      requireEstablished('PUBLISH_NAMESPACE');
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'PUBLISH_NAMESPACE') {
        fail('UNEXPECTED_MESSAGE', `expected PUBLISH_NAMESPACE, got ${decoded.typeName}`);
      }
      const message = decodeNamespaceRequestMessage(decoded.body, MOQ_MESSAGE_TYPES.PUBLISH_NAMESPACE);
      validatePeerRequestId(message.requestId);
      const sub = recordSubscription(message.requestId, 'publish_namespace', {
        namespace: message.namespacePrefix, parameters: message.parameters,
      });
      sub.direction = 'in';
      event('publish_namespace_received', { requestId: message.requestId.toString() });
      return { ok: true, ...message, subscription: sub };
    },

    createSubscribeNamespace({ namespacePrefix, parameters = [], nowMs = Date.now() }) {
      requireEstablished('SUBSCRIBE_NAMESPACE');
      if (!canInitiateNewRequests()) {
        fail('PROTOCOL_VIOLATION', 'new requests must not be initiated after GOAWAY');
      }
      const requestId = allocateRequestId();
      const bytes = encodeNamespaceRequestMessage(MOQ_MESSAGE_TYPES.SUBSCRIBE_NAMESPACE, { requestId, namespacePrefix, parameters });
      recordSubscription(requestId, 'subscribe_namespace', { namespace: namespacePrefix, parameters, nowMs });
      event('subscribe_namespace_sent', { requestId: requestId.toString() });
      return { requestId, bytes };
    },

    receiveSubscribeNamespace(bytes) {
      requireEstablished('SUBSCRIBE_NAMESPACE');
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'SUBSCRIBE_NAMESPACE') {
        fail('UNEXPECTED_MESSAGE', `expected SUBSCRIBE_NAMESPACE, got ${decoded.typeName}`);
      }
      const message = decodeNamespaceRequestMessage(decoded.body, MOQ_MESSAGE_TYPES.SUBSCRIBE_NAMESPACE);
      validatePeerRequestId(message.requestId);
      const sub = recordSubscription(message.requestId, 'subscribe_namespace', {
        namespace: message.namespacePrefix, parameters: message.parameters,
      });
      sub.direction = 'in';
      event('subscribe_namespace_received', { requestId: message.requestId.toString() });
      return { ok: true, ...message, subscription: sub };
    },

    createSubscribeTracks({ namespacePrefix, parameters = [], nowMs = Date.now() }) {
      requireEstablished('SUBSCRIBE_TRACKS');
      if (!canInitiateNewRequests()) {
        fail('PROTOCOL_VIOLATION', 'new requests must not be initiated after GOAWAY');
      }
      const requestId = allocateRequestId();
      const bytes = encodeSubscribeTracksMessage({ requestId, namespacePrefix, parameters });
      recordSubscription(requestId, 'subscribe_tracks', { namespace: namespacePrefix, parameters, nowMs });
      event('subscribe_tracks_sent', { requestId: requestId.toString() });
      return { requestId, bytes };
    },

    receiveSubscribeTracks(bytes) {
      requireEstablished('SUBSCRIBE_TRACKS');
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'SUBSCRIBE_TRACKS') {
        fail('UNEXPECTED_MESSAGE', `expected SUBSCRIBE_TRACKS, got ${decoded.typeName}`);
      }
      const message = decodeSubscribeTracksMessage(decoded.body);
      validatePeerRequestId(message.requestId);
      const sub = recordSubscription(message.requestId, 'subscribe_tracks', {
        namespace: message.namespacePrefix, parameters: message.parameters,
      });
      sub.direction = 'in';
      event('subscribe_tracks_received', { requestId: message.requestId.toString() });
      return { ok: true, ...message, subscription: sub };
    },

    createGoaway({ newSessionUri = '', timeoutMs = 0 } = {}) {
      requireEstablished('GOAWAY');
      if (session.goawaySentCount > 0) {
        fail('UNEXPECTED_MESSAGE', 'a second GOAWAY was sent on this control stream');
      }
      if (role === 'client' && newSessionUri !== '') {
        fail('ROLE_VIOLATION', 'a client MUST send a zero-length New Session URI in GOAWAY');
      }
      const bytes = encodeGoawayMessage({ newSessionUri, timeoutMs });
      session.goawaySentCount += 1;
      session.goawaySentAtMs = Date.now();
      session.state = 'goaway_sent';
      event('goaway_sent', { newSessionUri, timeoutMs: Number(checkU64(timeoutMs, 'GOAWAY timeout')) });
      return bytes;
    },

    receiveGoaway(bytes, { requestId = null } = {}) {
      requireEstablished('GOAWAY');
      if (requestId === null && session.goawayReceivedCount > 0) {
        fail('UNEXPECTED_MESSAGE', 'a second GOAWAY was received on this control stream');
      }
      if (requestId !== null) {
        // GOAWAY on a request stream: only the receiver of the request
        // may send it (§9.2). If WE are the receiver (direction 'in'),
        // the peer sending GOAWAY on it is a PROTOCOL_VIOLATION.
        const sub = session.subscriptions.get(BigInt(requestId).toString());
        if (sub && sub.direction === 'in') {
          fail('PROTOCOL_VIOLATION', `GOAWAY received on request stream ${requestId}, which we received (only the receiver of a request may send GOAWAY on it)`);
        }
      }
      const decoded = decodeControlMessage(bytes, { maxControlMessageSize: ourMaxControlMessageSize });
      if (decoded.typeName !== 'GOAWAY') {
        fail('UNEXPECTED_MESSAGE', `expected GOAWAY, got ${decoded.typeName}`);
      }
      const message = decodeGoawayMessage(decoded.body);
      if (peerRole === 'client' && message.newSessionUri !== '') {
        fail('ROLE_VIOLATION', 'a client MUST send a zero-length New Session URI in GOAWAY');
      }
      if (requestId === null) {
        session.goawayReceivedCount += 1;
        session.goawayReceivedAtMs = Date.now();
        session.state = 'goaway_received';
      }
      event('goaway_received', { requestId: requestId === null ? null : BigInt(requestId).toString(), newSessionUri: message.newSessionUri });
      return message;
    },

    getSubscription(requestId) {
      return session.subscriptions.get(BigInt(requestId).toString()) ?? null;
    },

    listSubscriptions() {
      return [...session.subscriptions.values()];
    },

    // EXPIRES (§9.19.16): returns the requests whose expiry time has
    // passed. The caller terminates them (PUBLISH_DONE EXPIRED for
    // subscriptions, REQUEST_ERROR TIMEOUT otherwise).
    checkExpiries(nowMs = Date.now()) {
      const expired = [];
      for (const sub of session.subscriptions.values()) {
        if (sub.state === 'established' && sub.expiresAtMs !== null && nowMs >= sub.expiresAtMs) {
          sub.state = 'terminated';
          expired.push({ requestId: sub.requestId, kind: sub.kind });
          event('request_expired', { requestId: sub.requestId.toString(), kind: sub.kind });
        }
      }
      return expired;
    },

    registerToken,

    close({ code = 'NO_ERROR', reason = '' } = {}) {
      if (!MOQ_SESSION_ERROR_CODES[code]) {
        fail('INVALID_FIELD', `unknown session error code '${code}'`);
      }
      session.closed = { code, codeValue: MOQ_SESSION_ERROR_CODES[code], reason };
      session.state = 'closed';
      event('session_closed', { code, reason });
      return session.closed;
    },

    isClosed() {
      return session.closed !== null;
    },
  };

  return api;
}

// REQUEST_UPDATE coalescing (§9.5): several REQUEST_UPDATEs on one
// request stream may be coalesced into one, EXCEPT when a non-
// coalescible parameter is present (FILL_PARAMETERS 0x23,
// TRACK_NAMESPACE_PREFIX 0x34). Sticky parameters: absent = unchanged,
// so the coalesced update carries the latest value of each parameter
// type present in any update.
export function coalesceRequestUpdates(updates) {
  if (!Array.isArray(updates)) fail('INVALID_FIELD', 'updates must be an array');
  const coalescible = [];
  const standalone = [];
  for (const update of updates) {
    const params = update.parameters ?? [];
    const hasNonCoalescible = params.some((param) => MOQ_NON_COALESCIBLE_PARAMETERS.includes(Number(param.type)));
    if (hasNonCoalescible) standalone.push(update);
    else coalescible.push(update);
  }
  const merged = new Map();
  for (const update of coalescible) {
    for (const param of update.parameters ?? []) {
      merged.set(param.type.toString(), param);
    }
  }
  const result = [];
  if (merged.size > 0) {
    result.push({
      requestId: coalescible[coalescible.length - 1].requestId,
      parameters: [...merged.values()].sort((a, b) => (a.type < b.type ? -1 : 1)),
    });
  }
  result.push(...standalone);
  return result;
}

// ---------------------------------------------------------------------------
// Group/object sequencing with malformed-track detection (§12.1)
// Strict in-order admission per subgroup: objects within one subgroup
// must arrive with consecutive Object IDs (delta +1). Duplicates with
// identical payload/properties/mode/priority are deduped, not refused.
// A duplicate with different payload, immutable properties, delivery
// mode or subgroup priority is a malformed track, as is an object
// beyond the final object of a group/track, an object after End of
// Track, or a group regression. A gap is refused with
// 'object_out_of_order' unless the caller passes {allowGap: true}
// (datagram delivery may legitimately lose objects; subgroup streams
// may not skip). Advancing to a new group while the previous group is
// unended is recorded as an abandoned group, not refused (§11.3.2
// reset cases: timeouts, early termination, paused omission).
// ---------------------------------------------------------------------------

export function createTrackSequencer({ trackAlias = null, namespace = null, trackName = null } = {}) {
  const state = {
    trackAlias,
    namespace,
    trackName,
    currentGroupId: null,
    groups: new Map(),
    trackEnded: false,
    largestObject: null,
    malformed: null,
    admittedCount: 0,
    dedupedCount: 0,
    refusedCount: 0,
  };

  function groupState(groupId) {
    const key = groupId.toString();
    let group = state.groups.get(key);
    if (!group) {
      group = {
        groupId,
        subgroups: new Map(),
        finalObjectId: null,
        ended: false,
        endedBy: null,
        abandoned: false,
      };
      state.groups.set(key, group);
    }
    return group;
  }

  function payloadHash(payload) {
    // Cheap content identity for duplicate comparison (the payload
    // itself is kept by the caller; the sequencer only compares).
    let hash = 0n;
    const bytes = toBuffer(payload ?? Buffer.alloc(0), 'object payload');
    for (let i = 0; i < bytes.length; i++) {
      hash = ((hash * 31n) + BigInt(bytes[i])) & 0xffffffffffffffffn;
    }
    return `${bytes.length}:${hash.toString(16)}`;
  }

  function propertiesHash(properties) {
    if (!properties || properties.length === 0) return '';
    return properties.map((property) => `${property.type}:${Buffer.isBuffer(property.value) ? property.value.toString('hex') : String(property.value)}`).join('|');
  }

  const api = {
    state,

    admitObject(object, opts = {}) {
      if (!isPlainObject(object)) fail('INVALID_FIELD', 'sequencer object must be an object');
      const groupId = checkU64(object.groupId, 'group ID');
      const objectId = checkU64(object.objectId, 'object ID');
      const subgroupId = checkU64(object.subgroupId ?? 0, 'subgroup ID');
      const deliveryMode = object.deliveryMode ?? 'subgroup';
      if (deliveryMode !== 'subgroup' && deliveryMode !== 'datagram' && deliveryMode !== 'fetch') {
        fail('INVALID_FIELD', `unknown delivery mode '${deliveryMode}'`);
      }
      const refuse = (reason, detail) => {
        state.refusedCount += 1;
        return { ok: false, malformed: true, reason, detail: detail ?? null, code: 'MALFORMED_TRACK' };
      };
      if (state.trackEnded) {
        return refuse('object_after_end_of_track', `object ${groupId}:${objectId} arrived after End of Track`);
      }
      if (state.currentGroupId !== null && groupId < state.currentGroupId) {
        return refuse('group_regressed', `group ${groupId} is below the current group ${state.currentGroupId}`);
      }
      let previousGroupAbandoned = false;
      if (state.currentGroupId !== null && groupId > state.currentGroupId) {
        const prev = state.groups.get(state.currentGroupId.toString());
        if (prev && !prev.ended) {
          prev.abandoned = true;
          previousGroupAbandoned = true;
        }
        state.currentGroupId = groupId;
      }
      if (state.currentGroupId === null) state.currentGroupId = groupId;
      const group = groupState(groupId);
      if (group.ended && group.finalObjectId !== null && objectId > group.finalObjectId) {
        return refuse('object_beyond_final', `object ${groupId}:${objectId} is beyond the final object ${group.finalObjectId} of group ${groupId}`);
      }
      if (group.ended && group.finalObjectId !== null && objectId === group.finalObjectId && object.objectStatus !== undefined && object.objectStatus !== null) {
        // A status object AT the final object ID is the final object
        // itself; fall through to the duplicate check below.
      }
      const subgroupKey = subgroupId.toString();
      let subgroup = group.subgroups.get(subgroupKey);
      if (!subgroup) {
        subgroup = {
          subgroupId,
          lastObjectId: null,
          priority: object.publisherPriority ?? null,
          seen: new Map(),
        };
        group.subgroups.set(subgroupKey, subgroup);
      }
      // §12.1 condition 1: a subgroup's publisher priority must not
      // change between objects.
      if (object.publisherPriority !== undefined && object.publisherPriority !== null
        && subgroup.priority !== null && object.publisherPriority !== subgroup.priority) {
        return refuse('subgroup_priority_changed', `subgroup ${subgroupId} priority changed from ${subgroup.priority} to ${object.publisherPriority}`);
      }
      const seenKey = objectId.toString();
      const seen = subgroup.seen.get(seenKey);
      const thisPayloadHash = payloadHash(object.payload);
      const thisPropertiesHash = propertiesHash(object.properties);
      if (seen) {
        if (seen.payloadHash === thisPayloadHash && seen.propertiesHash === thisPropertiesHash
          && seen.deliveryMode === deliveryMode) {
          state.dedupedCount += 1;
          return { ok: true, admitted: false, deduped: true, groupId, objectId, subgroupId };
        }
        return refuse('duplicate_object_differs', `object ${groupId}:${objectId} was already seen with a different payload, properties or delivery mode`);
      }
      if (subgroup.lastObjectId !== null) {
        if (objectId <= subgroup.lastObjectId) {
          return refuse('object_out_of_order', `object ${groupId}:${objectId} is not after the last object ${subgroup.lastObjectId} in subgroup ${subgroupId}`);
        }
        if (objectId > subgroup.lastObjectId + 1n && !opts.allowGap) {
          return refuse('object_out_of_order', `object ${groupId}:${objectId} skips object(s) after ${subgroup.lastObjectId} in subgroup ${subgroupId}`);
        }
      }
      const gap = subgroup.lastObjectId !== null && objectId > subgroup.lastObjectId + 1n;
      const status = object.objectStatus === undefined || object.objectStatus === null
        ? MOQ_OBJECT_STATUS.NORMAL
        : Number(checkObjectStatus(object.objectStatus));
      subgroup.seen.set(seenKey, {
        payloadHash: thisPayloadHash,
        propertiesHash: thisPropertiesHash,
        deliveryMode,
        priority: object.publisherPriority ?? null,
      });
      subgroup.lastObjectId = objectId;
      if (object.publisherPriority !== undefined && object.publisherPriority !== null) {
        subgroup.priority = object.publisherPriority;
      }
      if (status === MOQ_OBJECT_STATUS.END_OF_GROUP || object.endOfGroup) {
        if (group.finalObjectId !== null && group.finalObjectId !== objectId) {
          return refuse('conflicting_final_object', `group ${groupId} already ended at object ${group.finalObjectId}, now ends at ${objectId}`);
        }
        group.finalObjectId = objectId;
        group.ended = true;
        group.endedBy = 'end_of_group';
      }
      if (status === MOQ_OBJECT_STATUS.END_OF_TRACK) {
        if (group.finalObjectId !== null && group.finalObjectId !== objectId) {
          return refuse('conflicting_final_object', `group ${groupId} already ended at object ${group.finalObjectId}, now ends at ${objectId} (End of Track)`);
        }
        group.finalObjectId = objectId;
        group.ended = true;
        group.endedBy = 'end_of_track';
        state.trackEnded = true;
      }
      state.admittedCount += 1;
      if (!state.largestObject || compareLocation({ group: groupId, object: objectId }, state.largestObject) > 0) {
        state.largestObject = { group: groupId, object: objectId };
      }
      return {
        ok: true,
        admitted: true,
        deduped: false,
        gap,
        previousGroupAbandoned,
        groupId,
        objectId,
        subgroupId,
        largestObject: state.largestObject,
      };
    },

    getLargestObject() {
      return state.largestObject;
    },

    isGroupEnded(groupId) {
      const group = state.groups.get(checkU64(groupId, 'group ID').toString());
      return group ? group.ended : false;
    },

    isTrackEnded() {
      return state.trackEnded;
    },

    reset() {
      state.currentGroupId = null;
      state.groups.clear();
      state.trackEnded = false;
      state.largestObject = null;
      state.malformed = null;
      state.admittedCount = 0;
      state.dedupedCount = 0;
      state.refusedCount = 0;
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// Scheduling (§5.1) and delivery timeouts (§5.2)
// Scheduling order (§5.1.2): subscriber priority, then publisher
// priority, then group order, then lowest subgroup/object ID; on a
// mode tie, datagrams first.
// ---------------------------------------------------------------------------

export function sortTransmissionCandidates(candidates, { groupOrder = MOQ_GROUP_ORDER.ASCENDING } = {}) {
  if (!Array.isArray(candidates)) fail('INVALID_FIELD', 'candidates must be an array');
  const order = groupOrder === MOQ_GROUP_ORDER.DESCENDING ? -1 : 1;
  const sorted = [...candidates];
  sorted.sort((a, b) => {
    const subA = a.subscriberPriority === undefined ? MOQ_DEFAULT_SUBSCRIBER_PRIORITY : a.subscriberPriority;
    const subB = b.subscriberPriority === undefined ? MOQ_DEFAULT_SUBSCRIBER_PRIORITY : b.subscriberPriority;
    if (subA !== subB) return subA - subB;
    const pubA = a.publisherPriority === undefined || a.publisherPriority === null ? 128 : a.publisherPriority;
    const pubB = b.publisherPriority === undefined || b.publisherPriority === null ? 128 : b.publisherPriority;
    if (pubA !== pubB) return pubA - pubB;
    const groupA = checkU64(a.groupId ?? 0, 'candidate groupId');
    const groupB = checkU64(b.groupId ?? 0, 'candidate groupId');
    if (groupA !== groupB) return (groupA < groupB ? -1 : 1) * order;
    const subIdA = checkU64(a.subgroupId ?? 0, 'candidate subgroupId');
    const subIdB = checkU64(b.subgroupId ?? 0, 'candidate subgroupId');
    if (subIdA !== subIdB) return subIdA < subIdB ? -1 : 1;
    const objA = checkU64(a.objectId ?? 0, 'candidate objectId');
    const objB = checkU64(b.objectId ?? 0, 'candidate objectId');
    if (objA !== objB) return objA < objB ? -1 : 1;
    if (a.deliveryMode !== b.deliveryMode) {
      return a.deliveryMode === 'datagram' ? -1 : 1;
    }
    return (a.enqueuedAtMs ?? 0) - (b.enqueuedAtMs ?? 0);
  });
  return sorted;
}

// §5.2: the publisher value is the Object/Subgroup Property on the
// first object of a subgroup (else the Track Property); if both the
// publisher and subscriber values are non-zero, the smaller wins; a
// value of 0 means no timeout.
export function effectiveDeliveryTimeout({ publisherTimeoutMs = 0, subscriberTimeoutMs = 0 } = {}) {
  const publisher = Number(checkU64(publisherTimeoutMs, 'publisher delivery timeout'));
  const subscriber = Number(checkU64(subscriberTimeoutMs, 'subscriber delivery timeout'));
  if (publisher === 0) return subscriber;
  if (subscriber === 0) return publisher;
  return Math.min(publisher, subscriber);
}

export function isDeliveryExpired({ sentAtMs, nowMs, timeoutMs }) {
  const timeout = Number(checkU64(timeoutMs ?? 0, 'delivery timeout'));
  if (timeout === 0) return false;
  return (nowMs - sentAtMs) > timeout;
}

export function deliveryTimeoutCheck({ publisherTimeoutMs = 0, subscriberTimeoutMs = 0, sentAtMs, nowMs }) {
  const effective = effectiveDeliveryTimeout({ publisherTimeoutMs, subscriberTimeoutMs });
  return { effectiveTimeoutMs: effective, expired: isDeliveryExpired({ sentAtMs, nowMs, timeoutMs: effective }) };
}

// ---------------------------------------------------------------------------
// Caching relay (§7)
// Track registry, object cache keyed by Full Track Name + Group ID +
// Object ID (§7.1), namespace advertisement (§4), fan-out to
// downstream subscriptions, paused handling (§7.2: upstream stays
// unpaused while ANY downstream subscription is unpaused), and
// malformed-track handling (§12.1: downstream PUBLISH_DONE
// MALFORMED_TRACK, fetch streams reset, triggering objects NOT
// cached). The relay owns no sockets: deliveries land in each
// subscription's pendingDeliveries queue, and the transport (TCP
// loopback pair, or a future QUIC transport) drains the queue.
// Subgroup-stream continuity (§11.3.2): the relay must not forward an
// object on an existing subgroup stream unless it is the next object;
// streamForObject returns the stream to use, opening a new one (and
// naming the old stream to reset) when the object is not next.
// ---------------------------------------------------------------------------

export function createMoqRelay(config = {}) {
  const maxCachedObjects = config.maxCachedObjects === undefined ? 10000 : config.maxCachedObjects;
  const maxCacheBytes = config.maxCacheBytes === undefined ? 64 * 1024 * 1024 : config.maxCacheBytes;
  const relayMaxFilterRanges = config.maxFilterRanges === undefined ? 0 : config.maxFilterRanges;

  const relay = {
    tracks: new Map(),
    advertisedNamespaces: new Map(),
    events: [],
    nextDownstreamAlias: 0n,
    nextStreamId: 1,
    cacheBytes: 0,
    cacheObjects: 0,
  };

  function event(type, detail = {}) {
    relay.events.push({ type, atMs: Date.now(), ...detail });
    return relay.events[relay.events.length - 1];
  }

  function trackKey(namespace, trackName) {
    return fullTrackNameKey(namespace, trackName);
  }

  function getTrack(namespace, trackName) {
    return relay.tracks.get(trackKey(namespace, trackName)) ?? null;
  }

  function ensureTrack(namespace, trackName) {
    const key = trackKey(namespace, trackName);
    let track = relay.tracks.get(key);
    if (!track) {
      track = {
        namespace,
        trackName,
        key,
        publishers: new Map(),
        subscriptions: new Map(),
        cache: new Map(),
        evictedRanges: [],
        sequencer: createTrackSequencer({ namespace, trackName }),
        malformed: null,
        ended: false,
        endStatusCode: null,
        largestObject: null,
      };
      relay.tracks.set(key, track);
    }
    return track;
  }

  function cacheObjectKey(groupId, objectId) {
    return `${groupId.toString()}:${objectId.toString()}`;
  }

  function cachePut(track, object) {
    const key = cacheObjectKey(object.groupId, object.objectId);
    const existing = track.cache.get(key);
    const size = Buffer.byteLength(object.payload ?? Buffer.alloc(0)) + 64;
    if (existing) {
      if (!bytesEqual(toBuffer(existing.payload ?? Buffer.alloc(0), 'cached payload'), toBuffer(object.payload ?? Buffer.alloc(0), 'object payload'))
        || existing.deliveryMode !== object.deliveryMode) {
        return { ok: false, reason: 'malformed_track', detail: `duplicate object ${object.groupId}:${object.objectId} with a different payload or delivery mode (§7.1 cache key)` };
      }
      return { ok: true, deduped: true };
    }
    // Bounded cache: evict the oldest objects first (FIFO by insertion).
    while ((relay.cacheObjects >= maxCachedObjects || relay.cacheBytes + size > maxCacheBytes) && track.cache.size > 0) {
      const oldestKey = track.cache.keys().next().value;
      const oldest = track.cache.get(oldestKey);
      track.cache.delete(oldestKey);
      relay.cacheObjects -= 1;
      relay.cacheBytes -= oldest.size;
      track.evictedRanges.push({ groupId: oldest.groupId, objectId: oldest.objectId });
    }
    track.cache.set(key, { ...object, size, cachedAtMs: Date.now() });
    relay.cacheObjects += 1;
    relay.cacheBytes += size;
    return { ok: true };
  }

  function subscriptionPassesFilters(sub, object) {
    if (sub.paused) return false;
    const locationFilter = sub.locationFilter;
    if (locationFilter) {
      const resolved = resolveLocationFilter(locationFilter, sub.largestObjectSeen ?? trackLargestObject(sub));
      if (resolved.start && compareLocation({ group: object.groupId, object: object.objectId }, resolved.start) < 0) return false;
      if (resolved.end && compareLocation({ group: object.groupId, object: object.objectId }, resolved.end) > 0) return false;
    }
    for (const filter of sub.rangeFilters ?? []) {
      const value = filterValueFor(object, filter);
      if (value === null) return false;
      if (!rangeFilterMatches(filter.ranges, value)) return false;
    }
    return true;
  }

  function trackLargestObject(sub) {
    // The subscriber's view of Largest Object: the relay's largest
    // object for the track (updated on every admitted object).
    const track = relay.tracks.get(sub.trackKey);
    return track ? track.largestObject : null;
  }

  function filterValueFor(object, filter) {
    switch (filter.type) {
      case 0x25: return object.subgroupId ?? 0n;
      case 0x26: return object.objectId;
      case 0x27: return object.publisherPriority === null || object.publisherPriority === undefined ? null : BigInt(object.publisherPriority);
      case 0x28: {
        const property = (object.properties ?? []).find((entry) => entry.type === BigInt(filter.propertyType));
        if (!property) return null;
        if (typeof property.value !== 'bigint') return null;
        return property.value;
      }
      default: return null;
    }
  }

  const api = {
    relay,

    publishNamespace(namespacePrefix, { requestId = null } = {}) {
      const key = namespaceKey(namespacePrefix);
      if (!relay.advertisedNamespaces.has(key)) {
        relay.advertisedNamespaces.set(key, { namespacePrefix, requestIds: new Set(), tracks: new Set() });
      }
      const entry = relay.advertisedNamespaces.get(key);
      if (requestId !== null) entry.requestIds.add(BigInt(requestId).toString());
      event('namespace_published', { namespacePrefix: key });
      return { ok: true, namespacePrefix };
    },

    unpublishNamespace(namespacePrefix) {
      const key = namespaceKey(namespacePrefix);
      const removed = relay.advertisedNamespaces.delete(key);
      if (removed) event('namespace_unpublished', { namespacePrefix: key });
      return { ok: removed };
    },

    advertiseNamespaces() {
      const advertised = [];
      for (const entry of relay.advertisedNamespaces.values()) {
        const tracks = [];
        for (const track of relay.tracks.values()) {
          if (namespacePrefixMatches(entry.namespacePrefix, track.namespace)) {
            tracks.push({ namespace: track.namespace, trackName: track.trackName });
            entry.tracks.add(track.key);
          }
        }
        advertised.push({ namespacePrefix: entry.namespacePrefix, tracks });
      }
      return advertised;
    },

    registerPublisher({ namespace, trackName, requestId, parameters = [] }) {
      const track = ensureTrack(namespace, trackName);
      track.publishers.set(BigInt(requestId).toString(), { requestId: BigInt(requestId), parameters });
      event('publisher_registered', { track: track.key, requestId: BigInt(requestId).toString() });
      // A held (rendezvous) subscription can now proceed.
      const ready = [];
      for (const sub of track.subscriptions.values()) {
        if (sub.state === 'rendezvous') {
          sub.state = 'pending';
          ready.push(sub.requestId);
        }
      }
      return { ok: true, trackKey: track.key, rendezvousReady: ready };
    },

    unregisterPublisher({ namespace, trackName, requestId }) {
      const track = getTrack(namespace, trackName);
      if (!track) return { ok: false, reason: 'no_such_track' };
      track.publishers.delete(BigInt(requestId).toString());
      event('publisher_unregistered', { track: track.key, requestId: BigInt(requestId).toString() });
      return { ok: true };
    },

    subscribe({ namespace, trackName, requestId, parameters = [], nowMs = Date.now() }) {
      if (isReservedNamespace(namespace) && !isDotSessionNamespace(namespace)) {
        return { ok: false, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST), requestErrorReason: 'track namespace is reserved' };
      }
      const track = getTrack(namespace, trackName);
      const totalRanges = (parameters ?? []).reduce((sum, param) => sum + (FILTER_PARAMETER_TYPES.has(Number(param.type)) ? (param.value?.ranges ?? []).length : 0), 0);
      if (totalRanges > relayMaxFilterRanges) {
        return { ok: false, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.INVALID_FILTER), requestErrorReason: `SUBSCRIBE carries ${totalRanges} filter ranges, over the relay MAX_FILTER_RANGES limit ${relayMaxFilterRanges}` };
      }
      const locationFilter = getParameter(parameters, MOQ_PARAMETERS.LOCATION_FILTER) ?? null;
      const rangeFilters = (parameters ?? [])
        .filter((param) => FILTER_PARAMETER_TYPES.has(Number(param.type)))
        .map((param) => ({ type: Number(param.type), setId: param.value.setId, propertyType: param.value.propertyType, ranges: param.value.ranges }));
      const paused = getParameter(parameters, MOQ_PARAMETERS.PAUSED) === 1;
      const rendezvousTimeout = getParameter(parameters, MOQ_PARAMETERS.RENDEZVOUS_TIMEOUT);
      if (!track) {
        if (rendezvousTimeout !== undefined && rendezvousTimeout > 0n) {
          const heldTrack = ensureTrack(namespace, trackName);
          const alias = relay.nextDownstreamAlias;
          relay.nextDownstreamAlias += 1n;
          const sub = {
            requestId: BigInt(requestId), trackKey: heldTrack.key, namespace, trackName,
            trackAlias: alias, parameters, locationFilter, rangeFilters, paused,
            state: 'rendezvous', rendezvousExpiresAtMs: nowMs + Number(rendezvousTimeout),
            largestObjectSeen: null, pendingDeliveries: [], subgroupStreams: new Map(),
            subscriberPriority: getParameter(parameters, MOQ_PARAMETERS.SUBSCRIBER_PRIORITY) ?? MOQ_DEFAULT_SUBSCRIBER_PRIORITY,
          };
          heldTrack.subscriptions.set(BigInt(requestId).toString(), sub);
          event('subscribe_rendezvous', { requestId: BigInt(requestId).toString(), track: heldTrack.key });
          return { ok: true, held: true, trackAlias: alias, subscription: sub };
        }
        return { ok: false, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST), requestErrorReason: `no publisher for track ${renderFullTrackName(namespace, trackName)}` };
      }
      const alias = relay.nextDownstreamAlias;
      relay.nextDownstreamAlias += 1n;
      const sub = {
        requestId: BigInt(requestId), trackKey: track.key, namespace, trackName,
        trackAlias: alias, parameters, locationFilter, rangeFilters, paused,
        state: 'established', rendezvousExpiresAtMs: null,
        largestObjectSeen: track.largestObject, pendingDeliveries: [], subgroupStreams: new Map(),
        subscriberPriority: getParameter(parameters, MOQ_PARAMETERS.SUBSCRIBER_PRIORITY) ?? MOQ_DEFAULT_SUBSCRIBER_PRIORITY,
      };
      track.subscriptions.set(BigInt(requestId).toString(), sub);
      event('subscribe_established', { requestId: BigInt(requestId).toString(), track: track.key, trackAlias: alias.toString() });
      return { ok: true, held: false, trackAlias: alias, subscription: sub, trackProperties: [] };
    },

    unsubscribe({ namespace, trackName, requestId }) {
      const track = getTrack(namespace, trackName);
      if (!track) return { ok: false, reason: 'no_such_track' };
      const removed = track.subscriptions.delete(BigInt(requestId).toString());
      if (removed) event('unsubscribe', { requestId: BigInt(requestId).toString(), track: track.key });
      return { ok: removed };
    },

    // Drain (shift) all pending deliveries queued for one downstream
    // subscription. The loopback pair uses this to move relay fan-out
    // onto the subscriber's socket; the relay itself never touches
    // sockets, and the queue is the relay's only delivery surface.
    drainDeliveries({ namespace, trackName, requestId }) {
      const track = getTrack(namespace, trackName);
      if (!track) return { ok: false, reason: 'no_such_track', deliveries: [] };
      const sub = track.subscriptions.get(BigInt(requestId).toString());
      if (!sub) return { ok: false, reason: 'no_such_subscription', deliveries: [] };
      const deliveries = sub.pendingDeliveries.splice(0, sub.pendingDeliveries.length);
      return { ok: true, deliveries };
    },

    // §7.2: the relay MUST hold the upstream unpaused while ANY
    // downstream subscription is unpaused.
    upstreamPaused({ namespace, trackName }) {
      const track = getTrack(namespace, trackName);
      if (!track) return false;
      for (const sub of track.subscriptions.values()) {
        if (sub.state === 'established' && !sub.paused) return false;
      }
      return track.subscriptions.size > 0;
    },

    setPaused({ namespace, trackName, requestId, paused }) {
      const track = getTrack(namespace, trackName);
      if (!track) return { ok: false, reason: 'no_such_track' };
      const sub = track.subscriptions.get(BigInt(requestId).toString());
      if (!sub) return { ok: false, reason: 'no_such_subscription' };
      sub.paused = Boolean(paused);
      event('subscription_paused', { requestId: BigInt(requestId).toString(), paused: sub.paused });
      return { ok: true, upstreamPaused: api.upstreamPaused({ namespace, trackName }) };
    },

    publishObject(object) {
      if (!isPlainObject(object)) fail('INVALID_FIELD', 'relay object must be an object');
      const track = getTrack(object.namespace, object.trackName);
      if (!track) {
        return { ok: false, reason: 'no_such_track', detail: `no track ${renderFullTrackName(object.namespace, object.trackName)} is registered` };
      }
      if (track.malformed) {
        return { ok: false, malformed: true, reason: track.malformed.reason, detail: 'track is already malformed' };
      }
      if (track.ended) {
        return { ok: false, malformed: true, reason: 'object_after_end_of_track', detail: 'track already ended' };
      }
      const admitted = track.sequencer.admitObject(object, { allowGap: object.deliveryMode === 'datagram' });
      if (!admitted.ok) {
        track.malformed = { reason: admitted.reason, detail: admitted.detail };
        event('malformed_track', { track: track.key, reason: admitted.reason, detail: admitted.detail });
        // §12.1: downstream subscriptions are terminated with
        // PUBLISH_DONE MALFORMED_TRACK and fetch streams are reset;
        // the triggering object is NOT cached.
        for (const sub of track.subscriptions.values()) {
          if (sub.state === 'established') {
            sub.state = 'terminated';
            sub.pendingDeliveries.push({ kind: 'publish_done', statusCode: BigInt(MOQ_PUBLISH_DONE_CODES.MALFORMED_TRACK), reason: admitted.reason });
          }
        }
        return { ok: false, malformed: true, reason: admitted.reason, detail: admitted.detail };
      }
      if (!admitted.deduped) {
        const cached = cachePut(track, object);
        if (!cached.ok) {
          track.malformed = { reason: cached.reason, detail: cached.detail };
          event('malformed_track', { track: track.key, reason: cached.reason, detail: cached.detail });
          for (const sub of track.subscriptions.values()) {
            if (sub.state === 'established') {
              sub.state = 'terminated';
              sub.pendingDeliveries.push({ kind: 'publish_done', statusCode: BigInt(MOQ_PUBLISH_DONE_CODES.MALFORMED_TRACK), reason: cached.reason });
            }
          }
          return { ok: false, malformed: true, reason: cached.reason, detail: cached.detail };
        }
        track.largestObject = track.sequencer.getLargestObject();
      }
      const deliveredTo = [];
      for (const sub of track.subscriptions.values()) {
        if (sub.state !== 'established') continue;
        sub.largestObjectSeen = track.largestObject;
        if (!subscriptionPassesFilters(sub, object)) continue;
        sub.pendingDeliveries.push({ kind: 'object', object: { ...object } });
        deliveredTo.push(sub.requestId);
      }
      event('object_published', { track: track.key, groupId: object.groupId.toString(), objectId: object.objectId.toString(), deliveredTo: deliveredTo.length });
      return { ok: true, admitted, deliveredTo, cached: !admitted.deduped };
    },

    // §11.3.2: which subgroup stream carries this object downstream.
    // Returns {streamId, newStream, resetStreamId}: the existing
    // stream when the object is the next one, else a fresh stream
    // (and the old stream to reset).
    streamForObject({ namespace, trackName, requestId, groupId, subgroupId, objectId }) {
      const track = getTrack(namespace, trackName);
      if (!track) fail('INVALID_FIELD', 'no such track for streamForObject');
      const sub = track.subscriptions.get(BigInt(requestId).toString());
      if (!sub) fail('INVALID_FIELD', `no subscription ${requestId} for streamForObject`);
      const key = `${groupId.toString()}:${subgroupId.toString()}`;
      const existing = sub.subgroupStreams.get(key);
      const objectIdValue = checkU64(objectId, 'object ID');
      if (existing && existing.lastObjectId !== null && objectIdValue === existing.lastObjectId + 1n) {
        existing.lastObjectId = objectIdValue;
        return { streamId: existing.streamId, newStream: false, resetStreamId: null };
      }
      const streamId = relay.nextStreamId;
      relay.nextStreamId += 1;
      const resetStreamId = existing ? existing.streamId : null;
      sub.subgroupStreams.set(key, { streamId, lastObjectId: objectIdValue, groupId, subgroupId });
      return { streamId, newStream: true, resetStreamId };
    },

    getCachedObject({ namespace, trackName, groupId, objectId }) {
      const track = getTrack(namespace, trackName);
      if (!track) return null;
      return track.cache.get(cacheObjectKey(checkU64(groupId, 'group ID'), checkU64(objectId, 'object ID'))) ?? null;
    },

    // FETCH (§3.2) served from the cache. Objects are returned in
    // group order; gaps are reported with their kind: objects within
    // [start, largest] that were evicted are 'gone', objects within
    // range never seen are 'unknown', objects beyond the largest
    // object are 'non-existent' when the track has ended and
    // 'unknown' otherwise.
    fetch({ namespace, trackName, start, end = null, groupOrder = MOQ_GROUP_ORDER.ASCENDING }) {
      const track = getTrack(namespace, trackName);
      if (!track) {
        return { ok: false, requestErrorCode: BigInt(MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST), requestErrorReason: 'no such track' };
      }
      const startLocation = { group: checkU64(start.group, 'fetch start group'), object: checkU64(start.object, 'fetch start object') };
      const endLocation = end ? { group: checkU64(end.group, 'fetch end group'), object: checkU64(end.object, 'fetch end object') } : null;
      const objects = [];
      const gaps = [];
      const largest = track.largestObject;
      // Walk the requested range object by object. The cache is
      // bounded, so the walk is capped at 10,000 objects per fetch.
      let current = { ...startLocation };
      let steps = 0;
      while (steps < 10000) {
        if (endLocation && compareLocation(current, endLocation) > 0) break;
        if (largest && compareLocation(current, largest) > 0) {
          gaps.push({ from: { ...current }, to: endLocation ?? { ...current }, kind: track.ended ? 'non-existent' : 'unknown' });
          break;
        }
        const cached = track.cache.get(cacheObjectKey(current.group, current.object));
        if (cached) {
          objects.push(cached);
        } else {
          const evicted = track.evictedRanges.some((range) => range.groupId === current.group && range.objectId === current.object);
          const gapStart = { ...current };
          // Coalesce consecutive missing objects into one gap.
          let gapEnd = { ...current };
          while (steps < 10000) {
            const next = nextLocation(current);
            if (endLocation && compareLocation(next, endLocation) > 0) break;
            if (largest && compareLocation(next, largest) > 0) break;
            if (track.cache.get(cacheObjectKey(next.group, next.object))) break;
            const nextEvicted = track.evictedRanges.some((range) => range.groupId === next.group && range.objectId === next.object);
            if (nextEvicted !== evicted) break;
            current = next;
            gapEnd = { ...current };
            steps += 1;
          }
          gaps.push({ from: gapStart, to: gapEnd, kind: evicted ? 'gone' : 'unknown' });
        }
        current = nextLocation(current);
        steps += 1;
        if (largest && compareLocation(current, largest) > 0 && !endLocation) break;
        if (!largest) break;
      }
      if (groupOrder === MOQ_GROUP_ORDER.DESCENDING) objects.reverse();
      return { ok: true, objects, gaps, largestObject: largest, trackEnded: track.ended };
    },

    endTrack({ namespace, trackName, statusCode = MOQ_PUBLISH_DONE_CODES.TRACK_ENDED, reason = '' }) {
      const track = getTrack(namespace, trackName);
      if (!track) return { ok: false, reason: 'no_such_track' };
      track.ended = true;
      track.endStatusCode = BigInt(statusCode);
      for (const sub of track.subscriptions.values()) {
        if (sub.state === 'established') {
          sub.state = 'terminated';
          sub.pendingDeliveries.push({ kind: 'publish_done', statusCode: BigInt(statusCode), reason });
        }
      }
      event('track_ended', { track: track.key, statusCode: BigInt(statusCode).toString() });
      return { ok: true };
    },

    checkRendezvous(nowMs = Date.now()) {
      const expired = [];
      for (const track of relay.tracks.values()) {
        for (const sub of track.subscriptions.values()) {
          if (sub.state === 'rendezvous' && sub.rendezvousExpiresAtMs !== null && nowMs >= sub.rendezvousExpiresAtMs) {
            sub.state = 'terminated';
            expired.push({ requestId: sub.requestId, trackKey: track.key });
            event('rendezvous_timeout', { requestId: sub.requestId.toString(), track: track.key });
          }
        }
      }
      return expired;
    },

    getTrack,
    listTracks() {
      return [...relay.tracks.values()].map((track) => ({
        namespace: track.namespace,
        trackName: track.trackName,
        publishers: track.publishers.size,
        subscriptions: track.subscriptions.size,
        cachedObjects: track.cache.size,
        largestObject: track.largestObject,
        ended: track.ended,
        malformed: track.malformed,
      }));
    },
  };

  return api;
}

function nextLocation(location) {
  const object = checkU64(location.object, 'object ID') + 1n;
  if (object > 0xffffffffffffffffn) {
    return { group: checkU64(location.group, 'group ID') + 1n, object: 0n };
  }
  return { group: checkU64(location.group, 'group ID'), object };
}

// ---------------------------------------------------------------------------
// Multicast (draft-ramadan-moq-multicast-02 §4.1)
// ---------------------------------------------------------------------------

// IPv6 parsing (needed for group-address range checks). Handles ::
// compression and hex groups; embedded IPv4 tails (::ffff:1.2.3.4)
// are parsed as their 4 trailing bytes.
export function parseIpv6(address) {
  if (typeof address !== 'string' || address.length === 0) {
    fail('INVALID_FIELD', 'IPv6 address must be a non-empty string');
  }
  let head = address;
  let tail = null;
  const doubleColon = address.indexOf('::');
  if (doubleColon !== -1) {
    if (address.indexOf('::', doubleColon + 2) !== -1) {
      fail('INVALID_FIELD', `IPv6 address '${address}' has more than one '::'`);
    }
    head = address.slice(0, doubleColon);
    tail = address.slice(doubleColon + 2);
  }
  const parseGroups = (part) => {
    if (part === '') return [];
    return part.split(':').map((group) => {
      if (group.includes('.')) {
        // Embedded IPv4 tail: expands to two 16-bit groups.
        const v4 = parseIpv4(group);
        return [((v4[0] << 8) | v4[1]), ((v4[2] << 8) | v4[3])];
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
        fail('INVALID_FIELD', `IPv6 address '${address}' has an invalid group '${group}'`);
      }
      return [parseInt(group, 16)];
    }).flat();
  };
  const headGroups = parseGroups(head);
  const tailGroups = tail === null ? [] : parseGroups(tail);
  if (doubleColon === -1) {
    if (headGroups.length !== 8) {
      fail('INVALID_FIELD', `IPv6 address '${address}' must have 8 groups`);
    }
    return Buffer.from(headGroups.flatMap((value) => [(value >> 8) & 0xff, value & 0xff]));
  }
  const total = headGroups.length + tailGroups.length;
  if (total > 7) {
    fail('INVALID_FIELD', `IPv6 address '${address}' has too many groups for '::' compression`);
  }
  const groups = [...headGroups];
  while (groups.length < 8 - tailGroups.length) groups.push(0);
  groups.push(...tailGroups);
  return Buffer.from(groups.flatMap((value) => [(value >> 8) & 0xff, value & 0xff]));
}

function ipFamily(address) {
  try {
    parseIpv4(address);
    return 'ipv4';
  } catch {
    // Not IPv4; try IPv6.
  }
  try {
    parseIpv6(address);
    return 'ipv6';
  } catch {
    return null;
  }
}

function isSsmGroup(address, family) {
  if (family === 'ipv4') {
    const bytes = parseIpv4(address);
    return bytes[0] === 232;
  }
  const bytes = parseIpv6(address);
  return bytes[0] === 0xff && (bytes[1] & 0xf0) === 0x30;
}

function isAsmGroup(address, family) {
  if (family === 'ipv4') {
    const bytes = parseIpv4(address);
    return bytes[0] >= 224 && bytes[0] <= 239 && bytes[0] !== 232;
  }
  const bytes = parseIpv6(address);
  if (bytes[0] !== 0xff) return false;
  return !((bytes[1] & 0xf0) === 0x30);
}

function isMulticastGroup(address, family) {
  if (family === 'ipv4') {
    const bytes = parseIpv4(address);
    return bytes[0] >= 224 && bytes[0] <= 239;
  }
  const bytes = parseIpv6(address);
  return bytes[0] === 0xff;
}

// Validate one multicast endpoint (ramadan §4.1). Returns
// {ok, reasons, warnings, normalized} — normalized is null when not ok.
export function validateMulticastEndpoint(endpoint, opts = {}) {
  const reasons = [];
  const warnings = [];
  if (!isPlainObject(endpoint)) {
    return { ok: false, reasons: ['endpoint must be an object'], warnings, normalized: null };
  }
  const namespace = opts.namespace ?? null;
  const catalogTracks = opts.catalogTracks ?? null;
  let catalogValidated = false;
  if (typeof endpoint.groupAddress !== 'string' || endpoint.groupAddress.length === 0) {
    reasons.push('groupAddress is required');
  }
  const family = typeof endpoint.groupAddress === 'string' ? ipFamily(endpoint.groupAddress) : null;
  if (endpoint.groupAddress && !family) {
    reasons.push(`groupAddress '${endpoint.groupAddress}' is not a valid IP address`);
  }
  let protocol = endpoint.protocol ?? null;
  if (protocol !== null && protocol !== 'ssm' && protocol !== 'asm') {
    reasons.push(`protocol must be 'ssm' or 'asm', got '${protocol}'`);
  }
  if (protocol === null) {
    protocol = endpoint.sourceAddress ? 'ssm' : 'asm';
  }
  if (protocol === 'ssm' && !endpoint.sourceAddress) {
    reasons.push('SSM endpoint requires sourceAddress');
  }
  if (protocol === 'asm' && endpoint.sourceAddress) {
    reasons.push('ASM endpoint must not carry sourceAddress (S is absent on unprotected ASM; auth.senderAddress on protected ASM)');
  }
  if (endpoint.sourceAddress) {
    const sourceFamily = ipFamily(endpoint.sourceAddress);
    if (!sourceFamily) {
      reasons.push(`sourceAddress '${endpoint.sourceAddress}' is not a valid IP address`);
    } else if (family && sourceFamily !== family) {
      reasons.push(`sourceAddress family (${sourceFamily}) does not match groupAddress family (${family})`);
    }
  }
  if (family) {
    if (protocol === 'ssm' && !isSsmGroup(endpoint.groupAddress, family)) {
      reasons.push(`SSM groupAddress '${endpoint.groupAddress}' is outside the SSM range (${family === 'ipv4' ? MULTICAST_SSM_IPV4_PREFIX : 'ff3x::/32'})`);
    }
    if (protocol === 'asm' && !isAsmGroup(endpoint.groupAddress, family)) {
      reasons.push(`ASM groupAddress '${endpoint.groupAddress}' is outside the ASM range`);
    }
    if (!isMulticastGroup(endpoint.groupAddress, family)) {
      reasons.push(`groupAddress '${endpoint.groupAddress}' is not a multicast address`);
    }
  }
  if (!Number.isSafeInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
    reasons.push('port is required and must be an integer in 1..65535');
  }
  if (!Array.isArray(endpoint.tracks) || endpoint.tracks.length === 0) {
    reasons.push('tracks is required and must be a non-empty array');
  }
  const normalizedTracks = [];
  const seenPacketIds = new Set();
  if (Array.isArray(endpoint.tracks)) {
    for (let i = 0; i < endpoint.tracks.length; i++) {
      const track = endpoint.tracks[i];
      if (!isPlainObject(track)) {
        reasons.push(`tracks[${i}] must be an object`);
        continue;
      }
      if (typeof track.name !== 'string' || track.name.length === 0) {
        reasons.push(`tracks[${i}].name is required`);
        continue;
      }
      if (!Number.isSafeInteger(track.packetId) || track.packetId < 1 || track.packetId > 65535) {
        reasons.push(`tracks[${i}].packetId must be an integer in 1..65535 (packet_id 0 is reserved for signaling)`);
        continue;
      }
      if (seenPacketIds.has(track.packetId)) {
        reasons.push(`tracks[${i}].packetId ${track.packetId} is duplicated within the endpoint`);
        continue;
      }
      seenPacketIds.add(track.packetId);
      let packaging = track.packaging ?? null;
      if (catalogTracks) {
        const catalogEntry = catalogTracks instanceof Map
          ? catalogTracks.get(track.name)
          : catalogTracks[track.name];
        if (!catalogEntry) {
          reasons.push(`track '${track.name}' is not in the catalog`);
          continue;
        }
        if (namespace && catalogEntry.namespace && !namespaceEquals(namespace, catalogEntry.namespace)) {
          reasons.push(`track '${track.name}' declares another namespace in the catalog`);
          continue;
        }
        packaging = catalogEntry.packaging ?? packaging;
        if (packaging !== 'mmtp' && packaging !== 'fec-repair') {
          reasons.push(`track '${track.name}' packaging must be 'mmtp' or 'fec-repair', got '${packaging}'`);
          continue;
        }
        catalogValidated = true;
      } else {
        warnings.push('track catalog checks skipped: no catalog supplied');
      }
      normalizedTracks.push({ name: Buffer.from(track.name, 'utf8'), nameText: track.name, packetId: track.packetId, packaging });
    }
  }
  const isProtected = endpoint.auth !== undefined && endpoint.auth !== null;
  if (isProtected && (endpoint.bandwidth === undefined || endpoint.bandwidth === null)) {
    reasons.push('protected endpoint requires bandwidth (§7.2.6: a receiver ignores a protected endpoint without it)');
  }
  if (endpoint.bandwidth !== undefined && endpoint.bandwidth !== null) {
    if (typeof endpoint.bandwidth !== 'number' || !(endpoint.bandwidth > 0)) {
      reasons.push('bandwidth must be a positive number when present');
    }
  }
  if (opts.catalogAuth !== undefined && opts.catalogAuth !== null && !isProtected) {
    reasons.push('auth is required: the catalog multicast object carries an auth member');
  }
  if (isProtected) {
    if (!isPlainObject(endpoint.auth)) {
      reasons.push('auth must be an object when present');
    } else if (endpoint.auth.senderAddress !== undefined && endpoint.auth.senderAddress !== null) {
      const authFamily = ipFamily(endpoint.auth.senderAddress);
      if (!authFamily) {
        reasons.push(`auth.senderAddress '${endpoint.auth.senderAddress}' is not a valid IP address`);
      } else if (family && authFamily !== family) {
        reasons.push(`auth.senderAddress family (${authFamily}) does not match groupAddress family (${family})`);
      }
    }
    if (protocol === 'asm' && (!endpoint.auth || !endpoint.auth.senderAddress)) {
      reasons.push('protected ASM endpoint requires auth.senderAddress (S = auth.senderAddress on protected ASM)');
    }
  }
  if (endpoint.networkSource !== undefined && endpoint.networkSource !== null) {
    if (!isPlainObject(endpoint.networkSource)) {
      reasons.push('networkSource must be an object when present');
    } else if (endpoint.networkSource.type === 'amt') {
      if (typeof endpoint.networkSource.relay !== 'string' || endpoint.networkSource.relay.length === 0) {
        reasons.push('AMT networkSource requires relay (hostname)');
      }
      if (endpoint.networkSource.discovery !== undefined
        && !['dns', 'driad', 'manual'].includes(endpoint.networkSource.discovery)) {
        reasons.push(`AMT discovery must be 'dns', 'driad' or 'manual', got '${endpoint.networkSource.discovery}'`);
      }
      if (endpoint.networkSource.port !== undefined
        && (!Number.isSafeInteger(endpoint.networkSource.port) || endpoint.networkSource.port < 1 || endpoint.networkSource.port > 65535)) {
        reasons.push('AMT networkSource port must be an integer in 1..65535');
      }
    } else if (endpoint.networkSource.type === 'atsc3') {
      if (typeof endpoint.networkSource.frequency !== 'number' || !(endpoint.networkSource.frequency > 0)) {
        reasons.push('ATSC3 networkSource requires frequency (kHz)');
      }
    } else {
      reasons.push(`networkSource type must be 'amt' or 'atsc3', got '${endpoint.networkSource.type}'`);
    }
  }
  if (reasons.length > 0) {
    return { ok: false, reasons, warnings, normalized: null };
  }
  // S (the source for the join): sourceAddress on SSM,
  // auth.senderAddress on protected ASM, absent on unprotected ASM.
  const sourceForJoin = protocol === 'ssm'
    ? endpoint.sourceAddress
    : (isProtected ? endpoint.auth.senderAddress : null);
  const normalized = {
    protocol,
    family,
    groupAddress: endpoint.groupAddress,
    port: endpoint.port,
    sourceAddress: endpoint.sourceAddress ?? null,
    sourceForJoin,
    tracks: normalizedTracks,
    bandwidth: endpoint.bandwidth ?? null,
    auth: endpoint.auth ?? null,
    networkSource: endpoint.networkSource ?? null,
    catalogValidated,
    tupleKey: `${sourceForJoin ?? ''}|${endpoint.groupAddress}|${endpoint.port}`,
  };
  return { ok: true, reasons, warnings, normalized };
}

// Validate a set of endpoints: each (S,G,port) tuple MUST be
// associated with at most one MoQ namespace and at most one endpoint
// object (§4.1).
export function validateMulticastEndpointSet(endpoints, opts = {}) {
  if (!Array.isArray(endpoints)) {
    return { ok: false, reasons: ['endpoints must be an array'], results: [] };
  }
  const results = [];
  const seenTuples = new Map();
  const reasons = [];
  for (let i = 0; i < endpoints.length; i++) {
    const result = validateMulticastEndpoint(endpoints[i], opts);
    if (result.ok) {
      const tupleKey = result.normalized.tupleKey;
      const namespaceKeyText = opts.namespace ? namespaceKey(opts.namespace) : '';
      const previous = seenTuples.get(tupleKey);
      if (previous) {
        if (previous.namespaceKey !== namespaceKeyText) {
          result.ok = false;
          result.reasons.push(`(S,G,port) tuple ${tupleKey} is already associated with another namespace`);
        } else {
          result.ok = false;
          result.reasons.push(`(S,G,port) tuple ${tupleKey} is already used by another endpoint object`);
        }
      } else {
        seenTuples.set(tupleKey, { namespaceKey: namespaceKeyText });
      }
    }
    if (!result.ok) reasons.push(...result.reasons.map((reason) => `endpoints[${i}]: ${reason}`));
    results.push(result);
  }
  return { ok: reasons.length === 0, reasons, results };
}

// Per-packet_id MMTP sequence tracking (§7.1: receivers MAY track the
// MMTP Packet Sequence Number per packet_id per tuple). Sequence
// numbers are u32, +1 modulo 2^32.
export function createMmtpSequenceTracker() {
  const perPacketId = new Map();
  const api = {
    note(packetId, packetSequenceNumber) {
      const id = checkU32(packetId, 'packet ID');
      const seq = checkU32(packetSequenceNumber, 'packet sequence number');
      let entry = perPacketId.get(id);
      if (!entry) {
        entry = { lastSeq: null, seen: new Set(), gaps: [], duplicates: 0, received: 0 };
        perPacketId.set(id, entry);
      }
      entry.received += 1;
      if (entry.seen.has(seq)) {
        entry.duplicates += 1;
        return { ok: true, duplicate: true, gap: null };
      }
      let gap = null;
      if (entry.lastSeq !== null) {
        const expected = (entry.lastSeq + 1) >>> 0;
        if (seq !== expected) {
          gap = { from: expected, to: seq };
          entry.gaps.push(gap);
        }
      }
      entry.seen.add(seq);
      if (entry.seen.size > 4096) {
        // Bounded memory: drop the oldest tracked sequences.
        const oldest = entry.seen.values().next().value;
        entry.seen.delete(oldest);
      }
      entry.lastSeq = seq;
      return { ok: true, duplicate: false, gap };
    },

    get(packetId) {
      return perPacketId.get(checkU32(packetId, 'packet ID')) ?? null;
    },

    list() {
      return [...perPacketId.entries()].map(([packetId, entry]) => ({
        packetId, lastSeq: entry.lastSeq, received: entry.received,
        duplicates: entry.duplicates, gaps: entry.gaps,
      }));
    },
  };
  return api;
}

// Multicast join lifecycle (ramadan §4.1).
// States: idle → joining → joined → leaving → left | failed, with
// fallback_unicast entered by hysteresis (sustained loss / no data
// after join) and left by a stable period.
// Join takes 1–3 s for IGMP/MLD at the network level; the socket API
// reports membership immediately, so the join latency is recorded as
// not-observable-from-the-socket-API rather than invented.
export function createMulticastJoin({ endpoint, validation = null, socketFactory = null, onPacket = null, onSignaling = null, opts = {} } = {}) {
  const checked = validation ?? validateMulticastEndpoint(endpoint, opts);
  if (!checked.ok) {
    fail('INVALID_FIELD', `multicast endpoint is invalid: ${checked.reasons.join('; ')}`);
  }
  const normalized = checked.normalized;
  if (normalized.networkSource && (normalized.networkSource.type === 'amt' || normalized.networkSource.type === 'atsc3')) {
    fail('INVALID_FIELD', `networkSource '${normalized.networkSource.type}' is not supported by this transport (AMT relay / ATSC 3.0 broadcast carriage are out of scope; native SSM/ASM over UDP only)`);
  }
  const noDataTimeoutMs = opts.noDataTimeoutMs === undefined ? 3000 : opts.noDataTimeoutMs;
  const lossThreshold = opts.lossThreshold === undefined ? 3 : opts.lossThreshold;
  const sustainedLossMs = opts.sustainedLossMs === undefined ? 5000 : opts.sustainedLossMs;
  const stablePeriodMs = opts.stablePeriodMs === undefined ? 10000 : opts.stablePeriodMs;
  const trackByPacketId = new Map(normalized.tracks.map((track) => [track.packetId, track]));
  const tracker = createMmtpSequenceTracker();
  const join = {
    endpoint: normalized,
    state: 'idle',
    socket: null,
    joinedAtMs: null,
    leftAtMs: null,
    failure: null,
    received: 0,
    delivered: 0,
    discarded: 0,
    duplicates: 0,
    signaling: 0,
    consecutiveFailures: 0,
    lastLossAtMs: null,
    stableSinceMs: null,
    igmpJoinLatencyMs: { min: MULTICAST_JOIN_LATENCY_MS.MIN, max: MULTICAST_JOIN_LATENCY_MS.MAX, observed: 'not observable from the socket API' },
  };

  function makeSocket() {
    const factory = socketFactory ?? ((type) => dgram.createSocket(type));
    const socketType = normalized.family === 'ipv6' ? 'udp6' : 'udp4';
    return factory(socketType);
  }

  const api = {
    join,
    tracker,

    async joinSocket() {
      if (join.state !== 'idle' && join.state !== 'left' && join.state !== 'failed' && join.state !== 'fallback_unicast') {
        fail('INVALID_FIELD', `multicast join cannot start from state '${join.state}'`);
      }
      join.state = 'joining';
      const socket = makeSocket();
      join.socket = socket;
      socket.on('message', (msg, rinfo) => {
        api.handleUdpDatagram(msg, rinfo);
      });
      socket.on('error', (error) => {
        join.failure = { reason: 'socket_error', detail: error.message };
        if (join.state === 'joined' || join.state === 'joining') join.state = 'failed';
      });
      const bindAddress = normalized.family === 'ipv6' ? '::' : '0.0.0.0';
      await new Promise((resolve, reject) => {
        socket.bind(normalized.port, bindAddress, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      try {
        if (normalized.protocol === 'ssm') {
          socket.addSourceSpecificMembership(normalized.sourceForJoin, normalized.groupAddress);
        } else {
          socket.addMembership(normalized.groupAddress);
        }
      } catch (error) {
        join.state = 'failed';
        join.failure = { reason: 'membership_failed', detail: error.message };
        try { socket.close(); } catch { /* already closed */ }
        throw new MoqError('INVALID_FIELD', `multicast membership failed: ${error.message}`);
      }
      join.state = 'joined';
      join.joinedAtMs = Date.now();
      join.stableSinceMs = join.joinedAtMs;
      return { ok: true, state: 'joined', groupAddress: normalized.groupAddress, port: normalized.port, protocol: normalized.protocol };
    },

    async leaveSocket() {
      if (!join.socket) {
        join.state = 'left';
        join.leftAtMs = Date.now();
        return { ok: true, state: 'left' };
      }
      join.state = 'leaving';
      const socket = join.socket;
      try {
        if (normalized.protocol === 'ssm') {
          socket.dropSourceSpecificMembership(normalized.sourceForJoin, normalized.groupAddress);
        } else {
          socket.dropMembership(normalized.groupAddress);
        }
      } catch {
        // Dropping a membership that is already gone is not fatal.
      }
      await new Promise((resolve) => {
        try {
          socket.close(() => resolve());
        } catch {
          resolve();
        }
      });
      join.socket = null;
      join.state = 'left';
      join.leftAtMs = Date.now();
      return { ok: true, state: 'left' };
    },

    handleUdpDatagram(msg, rinfo = {}) {
      join.received += 1;
      let packet;
      try {
        packet = parseMmtpPacket(msg);
      } catch (error) {
        join.discarded += 1;
        return { ok: false, action: 'discarded', reason: error.code ?? 'malformed_mmtp_packet', detail: error.message };
      }
      if (packet.packetId === MMTP_SIGNALING_PACKET_ID) {
        join.signaling += 1;
        let signaling = null;
        try {
          signaling = parseMmtpSignalingHeader(packet.payload);
        } catch (error) {
          join.discarded += 1;
          return { ok: false, action: 'discarded', reason: 'malformed_signaling_header', detail: error.message };
        }
        if (typeof onSignaling === 'function') {
          try { onSignaling({ packet, signaling, rinfo }); } catch { /* subscriber callback errors do not fail the join */ }
        }
        return { ok: true, action: 'signaling', packet, signaling };
      }
      const track = trackByPacketId.get(packet.packetId);
      if (!track) {
        // §5 (moq-mmt): a receiver discards every unlisted packet_id.
        join.discarded += 1;
        return { ok: false, action: 'discarded', reason: 'unlisted_packet_id', packetId: packet.packetId };
      }
      const noted = tracker.note(packet.packetId, packet.packetSequenceNumber);
      if (noted.duplicate) {
        join.duplicates += 1;
        return { ok: true, action: 'duplicate', packet, gap: null };
      }
      join.delivered += 1;
      join.stableSinceMs = Date.now();
      join.consecutiveFailures = 0;
      const delivered = { packet, track, rinfo, gap: noted.gap };
      if (typeof onPacket === 'function') {
        try { onPacket(delivered); } catch { /* subscriber callback errors do not fail the join */ }
      }
      return { ok: true, action: 'delivered', ...delivered };
    },

    // §4.1: subscribers SHOULD detect absence of multicast data after
    // join and fall back to unicast.
    noteNoData(nowMs = Date.now()) {
      if (join.state !== 'joined') return { fallbackRecommended: false, reason: `join is in state '${join.state}'` };
      if (join.delivered > 0 || join.signaling > 0) return { fallbackRecommended: false, reason: 'multicast data has been received' };
      if (join.joinedAtMs === null) return { fallbackRecommended: false, reason: 'join has not completed' };
      if (nowMs - join.joinedAtMs > noDataTimeoutMs) {
        return { fallbackRecommended: true, reason: `no multicast data ${nowMs - join.joinedAtMs} ms after join (timeout ${noDataTimeoutMs} ms)` };
      }
      return { fallbackRecommended: false, reason: `no data yet, ${nowMs - join.joinedAtMs} ms since join (timeout ${noDataTimeoutMs} ms)` };
    },

    // §4.1 hysteresis: switch away after sustained loss / consecutive
    // FEC block failures; switch back only after a stable period.
    recordLoss({ consecutiveFailures = 1, nowMs = Date.now() } = {}) {
      join.consecutiveFailures += consecutiveFailures;
      join.lastLossAtMs = nowMs;
      join.stableSinceMs = null;
      return { consecutiveFailures: join.consecutiveFailures };
    },

    shouldFallbackToUnicast(nowMs = Date.now()) {
      if (join.state !== 'joined') return { fallback: false, reason: `join is in state '${join.state}'` };
      if (join.consecutiveFailures >= lossThreshold) {
        return { fallback: true, reason: `${join.consecutiveFailures} consecutive failures (threshold ${lossThreshold})` };
      }
      if (join.lastLossAtMs !== null && nowMs - join.lastLossAtMs >= sustainedLossMs && join.consecutiveFailures > 0) {
        return { fallback: true, reason: `sustained loss for ${nowMs - join.lastLossAtMs} ms (threshold ${sustainedLossMs} ms)` };
      }
      return { fallback: false, reason: 'loss below the fallback thresholds' };
    },

    shouldSwitchBackToMulticast(nowMs = Date.now()) {
      if (join.state !== 'fallback_unicast') return { switchBack: false, reason: `join is in state '${join.state}'` };
      if (join.stableSinceMs === null) return { switchBack: false, reason: 'no stable period recorded' };
      if (nowMs - join.stableSinceMs >= stablePeriodMs && join.consecutiveFailures === 0) {
        return { switchBack: true, reason: `stable for ${nowMs - join.stableSinceMs} ms (period ${stablePeriodMs} ms)` };
      }
      return { switchBack: false, reason: `stable for ${join.stableSinceMs === null ? 0 : nowMs - join.stableSinceMs} ms (period ${stablePeriodMs} ms)` };
    },

    enterFallbackUnicast(reason = '') {
      join.state = 'fallback_unicast';
      return { ok: true, state: 'fallback_unicast', reason };
    },

    getState() {
      return {
        state: join.state,
        endpoint: {
          protocol: normalized.protocol,
          groupAddress: normalized.groupAddress,
          port: normalized.port,
          sourceForJoin: normalized.sourceForJoin,
        },
        joinedAtMs: join.joinedAtMs,
        leftAtMs: join.leftAtMs,
        failure: join.failure,
        received: join.received,
        delivered: join.delivered,
        discarded: join.discarded,
        duplicates: join.duplicates,
        signaling: join.signaling,
        consecutiveFailures: join.consecutiveFailures,
        sequences: tracker.list(),
      };
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// Catalog (MSF catalog track, `multicast` member)
// The catalog track is named `catalog` and is fetched over the
// established MoQ session by SUBSCRIBE (ramadan §4.1: subscribers
// MUST establish a MoQ session first to receive the catalog). There
// is deliberately NO out-of-band fetch: a hostile catalog is an
// attack vector (§7.3), so catalogs arrive by provisioning or over
// the session, never by fetching a URL.
// The MSF catalog JSON shape (draft-ietf-moq-msf) is not pinned here:
// the `multicast` member and its endpoints are parsed strictly, and
// `tracks` entries are read defensively (name/trackName, packaging,
// namespace); the rest of the catalog is treated opaquely.
// ---------------------------------------------------------------------------

export function parseMulticastCatalog(catalog, opts = {}) {
  if (!isPlainObject(catalog)) {
    return { ok: false, reasons: ['catalog must be an object'], endpoints: [], validEndpoints: [], catalogTracks: null, bcCatalog: null };
  }
  const reasons = [];
  const multicast = catalog.multicast ?? null;
  if (!isPlainObject(multicast)) {
    return { ok: false, reasons: ['catalog has no multicast member'], endpoints: [], validEndpoints: [], catalogTracks: null, bcCatalog: null };
  }
  if (!Array.isArray(multicast.endpoints) || multicast.endpoints.length === 0) {
    return { ok: false, reasons: ['catalog multicast member has no endpoints array'], endpoints: [], validEndpoints: [], catalogTracks: null, bcCatalog: null };
  }
  // Catalog tracks, for the endpoint track checks (§4.1: each track
  // is resolved in the catalog track's namespace and MUST be
  // packaging mmtp or fec-repair).
  let catalogTracks = null;
  if (Array.isArray(catalog.tracks)) {
    catalogTracks = new Map();
    for (const entry of catalog.tracks) {
      if (!isPlainObject(entry)) continue;
      const name = entry.name ?? entry.trackName;
      if (typeof name !== 'string') continue;
      let namespace = null;
      if (Array.isArray(entry.namespace)) {
        namespace = entry.namespace.map((field) => Buffer.from(String(field), 'utf8'));
      } else if (typeof entry.namespace === 'string') {
        namespace = [Buffer.from(entry.namespace, 'utf8')];
      }
      catalogTracks.set(name, { packaging: entry.packaging ?? null, namespace });
    }
  }
  const setResult = validateMulticastEndpointSet(multicast.endpoints, {
    namespace: opts.namespace ?? null,
    catalogTracks,
    catalogAuth: multicast.auth ?? null,
  });
  const endpoints = setResult.results.map((result, index) => ({ endpoint: multicast.endpoints[index], validation: result }));
  const validEndpoints = endpoints.filter((entry) => entry.validation.ok).map((entry) => entry.validation.normalized);
  if (validEndpoints.length === 0) {
    reasons.push(...setResult.reasons);
  }
  // bc-provenance catalog member (§7.2.6), validated with the bc
  // module when present.
  let bcCatalog = null;
  const bcMember = catalog['bc-provenance'] ?? null;
  if (bcMember !== undefined && bcMember !== null) {
    const checked = validateBcCatalog(bcMember);
    bcCatalog = { ok: checked.ok, reasons: checked.reasons ?? [], normalized: checked.ok ? checked.normalized : null };
    if (!checked.ok) reasons.push(`bc-provenance catalog member is invalid: ${checked.reasons.join('; ')}`);
  }
  return {
    ok: validEndpoints.length > 0 && reasons.length === 0,
    reasons,
    endpoints,
    validEndpoints,
    catalogTracks,
    bcCatalog,
    multicast,
  };
}

// Reassemble a catalog track's objects into bytes: objects are sorted
// by (group, object) and their payloads concatenated.
export function reassembleCatalogObjects(objects) {
  if (!Array.isArray(objects)) fail('INVALID_FIELD', 'catalog objects must be an array');
  const sorted = [...objects].sort((a, b) => compareLocation(
    { group: a.groupId ?? 0, object: a.objectId ?? 0 },
    { group: b.groupId ?? 0, object: b.objectId ?? 0 },
  ));
  return Buffer.concat(sorted.map((object) => toBuffer(object.payload, 'catalog object payload')));
}

// Fetch the catalog over an established MoQ session. `subscribe` is an
// async function supplied by the caller (the TCP loopback pair
// supplies it) that performs the SUBSCRIBE to the `catalog` track and
// returns the reassembled track bytes. No URL fetch exists.
export async function fetchCatalogOverSession({ subscribe, namespace = null, trackName = MOQ_CATALOG_TRACK_NAME, timeoutMs = 5000 } = {}) {
  if (typeof subscribe !== 'function') {
    fail('INVALID_FIELD', 'fetchCatalogOverSession requires a subscribe function (catalogs are fetched over the MoQ session, never by URL)');
  }
  const bytes = await subscribe({ namespace, trackName, timeoutMs });
  let parsed;
  try {
    parsed = JSON.parse(toBuffer(bytes, 'catalog bytes').toString('utf8'));
  } catch (error) {
    return { ok: false, reasons: [`catalog track bytes are not valid JSON: ${error.message}`], endpoints: [], validEndpoints: [], catalogTracks: null, bcCatalog: null };
  }
  return parseMulticastCatalog(parsed, { namespace });
}

// ---------------------------------------------------------------------------
// bc-provenance admission on the multicast leg
// A manifest record is verified FIRST (verifyBcRecord) and only then
// are datagrams admitted — per-packet digest comparison against the
// verified manifest, or whole-batch admission via receiveBcBatch. A
// failed verification refuses the datagram(s) and records the reason;
// nothing is admitted. Unprotected endpoints admit without provenance
// and say so (provenance: 'none').
//
// WHICH DIGEST: the manifest's digests are batchDigest values (the
// JCS record's digest — the bc module delegates mint/admission to the
// batch layer, and receiveBcBatch recomputes with batchDigest). The
// admission therefore recomputes batchDigest(flow, data) with the
// endpoint flow {source: S, group: G, port, streamId}. The draft's
// §7.2.2 wire digest (bcDatagramDigest, raw IPv4 octets in the
// pseudoheader) is NOT interchangeable with batchDigest (bc module
// comment, §7.2.2 section) — it is computed alongside as
// `wireDigest` for cross-checking against a peer that uses the §7.2.2
// form, and it is IPv4-only, so on an IPv6 endpoint wireDigest is
// refused with 'bc_provenance_ipv6_unsupported' while admission
// itself still proceeds on the batchDigest comparison (batchDigest
// binds UTF-8 source/group strings and works for IPv6).
// ---------------------------------------------------------------------------

export function createMulticastAdmission({ endpoint, catalog = null, receiverState = null, budget = null, context = null, nowUnixSeconds = null } = {}) {
  if (!isPlainObject(endpoint)) fail('INVALID_FIELD', 'admission endpoint must be an object');
  const normalized = endpoint.normalized ?? endpoint;
  const isProtected = normalized.auth !== undefined && normalized.auth !== null;
  const state = {
    endpoint: normalized,
    catalog: catalog ?? null,
    receiverState: receiverState ?? createBcReceiverState(),
    budget: budget ?? createVerificationBudget({}),
    context,
    nowUnixSeconds: nowUnixSeconds ?? Math.floor(Date.now() / 1000),
    verifiedManifest: null,
    verifiedAtMs: null,
    refusals: [],
  };

  function bcTiming() {
    const endpointTiming = state.catalog?.endpoint ?? null;
    return {
      maxAuthDelayMs: endpointTiming?.maxAuthDelayMs,
      manifestTimerMs: endpointTiming?.manifestTimerMs,
    };
  }

  function digestSource() {
    // S: sourceAddress on SSM, auth.senderAddress on protected ASM.
    return normalized.sourceForJoin ?? normalized.sourceAddress ?? null;
  }

  const api = {
    admission: state,

    verifyManifestRecord(manifestRecord) {
      const timing = bcTiming();
      const result = verifyBcRecord(manifestRecord, {
        catalog: state.catalog ?? undefined,
        receiverState: state.receiverState,
        budget: state.budget,
        context: state.context ?? undefined,
        nowUnixSeconds: state.nowUnixSeconds,
        ...(timing.maxAuthDelayMs !== undefined ? { maxAuthDelayMs: timing.maxAuthDelayMs } : {}),
        ...(timing.manifestTimerMs !== undefined ? { manifestTimerMs: timing.manifestTimerMs } : {}),
      });
      if (result.ok) {
        state.verifiedManifest = result.manifest;
        state.verifiedAtMs = Date.now();
      } else {
        state.refusals.push({ kind: 'manifest', outcome: result.outcome, reasons: result.reasons });
      }
      return result;
    },

    // The §7.2.2 wire digest for this endpoint (IPv4 only; the
    // pseudoheader carries raw IPv4 octets). Informational: it is NOT
    // the admission digest (see the section comment above).
    wireDigestForDatagram(packetBytes) {
      const data = toBuffer(packetBytes, 'datagram bytes');
      if (normalized.family !== 'ipv4') {
        return { ok: false, reason: 'bc_provenance_ipv6_unsupported', detail: 'the §7.2.2 wire digest is defined over an IPv4 pseudoheader' };
      }
      const source = digestSource();
      if (!source) {
        return { ok: false, reason: 'missing_source', detail: 'no source address (S) is known for this endpoint' };
      }
      const effectiveStreamId = state.catalog?.endpoint?.streamId;
      if (effectiveStreamId === undefined || effectiveStreamId === null) {
        return { ok: false, reason: 'missing_stream_id', detail: 'the bc catalog endpoint has no streamId' };
      }
      try {
        const digest = bcDatagramDigest({
          source,
          group: normalized.groupAddress,
          port: normalized.port,
          streamId: effectiveStreamId,
          data,
        });
        return { ok: true, wireDigest: digest };
      } catch (error) {
        return { ok: false, reason: 'digest_error', detail: error.message };
      }
    },

    // Admit one MMTP datagram against the verified manifest. `seq` is
    // the datagram's sequence within the manifest (first_seq + index);
    // when omitted it defaults to packetSequenceNumber. The digest
    // compared is batchDigest — the digest the manifest binds.
    admitSingleDatagram({ packetBytes, seq = null, packetSequenceNumber = null, streamId = null, manifest = null } = {}) {
      const data = toBuffer(packetBytes, 'datagram bytes');
      if (!isProtected || !state.catalog) {
        return { ok: true, admitted: true, provenance: 'none', reason: 'endpoint is unprotected (no bc-provenance catalog); admitted without provenance' };
      }
      const activeManifest = manifest ?? state.verifiedManifest;
      if (!activeManifest) {
        const refusal = { ok: false, admitted: false, provenance: 'refused', reason: 'no_verified_manifest', detail: 'no bc manifest record has been verified for this endpoint' };
        state.refusals.push({ kind: 'datagram', ...refusal });
        return refusal;
      }
      if (manifest) {
        const verified = api.verifyManifestRecord(manifest);
        if (!verified.ok) {
          return { ok: false, admitted: false, provenance: 'refused', reason: verified.outcome, detail: verified.reasons.join('; ') };
        }
      }
      const verifiedManifest = state.verifiedManifest;
      const sequence = seq !== null ? seq : packetSequenceNumber;
      if (sequence === null || sequence === undefined) {
        const refusal = { ok: false, admitted: false, provenance: 'refused', reason: 'missing_sequence', detail: 'no seq or packetSequenceNumber was supplied' };
        state.refusals.push({ kind: 'datagram', ...refusal });
        return refusal;
      }
      const index = Number(BigInt(sequence) - BigInt(verifiedManifest.first_seq));
      if (index < 0 || index >= verifiedManifest.digests.length) {
        const refusal = { ok: false, admitted: false, provenance: 'refused', reason: 'sequence_out_of_manifest_range', detail: `seq ${sequence} is outside the manifest range ${verifiedManifest.first_seq}..${verifiedManifest.first_seq + verifiedManifest.count - 1}` };
        state.refusals.push({ kind: 'datagram', ...refusal });
        return refusal;
      }
      const source = digestSource();
      if (!source) {
        const refusal = { ok: false, admitted: false, provenance: 'refused', reason: 'missing_source', detail: 'no source address (S) is known for this endpoint' };
        state.refusals.push({ kind: 'datagram', ...refusal });
        return refusal;
      }
      const effectiveStreamId = streamId ?? state.catalog?.endpoint?.streamId;
      if (effectiveStreamId === undefined || effectiveStreamId === null) {
        const refusal = { ok: false, admitted: false, provenance: 'refused', reason: 'missing_stream_id', detail: 'the bc catalog endpoint has no streamId' };
        state.refusals.push({ kind: 'datagram', ...refusal });
        return refusal;
      }
      // The manifest binds batchDigest(flow, data) with the endpoint
      // flow; the §7.2.2 wire digest is computed alongside for
      // cross-checking (IPv4 only) and is reported, not compared.
      let computed;
      try {
        computed = batchDigest({ source, group: normalized.groupAddress, port: normalized.port, streamId: effectiveStreamId }, data);
      } catch (error) {
        const refusal = { ok: false, admitted: false, provenance: 'refused', reason: 'digest_error', detail: error.message };
        state.refusals.push({ kind: 'datagram', ...refusal });
        return refusal;
      }
      const wire = api.wireDigestForDatagram(data);
      if (computed !== verifiedManifest.digests[index]) {
        const refusal = { ok: false, admitted: false, provenance: 'refused', reason: 'digest_mismatch', detail: `datagram digest at manifest index ${index} does not match`, wireDigest: wire.ok ? wire.wireDigest : null };
        state.refusals.push({ kind: 'datagram', ...refusal });
        return refusal;
      }
      return { ok: true, admitted: true, provenance: 'bc-provenance', manifestIndex: index, digest: computed, wireDigest: wire.ok ? wire.wireDigest : null };
    },

    // Whole-batch admission via receiveBcBatch (items: {seq, data}).
    admitBatch({ manifest, items } = {}) {
      const timing = bcTiming();
      const result = receiveBcBatch(manifest, items, {
        catalog: state.catalog ?? undefined,
        receiverState: state.receiverState,
        budget: state.budget,
        context: state.context ?? undefined,
        nowUnixSeconds: state.nowUnixSeconds,
        ...(timing.maxAuthDelayMs !== undefined ? { maxAuthDelayMs: timing.maxAuthDelayMs } : {}),
        ...(timing.manifestTimerMs !== undefined ? { manifestTimerMs: timing.manifestTimerMs } : {}),
      });
      if (!result.ok) {
        state.refusals.push({ kind: 'batch', outcome: result.outcome, reasons: result.reasons });
      } else {
        state.verifiedManifest = result.manifest ?? state.verifiedManifest;
      }
      return result;
    },

    getVerifiedManifest() {
      return state.verifiedManifest;
    },

    getRefusals() {
      return state.refusals;
    },
  };

  return api;
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

// QUIC availability probe. This Node build (26.13.1) does NOT expose
// node:quic and has no global WebTransport (verified live in the prior
// session and re-probed here); the MoQ session therefore runs over the
// TCP loopback transport below. The transport interface is designed so
// a QUIC transport can be added later without changing the session,
// relay or sequencer: a QUIC transport only has to move CONTROL frames
// (one request stream per request) and DATAGRAM / subgroup-stream
// bytes between two sessions.
export async function detectQuicSupport() {
  const evidence = { nodeQuic: false, nodeQuicError: null, nodeQuicExports: [], webTransport: false };
  try {
    const quic = await import('node:quic');
    evidence.nodeQuic = true;
    evidence.nodeQuicExports = Object.keys(quic ?? {});
  } catch (error) {
    evidence.nodeQuicError = { code: error?.code ?? null, message: error?.message ?? String(error) };
  }
  evidence.webTransport = typeof globalThis.WebTransport !== 'undefined';
  return {
    nodeQuic: evidence.nodeQuic,
    webTransport: evidence.webTransport,
    quicAvailable: evidence.nodeQuic || evidence.webTransport,
    evidence,
  };
}

// A QUIC transport refuses until a Node build exposes node:quic (or
// WebTransport) with the expected entry points. This is a deliberate
// refusal, not a fallback: there is no QUIC implementation here to
// substitute, and a fake one would be presented as a live result.
export async function createQuicTransport() {
  const probe = await detectQuicSupport();
  if (!probe.quicAvailable) {
    fail('INVALID_FIELD', `quic_unavailable: node:quic is not exposed by this Node build (${probe.evidence.nodeQuicError?.code ?? 'no error code'}: ${probe.evidence.nodeQuicError?.message ?? 'unknown'}) and WebTransport is ${probe.evidence.webTransport ? 'present' : 'absent'}; use the TCP loopback transport`);
  }
  if (probe.nodeQuic && !probe.evidence.nodeQuicExports.includes('QuicSocket')) {
    fail('INVALID_FIELD', `quic_api_unexpected: node:quic is present but does not export QuicSocket (exports: ${probe.evidence.nodeQuicExports.join(', ') || 'none'}); a QUIC transport cannot be built against this shape`);
  }
  fail('INVALID_FIELD', 'quic transport is not implemented against this Node build: node:quic is present but the QuicSocket API shape has not been verified here; use the TCP loopback transport');
}

// NCPS-internal TCP framing for the loopback transport. The draft
// does NOT define a TCP carriage for MoQ (§6.2), so this framing is
// NCPS-internal and is labelled as such everywhere: [kind u8][length
// u32 BE][payload]. CONTROL carries one encoded control message;
// DATAGRAM carries one encoded OBJECT_DATAGRAM; SUBGROUP_DATA carries
// [streamId varint][subgroup-stream bytes]; SUBGROUP_FIN /
// SUBGROUP_RESET end / reset a subgroup stream by streamId.
export const MOQ_TCP_FRAME_KINDS = Object.freeze({
  CONTROL: 0x01,
  DATAGRAM: 0x02,
  SUBGROUP_DATA: 0x03,
  SUBGROUP_FIN: 0x04,
  SUBGROUP_RESET: 0x05,
});
export const MOQ_TCP_MAX_FRAME_BYTES = 16 * 1024 * 1024;

export function createTcpFrameSocket(socket) {
  if (!socket || typeof socket.write !== 'function' || typeof socket.on !== 'function') {
    fail('INVALID_FIELD', 'TCP frame socket requires a net.Socket');
  }
  let buffer = Buffer.alloc(0);
  let closed = false;
  const frameHandlers = new Set();
  const errorHandlers = new Set();
  const closeHandlers = new Set();

  function emitError(error) {
    for (const handler of errorHandlers) {
      try { handler(error); } catch { /* error handlers must not throw */ }
    }
  }

  function emitFrame(frame) {
    for (const handler of frameHandlers) {
      try { handler(frame); } catch { /* frame handlers must not throw */ }
    }
  }

  function pump() {
    while (buffer.length >= 5) {
      const kind = buffer[0];
      const length = buffer.readUInt32BE(1);
      if (length > MOQ_TCP_MAX_FRAME_BYTES) {
        const error = new MoqError('FIELD_LENGTH_EXCEEDED', `TCP frame length ${length} exceeds the ${MOQ_TCP_MAX_FRAME_BYTES}-byte limit`);
        emitError(error);
        try { socket.destroy(error); } catch { /* already destroyed */ }
        return;
      }
      if (buffer.length < 5 + length) return;
      const payload = buffer.subarray(5, 5 + length);
      buffer = buffer.subarray(5 + length);
      if (!Object.values(MOQ_TCP_FRAME_KINDS).includes(kind)) {
        const error = new MoqError('UNEXPECTED_MESSAGE', `unknown TCP frame kind 0x${kind.toString(16)}`);
        emitError(error);
        try { socket.destroy(error); } catch { /* already destroyed */ }
        return;
      }
      emitFrame({ kind, payload: Buffer.from(payload) });
    }
  }

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    pump();
  });
  socket.on('error', (error) => emitError(error));
  socket.on('close', () => {
    closed = true;
    for (const handler of closeHandlers) {
      try { handler(); } catch { /* close handlers must not throw */ }
    }
  });

  const api = {
    socket,
    isOpen() { return !closed && !socket.destroyed; },
    onFrame(handler) {
      frameHandlers.add(handler);
      return () => frameHandlers.delete(handler);
    },
    onError(handler) {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    sendFrame(kind, payload) {
      if (closed || socket.destroyed) fail('INVALID_FIELD', 'cannot send on a closed TCP frame socket');
      const bytes = toBuffer(payload, 'frame payload');
      const header = Buffer.alloc(5);
      header[0] = kind;
      header.writeUInt32BE(bytes.length, 1);
      socket.write(Buffer.concat([header, bytes]));
    },
    sendControl(bytes) { api.sendFrame(MOQ_TCP_FRAME_KINDS.CONTROL, bytes); },
    sendDatagram(bytes) { api.sendFrame(MOQ_TCP_FRAME_KINDS.DATAGRAM, bytes); },
    sendSubgroupData(streamId, chunkBytes) {
      const payload = Buffer.concat([encodeVarint(checkU64(streamId, 'subgroup stream ID')), toBuffer(chunkBytes, 'subgroup chunk')]);
      api.sendFrame(MOQ_TCP_FRAME_KINDS.SUBGROUP_DATA, payload);
    },
    sendSubgroupFin(streamId) {
      api.sendFrame(MOQ_TCP_FRAME_KINDS.SUBGROUP_FIN, encodeVarint(checkU64(streamId, 'subgroup stream ID')));
    },
    sendSubgroupReset(streamId, resetCode) {
      const payload = Buffer.concat([
        encodeVarint(checkU64(streamId, 'subgroup stream ID')),
        encodeVarint(checkU64(resetCode, 'subgroup reset code')),
      ]);
      api.sendFrame(MOQ_TCP_FRAME_KINDS.SUBGROUP_RESET, payload);
    },
    close() {
      closed = true;
      try { socket.destroy(); } catch { /* already destroyed */ }
    },
  };
  return api;
}

// UDP loopback probe: the honest environment check. Returns whether a
// UDP datagram sent on 127.0.0.1 actually arrives here. In this VM it
// does NOT (unicast UDP loopback timed out in two Node variants;
// Python3 cannot even create a UDP socket: PermissionError Errno 1).
export async function probeUdpLoopback({ timeoutMs = 2000 } = {}) {
  const receiver = dgram.createSocket('udp4');
  const sender = dgram.createSocket('udp4');
  try {
    const port = await new Promise((resolve, reject) => {
      receiver.once('error', reject);
      receiver.bind(0, '127.0.0.1', () => resolve(receiver.address().port));
    });
    const payload = Buffer.from('moq-udp-loopback-probe');
    const received = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      receiver.once('message', (msg) => {
        clearTimeout(timer);
        resolve(msg.equals(payload));
      });
    });
    const startedAt = Date.now();
    await new Promise((resolve, reject) => {
      sender.send(payload, port, '127.0.0.1', (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const arrived = await received;
    return { ok: arrived, sent: true, received: arrived, elapsedMs: Date.now() - startedAt, error: arrived ? null : 'UDP loopback datagram did not arrive within the timeout' };
  } catch (error) {
    return { ok: false, sent: false, received: false, elapsedMs: null, error: error.message };
  } finally {
    try { receiver.close(); } catch { /* already closed */ }
    try { sender.close(); } catch { /* already closed */ }
  }
}

// ---------------------------------------------------------------------------
// Loopback session pair: publisher → relay → subscriber over real TCP
// loopback sockets. Both SETUP handshakes, SUBSCRIBE / SUBSCRIBE_OK /
// REQUEST_ERROR, PUBLISH and object datagrams all travel as real TCP
// frames between real session objects; the relay fans objects out to
// the subscriber; the subscriber admits them through its sequencer.
// This is the live end-to-end path exercised by the tests. The pair
// is a test/demo harness, not a production relay: it drives
// subscribe/publish serially and correlates SUBSCRIBE_OK /
// REQUEST_ERROR by the single outstanding subscriber request.
// ---------------------------------------------------------------------------

export async function createLoopbackSessionPair({ namespace = ['numina', 'test'], onSubscriberObject = null, onRelayEvent = null } = {}) {
  const relay = createMoqRelay({});
  const publisherSession = createMoqSession({ role: 'client' });
  const subscriberSession = createMoqSession({ role: 'client' });
  const relaySessionPublisher = createMoqSession({ role: 'server' });
  const relaySessionSubscriber = createMoqSession({ role: 'server' });
  const pair = {
    relay,
    publisherSession,
    subscriberSession,
    relaySessionPublisher,
    relaySessionSubscriber,
    namespace,
    server: null,
    port: null,
    publisherLink: null,
    subscriberLink: null,
    events: [],
    subscriberObjects: [],
    pendingSubscribeRequestId: null,
    establishedSubscribeRequestId: null,
    publisherAliases: new Map(), // publisher track alias -> {namespace, trackName}
    publisherAliasesByTrack: new Map(), // track key -> publisher track alias
    subscriberAliases: new Map(), // downstream track alias -> {namespace, trackName, requestId, alias}
    subscriberSequencers: new Map(), // track key -> sequencer
    started: false,
    closed: false,
  };

  function event(type, detail = {}) {
    const entry = { type, atMs: Date.now(), ...detail };
    pair.events.push(entry);
    if (typeof onRelayEvent === 'function') {
      try { onRelayEvent(entry); } catch { /* event callbacks must not throw */ }
    }
    return entry;
  }

  function trackKeyText(ns, trackName) {
    return fullTrackNameKey(ns, trackName);
  }

  function sequencerFor(ns, trackName) {
    const key = trackKeyText(ns, trackName);
    let sequencer = pair.subscriberSequencers.get(key);
    if (!sequencer) {
      sequencer = createTrackSequencer({ namespace: ns, trackName });
      pair.subscriberSequencers.set(key, sequencer);
    }
    return sequencer;
  }

  function sendToSubscriberDatagram({ namespace: ns, trackName, requestId, object }) {
    const aliasEntry = [...pair.subscriberAliases.values()].find((entry) => entry.requestId === BigInt(requestId));
    if (!aliasEntry) return { ok: false, reason: 'no_downstream_alias' };
    const bytes = encodeObjectDatagram({
      trackAlias: aliasEntry.alias,
      groupId: object.groupId,
      objectId: object.objectId,
      payload: object.payload,
      properties: object.properties ?? [],
      objectStatus: object.objectStatus ?? null,
      publisherPriority: object.publisherPriority ?? null,
      endOfGroup: object.endOfGroup ?? false,
    });
    pair.subscriberLink.serverFrameSocket.sendDatagram(bytes);
    return { ok: true };
  }

  function drainSubscriptionDeliveries({ namespace: ns, trackName, requestId }) {
    const drained = pair.relay.drainDeliveries({ namespace: ns, trackName, requestId });
    if (!drained.ok) return { drained: 0 };
    let count = 0;
    for (const delivery of drained.deliveries) {
      if (delivery.kind === 'object') {
        const sent = sendToSubscriberDatagram({ namespace: ns, trackName, requestId, object: delivery.object });
        if (sent.ok) count += 1;
      } else if (delivery.kind === 'publish_done') {
        const doneBytes = pair.relaySessionSubscriber.createPublishDone({
          requestId,
          statusCode: delivery.statusCode,
          reason: delivery.reason ?? '',
        });
        pair.subscriberLink.serverFrameSocket.sendControl(doneBytes);
        count += 1;
      }
    }
    return { drained: count };
  }

  function deliverCachedObjects({ namespace: ns, trackName, requestId }) {
    // A new subscription receives the relay's cached objects for the
    // track (the relay's fetch walk, from the first cached object).
    const fetched = pair.relay.fetch({ namespace: ns, trackName, start: { group: 0n, object: 0n } });
    if (!fetched.ok) return { ok: false, reason: fetched.requestErrorReason, delivered: 0 };
    let delivered = 0;
    for (const object of fetched.objects) {
      const sent = sendToSubscriberDatagram({ namespace: ns, trackName, requestId, object });
      if (sent.ok) delivered += 1;
    }
    return { ok: true, delivered, gaps: fetched.gaps };
  }

  function handlePublisherControl(bytes) {
    const decoded = decodeControlMessage(bytes, { maxControlMessageSize: MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE });
    if (decoded.typeName === 'SETUP') {
      try {
        pair.relaySessionPublisher.receiveSetup(bytes);
      } catch (error) {
        event('setup_refused', { side: 'publisher', reason: error.message });
        return;
      }
      const setupBytes = pair.relaySessionPublisher.createSetup({});
      pair.publisherLink.serverFrameSocket.sendControl(setupBytes);
      return;
    }
    if (decoded.typeName === 'PUBLISH') {
      const received = pair.relaySessionPublisher.receivePublish(bytes);
      if (!received.ok) {
        const errorBytes = pair.relaySessionPublisher.createRequestError({
          requestId: received.requestId, errorCode: received.requestErrorCode, reason: received.requestErrorReason,
        });
        pair.publisherLink.serverFrameSocket.sendControl(errorBytes);
        return;
      }
      const registered = pair.relay.registerPublisher({ namespace: received.namespace, trackName: received.trackName, requestId: received.requestId, parameters: received.parameters });
      if (!registered.ok) {
        const errorBytes = pair.relaySessionPublisher.createRequestError({
          requestId: received.requestId, errorCode: MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST, reason: registered.reason ?? 'publisher registration failed',
        });
        pair.publisherLink.serverFrameSocket.sendControl(errorBytes);
        return;
      }
      // The publisher's datagrams carry the track alias its PUBLISH
      // allocated; the pair maps that alias to this track.
      pair.publisherAliases.set(BigInt(received.trackAlias), { namespace: received.namespace, trackName: received.trackName });
      pair.publisherAliasesByTrack.set(trackKeyText(received.namespace, received.trackName), BigInt(received.trackAlias));
      event('publish_registered', { track: trackKeyText(received.namespace, received.trackName), requestId: received.requestId.toString() });
      return;
    }
    if (decoded.typeName === 'GOAWAY') {
      try {
        pair.relaySessionPublisher.receiveGoaway(bytes);
      } catch (error) {
        event('goaway_refused', { side: 'publisher', reason: error.message });
        return;
      }
      event('goaway_received', { side: 'publisher' });
      return;
    }
    event('unexpected_control', { side: 'publisher', type: decoded.typeName });
  }

  function handlePublisherDatagram(bytes) {
    const decoded = decodeObjectDatagram(bytes);
    const alias = pair.publisherAliases.get(BigInt(decoded.trackAlias));
    if (!alias) {
      event('datagram_refused', { side: 'publisher', reason: `unknown publisher track alias ${decoded.trackAlias}` });
      return;
    }
    const admitted = pair.relay.publishObject({
      namespace: alias.namespace,
      trackName: alias.trackName,
      groupId: decoded.groupId,
      subgroupId: 0n,
      objectId: decoded.objectId,
      payload: decoded.payload,
      properties: decoded.properties ?? [],
      objectStatus: decoded.objectStatus ?? null,
      publisherPriority: decoded.publisherPriority ?? null,
      endOfGroup: decoded.endOfGroup ?? false,
      deliveryMode: 'datagram',
    });
    if (!admitted.ok) {
      event('object_refused', { side: 'publisher', reason: admitted.reason, detail: admitted.detail });
      return;
    }
    for (const requestId of admitted.deliveredTo) {
      drainSubscriptionDeliveries({ namespace: alias.namespace, trackName: alias.trackName, requestId });
    }
  }

  function handleSubscriberControl(bytes) {
    const decoded = decodeControlMessage(bytes, { maxControlMessageSize: MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE });
    if (decoded.typeName === 'SETUP') {
      try {
        pair.relaySessionSubscriber.receiveSetup(bytes);
      } catch (error) {
        event('setup_refused', { side: 'subscriber', reason: error.message });
        return;
      }
      const setupBytes = pair.relaySessionSubscriber.createSetup({});
      pair.subscriberLink.serverFrameSocket.sendControl(setupBytes);
      return;
    }
    if (decoded.typeName === 'SUBSCRIBE') {
      const received = pair.relaySessionSubscriber.receiveSubscribe(bytes);
      if (!received.ok) {
        const errorBytes = pair.relaySessionSubscriber.createRequestError({
          requestId: received.requestId, errorCode: received.requestErrorCode, reason: received.requestErrorReason,
        });
        pair.subscriberLink.serverFrameSocket.sendControl(errorBytes);
        return;
      }
      const subscribed = pair.relay.subscribe({
        namespace: received.namespace, trackName: received.trackName,
        requestId: received.requestId, parameters: received.parameters,
      });
      if (!subscribed.ok) {
        const errorBytes = pair.relaySessionSubscriber.createRequestError({
          requestId: received.requestId, errorCode: subscribed.requestErrorCode, reason: subscribed.requestErrorReason,
        });
        pair.subscriberLink.serverFrameSocket.sendControl(errorBytes);
        return;
      }
      const ok = pair.relaySessionSubscriber.createSubscribeOk({
        requestId: received.requestId, trackAlias: subscribed.trackAlias,
      });
      pair.subscriberAliases.set(BigInt(subscribed.trackAlias), {
        namespace: received.namespace, trackName: received.trackName,
        requestId: BigInt(received.requestId), alias: BigInt(subscribed.trackAlias),
      });
      pair.subscriberLink.serverFrameSocket.sendControl(ok.bytes);
      // Cached objects flow to the new subscription.
      deliverCachedObjects({ namespace: received.namespace, trackName: received.trackName, requestId: received.requestId });
      return;
    }
    if (decoded.typeName === 'REQUEST_UPDATE') {
      // The pair drives subscribe serially; a REQUEST_UPDATE belongs
      // to the established subscription. The pair acks it (the relay
      // has no update-driven state change wired here).
      const requestId = pair.establishedSubscribeRequestId ?? pair.pendingSubscribeRequestId;
      if (requestId === null) {
        event('request_update_ignored', { reason: 'no outstanding subscriber request' });
        return;
      }
      try {
        pair.relaySessionSubscriber.receiveRequestUpdate(requestId, bytes);
      } catch (error) {
        event('request_update_refused', { reason: error.message });
        return;
      }
      const response = pair.relaySessionSubscriber.respondToRequestUpdate(requestId, { ok: true });
      pair.subscriberLink.serverFrameSocket.sendControl(response.bytes);
      return;
    }
    if (decoded.typeName === 'GOAWAY') {
      try {
        pair.relaySessionSubscriber.receiveGoaway(bytes);
      } catch (error) {
        event('goaway_refused', { side: 'subscriber', reason: error.message });
        return;
      }
      event('goaway_received', { side: 'subscriber' });
      return;
    }
    event('unexpected_control', { side: 'subscriber', type: decoded.typeName });
  }

  function handleSubscriberDatagram(bytes) {
    const decoded = decodeObjectDatagram(bytes);
    const alias = pair.subscriberAliases.get(BigInt(decoded.trackAlias));
    if (!alias) {
      event('datagram_refused', { side: 'subscriber', reason: `unknown downstream track alias ${decoded.trackAlias}` });
      return;
    }
    const sequencer = sequencerFor(alias.namespace, alias.trackName);
    const admitted = sequencer.admitObject({
      groupId: decoded.groupId,
      subgroupId: 0n,
      objectId: decoded.objectId,
      payload: decoded.payload,
      properties: decoded.properties ?? [],
      objectStatus: decoded.objectStatus ?? null,
      publisherPriority: decoded.publisherPriority ?? null,
      endOfGroup: decoded.endOfGroup ?? false,
      deliveryMode: 'datagram',
    });
    if (!admitted.ok) {
      event('subscriber_object_refused', { reason: admitted.reason, detail: admitted.detail });
      return;
    }
    if (admitted.deduped) return;
    const object = {
      namespace: alias.namespace, trackName: alias.trackName,
      groupId: decoded.groupId, objectId: decoded.objectId,
      payload: decoded.payload, properties: decoded.properties ?? [],
      objectStatus: decoded.objectStatus ?? null,
      endOfGroup: decoded.endOfGroup ?? false,
    };
    pair.subscriberObjects.push(object);
    if (typeof onSubscriberObject === 'function') {
      try { onSubscriberObject(object); } catch { /* subscriber callbacks must not throw */ }
    }
  }

  function handleSubscriberLinkControl(bytes) {
    const decoded = decodeControlMessage(bytes, { maxControlMessageSize: MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE });
    if (decoded.typeName === 'SETUP') {
      pair.subscriberSession.receiveSetup(bytes);
      return;
    }
    if (decoded.typeName === 'SUBSCRIBE_OK') {
      const requestId = pair.pendingSubscribeRequestId;
      if (requestId === null) {
        event('subscribe_ok_ignored', { reason: 'no outstanding subscriber request' });
        return;
      }
      pair.subscriberSession.receiveSubscribeOk(requestId, bytes);
      pair.pendingSubscribeRequestId = null;
      pair.establishedSubscribeRequestId = requestId;
      return;
    }
    if (decoded.typeName === 'REQUEST_ERROR') {
      const requestId = pair.pendingSubscribeRequestId;
      if (requestId === null) {
        event('request_error_ignored', { reason: 'no outstanding subscriber request' });
        return;
      }
      const error = pair.subscriberSession.receiveRequestError(requestId, bytes);
      pair.pendingSubscribeRequestId = null;
      event('request_error', { requestId: requestId.toString(), errorCode: error.errorCode.toString(), reason: error.reason });
      return;
    }
    if (decoded.typeName === 'PUBLISH_DONE') {
      const requestId = pair.establishedSubscribeRequestId;
      if (requestId === null) {
        event('publish_done_ignored', { reason: 'no established subscriber subscription' });
        return;
      }
      try {
        pair.subscriberSession.receivePublishDone(requestId, bytes);
      } catch (error) {
        event('publish_done_refused', { reason: error.message });
        return;
      }
      event('publish_done_received', { requestId: requestId.toString() });
      return;
    }
    event('unexpected_control', { side: 'subscriber-client', type: decoded.typeName });
  }

  function handlePublisherLinkControl(bytes) {
    const decoded = decodeControlMessage(bytes, { maxControlMessageSize: MOQ_DEFAULT_MAX_CONTROL_MESSAGE_SIZE });
    if (decoded.typeName === 'SETUP') {
      pair.publisherSession.receiveSetup(bytes);
      return;
    }
    if (decoded.typeName === 'REQUEST_ERROR') {
      event('request_error', { side: 'publisher', type: decoded.typeName });
      return;
    }
    event('unexpected_control', { side: 'publisher-client', type: decoded.typeName });
  }

  const api = {
    pair,

    async start() {
      if (pair.started) fail('INVALID_FIELD', 'loopback session pair is already started');
      pair.started = true;
      const server = net.createServer();
      pair.server = server;
      const accepted = [];
      server.on('connection', (socket) => {
        accepted.push(socket);
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
      });
      pair.port = server.address().port;

      const waitForAccept = () => new Promise((resolve) => {
        const check = () => {
          if (accepted.length > 0) resolve(accepted.shift());
          else setTimeout(check, 1);
        };
        check();
      });

      // Publisher link (first connection).
      const publisherSocket = net.connect(pair.port, '127.0.0.1');
      const publisherServerSocket = await waitForAccept();
      pair.publisherLink = {
        clientSocket: publisherSocket,
        serverSocket: publisherServerSocket,
        frameSocket: createTcpFrameSocket(publisherSocket),
        serverFrameSocket: createTcpFrameSocket(publisherServerSocket),
      };
      pair.publisherLink.serverFrameSocket.onFrame((frame) => {
        if (frame.kind === MOQ_TCP_FRAME_KINDS.CONTROL) handlePublisherControl(frame.payload);
        else if (frame.kind === MOQ_TCP_FRAME_KINDS.DATAGRAM) handlePublisherDatagram(frame.payload);
      });

      // Subscriber link (second connection).
      const subscriberSocket = net.connect(pair.port, '127.0.0.1');
      const subscriberServerSocket = await waitForAccept();
      pair.subscriberLink = {
        clientSocket: subscriberSocket,
        serverSocket: subscriberServerSocket,
        frameSocket: createTcpFrameSocket(subscriberSocket),
        serverFrameSocket: createTcpFrameSocket(subscriberServerSocket),
      };
      pair.subscriberLink.serverFrameSocket.onFrame((frame) => {
        if (frame.kind === MOQ_TCP_FRAME_KINDS.CONTROL) handleSubscriberControl(frame.payload);
        else if (frame.kind === MOQ_TCP_FRAME_KINDS.DATAGRAM) event('unexpected_datagram', { side: 'subscriber-server' });
      });
      pair.subscriberLink.frameSocket.onFrame((frame) => {
        if (frame.kind === MOQ_TCP_FRAME_KINDS.CONTROL) handleSubscriberLinkControl(frame.payload);
        else if (frame.kind === MOQ_TCP_FRAME_KINDS.DATAGRAM) handleSubscriberDatagram(frame.payload);
      });
      pair.publisherLink.frameSocket.onFrame((frame) => {
        if (frame.kind === MOQ_TCP_FRAME_KINDS.CONTROL) handlePublisherLinkControl(frame.payload);
      });

      // SETUP handshakes, both links, over the real sockets.
      // createSetup returns the encoded bytes directly.
      const publisherSetupBytes = pair.publisherSession.createSetup({});
      pair.publisherLink.frameSocket.sendControl(publisherSetupBytes);
      const subscriberSetupBytes = pair.subscriberSession.createSetup({});
      pair.subscriberLink.frameSocket.sendControl(subscriberSetupBytes);
      // The handshakes complete asynchronously; wait until both
      // sessions report established.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (pair.publisherSession.isEstablished() && pair.subscriberSession.isEstablished()) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      if (!pair.publisherSession.isEstablished() || !pair.subscriberSession.isEstablished()) {
        fail('INVALID_FIELD', 'loopback session pair SETUP handshake did not complete within 5 s');
      }
      return { ok: true, port: pair.port };
    },

    async publish({ namespace: ns, trackName, parameters = [] } = {}) {
      const created = pair.publisherSession.createPublish({ namespace: ns, trackName, parameters });
      pair.publisherLink.frameSocket.sendControl(created.bytes);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        // Track names arrive as Buffers from the decoded PUBLISH, so
        // compare by bytes, not by strict equality with the caller's
        // string.
        const track = pair.relay.listTracks().find((entry) => namespaceEquals(entry.namespace, ns) && bytesEqual(toBuffer(entry.trackName, 'track name'), toBuffer(trackName, 'track name')));
        if (track) return { ok: true, requestId: created.requestId, trackAlias: created.trackAlias };
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { ok: false, reason: 'publish registration did not land within 2 s', requestId: created.requestId };
    },

    async subscribe({ namespace: ns, trackName, parameters = [] } = {}) {
      const created = pair.subscriberSession.createSubscribe({ namespace: ns, trackName, parameters });
      pair.pendingSubscribeRequestId = created.requestId;
      pair.subscriberLink.frameSocket.sendControl(created.bytes);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (pair.pendingSubscribeRequestId === null) {
          const alias = [...pair.subscriberAliases.values()].find((entry) => entry.requestId === created.requestId);
          if (alias) return { ok: true, requestId: created.requestId, trackAlias: alias.alias };
          const errorEvent = pair.events.find((entry) => entry.type === 'request_error' && entry.requestId === created.requestId.toString());
          if (errorEvent) return { ok: false, reason: errorEvent.reason, errorCode: errorEvent.errorCode, requestId: created.requestId };
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { ok: false, reason: 'subscribe response did not arrive within 2 s', requestId: created.requestId };
    },

    async publishObject(object) {
      const alias = pair.publisherAliasesByTrack.get(trackKeyText(object.namespace, object.trackName));
      if (alias === undefined) {
        return { ok: false, reason: 'track_not_published', detail: `no PUBLISH has been sent for ${renderFullTrackName(object.namespace, object.trackName)}` };
      }
      const bytes = encodeObjectDatagram({
        trackAlias: alias,
        groupId: object.groupId,
        objectId: object.objectId,
        payload: object.payload,
        properties: object.properties ?? [],
        objectStatus: object.objectStatus ?? null,
        publisherPriority: object.publisherPriority ?? null,
        endOfGroup: object.endOfGroup ?? false,
      });
      pair.publisherLink.frameSocket.sendDatagram(bytes);
      // Let the relay fan out and the subscriber admit.
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { ok: true };
    },

    async fetchCatalog() {
      const result = await fetchCatalogOverSession({
        subscribe: async ({ namespace: ns, trackName }) => {
          const subscribed = await api.subscribe({ namespace: ns, trackName });
          if (!subscribed.ok) {
            fail('INVALID_FIELD', `catalog subscribe failed: ${subscribed.reason}`);
          }
          const deadline = Date.now() + 2000;
          while (Date.now() < deadline) {
            // Subscriber objects carry the track name as a Buffer from
            // the decoded SUBSCRIBE_OK leg; compare by bytes.
            const catalogObjects = pair.subscriberObjects.filter((object) => bytesEqual(toBuffer(object.trackName, 'track name'), toBuffer(trackName, 'track name')));
            if (catalogObjects.length > 0) {
              return reassembleCatalogObjects(catalogObjects.map((object) => ({
                groupId: object.groupId, objectId: object.objectId, payload: object.payload,
              })));
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          fail('INVALID_FIELD', 'catalog objects did not arrive within 2 s');
        },
        namespace: pair.namespace,
      });
      return result;
    },

    getSubscriberObjects() {
      return pair.subscriberObjects;
    },

    getEvents() {
      return pair.events;
    },

    async close() {
      if (pair.closed) return { ok: true };
      pair.closed = true;
      try { pair.publisherSession.close(); } catch { /* already closed */ }
      try { pair.subscriberSession.close(); } catch { /* already closed */ }
      try { pair.relaySessionPublisher.close(); } catch { /* already closed */ }
      try { pair.relaySessionSubscriber.close(); } catch { /* already closed */ }
      for (const link of [pair.publisherLink, pair.subscriberLink]) {
        if (!link) continue;
        try { link.frameSocket.close(); } catch { /* already closed */ }
        try { link.serverFrameSocket.close(); } catch { /* already closed */ }
      }
      if (pair.server) {
        await new Promise((resolve) => {
          try { pair.server.close(() => resolve()); } catch { resolve(); }
        });
      }
      return { ok: true };
    },
  };

  return api;
}
