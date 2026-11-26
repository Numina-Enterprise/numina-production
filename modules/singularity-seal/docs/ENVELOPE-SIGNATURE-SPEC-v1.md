<!-- Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs. Author: Samuel J. Kott. Operator: SK Consulting LLC dba Numina Labs. License: BSD-3-Clause. -->

# Envelope Signature Spec v1

Author: Samuel J. Kott
Operator: SK Consulting LLC dba Numina Labs
Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
License: BSD-3-Clause (see ../LICENSE.md)

Module: `@numina/singularity-seal` 1.0.0
Suite: `COMPSIG-MLDSA65-Ed25519-SHA512`
OID: `id-MLDSA65-Ed25519-SHA512` = `1.3.6.1.5.5.7.6.48` (RFC 10073)
Classical half: pure Ed25519, RFC 8032, via Node.js `crypto.sign(null, message, key)`
Post-quantum half: ML-DSA-65, FIPS 204, via `@noble/post-quantum` 0.7.1 (`ml_dsa65`)

This spec is the v1 signature block for Singularity task envelopes, provenance sidecars, and governance policy objects. Differences from the 26 November 2026 product memo are listed in [ENCODING-DIFFERENCES.md](ENCODING-DIFFERENCES.md).

## 1. Object bytes

Canonical JSON matches `canonicalizeJson` in `numina-doc-alignment/src/provenance-verifier.mjs`: object keys sorted by UTF-16 code unit, no whitespace, UTF-8, no BOM, arrays kept in order, `__proto__`, `constructor`, and `prototype` rejected, non-finite numbers rejected.

The signed message `M` depends on the object:

| Object | `objectType` | `ctx` | Message `M` |
|---|---|---|---|
| Task envelope | `task-envelope` | `singularity/task-envelope/v1` | Canonical JSON of the envelope with `signatures` removed |
| Provenance sidecar | `provenance-record` | `singularity/provenance-record/v1` | The existing transcript below |
| Governance policy | `governance-policy` | `singularity/governance-policy/v1` | Canonical JSON of the policy with `signatures` removed |

Provenance transcript, unchanged from the repository verifier:

```text
NUMINA-PROVENANCE-MANIFEST-V1
<lowercase hex SHA-256 of the canonical payload>
<canonical payload>
```

The canonical payload is the manifest with `multiSignature`, `clusterStateRootSha256`, and `manifestSha256` removed. The sidecar is a separate file. It is not inserted into the manifest, because the existing verifier would then hash the new field and the state root would no longer match.

A task envelope carries the six coordination components: `identity`, `topology`, `task`, `evidence`, `signatures`, and protocol version `v`. `objectType` is included in the signed body so a signature cannot be moved onto another object type.

## 2. Composite message

RFC 10073 section 2 and section 3, suite `id-MLDSA65-Ed25519-SHA512`:

```text
M' = Prefix || Label || len(ctx) || ctx || SHA-512(M)
```

- `Prefix` is the ASCII string `CompositeAlgorithmSignatures2025` (32 bytes).
- `Label` is the ASCII string `COMPSIG-MLDSA65-Ed25519-SHA512` (31 bytes).
- `len(ctx)` is one unsigned byte. `ctx` is at most 255 bytes.
- `SHA-512(M)` is the raw 64-byte digest, not hex.

ML-DSA-65 signs `M'` with its FIPS 204 context string set to `Label`. Ed25519 signs `M'` with pure Ed25519 and no Ed25519 context. The signature value is `mldsaSig || edSig` (3,309 + 64 = 3,373 bytes). The public key is `mldsaPublic || edPublic` (1,952 + 32 = 1,984 bytes). `kid` is the lowercase hex SHA-256 of those 1,984 bytes.

Verification succeeds only when both component checks succeed over the same `M'`. A short signature, a flipped ML-DSA byte, or a flipped Ed25519 byte rejects the composite. There is no single-component success mode.

## 3. Signature block

JSON field names are camelCase, matching the provenance verifier. The memo's `suite_oid` is `suiteOid` here. Unknown aliases are not accepted.

Composite block:

