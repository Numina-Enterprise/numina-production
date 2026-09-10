# Economic Authorization Credential v0.1

Web release 0.2.0 · 2026-09-10 · Numina Labs · Implementation draft

This document describes the public test implementation derived from the supplied Numina architecture: an EAC, deterministic verifier, Recognition Profile, atomic commit gateway, replay-safe event state, external violation receipt, and Authority Coverage. It is not a replacement for the frozen architecture. The supplied Core v1.8 archive now provides the frozen C1–C14 names and original 20 scenarios. They are preserved in Frozen-Constitution-v0.2.md and the vendored reference. Full hosted constitutional enforcement and external standards recognition are not asserted.

## Core v1.8 reference EAC adapter

The current supplied Numina core uses a richer EAC than the separately versioned /api/v0.1 transport demo described below. POST /api/core/v1.8/eac/verify accepts exactly credentialJson (the original canonical JSON string), signatureHex (the core's 128 lowercase hex Ed25519 signature), and kid. It verifies the original Python-signed bytes without coercing large integer quantities into floating-point numbers.

The reference EAC fields are authorization_id, operation_id, principal_id, agent_id, mandate_id, asset, side, rail, max_quantity_wei, max_price_usd_minor_per_eth, max_notional_usd_minor, nonce, dependency_root, pre_state_digest, constitution_digest, issuer_id, issued_sequence, and valid_until_sequence. Integers remain exact. Signatures cover the credential alone, matching numina/eac.py and numina/canonical.py in the supplied source. The kid selects the pinned EAC test key, which is purpose-restricted in server configuration. No caller-supplied key is accepted.

The hosted test Recognition Profile accepts numina-demo, SIM_A, and the SHA-256 of the preserved v0.2 constitutional specification. Its synthetic sequence is 100, status age is at most 32, and dependency/state digests must match /api/core/v1.8/context. Validity through sequence 132 is inclusive, matching the reference. The profile further narrows execution bounds to synthetic BUY/ETH authority <= 2,000,000 minor units. Future issuance, changed dependency/state, invalid bounds and unsupported shapes fail closed. This endpoint never commits and reports kernelDecision NOT_EVALUATED; the reference kernel's ALLOW/DENY/ESCALATE remains separate from EAC outcomes.

The full core permits wider Python/Unicode/integer inputs; this public profile restricts field strings to ASCII tokens, nonnegative integers below 10^38, and fixed synthetic context. Unknown or duplicate fields and noncanonical bytes are rejected. It is a narrowed interoperability adapter, not a replacement core specification. See core-v1.8-eac.json for a credential signed by the unchanged Python implementation.

## Scope of the v0.1 transport demo

Only simulated ledger events are supported. The public test signing key is intentionally downloadable. It proves protocol behavior, not identity or economic authority. There are no financial execution adapters, funds, custody, wallet, brokerage, or employer-system integrations.

## Envelope and fields

An envelope contains exactly `credential` and `signature`. Unknown fields are rejected. Credential fields are all required:

| Field | Constraint |
|---|---|
| version | `0.1` |
| environment | `test` |
| issuer | `numina-demo` |
| subject | 1–100 ASCII letters, digits, colon, underscore or hyphen; an unauthenticated test label |
| audience | `numina-demo-gateway` |
| profile | `numina-demo-rp-0.1` |
| action | `simulate.commit` |
| resource | `demo:ledger` |
| eventId | 1–100 token characters; unique in ledger |
| nonce | 22–100 token characters; unique in ledger; generators use random UUIDs |
| issuedAt, notBefore, expiresAt | Nonnegative safe-integer Unix seconds |

`issuedAt <= notBefore < expiresAt`, and `expiresAt - issuedAt <= 600`. An expiry equal to current time is expired. No clock tolerance is applied. The server clock controls HTTP decisions.

Signature fields are exactly `alg`, `kid`, `purpose`, and `value`. Algorithm is Ed25519; purpose is `eac-test-authorization`; key ID is `numina-demo-eac-1`. Value is canonical unpadded base64url for a 64-byte signature. Verification imports only a pinned public key. Request-supplied keys, remote key URLs, algorithm negotiation, and receipt keys cannot authorize an EAC.

## Deterministic serialization

`numina-ascii-json-v0.1` is a deliberately restricted format, not a claim of full RFC 8785 support. Sort object keys lexicographically, preserve array order, use JSON string escaping, and emit no whitespace. Only printable ASCII strings, safe integers (excluding negative zero), booleans, null, arrays and plain objects are serializable. No floats or Unicode strings. The schema further narrows the permitted credential structure.

The HTTP body must equal its canonical serialization byte-for-byte. This rejects duplicate keys, alternate number forms, whitespace, invalid UTF-8, and ambiguous escaping. The UI canonicalizes edited JSON before sending it. Independent clients must do the same. The signature covers UTF-8 bytes of canonical `{ "credential": credential, "protected": { "alg": alg, "kid": kid, "purpose": purpose } }`. The signature value is excluded. The downloadable Node harness uses a separate implementation of serialization and Node crypto to demonstrate interoperability.

## Deterministic decision precedence

1. Invalid schema → `INVALID / SCHEMA_INVALID`.
2. Unknown key → `INVALID / UNTRUSTED_KEY`.
3. Key purpose or issuer mismatch → `INVALID / KEY_PURPOSE_OR_ISSUER`.
4. Revoked key → `INVALID / KEY_REVOKED`.
5. Invalid signature → `INVALID / SIGNATURE_INVALID`.
6. Unsupported version or disallowed environment/audience/issuer/action/resource → `INVALID / SCOPE_DENIED`.
7. Changed profile → `REVALIDATION_REQUIRED / PROFILE_CHANGED`.
8. Malformed time range → `INVALID / TIME_RANGE_INVALID`.
9. Future validity → `REVALIDATION_REQUIRED / NOT_YET_VALID`.
10. Expired validity → `REVALIDATION_REQUIRED / EXPIRED`.
11. Otherwise → `VALID_FOR_COMMIT / TEST_AUTHORITY_VALID`.

The HTTP layer additionally checks durable event/nonce state. A used event ID or nonce yields `INVALID / REPLAY_DETECTED`. Storage/signing failure yields HTTP 503 with `REVALIDATION_REQUIRED`. Rate limits are HTTP 429 transport errors, not authority decisions. Other transport errors use 400/413/415/405. Valid decisions use HTTP 200; invalid credential decisions use 422; revalidation uses 409.

## Gateway and receipts

`POST /api/v0.1/verify` is a snapshot: it does not reserve a nonce or guarantee a later commit. `POST /api/v0.1/commit` re-verifies and atomically inserts event ID, unique nonce, credential digest, signed receipt and timestamp in one database statement. There is no external side effect. Exactly one competing insert can succeed. Network uncertainty is resolved by retrying: the duplicate is rejected, never executed twice.

Receipts include an opaque ID, request ID, timestamp, version, profile, test-only scope, credential digest, outcome and reason. `kind` distinguishes VERIFICATION, SIMULATED_COMMIT, and VIOLATION. Receipt signatures use a separate server-held Ed25519 key with purpose `external-test-receipt`. Verify canonical `{ "receipt": receipt, "protected": signatureWithoutValue }` using `/api/v0.1/keys`. Pin the receipt public key out-of-band for stronger independence from the hosting operator.

Successful commits persist their receipts with the event. Rejected canonical credentials return signed external violation receipts and persist them while capacity permits. `persisted` and `receiptUrl` identify durable export availability. Successful non-consuming verification receipts are returned but not stored. Invalid wire data and unavailable signing/storage return structured errors without a signed receipt. Download returned receipts for independent storage. Public receipt IDs are capability-like URLs: only non-sensitive test data belongs here.

## API

GET `/api/v0.1/health`, `/status`, `/profile`, `/keys`, `/coverage`, `/conformance`, `/receipts/{id}`; POST `/api/v0.1/verify`, `/commit`. All paths after the first are under `/api/v0.1`. See the Operations and Conformance documents for limits and checks.
