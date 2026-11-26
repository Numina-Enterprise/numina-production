// numina-pedigree.js — PEDIGREE delegation chains, mandate narrowing
// proofs, and signed completion blocks for NCPS (owner directive
// Nov 20, 2026: implement the three PEDIGREE evaluation ideas).
//
// Source: draft-rampalli-pedigree-01, "PEDIGREE: Verifiable Delegation
// Identity for Agentic AI Systems", Karthik Rampalli (Glyphzero, Inc.),
// 19 November 2026, https://datatracker.ietf.org/doc/draft-rampalli-pedigree/
// (expires 23 May 2027; revives expired -00; a substantial rewrite of
// -00: parent binding, closed claim set, status/consent rules, JCS
// canonicalization, completion blocks).
//
// EVIDENCE CLASS (c) — UNPROVEN CLAIM. The draft has no machine-checked
// proof, no public implementation (Implementation Status §15: the author
// maintains a NON-PUBLIC implementation of an EARLIER revision and claims
// NO interoperability result for -01), and NO byte-level vectors
// (Appendix A: "This revision includes no byte-level vectors. The cases
// below name an input and the expected outcome from Section 5.6").
// Nothing in this module proves anything about PEDIGREE, and no KAT/ACVP
// pass is claimed for it: there are no vectors to pin. The tests below
// prove only that THIS implementation refuses the draft's own failure
// cases (mutant-kill on every field) and accepts its well-formed chains.
//
// NCPS CHAIN-BINDING VERDICT (evaluation item 1) — NCPS chain binding
// was NOT at least as strong as PEDIGREE's, because NCPS had NO
// multi-hop signed delegation chain at all:
//   * src/control.js grantValid is a MANIFEST-LOCAL grant tree: one
//     manifest, scopes subset, resource-prefix within, expiry, depth
//     capped at 8. No per-hop signature, no parent-hash binding, no
//     conveyed chain — a grant's parent is a manifest lookup, not a
//     signed token.
//   * src/numina-authorization-binding.js (Work B) is SINGLE-HOP: one
//     authorization, one once-consumed nonce, one binding_digest. It
//     binds what one authorization authorizes; it says nothing about a
//     chain of delegations.
// This module ADDS the chain layer PEDIGREE defines and adopts its
// invariant as an explicit NCPS rule: VERIFY EVERY PARENT, NO ANCESTOR
// FETCH (draft §5.2: "A verifier MUST NOT fetch a missing ancestor
// from the network. A chain with a missing ancestor is malformed";
// §5.3 step 2: "Every token is verified, not only the leaf").
//
// What this module does NOT do (stated, not silently absent):
//   * Operator ceiling (draft §7): no ceiling document is defined or
//     evaluated here. ceiling_ref is carried as a REQUIRED well-formed
//     digest (draft §4.2) and is checked against a caller-supplied
//     accepted set ONLY when one is configured; otherwise the verify
//     result records ceiling as NOT EVALUATED. Nothing is claimed
//     about a ceiling that was never configured.
//   * Token / consent status (draft §10): no Token Status List and no
//     consent status source exist in NCPS. verifyPedigreeChain records
//     status as NOT EVALUATED on every result; a chain is never
//     reported as "not revoked" — only as "status not checked".
//   * Cedar 4.5 parsing (draft §8.1): no Cedar parser exists in this
//     repo. Mandate validity is a conservative STATIC-SHAPE check
//     (exactly one static permit/forbid statement, no slots, no
//     templates) unless the caller supplies a Cedar validator via
//     opts.cedarValidator. Every verify result labels which one ran
//     (mandateValidity: 'shape-only' | 'validator'). A shape check is
//     NOT a Cedar parse; a deployment that relies on mandates must
//     supply a validator.
//   * Narrowing proof formats (draft §8.4): the draft defines NO proof
//     format. This module implements the §8.4 DECISION PROCEDURE
//     (syntactic first, then proof, then input_unavailable, then
//     refuse) with a caller-supplied checker registry
//     (opts.proofCheckers). NO format is implemented here, so a hop
//     that needs a proof is refused until a format is registered.
//   * WIMSE workload credentials, holder binding (WPT), invocations
//     (draft §6), and revocation mechanics: out of scope; the chain
//     verifier covers draft §5.3 steps 1-8 only (step 8 recorded as
//     not evaluated), plus the optional leaf-audience check of step 9
//     when opts.audience is supplied.
//
// INTEGRATION POINT (not applied here): wiring this verifier into
// createSignedMurphRecord (src/numina-protocol-sign.js) or into
// control.js authorizeControl is an OWNER DECISION. This module is a
// standalone verifier: a signed MERF record still carries no PEDIGREE
// chain until a caller attaches one and a verifier calls
// verifyPedigreeChain. Do not report a chain as verified until that
// call has run.
//
// KAT/ACVP RULE (docs/numina-crypto-verification-rule-2026-11-20.md):
// passing known-answer / ACVP vectors is NECESSARY, never SUFFICIENT,
// for NCPS crypto code. No KAT/ACVP pass may be claimed for this module
// — the draft publishes no vectors. The sufficiency bar is assessed in
// the design note (~/workspace/your_files/
// numina-pedigree-implementation-2026-11-20.md).
//
// Fail-closed: mint* throws on any malformed input; verify* never
// throws on a malformed chain or malformed verifier configuration —
// it returns { ok: false, outcome, reasons }. Amounts and times are
// integers (BigInt where compared as money is not involved here; times
// are safe integers, never floats). No private key material is ever
// accepted, stored, or logged by this module: mint takes a `sign`
// callback supplied by the caller (the key stays with the owner, as in
// numina-protocol-sign.js), verify takes public JWKs only, and any JWK
// carrying a private member is rejected by decodeJwkPublicKey.

import { createHash, timingSafeEqual } from 'node:crypto';
import canonicalize from 'canonicalize';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  decodeStrictBase64url,
  decodeStrictEd25519Point,
  validateEd25519SignatureBytes,
  decodeJwkPublicKey,
  parseStrictJson,
  unhex,
} from './numina-protocol-verify.js';

export const PEDIGREE_DRAFT = 'draft-rampalli-pedigree-01';
export const PEDIGREE_TOKEN_TYP = 'pedigree+jwt';
export const PEDIGREE_COMPLETION_TYP = 'pedigree-completion+jwt';
export const PEDIGREE_MANDATE_FORMAT = 'cedar';
export const PEDIGREE_DEFAULT_MAX_TOKENS = 8;
export const PEDIGREE_DEFAULT_MAX_TOTAL_SIZE = 65536;

export const COMPLETION_STATUSES = Object.freeze(['completed', 'failed', 'partial']);
export const COMPLETION_VERIFICATION_STATUSES = Object.freeze([
  'self_reported',
  'tool_verified',
  'peer_verified',
  'human_verified',
]);

/** Draft §9.1, carried verbatim in every completion-block result. */
export const COMPLETION_CAVEAT =
  'A completion block is a REPORT by the signing agent (draft §9.1). ' +
  'It proves the signing agent reported this outcome under the key bound ' +
  'to the token. It does NOT prove the action happened, that it had the ' +
  'reported effect, or that the result is correct. verification_status is ' +
  "the signing agent's assertion; a value other than self_reported is NOT " +
  'evidence that a check took place.';

/**
 * Draft §5.6 Table 3 outcome names this module can produce, with the
 * verify step that produces each and its permanent/transient class.
 * ceiling_unknown is produced only when an accepted ceiling set is
 * configured; revoked / status_unknown are NEVER produced — status is
 * not evaluated (see module header) — and are listed here only so a
 * reader can see the gap against the draft's table.
 */
export const PEDIGREE_OUTCOMES = Object.freeze({
  malformed: { step: 1, class: 'permanent' },
  non_canonical: { step: 1, class: 'permanent' },
  signature_invalid: { step: 2, class: 'permanent' },
  par_hash_mismatch: { step: 3, class: 'permanent' },
  linkage_invalid: { step: 3, class: 'permanent' },
  principal_altered: { step: 4, class: 'permanent' },
  consent_altered: { step: 4, class: 'permanent' },
  mandate_invalid: { step: 5, class: 'permanent' },
  scope_widened: { step: 5, class: 'permanent' },
  mandate_not_narrower: { step: 5, class: 'permanent' },
  input_unavailable: { step: 5, class: 'transient' },
  expired: { step: 6, class: 'permanent' },
  ceiling_unknown: { step: 7, class: 'permanent' },
  audience_mismatch: { step: 9, class: 'permanent' },
});

/**
 * NCPS-LOCAL outcome names for draft §9.3 completion-block checks. The
 * draft defines no outcome names for §9.3, so these are named here and
 * labelled local wherever they appear — they are not draft outcomes.
 */
export const PEDIGREE_COMPLETION_OUTCOMES = Object.freeze({
  completion_unbound: 'the block does not bind to any token in the verified chain (token_hash, signing_agent, or key thumbprint mismatch)',
  completion_result_mismatch: 'result_hash does not match the result bytes supplied',
});

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const ABSOLUTE_URI_RE = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function fail(message) {
  throw new Error(`pedigree: ${message}`);
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

/** RFC 8785 (JCS) canonical text of a JSON value; throws when the value is not canonicalizable. */
export function pedigreeCanonicalText(value) {
  const text = canonicalize(value);
  if (typeof text !== 'string') throw new Error('value is not JSON-canonicalizable');
  return text;
}

/**
 * RFC 7638 JWK Thumbprint of an Ed25519 public JWK: base64url(SHA-256(
 * JCS({"crv":"Ed25519","kty":"OKP","x":"..."}) )). Only the required
 * members enter the thumbprint; extra members are ignored for it, but
 * any private member rejects the key outright (decodeJwkPublicKey).
 */
export function jwkThumbprint(jwk) {
  const raw = decodeJwkPublicKey(jwk);
  void raw;
  const text = pedigreeCanonicalText({ crv: 'Ed25519', kty: 'OKP', x: jwk.x });
  return base64urlEncode(sha256Bytes(new TextEncoder().encode(text)));
}

/**
 * The JWS Signing Input (RFC 7515 §5.2): ASCII(
 * BASE64URL(UTF8(JCS(header))) || '.' || BASE64URL(UTF8(JCS(payload))) ).
 * Returns { ascii, bytes }.
 */
export function pedigreeSigningInput(header, payload) {
  const headerText = pedigreeCanonicalText(header);
  const payloadText = pedigreeCanonicalText(payload);
  const ascii =
    `${base64urlEncode(new TextEncoder().encode(headerText))}` +
    `.${base64urlEncode(new TextEncoder().encode(payloadText))}`;
  return { ascii, bytes: new TextEncoder().encode(ascii) };
}

/** Draft §4.2 par_hash / §9.2 token_hash: base64url(SHA-256(Signing Input)). */
export function pedigreeTokenDigest(signingInputAscii) {
  if (typeof signingInputAscii !== 'string') throw new Error('signing input must be a string');
  return base64urlEncode(sha256Bytes(new TextEncoder().encode(signingInputAscii)));
}

/** Draft §4.2 narrowing_proof.hash / §9.2 result_hash: "sha256:" + hex(SHA-256(bytes)). */
export function pedigreeDigest(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('digest input must be bytes');
  return `sha256:${hex(sha256Bytes(bytes))}`;
}

function constantTimeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let aBytes;
  let bBytes;
  try {
    aBytes = decodeStrictBase64url(a);
    bBytes = decodeStrictBase64url(b);
  } catch {
    return false;
  }
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(Buffer.from(aBytes), Buffer.from(bBytes));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function checkNoUnknownFields(obj, allowed, what) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`${what} has unknown field '${key}'`);
  }
}

function checkNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a non-empty string`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) fail(`${name} contains a control character`);
}

function checkSafeNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a safe non-negative integer`);
}

function checkSafeInteger(value, name) {
  if (!Number.isSafeInteger(value)) fail(`${name} must be a safe integer`);
}

/**
 * Strict Ed25519 verification over ARBITRARY bytes (here: the ASCII JWS
 * Signing Input). Same strictness as verifySignature in
 * numina-protocol-verify.js — canonical torsion-free key, canonical
 * torsion-free R, S < L, zip215 off — but verifySignature signs over
 * RFC 8785 canonical payload bytes, while a JWS signature covers the
 * Signing Input, so the library call is made directly here. Returns
 * true/false; malformed input verifies as false, it does not throw.
 */
export function verifySigningInputSignature({ publicKeyRaw, signatureBytes, signingInputAscii }) {
  try {
    if (!(publicKeyRaw instanceof Uint8Array) || publicKeyRaw.length !== 32) return false;
    if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length !== 64) return false;
    decodeStrictEd25519Point(publicKeyRaw);
    validateEd25519SignatureBytes(signatureBytes);
    return ed25519.verify(
      signatureBytes,
      new TextEncoder().encode(signingInputAscii),
      publicKeyRaw,
      { zip215: false },
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Compact JWS parsing (draft §4.4 / §5.3 step 1)
// ---------------------------------------------------------------------------

/**
 * Parse one compact JWS into { header, payload, signingInput, signatureBytes }.
 * Enforces draft §4.4: header and payload must be EXACTLY the JCS
 * serialization of the object they parse to (else non_canonical), and
 * duplicate members / lone surrogates are refused (parseStrictJson).
 * Never throws for a malformed token — returns { ok: false, outcome,
 * reasons }. `expectedTyp` is 'pedigree+jwt' for tokens and
 * 'pedigree-completion+jwt' for completion blocks.
 */
export function parseCompactJws(compact, expectedTyp) {
  const reasons = [];
  if (typeof compact !== 'string') {
    return { ok: false, outcome: 'malformed', reasons: ['compact serialization must be a string'] };
  }
  const parts = compact.split('.');
  if (parts.length !== 3) {
    return { ok: false, outcome: 'malformed', reasons: ['compact serialization must have exactly three parts'] };
  }
  const [headerPart, payloadPart, signaturePart] = parts;
  let headerText;
  let payloadText;
  let signatureBytes;
  try {
    headerText = new TextDecoder('utf-8', { fatal: true }).decode(decodeStrictBase64url(headerPart));
  } catch {
    return { ok: false, outcome: 'malformed', reasons: ['header is not strict unpadded base64url UTF-8'] };
  }
  try {
    payloadText = new TextDecoder('utf-8', { fatal: true }).decode(decodeStrictBase64url(payloadPart));
  } catch {
    return { ok: false, outcome: 'malformed', reasons: ['payload is not strict unpadded base64url UTF-8'] };
  }
  try {
    signatureBytes = decodeStrictBase64url(signaturePart);
  } catch {
    return { ok: false, outcome: 'malformed', reasons: ['signature is not strict unpadded base64url'] };
  }
  if (signatureBytes.length !== 64) {
    return { ok: false, outcome: 'malformed', reasons: ['signature is not 64 bytes'] };
  }
  let header;
  let payload;
  try {
    header = parseStrictJson(headerText);
  } catch (error) {
    return { ok: false, outcome: 'malformed', reasons: [`header is not strict JSON: ${error.message}`] };
  }
  try {
    payload = parseStrictJson(payloadText);
  } catch (error) {
    return { ok: false, outcome: 'malformed', reasons: [`payload is not strict JSON: ${error.message}`] };
  }
  if (!isPlainObject(header)) {
    return { ok: false, outcome: 'malformed', reasons: ['header is not a JSON object'] };
  }
  if (!isPlainObject(payload)) {
    return { ok: false, outcome: 'malformed', reasons: ['payload is not a JSON object'] };
  }
  let reHeader;
  let rePayload;
  try {
    reHeader = pedigreeCanonicalText(header);
    rePayload = pedigreeCanonicalText(payload);
  } catch {
    return { ok: false, outcome: 'malformed', reasons: ['header or payload is not JSON-canonicalizable'] };
  }
  if (reHeader !== headerText || rePayload !== payloadText) {
    return { ok: false, outcome: 'non_canonical', reasons: ['header or payload is not exactly its JCS serialization (draft §4.4)'] };
  }
  if (header.typ !== expectedTyp) {
    reasons.push(`header typ must be '${expectedTyp}'`);
    return { ok: false, outcome: 'malformed', reasons };
  }
  return { ok: true, header, payload, signingInput: `${headerPart}.${payloadPart}`, signatureBytes, reasons: [] };
}

/** Parse one PEDIGREE token (typ 'pedigree+jwt'). Shape is checked separately by validateTokenShape. */
export function parsePedigreeToken(compact) {
  return parseCompactJws(compact, PEDIGREE_TOKEN_TYP);
}

/** Parse one completion block (typ 'pedigree-completion+jwt'). Shape is checked separately. */
export function parseCompletionBlock(compact) {
  return parseCompactJws(compact, PEDIGREE_COMPLETION_TYP);
}

// ---------------------------------------------------------------------------
// Token shape (draft §4.1 / §4.2 / §4.4; §5.3 step 1)
// ---------------------------------------------------------------------------

const TOKEN_CLAIMS = Object.freeze([
  'iss', 'sub', 'client_id', 'aud', 'jti', 'iat', 'exp', 'nbf', 'cnf',
  'del_depth', 'par_hash', 'parent_chain', 'grants', 'mandate',
  'narrowing_proof', 'consent_chain', 'ceiling_ref', 'completion_bindable',
  'status', 'act',
]);

function shapeError(reasons, reason) {
  reasons.push(reason);
}

/**
 * Validate a token's header + payload shape (draft §4.1/§4.2). Returns
 * { ok, reasons }. The `alg` value itself is NOT checked here: §5.3
 * step 2 refuses an alg outside the verifier's accepted list, so an
 * unknown alg is a signature_invalid at step 2, not a parse failure.
 * Policy CONTENT validity (§8.1) is likewise step 5, not parse: this
 * function checks only the mandate's STRUCTURE (closed object, format,
 * non-empty policy_set of strings).
 */
export function validateTokenShape(header, payload) {
  const reasons = [];
  if (!isPlainObject(header)) return { ok: false, reasons: ['header is not an object'] };
  if (!isPlainObject(payload)) return { ok: false, reasons: ['payload is not an object'] };

  // Header (draft §4.1): typ, alg required; jwk in T_i only; kid allowed;
  // any other member — including crit — is refused (NCPS implements no
  // crit extension, so crit is an unknown parameter here, fail-closed).
  for (const key of Object.keys(header)) {
    if (!['typ', 'alg', 'jwk', 'kid'].includes(key)) {
      shapeError(reasons, `header has unknown parameter '${key}'`);
    }
  }
  if (header.typ !== PEDIGREE_TOKEN_TYP) shapeError(reasons, `header typ must be '${PEDIGREE_TOKEN_TYP}'`);
  if (typeof header.alg !== 'string' || header.alg.length === 0) {
    shapeError(reasons, 'header alg must be a non-empty string');
  }
  if (header.kid !== undefined && typeof header.kid !== 'string') {
    shapeError(reasons, 'header kid must be a string');
  }

  // Closed claim set (draft §4.2).
  for (const key of Object.keys(payload)) {
    if (!TOKEN_CLAIMS.includes(key)) shapeError(reasons, `payload has unlisted claim '${key}'`);
  }
  const required = [
    'iss', 'sub', 'client_id', 'aud', 'jti', 'iat', 'exp', 'cnf',
    'del_depth', 'parent_chain', 'grants', 'consent_chain', 'ceiling_ref',
  ];
  for (const claim of required) {
    if (payload[claim] === undefined) shapeError(reasons, `payload is missing required claim '${claim}'`);
  }
  if (reasons.length > 0) return { ok: false, reasons };

  for (const name of ['iss', 'sub', 'client_id', 'jti']) {
    if (typeof payload[name] !== 'string' || payload[name].length === 0) {
      shapeError(reasons, `${name} must be a non-empty string`);
    }
  }
  if (typeof payload.aud !== 'string' && !Array.isArray(payload.aud)) {
    shapeError(reasons, 'aud must be a string or an array of strings');
  } else if (typeof payload.aud === 'string' && payload.aud.length === 0) {
    shapeError(reasons, 'aud must not be empty');
  } else if (Array.isArray(payload.aud)) {
    if (payload.aud.length === 0) shapeError(reasons, 'aud must not be an empty array');
    for (const a of payload.aud) {
      if (typeof a !== 'string' || a.length === 0) shapeError(reasons, 'aud entries must be non-empty strings');
    }
  }
  if (!Number.isSafeInteger(payload.iat)) shapeError(reasons, 'iat must be a safe integer');
  if (!Number.isSafeInteger(payload.exp)) shapeError(reasons, 'exp must be a safe integer');
  if (payload.nbf !== undefined && !Number.isSafeInteger(payload.nbf)) {
    shapeError(reasons, 'nbf must be a safe integer');
  }
  if (!isPlainObject(payload.cnf) || Object.keys(payload.cnf).length !== 1 || typeof payload.cnf.jkt !== 'string') {
    shapeError(reasons, 'cnf must be an object with exactly one member, jkt');
  } else {
    try {
      const raw = decodeStrictBase64url(payload.cnf.jkt);
      if (raw.length !== 32) shapeError(reasons, 'cnf.jkt must decode to 32 bytes');
    } catch {
      shapeError(reasons, 'cnf.jkt is not strict unpadded base64url');
    }
  }
  if (!Number.isSafeInteger(payload.del_depth) || payload.del_depth < 0) {
    shapeError(reasons, 'del_depth must be a safe non-negative integer');
  }
  if (payload.del_depth === 0) {
    if (payload.par_hash !== undefined) shapeError(reasons, 'par_hash MUST be absent in T_0 (draft §4.2)');
    if (payload.narrowing_proof !== undefined) shapeError(reasons, 'narrowing_proof MUST be absent in T_0 (draft §4.2)');
    if (header.jwk !== undefined) shapeError(reasons, 'header jwk MUST be absent in T_0 (draft §4.1/§4.5 invariant 0)');
  } else {
    if (payload.par_hash === undefined) {
      shapeError(reasons, 'par_hash is REQUIRED in T_i (i > 0) (draft §4.2)');
    } else if (typeof payload.par_hash !== 'string') {
      shapeError(reasons, 'par_hash must be a string');
    } else {
      try {
        const raw = decodeStrictBase64url(payload.par_hash);
        if (raw.length !== 32) shapeError(reasons, 'par_hash must decode to 32 bytes');
      } catch {
        shapeError(reasons, 'par_hash is not strict unpadded base64url');
      }
    }
    if (header.jwk === undefined) {
      shapeError(reasons, 'header jwk is REQUIRED in T_i (i > 0) (draft §4.1)');
    } else {
      try {
        decodeJwkPublicKey(header.jwk);
      } catch (error) {
        shapeError(reasons, `header jwk is not a valid public JWK: ${error.message}`);
      }
    }
  }
  if (!Array.isArray(payload.parent_chain)) {
    shapeError(reasons, 'parent_chain must be an array');
  } else {
    for (const entry of payload.parent_chain) {
      if (typeof entry !== 'string' || entry.length === 0) {
        shapeError(reasons, 'parent_chain entries must be non-empty strings');
      }
    }
  }
  validateGrantsShape(payload.grants, reasons);
  if (payload.mandate !== undefined) validateMandateShape(payload.mandate, reasons);
  if (payload.narrowing_proof !== undefined) {
    if (payload.mandate === undefined) {
      shapeError(reasons, 'narrowing_proof MUST be absent when the token carries no mandate (draft §4.2)');
    } else {
      validateNarrowingProofShape(payload.narrowing_proof, reasons);
    }
  }
  if (!Array.isArray(payload.consent_chain) || payload.consent_chain.length === 0) {
    shapeError(reasons, 'consent_chain must be a non-empty array');
  } else {
    for (const entry of payload.consent_chain) {
      if (typeof entry !== 'string' || entry.length === 0) {
        shapeError(reasons, 'consent_chain entries must be non-empty strings');
      }
    }
  }
  if (typeof payload.ceiling_ref !== 'string' || !DIGEST_RE.test(payload.ceiling_ref)) {
    shapeError(reasons, 'ceiling_ref must be "sha256:" followed by 64 lowercase hex characters');
  }
  if (payload.completion_bindable !== undefined && typeof payload.completion_bindable !== 'boolean') {
    shapeError(reasons, 'completion_bindable must be a boolean');
  }
  if (payload.status !== undefined && !isPlainObject(payload.status)) {
    shapeError(reasons, 'status must be an object (Token Status List reference, draft §10.3)');
  }
  if (payload.act !== undefined) {
    if (!isPlainObject(payload.act)) {
      shapeError(reasons, 'act must be an object');
    } else if (payload.act.sub !== payload.client_id) {
      shapeError(reasons, 'act outermost sub MUST equal client_id (draft §3.1)');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

function validateGrantsShape(grants, reasons) {
  if (!Array.isArray(grants) || grants.length === 0) {
    shapeError(reasons, 'grants must be a non-empty array');
    return;
  }
  const seen = new Set();
  for (let i = 0; i < grants.length; i++) {
    const grant = grants[i];
    if (!isPlainObject(grant) || Object.keys(grant).length !== 2
      || grant.resource === undefined || grant.scopes === undefined) {
      shapeError(reasons, `grants[${i}] must be an object with exactly 'resource' and 'scopes'`);
      continue;
    }
    if (typeof grant.resource !== 'string' || !ABSOLUTE_URI_RE.test(grant.resource)) {
      shapeError(reasons, `grants[${i}].resource must be an absolute URI (draft §4.2)`);
    }
    if (seen.has(grant.resource)) {
      shapeError(reasons, `grants name the same resource twice: '${grant.resource}' (draft §4.2)`);
    }
    seen.add(grant.resource);
    if (!Array.isArray(grant.scopes) || grant.scopes.length === 0) {
      shapeError(reasons, `grants[${i}].scopes must be a non-empty array`);
    } else {
      for (const scope of grant.scopes) {
        if (typeof scope !== 'string' || scope.length === 0) {
          shapeError(reasons, `grants[${i}].scopes entries must be non-empty strings`);
        }
      }
    }
  }
}

/** Mandate STRUCTURE only (draft §4.2): closed object, format, non-empty policy_set of strings. */
function validateMandateShape(mandate, reasons) {
  if (!isPlainObject(mandate) || Object.keys(mandate).length !== 2
    || mandate.format === undefined || mandate.policy_set === undefined) {
    shapeError(reasons, "mandate must be an object with exactly 'format' and 'policy_set'");
    return;
  }
  if (mandate.format !== PEDIGREE_MANDATE_FORMAT) {
    shapeError(reasons, `mandate format must be '${PEDIGREE_MANDATE_FORMAT}' in this revision (draft §4.2)`);
  }
  if (!Array.isArray(mandate.policy_set) || mandate.policy_set.length === 0) {
    shapeError(reasons, 'mandate policy_set must be a non-empty array');
    return;
  }
  for (const entry of mandate.policy_set) {
    if (typeof entry !== 'string' || entry.length === 0) {
      shapeError(reasons, 'mandate policy_set entries must be non-empty strings');
    }
  }
}

/** narrowing_proof STRUCTURE only (draft §4.2): closed object, format + "sha256:" hex hash. */
function validateNarrowingProofShape(proof, reasons) {
  if (!isPlainObject(proof) || Object.keys(proof).length !== 2
    || proof.format === undefined || proof.hash === undefined) {
    shapeError(reasons, "narrowing_proof must be an object with exactly 'format' and 'hash'");
    return;
  }
  if (typeof proof.format !== 'string' || proof.format.length === 0) {
    shapeError(reasons, 'narrowing_proof.format must be a non-empty string');
  }
  if (typeof proof.hash !== 'string' || !DIGEST_RE.test(proof.hash)) {
    shapeError(reasons, 'narrowing_proof.hash must be "sha256:" followed by 64 lowercase hex characters');
  }
}

// ---------------------------------------------------------------------------
// Mandate validity and narrowing (draft §8; evaluation item 2)
// ---------------------------------------------------------------------------

/**
 * Classify one Cedar policy string by its effect. Returns 'permit',
 * 'forbid', or null when the string does not start with exactly one
 * static permit/forbid statement.
 */
export function cedarPolicyEffect(policy) {
  if (typeof policy !== 'string') return null;
  const text = policy.trim();
  if (/^permit\s*\(/.test(text)) return 'permit';
  if (/^forbid\s*\(/.test(text)) return 'forbid';
  return null;
}

/**
 * Conservative STATIC-SHAPE check for one Cedar 4.5 policy (draft
 * §8.1): exactly one static permit/forbid statement, balanced
 * delimiters, no template slots (?principal / ?action / ?resource),
 * no ${...} placeholders, exactly one top-level ';' at the end.
 * THIS IS NOT A CEDAR PARSE. It cannot tell a well-formed Cedar
 * policy from a syntactically similar string that Cedar would reject,
 * and it cannot tell a semantically empty policy from a real one. A
 * deployment that relies on mandates must supply a Cedar 4.5 validator
 * via opts.cedarValidator; when one is supplied it is authoritative
 * and this shape check is not run.
 */
export function isStaticCedarPolicyShape(policy) {
  if (typeof policy !== 'string' || policy.length === 0) return false;
  const text = policy.trim();
  if (cedarPolicyEffect(text) === null) return false;
  if (/\?(principal|action|resource)\b/.test(text)) return false;
  if (text.includes('${')) return false;
  // Walk the text tracking string literals and delimiter depth; count
  // top-level semicolons (depth 0, outside strings). Exactly one, at
  // the end, means exactly one statement.
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let inString = false;
  let escaped = false;
  let topLevelSemicolons = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '(') paren++;
    else if (ch === ')') { paren--; if (paren < 0) return false; }
    else if (ch === '{') brace++;
    else if (ch === '}') { brace--; if (brace < 0) return false; }
    else if (ch === '[') bracket++;
    else if (ch === ']') { bracket--; if (bracket < 0) return false; }
    else if (ch === ';' && paren === 0 && brace === 0 && bracket === 0) topLevelSemicolons++;
  }
  if (inString || paren !== 0 || brace !== 0 || bracket !== 0) return false;
  if (topLevelSemicolons !== 1) return false;
  if (!text.endsWith(';')) return false;
  return true;
}

/**
 * Mandate validity (draft §8.1). Returns { ok, reasons, validity }.
 * validity is 'validator' when a caller-supplied Cedar validator ran,
 * 'shape-only' when only the static-shape check ran. A validator that
 * throws fails the mandate closed — a broken checker is not a pass.
 */
export function validateMandate(mandate, opts = {}) {
  const reasons = [];
  if (!isPlainObject(mandate)) return { ok: false, reasons: ['mandate must be an object'], validity: 'shape-only' };
  const shapeReasons = [];
  validateMandateShape(mandate, shapeReasons);
  if (shapeReasons.length > 0) {
    return { ok: false, reasons: shapeReasons, validity: 'shape-only' };
  }
  if (typeof opts.cedarValidator === 'function') {
    for (const entry of mandate.policy_set) {
      let valid;
      try {
        valid = opts.cedarValidator(entry);
      } catch (error) {
        return { ok: false, reasons: [`cedar validator failed on a policy entry: ${error.message}`], validity: 'validator' };
      }
      if (valid !== true) {
        reasons.push('a mandate policy entry failed the supplied Cedar validator (draft §8.1)');
        return { ok: false, reasons, validity: 'validator' };
      }
    }
    return { ok: true, reasons: [], validity: 'validator' };
  }
  for (const entry of mandate.policy_set) {
    if (!isStaticCedarPolicyShape(entry)) {
      reasons.push('a mandate policy entry is not exactly one static Cedar policy (shape check; draft §8.1)');
      return { ok: false, reasons, validity: 'shape-only' };
    }
  }
  return { ok: true, reasons: [], validity: 'shape-only' };
}

/**
 * The syntactic subset check (draft §8.3). For valid mandates: passes
 * when (1) every permit entry in the child is also in the parent, and
 * (2) every forbid entry in the parent is also in the child. Entries
 * are compared as exact strings. The check is INCOMPLETE by the
 * draft's own account: a child that rewrites a permit into a narrower
 * one fails it and then needs a proof artifact (§8.4).
 */
export function syntacticSubsetCheck(parentMandate, childMandate) {
  const parentPermits = new Set();
  const parentForbids = new Set();
  for (const entry of parentMandate.policy_set) {
    if (cedarPolicyEffect(entry) === 'permit') parentPermits.add(entry);
    else if (cedarPolicyEffect(entry) === 'forbid') parentForbids.add(entry);
  }
  const childPermits = new Set();
  const childForbids = new Set();
  for (const entry of childMandate.policy_set) {
    if (cedarPolicyEffect(entry) === 'permit') childPermits.add(entry);
    else if (cedarPolicyEffect(entry) === 'forbid') childForbids.add(entry);
  }
  for (const permit of childPermits) {
    if (!parentPermits.has(permit)) return false;
  }
  for (const forbid of parentForbids) {
    if (!childForbids.has(forbid)) return false;
  }
  return true;
}

/**
 * The narrowing decision for one hop (draft §8.2 hop rules + §8.4
 * verifier rules, in order). Returns { narrows, method, outcome,
 * reasons }. method is 'none' (neither carries a mandate),
 * 'child-only' (parent has none, child adds one), 'syntactic' (§8.3),
 * or 'proof' (§8.4). outcome is null when narrows is true, else the
 * draft outcome name: 'mandate_invalid', 'mandate_not_narrower', or
 * 'input_unavailable' (transient).
 *
 * opts:
 *   cedarValidator — passed through to validateMandate.
 *   proofCheckers — { [format]: (artifactBytes, parentMandate,
 *     childMandate) => boolean }. No format is implemented here; a
 *     format with no registered checker is "not implemented" (§8.4
 *     rule 4: refuse).
 *   artifactFor — (narrowingProof) => Uint8Array | null | undefined.
 *     Supplies the artifact bytes for a referenced proof. Absent bytes
 *     for an implemented format is input_unavailable (§8.4 rule 3).
 *   requireNarrowingProof — NCPS TIGHTENING, not a draft rule: when
 *     true (safety-critical mandate), the syntactic check alone is NOT
 *     sufficient — a verified narrowing_proof is mandatory even when
 *     the syntactic check passes. A hop that would narrow syntactically
 *     but carries no verified proof is refused with
 *     mandate_not_narrower.
 */
export function narrowMandate(parentMandate, childMandate, opts = {}) {
  const reasons = [];
  if (parentMandate === undefined || parentMandate === null) {
    if (childMandate === undefined || childMandate === null) {
      return { narrows: true, method: 'none', outcome: null, reasons: [] };
    }
    const childValid = validateMandate(childMandate, opts);
    if (!childValid.ok) {
      return { narrows: false, method: null, outcome: 'mandate_invalid', reasons: childValid.reasons };
    }
    return { narrows: true, method: 'child-only', outcome: null, reasons: [] };
  }
  const parentValid = validateMandate(parentMandate, opts);
  if (!parentValid.ok) {
    return { narrows: false, method: null, outcome: 'mandate_invalid', reasons: parentValid.reasons };
  }
  if (childMandate === undefined || childMandate === null) {
    return {
      narrows: false,
      method: null,
      outcome: 'mandate_not_narrower',
      reasons: ['parent carries a mandate and the child carries none — dropping a mandate would remove its constraints (draft §8.2)'],
    };
  }
  const childValid = validateMandate(childMandate, opts);
  if (!childValid.ok) {
    return { narrows: false, method: null, outcome: 'mandate_invalid', reasons: childValid.reasons };
  }
  // §8.4 rule 1: the syntactic check. Skipped only under the NCPS
  // safety-critical tightening, which demands a proof regardless.
  const syntacticPasses = syntacticSubsetCheck(parentMandate, childMandate);
  if (syntacticPasses && !opts.requireNarrowingProof) {
    return { narrows: true, method: 'syntactic', outcome: null, reasons: [] };
  }
  // §8.4 rules 2-4: the proof path. The child must carry a
  // narrowing_proof; its format must be implemented by this verifier;
  // the artifact must be available; its digest must equal the
  // reference; and the artifact must prove narrowing for EXACTLY this
  // child mandate against EXACTLY this parent mandate.
  const proof = opts.narrowingProof;
  if (!isPlainObject(proof)) {
    return {
      narrows: false,
      method: null,
      outcome: 'mandate_not_narrower',
      reasons: [opts.requireNarrowingProof
        ? 'safety-critical mandate: a narrowing proof is required even though the syntactic check passes (NCPS tightening)'
        : 'the syntactic subset check fails and the child carries no narrowing_proof (draft §8.4 rule 4)'],
    };
  }
  const proofShapeReasons = [];
  validateNarrowingProofShape(proof, proofShapeReasons);
  if (proofShapeReasons.length > 0) {
    return { narrows: false, method: null, outcome: 'mandate_invalid', reasons: proofShapeReasons };
  }
  const checker = opts.proofCheckers && opts.proofCheckers[proof.format];
  if (typeof checker !== 'function') {
    return {
      narrows: false,
      method: null,
      outcome: 'mandate_not_narrower',
      reasons: [`no proof checker is registered for format '${proof.format}' — a verifier without an analyzer applies the syntactic check or refuses (draft §8.4)`],
    };
  }
  let artifactBytes;
  try {
    artifactBytes = typeof opts.artifactFor === 'function' ? opts.artifactFor(proof) : undefined;
  } catch (error) {
    return { narrows: false, method: null, outcome: 'input_unavailable', reasons: [`artifact lookup failed: ${error.message}`] };
  }
  if (!(artifactBytes instanceof Uint8Array)) {
    return {
      narrows: false,
      method: null,
      outcome: 'input_unavailable',
      reasons: [`a proof artifact in format '${proof.format}' is required but could not be obtained (draft §8.4 rule 3)`],
    };
  }
  if (pedigreeDigest(artifactBytes) !== proof.hash) {
    return {
      narrows: false,
      method: null,
      outcome: 'mandate_not_narrower',
      reasons: ['narrowing_proof.hash does not equal the SHA-256 digest of the artifact bytes (draft §8.4 rule 2)'],
    };
  }
  let proven;
  try {
    proven = checker(artifactBytes, parentMandate, childMandate);
  } catch (error) {
    return { narrows: false, method: null, outcome: 'mandate_not_narrower', reasons: [`proof checker failed: ${error.message}`] };
  }
  if (proven !== true) {
    return {
      narrows: false,
      method: null,
      outcome: 'mandate_not_narrower',
      reasons: ['the proof artifact does not prove narrowing for exactly this child mandate against this parent mandate (draft §8.4 rule 2)'],
    };
  }
  return { narrows: true, method: 'proof', outcome: null, reasons: [] };
}

/** Draft §4.5 invariant 6: every child grant is covered by a parent grant (same resource, scopes a subset). */
export function grantsCover(parentGrants, childGrants) {
  if (!Array.isArray(parentGrants) || !Array.isArray(childGrants)) return false;
  for (const child of childGrants) {
    const parent = parentGrants.find((g) => g.resource === child.resource);
    if (!parent) return false;
    if (!child.scopes.every((scope) => parent.scopes.includes(scope))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mint (draft §5.1). The module never signs with a held key: callers
// supply `sign`, a callback that signs the Signing Input bytes with the
// key the owner holds. Fresh signatures are re-verified before return
// (same posture as signPayload in numina-protocol-sign.js).
// ---------------------------------------------------------------------------

function checkSignCallback(sign) {
  if (typeof sign !== 'function') fail('sign must be a function (signingInputBytes: Uint8Array) => Uint8Array signature (64 bytes)');
}

function signAndVerify({ header, payload, sign, publicKeyRaw }) {
  const { ascii, bytes } = pedigreeSigningInput(header, payload);
  const signature = sign(bytes);
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    fail('sign callback must return a 64-byte Ed25519 signature');
  }
  if (!verifySigningInputSignature({ publicKeyRaw, signatureBytes: signature, signingInputAscii: ascii })) {
    fail('fresh signature failed re-verification — refusing to return it');
  }
  const compact = `${base64urlEncode(new TextEncoder().encode(pedigreeCanonicalText(header)))}.${base64urlEncode(new TextEncoder().encode(pedigreeCanonicalText(payload)))}.${base64urlEncode(signature)}`;
  return { compact, header, payload, signingInput: ascii, signatureBytes: signature };
}

function buildRootPayload(fields, agentThumbprint) {
  const payload = {
    iss: fields.iss,
    sub: fields.sub,
    client_id: fields.client_id,
    aud: fields.aud,
    jti: fields.jti,
    iat: fields.iat,
    exp: fields.exp,
    cnf: { jkt: agentThumbprint },
    del_depth: 0,
    parent_chain: [],
    grants: fields.grants,
    consent_chain: fields.consent_chain,
    ceiling_ref: fields.ceiling_ref,
  };
  if (fields.nbf !== undefined) payload.nbf = fields.nbf;
  if (fields.mandate !== undefined) payload.mandate = fields.mandate;
  if (fields.completion_bindable !== undefined) payload.completion_bindable = fields.completion_bindable;
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.act !== undefined) payload.act = fields.act;
  return payload;
}

/**
 * Mint the root token T_0 (draft §5.1, root case; §4.5 invariant 0).
 * `sign` signs with the TRUST-ANCHOR key; `anchorPublicJwk` is that
 * key, used only to re-verify the fresh signature. `agentPublicJwk`
 * is the root acting agent's key, carried as cnf.jkt (it signs T_1).
 * Throws on any malformed field — fail closed at construction.
 */
export function mintRootToken(args) {
  if (!args || typeof args !== 'object') fail('args must be an object');
  const { fields, sign, anchorPublicJwk, agentPublicJwk } = args;
  checkSignCallback(sign);
  if (!fields || typeof fields !== 'object') fail('fields must be an object');
  checkNoUnknownFields(fields, [
    'iss', 'sub', 'client_id', 'aud', 'jti', 'iat', 'exp', 'nbf', 'grants',
    'mandate', 'consent_chain', 'ceiling_ref', 'completion_bindable',
    'status', 'act',
  ], 'root token fields');
  for (const name of ['iss', 'sub', 'client_id', 'jti']) checkNonEmptyString(fields[name], name);
  if (typeof fields.aud !== 'string' && !Array.isArray(fields.aud)) fail('aud must be a string or an array of strings');
  if (typeof fields.aud === 'string' && fields.aud.length === 0) fail('aud must not be empty');
  if (Array.isArray(fields.aud) && fields.aud.length === 0) fail('aud must not be an empty array');
  checkSafeInteger(fields.iat, 'iat');
  checkSafeInteger(fields.exp, 'exp');
  if (fields.exp <= fields.iat) fail('exp must be later than iat');
  if (fields.nbf !== undefined) checkSafeInteger(fields.nbf, 'nbf');
  if (!Array.isArray(fields.grants) || fields.grants.length === 0) fail('grants must be a non-empty array');
  if (!Array.isArray(fields.consent_chain) || fields.consent_chain.length === 0) fail('consent_chain must be a non-empty array');
  if (typeof fields.ceiling_ref !== 'string' || !DIGEST_RE.test(fields.ceiling_ref)) {
    fail('ceiling_ref must be "sha256:" followed by 64 lowercase hex characters');
  }
  if (fields.mandate !== undefined) {
    const valid = validateMandate(fields.mandate, args);
    if (!valid.ok) fail(`root mandate is invalid: ${valid.reasons.join('; ')}`);
  }
  if (fields.completion_bindable !== undefined && typeof fields.completion_bindable !== 'boolean') {
    fail('completion_bindable must be a boolean');
  }
  if (fields.act !== undefined) {
    if (!isPlainObject(fields.act) || fields.act.sub !== fields.client_id) {
      fail('act outermost sub MUST equal client_id (draft §3.1)');
    }
  }
  const grantsReasons = [];
  validateGrantsShape(fields.grants, grantsReasons);
  if (grantsReasons.length > 0) fail(`grants are malformed: ${grantsReasons.join('; ')}`);
  let anchorRaw;
  try {
    anchorRaw = decodeJwkPublicKey(anchorPublicJwk);
  } catch (error) {
    fail(`anchorPublicJwk is not a valid public JWK: ${error.message}`);
  }
  let agentThumbprint;
  try {
    agentThumbprint = jwkThumbprint(agentPublicJwk);
  } catch (error) {
    fail(`agentPublicJwk is not a valid public JWK: ${error.message}`);
  }
  const header = { typ: PEDIGREE_TOKEN_TYP, alg: 'Ed25519' };
  const payload = buildRootPayload(fields, agentThumbprint);
  const shape = validateTokenShape(header, payload);
  if (!shape.ok) fail(`root token fails its own shape check: ${shape.reasons.join('; ')}`);
  return signAndVerify({ header, payload, sign, publicKeyRaw: anchorRaw });
}

/**
 * Mint a child token T_(i+1) from a parent token (draft §5.1 steps
 * 2-8). `parent` is a minted token object { header, payload,
 * signingInput } or a compact string. `sign` signs with the PARENT
 * acting agent's key (the key whose thumbprint is parent cnf.jkt);
 * `parentPublicJwk` is that key — it goes in the child's header jwk
 * and re-verifies the fresh signature. `childPublicJwk` is the child
 * acting agent's key, carried as the child's cnf.jkt. `fields`:
 * client_id, aud, jti, iat, exp, grants, ceiling_ref, and optional
 * mandate, narrowing_proof, completion_bindable, nbf, status, act.
 * `parentChain` (optional, array of compacts ending with the parent)
 * is verified with verifyPedigreeChain when supplied — minting from a
 * chain that fails verification is refused (§5.1 step 1). Without it,
 * only the parent token's shape is checked; the caller must have
 * verified the chain itself. Throws on any violation.
 */
export function mintChildToken(args) {
  if (!args || typeof args !== 'object') fail('args must be an object');
  const { parent, parentChain, sign, parentPublicJwk, childPublicJwk, fields } = args;
  checkSignCallback(sign);
  if (!fields || typeof fields !== 'object') fail('fields must be an object');
  checkNoUnknownFields(fields, [
    'client_id', 'aud', 'jti', 'iat', 'exp', 'nbf', 'grants', 'mandate',
    'narrowing_proof', 'ceiling_ref', 'completion_bindable', 'status', 'act',
  ], 'child token fields');

  let parentToken;
  if (typeof parent === 'string') {
    const parsed = parsePedigreeToken(parent);
    if (!parsed.ok) fail(`parent token does not parse: ${parsed.reasons.join('; ')}`);
    parentToken = parsed;
  } else if (parent && typeof parent === 'object' && parent.header && parent.payload && parent.signingInput) {
    parentToken = parent;
  } else {
    fail('parent must be a compact token string or a minted token object { header, payload, signingInput }');
  }
  const parentShape = validateTokenShape(parentToken.header, parentToken.payload);
  if (!parentShape.ok) fail(`parent token fails its shape check: ${parentShape.reasons.join('; ')}`);
  if (Array.isArray(parentChain)) {
    const verified = verifyPedigreeChain(parentChain, args.verifyOpts || {});
    if (!verified.ok) {
      fail(`refusing to mint from a chain that fails verification (${verified.outcome}: ${verified.reasons.join('; ')})`);
    }
  }
  let parentRaw;
  try {
    parentRaw = decodeJwkPublicKey(parentPublicJwk);
  } catch (error) {
    fail(`parentPublicJwk is not a valid public JWK: ${error.message}`);
  }
  let parentThumbprint;
  try {
    parentThumbprint = jwkThumbprint(parentPublicJwk);
  } catch (error) {
    fail(`parentPublicJwk is not a valid public JWK: ${error.message}`);
  }
  if (parentThumbprint !== parentToken.payload.cnf.jkt) {
    fail('parentPublicJwk thumbprint does not equal parent cnf.jkt — the signer is not the parent acting agent (draft §4.5 invariant 5)');
  }
  let childThumbprint;
  try {
    childThumbprint = jwkThumbprint(childPublicJwk);
  } catch (error) {
    fail(`childPublicJwk is not a valid public JWK: ${error.message}`);
  }
  for (const name of ['client_id', 'jti']) checkNonEmptyString(fields[name], name);
  if (typeof fields.aud !== 'string' && !Array.isArray(fields.aud)) fail('aud must be a string or an array of strings');
  if (typeof fields.aud === 'string' && fields.aud.length === 0) fail('aud must not be empty');
  if (Array.isArray(fields.aud) && fields.aud.length === 0) fail('aud must not be an empty array');
  checkSafeInteger(fields.iat, 'iat');
  checkSafeInteger(fields.exp, 'exp');
  if (fields.nbf !== undefined) checkSafeInteger(fields.nbf, 'nbf');
  const parentPayload = parentToken.payload;
  if (fields.exp > parentPayload.exp) fail('child exp must not be later than parent exp (draft §4.5 invariant 8)');
  if (fields.iat < parentPayload.iat) fail('child iat must not be earlier than parent iat (draft §4.5 invariant 8)');
  if (fields.exp <= fields.iat) fail('exp must be later than iat');
  if (!Array.isArray(fields.grants) || fields.grants.length === 0) fail('grants must be a non-empty array');
  const grantsReasons = [];
  validateGrantsShape(fields.grants, grantsReasons);
  if (grantsReasons.length > 0) fail(`grants are malformed: ${grantsReasons.join('; ')}`);
  if (!grantsCover(parentPayload.grants, fields.grants)) {
    fail('child grants are not covered by the parent grants (draft §4.5 invariant 6)');
  }
  if (typeof fields.ceiling_ref !== 'string' || !DIGEST_RE.test(fields.ceiling_ref)) {
    fail('ceiling_ref must be "sha256:" followed by 64 lowercase hex characters');
  }
  if (Array.isArray(args.acceptedCeilings) && !args.acceptedCeilings.includes(fields.ceiling_ref)) {
    fail('ceiling_ref is not in the accepted ceiling set configured for the minter (draft §5.1 step 4)');
  }
  const narrowOpts = {
    cedarValidator: args.cedarValidator,
    proofCheckers: args.proofCheckers,
    artifactFor: args.artifactFor,
    requireNarrowingProof: args.requireNarrowingProof,
    narrowingProof: fields.narrowing_proof,
  };
  const narrowing = narrowMandate(parentPayload.mandate, fields.mandate, narrowOpts);
  if (!narrowing.narrows) {
    fail(`child mandate does not narrow the parent mandate (${narrowing.outcome}: ${narrowing.reasons.join('; ')})`);
  }
  if (fields.completion_bindable !== undefined && typeof fields.completion_bindable !== 'boolean') {
    fail('completion_bindable must be a boolean');
  }
  if (fields.act !== undefined) {
    if (!isPlainObject(fields.act) || fields.act.sub !== fields.client_id) {
      fail('act outermost sub MUST equal client_id (draft §3.1)');
    }
  }
  const payload = {
    iss: parentPayload.client_id,
    sub: parentPayload.sub,
    client_id: fields.client_id,
    aud: fields.aud,
    jti: fields.jti,
    iat: fields.iat,
    exp: fields.exp,
    cnf: { jkt: childThumbprint },
    del_depth: parentPayload.del_depth + 1,
    par_hash: pedigreeTokenDigest(parentToken.signingInput),
    parent_chain: [...parentPayload.parent_chain, parentPayload.jti],
    grants: fields.grants,
    consent_chain: [...parentPayload.consent_chain],
    ceiling_ref: fields.ceiling_ref,
  };
  if (fields.nbf !== undefined) payload.nbf = fields.nbf;
  if (fields.mandate !== undefined) payload.mandate = fields.mandate;
  if (fields.narrowing_proof !== undefined) payload.narrowing_proof = fields.narrowing_proof;
  if (fields.completion_bindable !== undefined) payload.completion_bindable = fields.completion_bindable;
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.act !== undefined) payload.act = fields.act;
  const header = { typ: PEDIGREE_TOKEN_TYP, alg: 'Ed25519', jwk: parentPublicJwk };
  const shape = validateTokenShape(header, payload);
  if (!shape.ok) fail(`child token fails its own shape check: ${shape.reasons.join('; ')}`);
  return signAndVerify({ header, payload, sign, publicKeyRaw: parentRaw });
}

// ---------------------------------------------------------------------------
// Chain verification (draft §5.3 steps 1-8; evaluation item 1)
// ---------------------------------------------------------------------------

function failResult(outcome, step, reasons, extra = {}) {
  const info = PEDIGREE_OUTCOMES[outcome] || { step, class: 'permanent' };
  return {
    ok: false,
    outcome,
    step: info.step,
    class: info.class,
    reasons,
    depth: null,
    leaf: null,
    checks: extra.checks || {},
    notEvaluated: extra.notEvaluated || ['token-status', 'consent-status'],
    mandateValidity: extra.mandateValidity || 'none',
  };
}

function normalizeTrustAnchor(entry, index) {
  // An anchor is { iss, key } where key is a JWK object, a hex string,
  // or 32 raw bytes. The root issuer id is matched to the anchor's iss
  // (draft §3.2); a root key named only by the presented chain is never
  // accepted (draft §3.3).
  if (!isPlainObject(entry) || typeof entry.iss !== 'string' || entry.iss.length === 0) {
    throw new Error(`trust anchor ${index} must be { iss, key } with a non-empty iss`);
  }
  const { key } = entry;
  if (isPlainObject(key)) return { iss: entry.iss, raw: decodeJwkPublicKey(key) };
  if (typeof key === 'string') {
    const raw = unhex(key);
    decodeStrictEd25519Point(raw);
    return { iss: entry.iss, raw };
  }
  if (key instanceof Uint8Array) {
    decodeStrictEd25519Point(key);
    return { iss: entry.iss, raw: key };
  }
  throw new Error(`trust anchor ${index} key must be a JWK object, a hex string, or 32 raw bytes`);
}

/**
 * Verify a conveyed chain T_0 ... T_n (draft §5.3). The chain is the
 * array as presented — the verifier NEVER fetches a missing ancestor
 * (§5.2); a chain with a missing ancestor fails at step 3
 * (par_hash_mismatch / linkage_invalid), it is not completed from the
 * network. Every token is verified, not only the leaf. Steps run in
 * the draft's order and verification refuses on the FIRST failure.
 *
 * opts:
 *   trustAnchors (REQUIRED, non-empty) — [{ iss, key }]; T_0 must
 *     verify under the anchor whose iss equals T_0.iss.
 *   acceptedAlgs — default ['Ed25519']. NCPS implements Ed25519 only;
 *     any other alg is refused (signature_invalid).
 *   maxTokens — default 8 (same bound as control.js grantValid depth).
 *   maxTotalSize — default 65536 bytes of compact serialization.
 *   nowUnixSeconds (REQUIRED) — verifier-supplied clock; the function
 *     never reads a clock itself, so tests are deterministic.
 *   acceptedCeilings — optional array of 'sha256:...' digests. When
 *     supplied, every ceiling_ref must be a member (else
 *     ceiling_unknown, step 7). When absent, ceiling is recorded as
 *     NOT EVALUATED.
 *   audience — optional string: the leaf aud must name it (step 9).
 *   cedarValidator, proofCheckers, artifactFor,
 *   requireNarrowingProof — passed through to narrowMandate (§8).
 *
 * Returns { ok, outcome, step, class, reasons, depth, leaf, checks,
 * notEvaluated, mandateValidity }. `outcome` is 'verified' when ok.
 * `notEvaluated` ALWAYS includes 'token-status' and
 * 'consent-status' (draft §10 — no status source exists in NCPS),
 * and includes 'ceiling' when no accepted set was configured. A
 * result with ok: true therefore means: parse, signatures, linkage,
 * shape, attenuation, and time all passed for EVERY token — and
 * nothing more.
 */
export function verifyPedigreeChain(chain, opts = {}) {
  const notEvaluated = ['token-status', 'consent-status'];
  let mandateValidity = 'none';
  const checks = {};

  if (!opts || typeof opts !== 'object') {
    return failResult('malformed', 1, ['verifier options must be an object'], { notEvaluated, mandateValidity });
  }
  if (!Number.isSafeInteger(opts.nowUnixSeconds) || opts.nowUnixSeconds < 0) {
    return failResult('malformed', 1, ['nowUnixSeconds is required and must be a safe non-negative integer'], { notEvaluated, mandateValidity });
  }
  if (!Array.isArray(chain) || chain.length === 0) {
    return failResult('malformed', 1, ['chain must be a non-empty array of compact tokens'], { notEvaluated, mandateValidity });
  }
  const maxTokens = opts.maxTokens === undefined ? PEDIGREE_DEFAULT_MAX_TOKENS : opts.maxTokens;
  const maxTotalSize = opts.maxTotalSize === undefined ? PEDIGREE_DEFAULT_MAX_TOTAL_SIZE : opts.maxTotalSize;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) {
    return failResult('malformed', 1, ['maxTokens must be a safe integer >= 1'], { notEvaluated, mandateValidity });
  }
  if (!Number.isSafeInteger(maxTotalSize) || maxTotalSize < 1) {
    return failResult('malformed', 1, ['maxTotalSize must be a safe integer >= 1'], { notEvaluated, mandateValidity });
  }
  if (chain.length > maxTokens) {
    return failResult('malformed', 1, [`chain has ${chain.length} tokens, over the configured bound of ${maxTokens} (draft §5.3 step 1)`], { notEvaluated, mandateValidity });
  }
  let totalSize = 0;
  for (const token of chain) {
    if (typeof token !== 'string') {
      return failResult('malformed', 1, ['every chain entry must be a compact token string'], { notEvaluated, mandateValidity });
    }
    totalSize += token.length;
  }
  if (totalSize > maxTotalSize) {
    return failResult('malformed', 1, [`chain is ${totalSize} bytes, over the configured bound of ${maxTotalSize} (draft §5.3 step 1)`], { notEvaluated, mandateValidity });
  }
  if (!Array.isArray(opts.trustAnchors) || opts.trustAnchors.length === 0) {
    return failResult('signature_invalid', 2, ['no trust anchors configured — refusing to verify a root without a configured anchor (draft §3.3)'], { notEvaluated, mandateValidity });
  }
  let anchors;
  try {
    anchors = opts.trustAnchors.map((entry, i) => normalizeTrustAnchor(entry, i));
  } catch (error) {
    return failResult('signature_invalid', 2, [`trust anchor configuration is malformed: ${error.message}`], { notEvaluated, mandateValidity });
  }
  const acceptedAlgs = opts.acceptedAlgs === undefined ? ['Ed25519'] : opts.acceptedAlgs;
  if (!Array.isArray(acceptedAlgs) || acceptedAlgs.length === 0) {
    return failResult('signature_invalid', 2, ['acceptedAlgs must be a non-empty array'], { notEvaluated, mandateValidity });
  }

  // Step 1 — Parse. Every token: compact JWS, typ, closed claims,
  // required claims with the right shape, JCS encoding, T_0 without
  // par_hash / narrowing_proof / header jwk, T_i with header jwk and
  // par_hash.
  const parsed = [];
  for (let i = 0; i < chain.length; i++) {
    const token = parsePedigreeToken(chain[i]);
    if (!token.ok) {
      checks.parse = { ok: false, tokenIndex: i, outcome: token.outcome };
      return failResult(token.outcome, 1, [`token ${i}: ${token.reasons.join('; ')}`], { checks, notEvaluated, mandateValidity });
    }
    const shape = validateTokenShape(token.header, token.payload);
    if (!shape.ok) {
      checks.parse = { ok: false, tokenIndex: i, outcome: 'malformed' };
      return failResult('malformed', 1, [`token ${i}: ${shape.reasons.join('; ')}`], { checks, notEvaluated, mandateValidity });
    }
    parsed.push(token);
  }
  checks.parse = { ok: true, tokens: parsed.length };

  // Step 2 — Signatures. T_0 under the trust anchor whose iss matches
  // T_0.iss; each T_i under its header jwk, whose thumbprint equals
  // T_(i-1).cnf.jkt; T_i.iss equals T_(i-1).client_id; alg on the
  // accepted list and matching the key type. EVERY token is verified.
  for (let i = 0; i < parsed.length; i++) {
    const token = parsed[i];
    if (!acceptedAlgs.includes(token.header.alg)) {
      checks.signatures = { ok: false, tokenIndex: i, outcome: 'signature_invalid' };
      return failResult('signature_invalid', 2, [`token ${i}: alg '${token.header.alg}' is not on the verifier's accepted list (draft §5.3 step 2)`], { checks, notEvaluated, mandateValidity });
    }
    let verifyingRaw;
    if (i === 0) {
      const anchor = anchors.find((a) => a.iss === token.payload.iss);
      if (!anchor) {
        checks.signatures = { ok: false, tokenIndex: 0, outcome: 'signature_invalid' };
        return failResult('signature_invalid', 2, [`token 0: no trust anchor is configured for issuer '${token.payload.iss}' (draft §3.2/§3.3)`], { checks, notEvaluated, mandateValidity });
      }
      verifyingRaw = anchor.raw;
    } else {
      const parent = parsed[i - 1];
      if (token.payload.iss !== parent.payload.client_id) {
        checks.signatures = { ok: false, tokenIndex: i, outcome: 'signature_invalid' };
        return failResult('signature_invalid', 2, [`token ${i}: iss '${token.payload.iss}' does not equal the parent client_id '${parent.payload.client_id}' (draft §5.3 step 2)`], { checks, notEvaluated, mandateValidity });
      }
      let headerRaw;
      try {
        headerRaw = decodeJwkPublicKey(token.header.jwk);
      } catch (error) {
        checks.signatures = { ok: false, tokenIndex: i, outcome: 'signature_invalid' };
        return failResult('signature_invalid', 2, [`token ${i}: header jwk is not a valid public JWK: ${error.message}`], { checks, notEvaluated, mandateValidity });
      }
      let thumbprint;
      try {
        thumbprint = jwkThumbprint(token.header.jwk);
      } catch (error) {
        checks.signatures = { ok: false, tokenIndex: i, outcome: 'signature_invalid' };
        return failResult('signature_invalid', 2, [`token ${i}: header jwk thumbprint failed: ${error.message}`], { checks, notEvaluated, mandateValidity });
      }
      if (thumbprint !== parent.payload.cnf.jkt) {
        checks.signatures = { ok: false, tokenIndex: i, outcome: 'signature_invalid' };
        return failResult('signature_invalid', 2, [`token ${i}: header jwk thumbprint does not equal the parent cnf.jkt (draft §5.3 step 2)`], { checks, notEvaluated, mandateValidity });
      }
      verifyingRaw = headerRaw;
    }
    const signatureOk = verifySigningInputSignature({
      publicKeyRaw: verifyingRaw,
      signatureBytes: token.signatureBytes,
      signingInputAscii: token.signingInput,
    });
    if (!signatureOk) {
      checks.signatures = { ok: false, tokenIndex: i, outcome: 'signature_invalid' };
      return failResult('signature_invalid', 2, [`token ${i}: signature does not verify under its key (draft §5.3 step 2)`], { checks, notEvaluated, mandateValidity });
    }
  }
  checks.signatures = { ok: true, tokens: parsed.length };

  // Step 3 — Linkage. T_0.parent_chain empty; for each i > 0 the
  // SHA-256 digest of the parent's Signing Input, compared in
  // constant time, equals T_i.par_hash (par_hash_mismatch), and
  // parent_chain / del_depth meet invariants 2 and 3
  // (linkage_invalid). This is the step that refuses a chain with a
  // missing ancestor: the conveyed parent's digest is not the one the
  // child names, and no fetch is ever attempted.
  const root = parsed[0];
  if (root.payload.parent_chain.length !== 0) {
    checks.linkage = { ok: false, tokenIndex: 0, outcome: 'linkage_invalid' };
    return failResult('linkage_invalid', 3, ['token 0: parent_chain must be empty (draft §4.5 invariant 0)'], { checks, notEvaluated, mandateValidity });
  }
  for (let i = 1; i < parsed.length; i++) {
    const token = parsed[i];
    const parent = parsed[i - 1];
    const parentDigest = pedigreeTokenDigest(parent.signingInput);
    if (!constantTimeEqualStrings(token.payload.par_hash, parentDigest)) {
      checks.linkage = { ok: false, tokenIndex: i, outcome: 'par_hash_mismatch' };
      return failResult('par_hash_mismatch', 3, [`token ${i}: par_hash does not equal the SHA-256 digest of the conveyed parent's Signing Input — the child is not bound to the parent conveyed with it (draft §5.6)`], { checks, notEvaluated, mandateValidity });
    }
    const expectedChain = [...parent.payload.parent_chain, parent.payload.jti];
    if (token.payload.del_depth !== parent.payload.del_depth + 1
      || token.payload.parent_chain.length !== token.payload.del_depth
      || JSON.stringify(token.payload.parent_chain) !== JSON.stringify(expectedChain)) {
      checks.linkage = { ok: false, tokenIndex: i, outcome: 'linkage_invalid' };
      return failResult('linkage_invalid', 3, [`token ${i}: del_depth / parent_chain is inconsistent with the chain (draft §4.5 invariants 2 and 3)`], { checks, notEvaluated, mandateValidity });
    }
  }
  checks.linkage = { ok: true, hops: parsed.length - 1 };

  // Step 4 — Shape. Every sub equals T_0.sub; every consent_chain
  // equals T_0.consent_chain.
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].payload.sub !== root.payload.sub) {
      checks.shape = { ok: false, tokenIndex: i, outcome: 'principal_altered' };
      return failResult('principal_altered', 4, [`token ${i}: sub differs from T_0.sub (draft §5.3 step 4)`], { checks, notEvaluated, mandateValidity });
    }
    if (JSON.stringify(parsed[i].payload.consent_chain) !== JSON.stringify(root.payload.consent_chain)) {
      checks.shape = { ok: false, tokenIndex: i, outcome: 'consent_altered' };
      return failResult('consent_altered', 4, [`token ${i}: consent_chain differs from T_0.consent_chain (draft §5.3 step 4)`], { checks, notEvaluated, mandateValidity });
    }
  }
  checks.shape = { ok: true };

  // Step 5 — Attenuation. Every mandate valid (§8.1); each hop's
  // grants covered by its parent (scope_widened); where the parent
  // carries a mandate, the child carries one that narrows it (§8).
  let anyMandate = false;
  for (let i = 0; i < parsed.length; i++) {
    const mandate = parsed[i].payload.mandate;
    if (mandate !== undefined) {
      anyMandate = true;
      const valid = validateMandate(mandate, opts);
      if (valid.validity === 'validator' || mandateValidity === 'none') mandateValidity = valid.validity;
      if (!valid.ok) {
        checks.attenuation = { ok: false, tokenIndex: i, outcome: 'mandate_invalid' };
        return failResult('mandate_invalid', 5, [`token ${i}: mandate is invalid: ${valid.reasons.join('; ')}`], { checks, notEvaluated, mandateValidity });
      }
    }
  }
  if (!anyMandate) mandateValidity = 'none';
  for (let i = 1; i < parsed.length; i++) {
    const token = parsed[i];
    const parent = parsed[i - 1];
    if (!grantsCover(parent.payload.grants, token.payload.grants)) {
      checks.attenuation = { ok: false, tokenIndex: i, outcome: 'scope_widened' };
      return failResult('scope_widened', 5, [`token ${i}: a child grant is not covered by a parent grant (draft §4.5 invariant 6)`], { checks, notEvaluated, mandateValidity });
    }
    const narrowing = narrowMandate(parent.payload.mandate, token.payload.mandate, {
      ...opts,
      narrowingProof: token.payload.narrowing_proof,
    });
    if (!narrowing.narrows) {
      checks.attenuation = { ok: false, tokenIndex: i, outcome: narrowing.outcome };
      return failResult(narrowing.outcome, 5, [`token ${i}: ${narrowing.reasons.join('; ')}`], { checks, notEvaluated, mandateValidity });
    }
  }
  checks.attenuation = { ok: true, hops: parsed.length - 1 };

  // Step 6 — Time. At the verifier's evaluation instant each token is
  // within its validity window, and the chain meets invariant 8.
  const now = opts.nowUnixSeconds;
  for (let i = 0; i < parsed.length; i++) {
    const payload = parsed[i].payload;
    if (payload.nbf !== undefined && now < payload.nbf) {
      checks.time = { ok: false, tokenIndex: i, outcome: 'expired' };
      return failResult('expired', 6, [`token ${i}: not yet valid (nbf ${payload.nbf}, now ${now})`], { checks, notEvaluated, mandateValidity });
    }
    if (now < payload.iat || now > payload.exp) {
      checks.time = { ok: false, tokenIndex: i, outcome: 'expired' };
      return failResult('expired', 6, [`token ${i}: outside its validity window [${payload.iat}, ${payload.exp}] at now ${now}`], { checks, notEvaluated, mandateValidity });
    }
    if (payload.exp <= payload.iat) {
      checks.time = { ok: false, tokenIndex: i, outcome: 'expired' };
      return failResult('expired', 6, [`token ${i}: exp is not later than iat — the token is never valid`], { checks, notEvaluated, mandateValidity });
    }
    if (i > 0) {
      const parent = parsed[i - 1].payload;
      if (payload.exp > parent.exp || payload.iat < parent.iat) {
        checks.time = { ok: false, tokenIndex: i, outcome: 'expired' };
        return failResult('expired', 6, [`token ${i}: time order violates invariant 8 (child exp must be <= parent exp, child iat >= parent iat)`], { checks, notEvaluated, mandateValidity });
      }
    }
  }
  checks.time = { ok: true, now };

  // Step 7 — Ceiling. Each ceiling_ref must be in the verifier's
  // accepted ceiling set. With no set configured, the ceiling is NOT
  // evaluated and the result says so.
  if (Array.isArray(opts.acceptedCeilings)) {
    for (let i = 0; i < parsed.length; i++) {
      if (!opts.acceptedCeilings.includes(parsed[i].payload.ceiling_ref)) {
        checks.ceiling = { ok: false, tokenIndex: i, outcome: 'ceiling_unknown' };
        return failResult('ceiling_unknown', 7, [`token ${i}: ceiling_ref is not in the verifier's accepted ceiling set (draft §7.1)`], { checks, notEvaluated, mandateValidity });
      }
    }
    checks.ceiling = { ok: true, evaluated: true };
  } else {
    checks.ceiling = { ok: true, evaluated: false, reason: 'no accepted ceiling set configured — ceiling not evaluated' };
    if (!notEvaluated.includes('ceiling')) notEvaluated.push('ceiling');
  }

  // Step 8 — Status. NOT EVALUATED: no Token Status List and no
  // consent status source exist in NCPS. Recorded, never claimed.
  checks.status = { ok: true, evaluated: false, reason: 'no token status list or consent status source is configured — status not evaluated (draft §10)' };

  // Step 9 (optional) — Audience. The leaf aud must name the
  // configured verifier. Only when opts.audience is supplied.
  const leaf = parsed[parsed.length - 1];
  if (opts.audience !== undefined) {
    const aud = leaf.payload.aud;
    const names = typeof aud === 'string' ? [aud] : aud;
    if (!names.includes(opts.audience)) {
      checks.audience = { ok: false, outcome: 'audience_mismatch' };
      return failResult('audience_mismatch', 9, [`leaf aud does not name the configured verifier '${opts.audience}' (draft §5.6)`], { checks, notEvaluated, mandateValidity });
    }
    checks.audience = { ok: true };
  }

  return {
    ok: true,
    outcome: 'verified',
    step: null,
    class: null,
    reasons: [],
    depth: parsed.length - 1,
    leaf: { jti: leaf.payload.jti, client_id: leaf.payload.client_id },
    checks,
    notEvaluated,
    mandateValidity,
  };
}

// ---------------------------------------------------------------------------
// Signed completion blocks (draft §9; evaluation item 3)
// ---------------------------------------------------------------------------

const COMPLETION_PAYLOAD_MEMBERS = Object.freeze([
  'jti', 'token_hash', 'status', 'result_hash', 'verification_status',
  'cost_cents', 'timestamp', 'signing_agent',
]);

function validateCompletionPayloadShape(payload, reasons) {
  if (!isPlainObject(payload)) {
    reasons.push('completion payload is not an object');
    return;
  }
  for (const key of Object.keys(payload)) {
    if (!COMPLETION_PAYLOAD_MEMBERS.includes(key)) {
      reasons.push(`completion payload has unknown member '${key}' (draft §9.2: the payload is a closed object)`);
    }
  }
  for (const name of ['jti', 'token_hash', 'result_hash', 'timestamp', 'signing_agent']) {
    if (typeof payload[name] !== 'string' || payload[name].length === 0) {
      reasons.push(`${name} must be a non-empty string`);
    }
  }
  if (typeof payload.token_hash === 'string') {
    try {
      const raw = decodeStrictBase64url(payload.token_hash);
      if (raw.length !== 32) reasons.push('token_hash must decode to 32 bytes');
    } catch {
      reasons.push('token_hash is not strict unpadded base64url');
    }
  }
  if (payload.status !== undefined && !COMPLETION_STATUSES.includes(payload.status)) {
    reasons.push(`status must be one of: ${COMPLETION_STATUSES.join(', ')}`);
  }
  if (typeof payload.result_hash === 'string' && !DIGEST_RE.test(payload.result_hash)) {
    reasons.push('result_hash must be "sha256:" followed by 64 lowercase hex characters');
  }
  if (payload.verification_status !== undefined && !COMPLETION_VERIFICATION_STATUSES.includes(payload.verification_status)) {
    reasons.push(`verification_status must be one of: ${COMPLETION_VERIFICATION_STATUSES.join(', ')}`);
  }
  if (payload.cost_cents !== undefined) {
    if (!Number.isSafeInteger(payload.cost_cents) || payload.cost_cents < 0) {
      reasons.push('cost_cents must be a safe non-negative integer');
    }
  }
  if (typeof payload.timestamp === 'string') {
    if (!RFC3339_RE.test(payload.timestamp) || Number.isNaN(Date.parse(payload.timestamp))) {
      reasons.push('timestamp must be an RFC 3339 date-time');
    }
  }
}

/**
 * Mint a completion block for a leaf token (draft §9.2). `token` is a
 * minted token object { header, payload, signingInput }. `sign` signs
 * with the LEAF acting agent's key (the key whose thumbprint is
 * token.cnf.jkt); `signerPublicJwk` is that key — it goes in the
 * block's header jwk and re-verifies the fresh signature.
 * `resultBytes` are the result bytes as delivered to the consumer;
 * result_hash is their SHA-256. Throws on any malformed field.
 */
export function mintCompletionBlock(args) {
  if (!args || typeof args !== 'object') fail('args must be an object');
  const { token, sign, signerPublicJwk, fields } = args;
  checkSignCallback(sign);
  if (!token || typeof token !== 'object' || !token.payload || !token.signingInput) {
    fail('token must be a minted token object { header, payload, signingInput }');
  }
  if (!fields || typeof fields !== 'object') fail('fields must be an object');
  checkNoUnknownFields(fields, [
    'jti', 'status', 'resultBytes', 'verification_status', 'cost_cents', 'timestamp',
  ], 'completion block fields');
  checkNonEmptyString(fields.jti, 'jti');
  if (!COMPLETION_STATUSES.includes(fields.status)) {
    fail(`status must be one of: ${COMPLETION_STATUSES.join(', ')}`);
  }
  if (!COMPLETION_VERIFICATION_STATUSES.includes(fields.verification_status)) {
    fail(`verification_status must be one of: ${COMPLETION_VERIFICATION_STATUSES.join(', ')}`);
  }
  if (!(fields.resultBytes instanceof Uint8Array)) fail('resultBytes must be bytes (Uint8Array)');
  if (typeof fields.timestamp !== 'string' || !RFC3339_RE.test(fields.timestamp)
    || Number.isNaN(Date.parse(fields.timestamp))) {
    fail('timestamp must be an RFC 3339 date-time');
  }
  if (fields.cost_cents !== undefined) checkSafeNonNegativeInteger(fields.cost_cents, 'cost_cents');
  let signerRaw;
  try {
    signerRaw = decodeJwkPublicKey(signerPublicJwk);
  } catch (error) {
    fail(`signerPublicJwk is not a valid public JWK: ${error.message}`);
  }
  let signerThumbprint;
  try {
    signerThumbprint = jwkThumbprint(signerPublicJwk);
  } catch (error) {
    fail(`signerPublicJwk is not a valid public JWK: ${error.message}`);
  }
  if (signerThumbprint !== token.payload.cnf.jkt) {
    fail('signerPublicJwk thumbprint does not equal the token cnf.jkt — the signer is not the acting agent bound to this token (draft §9.3)');
  }
  const payload = {
    jti: fields.jti,
    token_hash: pedigreeTokenDigest(token.signingInput),
    status: fields.status,
    result_hash: pedigreeDigest(fields.resultBytes),
    verification_status: fields.verification_status,
    timestamp: fields.timestamp,
    signing_agent: token.payload.client_id,
  };
  if (fields.cost_cents !== undefined) payload.cost_cents = fields.cost_cents;
  const shapeReasons = [];
  validateCompletionPayloadShape(payload, shapeReasons);
  if (shapeReasons.length > 0) fail(`completion block fails its own shape check: ${shapeReasons.join('; ')}`);
  const header = { typ: PEDIGREE_COMPLETION_TYP, alg: 'Ed25519', jwk: signerPublicJwk };
  return signAndVerify({ header, payload, sign, publicKeyRaw: signerRaw });
}

/**
 * Verify a completion block against a conveyed chain and the result
 * bytes the consumer received (draft §9.3). Steps: verify the chain
 * (steps 1-8; a chain failure passes through with its outcome);
 * token_hash must equal the digest of a token's Signing Input in that
 * chain; signing_agent must equal that token's client_id; the
 * thumbprint of the header jwk must equal that token's cnf.jkt; the
 * signature must verify; result_hash must match the supplied result
 * bytes. Never throws on a malformed block or chain — returns
 * { ok: false, outcome, reasons }.
 *
 * The result ALWAYS carries the §9.1 caveat: the block is a REPORT,
 * not an observation. `verification_status` is echoed with
 * evidenceOfCheck: false — even 'tool_verified' / 'peer_verified' /
 * 'human_verified' is the signing agent's assertion, never evidence a
 * check took place (draft §9.2: "A consumer MUST NOT treat it as
 * evidence that the check took place").
 */
export function verifyCompletionBlock(blockCompact, chain, resultBytes, opts = {}) {
  const base = {
    caveat: COMPLETION_CAVEAT,
    verification_status: null,
    evidenceOfCheck: false,
    block: null,
    token: null,
  };
  if (!(resultBytes instanceof Uint8Array)) {
    return {
      ok: false,
      outcome: 'malformed',
      reasons: ['result bytes are required to check result_hash (draft §9.3)'],
      ...base,
    };
  }
  const parsed = parseCompletionBlock(blockCompact);
  if (!parsed.ok) {
    return { ok: false, outcome: parsed.outcome, reasons: [`completion block: ${parsed.reasons.join('; ')}`], ...base };
  }
  const { header, payload } = parsed;
  const shapeReasons = [];
  for (const key of Object.keys(header)) {
    if (!['typ', 'alg', 'jwk', 'kid'].includes(key)) {
      shapeReasons.push(`header has unknown parameter '${key}'`);
    }
  }
  if (header.alg !== 'Ed25519') {
    shapeReasons.push("header alg must be 'Ed25519' (the only algorithm this NCPS implementation supports)");
  }
  if (header.jwk === undefined) {
    shapeReasons.push('header jwk is REQUIRED in a completion block (draft §9.2)');
  } else {
    try {
      decodeJwkPublicKey(header.jwk);
    } catch (error) {
      shapeReasons.push(`header jwk is not a valid public JWK: ${error.message}`);
    }
  }
  if (header.kid !== undefined && typeof header.kid !== 'string') {
    shapeReasons.push('header kid must be a string');
  }
  validateCompletionPayloadShape(payload, shapeReasons);
  if (shapeReasons.length > 0) {
    return { ok: false, outcome: 'malformed', reasons: shapeReasons, ...base };
  }
  base.verification_status = payload.verification_status;

  // The consumer holds the chain of the token the block names and
  // verifies that chain first (draft §9.3).
  const chainResult = verifyPedigreeChain(chain, opts);
  if (!chainResult.ok) {
    return {
      ok: false,
      outcome: chainResult.outcome,
      reasons: [`the chain the block names fails verification (${chainResult.outcome}: ${chainResult.reasons.join('; ')})`],
      ...base,
    };
  }
  // Re-parse the verified chain to reach the tokens' signing inputs.
  const tokens = [];
  for (const compact of chain) {
    const token = parsePedigreeToken(compact);
    tokens.push(token);
  }
  const named = tokens.find((token) => constantTimeEqualStrings(payload.token_hash, pedigreeTokenDigest(token.signingInput)));
  if (!named) {
    return {
      ok: false,
      outcome: 'completion_unbound',
      reasons: ['token_hash does not equal the digest of any token Signing Input in the verified chain (draft §9.3)'],
      ...base,
    };
  }
  if (payload.signing_agent !== named.payload.client_id) {
    return {
      ok: false,
      outcome: 'completion_unbound',
      reasons: [`signing_agent '${payload.signing_agent}' does not equal the named token's client_id '${named.payload.client_id}' (draft §9.3)`],
      ...base,
    };
  }
  let headerThumbprint;
  try {
    headerThumbprint = jwkThumbprint(header.jwk);
  } catch (error) {
    return { ok: false, outcome: 'completion_unbound', reasons: [`header jwk thumbprint failed: ${error.message}`], ...base };
  }
  if (headerThumbprint !== named.payload.cnf.jkt) {
    return {
      ok: false,
      outcome: 'completion_unbound',
      reasons: ['thumbprint of the header jwk does not equal the named token cnf.jkt (draft §9.3)'],
      ...base,
    };
  }
  let signerRaw;
  try {
    signerRaw = decodeJwkPublicKey(header.jwk);
  } catch (error) {
    return { ok: false, outcome: 'signature_invalid', reasons: [`header jwk is not a valid public JWK: ${error.message}`], ...base };
  }
  const signatureOk = verifySigningInputSignature({
    publicKeyRaw: signerRaw,
    signatureBytes: parsed.signatureBytes,
    signingInputAscii: parsed.signingInput,
  });
  if (!signatureOk) {
    return { ok: false, outcome: 'signature_invalid', reasons: ['completion block signature does not verify under the header jwk (draft §9.3)'], ...base };
  }
  if (pedigreeDigest(resultBytes) !== payload.result_hash) {
    return {
      ok: false,
      outcome: 'completion_result_mismatch',
      reasons: ['result_hash does not match the SHA-256 digest of the result bytes supplied (draft §9.3)'],
      ...base,
    };
  }
  return {
    ok: true,
    outcome: 'verified',
    reasons: [],
    ...base,
    block: {
      jti: payload.jti,
      status: payload.status,
      verification_status: payload.verification_status,
      cost_cents: payload.cost_cents,
      timestamp: payload.timestamp,
      signing_agent: payload.signing_agent,
    },
    token: { jti: named.payload.jti, client_id: named.payload.client_id },
  };
}

/**
 * Draft §9.3, last paragraph: a consumer MAY refuse results that
 * arrive without a completion block when the producing token has
 * completion_bindable set to true. This helper reports the flag; the
 * refusal itself is the consumer's decision.
 */
export function completionBlockRequired(tokenPayload) {
  if (!tokenPayload || typeof tokenPayload !== 'object') return false;
  return tokenPayload.completion_bindable === true;
}
