<!-- Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs. Author: Samuel J. Kott. Operator: SK Consulting LLC dba Numina Labs. License: BSD-3-Clause. -->

# Archive Seal v1

Author: Samuel J. Kott
Operator: SK Consulting LLC dba Numina Labs
Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
License: BSD-3-Clause (see ../LICENSE.md)

Archive Seal is the backup product from the 26 November 2026 memo. It takes a batch of existing Ed25519-signed logs, builds a hash tree, and signs the root with ML-DSA-65. Live Ed25519 signing is not modified. The tool writes a separate archive object.

## Logs it understands

1. Provenance manifests (`schemaVersion` `numina-provenance-manifest-v1`) whose `multiSignature` Ed25519 signatures verify over the repository transcript.
2. Evidence receipts of the shape in `scripts/trusted-release-evidence.mjs`: `algorithm` `Ed25519`, base64 raw public key, base64 signature over the canonical `{artifact_type, key_id, payload}`, and `key_id` equal to the first 24 hex characters of SHA-256(public key).

Any other record is rejected. A batch that fails its embedded Ed25519 checks is not sealed.

## Tree

Leaf hash: `SHA-256(0x00 || canonical JSON of the whole record)`.

Node hash: `SHA-256(0x01 || left || right)`.

An odd level duplicates the last hash. The signed header includes the ordered leaf hashes and the root, so a reordered or edited record cannot be explained away as an odd-node duplicate.

## Signed statement

The signed bytes are the ASCII prefix `ARCHIVE-SEAL-V1\n` plus the canonical JSON of the archive with `signatures` removed. ML-DSA-65 signs those bytes with FIPS 204 context `singularity/archive-seal/v1`. This is not the RFC 10073 composite. The classical signatures remain the ones already inside the logs.

Each archive signature carries `signerId`, `kid` (SHA-256 of the 1,952-byte ML-DSA-65 public key), the public key, and the signature. The verifier checks `kid` against the public key. When a policy is supplied, the `signerId` and `kid` must appear in that policy.

The threshold counts distinct `signerId` values. Two ML-DSA keys for the same person count as one person.

## Verifier results

`archive-verify` recomputes the leaves from the batch. A changed record produces `MERKLE_ROOT_MISMATCH` and, when the Ed25519 payload no longer matches, `ED25519_LOG_FAILED`. A changed archive signature produces `ML_DSA_FAILED` while the tree still matches. The verdict is `valid` only when every check passes. Archive Seal does not emit a legacy verdict: the post-quantum signature is ML-DSA-65, and the Ed25519 log signatures are inputs, not a migration mode.
