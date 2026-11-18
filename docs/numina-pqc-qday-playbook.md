# Q-Day Playbook — Sudden-Change Response for the Singularity Protocol

Status: part of the hybrid PQC build (the next protocol change after tagged
v5.0.0). Mechanism only — no speculation, no predictions about when or
whether any algorithm breaks.

Pinned in `numina-protocol.json` under `postQuantum.qDayPlaybook`; this note
is the human-readable form of the same steps. The protocol file is the
authority; if they ever disagree, the protocol file wins and this note is
corrected.

## What "sudden change" means here

Any one of these conditions, when it is established by a receipt (a
published break, a NIST standards change, or a verified implementation
finding) — not by rumor:

1. Ed25519 is broken (signature forgery becomes feasible).
2. ML-DSA-65 or ML-KEM-768 is broken (signature forgery, or key
   recovery / decapsulation failure becomes feasible).
3. A standards body supersedes FIPS 203 or FIPS 204 for the levels used
   here (ML-KEM-768 / ML-DSA-65).

Until one of those is established, nothing in this playbook is executed.
The hybrid construction already assumes either layer alone could break:
verification requires BOTH signatures, so a break in one layer alone does
not silently void verification — it fails closed.

## Steps, in order

1. **Stop signing with the affected algorithm.** No new hybrid signatures
   are created until replacement keys exist. Verification of existing
   records continues against the pinned keys; a break does not retroactively
   un-verify a record that was valid when signed, but no new record is
   trusted on the broken layer alone.
2. **Provision replacement keys.** The owner generates the replacement
   keypair (ML-DSA-65 and/or ML-KEM-768, as the break requires) and pins
   the new public key in `numina-protocol.json` as SPKI DER hex, under a
   NEW `keyId`. No agent generates Authority or Guardian keys. The old
   key stays pinned alongside the new one — old keys are never deleted,
   because historical records verify against them.
3. **Bump the version.** `postQuantum.cryptoAgility.pqcSchemaVersion`
   (and `productionVersion`) are bumped so old and new algorithms are
   distinguishable by version, never by guessing. The record format does
   not change: a future algorithm lands by a version bump plus new pinned
   keys.
4. **Re-sign live records.** Every live record is re-signed with the
   hybrid signer (`src/numina-protocol-pqc.js`, `signHybridAsRole`) over
   the SAME RFC 8785 canonical bytes. The hybrid signer re-verifies the
   fresh signature before returning it, and refuses a role whose PQC key
   is unprovisioned.
5. **Re-run the full suite.** `npm test` under Node 26.13.1 must pass in
   full, with exact counts reported. No test is weakened to make a broken
   algorithm pass; a failing test stops the step (universal error rule:
   stop, record the exact error, do not continue).
6. **Cut a new release.** A protocol change means a new release after
   v5.0.0. The release cut, tag, and push are the owner's call — no agent
   commits, tags, pushes, or deploys.

## What does not change in a sudden change

- The classical Ed25519 layer is retained alongside every PQC layer
  (hybrid, never PQC-only).
- The byte layouts stay big-endian (see `endianness` in
  `numina-protocol.json`); the labeled exceptions stay labeled — the
  primitives' own encodings (Ed25519 little-endian per RFC 8032,
  ML-KEM/ML-DSA per FIPS 203/204) are never re-encoded.
- The Genesis guardrail still applies: a Murph record must name the
  pinned chain id (962421430) and genesis.
- The 726e state-root quarantine is untouched by this playbook; it is
  lifted only by the owner's explicit decision, never as a side effect
  of a key rotation.

## Pointers

- Signatures: `src/numina-protocol-pqc.js`; tests:
  `tests/numina-protocol-pqc.test.mjs`
- Key exchange: `src/numina-protocol-kex.js`; tests:
  `tests/numina-protocol-kex.test.mjs`
- E2EE profile: `numina-e2ee-x25519-mlkem768-hkdf-aes256gcm-ed25519-mldsa65-v1`
  (pinned in `numina-protocol.json`, `postQuantum.hybridKeyExchange`)
- Sizes (measured on Node 26.11.1 / OpenSSL 3.5.9): ML-DSA-65 signature
  3,309 bytes; ML-DSA-65 public key 1,952 bytes raw / 1,974 SPKI DER;
  ML-KEM-768 ciphertext 1,088 bytes; hybrid bundle 3,383 bytes.