```json
{
  "v": 1,
  "suite": "COMPSIG-MLDSA65-Ed25519-SHA512",
  "suiteOid": "1.3.6.1.5.5.7.6.48",
  "kid": "<64 hex chars, SHA-256 of the 1984-byte composite public key>",
  "signerId": "<person id>",
  "role": "<role, must match the policy registry>",
  "ctx": "<object ctx from section 1>",
  "sig": "<base64 of 3373 bytes>"
}
```

Legacy block, accepted only with an explicit legacy flag:

```json
{
  "v": 1,
  "suite": "Ed25519",
  "suiteOid": "1.3.101.112",
  "kid": "<64 hex chars, SHA-256 of the 32-byte raw Ed25519 public key>",
  "signerId": "<person id>",
  "role": "<role, must match the policy registry>",
  "ctx": "<object ctx from section 1>",
  "sig": "<base64 of 64 bytes>"
}
```

Legacy Ed25519 signs `M` itself (the envelope body, the provenance transcript, or the governance body), not `M'`. `ctx` is still checked against the object type.

## 4. Verification rule

1. Recompute `M` from the object. Do not trust a stored digest without checking it.
2. Resolve `kid` in the policy registry. The registry binds `kid` to one `signerId` and one `role`. A signature whose `signerId` or `role` disagrees is rejected. A valid signature does not grant a role.
3. Composite: both components must pass. Verdict for that signer is `valid`, and it counts as one person.
4. Legacy: if the Ed25519 check passes and the caller did not set legacy acceptance, the verdict is `invalid` and the reason is `LEGACY_NOT_ACCEPTED`. The word `legacy` is not used as a success verdict.
5. Legacy with the explicit flag, phase 0 or phase 1, and a policy that counts that object type: the signer verdict is `legacy` (never `valid`). It counts as one person.
6. Phase 2 rejects legacy even when the flag is set (`LEGACY_REJECTED_BY_PHASE`).
7. Governance policy objects never count legacy signatures (`LEGACY_REJECTED_FOR_GOVERNANCE`).
8. The document verdict is `valid` only when the threshold is met and every accepted signature is composite. If any accepted signature is legacy, the document verdict is `legacy`. Otherwise the verdict is `invalid`.

## 5. Thresholds

A k-of-n check counts distinct `signerId` values among accepted signatures. `n` is the number of people in the registry. One person with a composite signature, a legacy signature, or both, counts as one. A second copy of the same person's signature counts as zero more. Component algorithms are not signers.

## 6. Keys

Composite keys are generated as a fresh ML-DSA-65 seed and a fresh Ed25519 seed. An Ed25519 seed marked as already used alone is refused. The published authority and guardian public keys in the provenance verifier are refused. Private seeds are not printed by the CLI.

ML-DSA signing defaults to hedged FIPS 204 entropy. Tests and the `--deterministic` flag set `extraEntropy: false` so the known-answer vector is stable. Verification accepts either mode.

## 7. Sizes

| Item | Bytes |
|---|---|
| Composite public key | 1,984 |
| Composite signature | 3,373 |
| Legacy Ed25519 public key | 32 |
| Legacy Ed25519 signature | 64 |

Base64 text is longer than these binary sizes. One machine measurement is written by `npm run bench` to `test-results/bench.txt`. That file is not a cross-platform latency guarantee.

## 8. Migration

| Phase | Acceptance |
|---|---|
| 0 | Ed25519 only, and only with the explicit legacy flag. Verdict `legacy`. |
| 1 | Composite signatures verify as `valid`. Legacy signatures verify as `legacy` only with the flag, and only for object types listed in `legacyCountsFor`, never for governance. |
| 2 | Composite required. Legacy is rejected even with the flag. |

Phase 3 (ML-DSA without Ed25519) is out of v1.

## 9. What this spec does not do

No ML-KEM, no FN-DSA, no SLH-DSA, no ML-DSA-87, no HSM, no hosted registry, no change to treasury code, and no replacement of the existing provenance governance gates. The policy file carried with the signature is the registry. This module is not FIPS 140-3 validated. See [FIPS-140-3.md](FIPS-140-3.md). NIST ACVP ML-DSA-65 samples and the RFC 10073 Ed25519 composite vector are under `vectors/`.
