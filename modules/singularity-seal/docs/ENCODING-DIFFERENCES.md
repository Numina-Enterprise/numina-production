<!-- Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs. Author: Samuel J. Kott. Operator: SK Consulting LLC dba Numina Labs. License: BSD-3-Clause. -->

# Encoding differences from the 26 November 2026 memo

Author: Samuel J. Kott
Operator: SK Consulting LLC dba Numina Labs
Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs

The memo marked its envelope layout as an assumption because the repository scan was still open. This module uses the encodings that are actually in the tree at `origin/main` `c0f8e50799b337724a2ad75bbd13baac4ac3b84f`.

## Task envelopes

The memo assumed a task envelope type with a canonical byte encoding. The coordination model (`docs/protocols/singularity-coordination-model.md`) names six components (identity, topology, task, evidence, signatures, protocol version) and says the task-envelope design still needs implementation. No encoder, schema, or signature field for that object exists in the repository.

Envelope Seal therefore defines the first concrete encoding, in [ENVELOPE-SIGNATURE-SPEC-v1.md](ENVELOPE-SIGNATURE-SPEC-v1.md). The canonicalizer is the same algorithm as `numina-doc-alignment/src/provenance-verifier.mjs` (`canonicalizeJson`), copied into this module so the module does not edit that file. `objectType` is part of the signed body. The memo did not include that field. It stops a signature over one object from being replayed as another.

## Provenance records

These are implemented. `numina-doc-alignment/src/provenance-verifier.mjs` does all of the following:

- Canonicalize the payload with sorted keys and no whitespace.
- Drop `multiSignature`, `clusterStateRootSha256`, and `manifestSha256` before hashing.
- Set the state root to the hex SHA-256 of that canonical payload.
- Sign this transcript with pure Ed25519 (`crypto.sign(null, transcript, key)`), not Ed25519ph:

```text
NUMINA-PROVENANCE-MANIFEST-V1
<state root hex>
<canonical payload>
```

- Store signatures as hex on `multiSignature.signers[].signatureHex`.
- Embed each public key as PEM (`publicKeyPem`) and also store `keyId` and `role`.
- Tag the group with `algorithm: "ed25519"`.

The memo's assumption (b), pure Ed25519, matches. Assumption (a) matches only after the three signature and hash fields are removed, and the signed bytes are the labeled transcript, not the raw canonical JSON and not SHA-512 of that JSON. Assumption (c), keys referenced only by id, does not match: the PEM is embedded.

Envelope Seal signs that same transcript. The composite prehash (SHA-512 inside RFC 10073 `M'`) is applied to the transcript. The Ed25519 half of the composite therefore signs `M'`, not the historical transcript. Existing Ed25519 signatures stay in `multiSignature`. The composite result is a sidecar file. Putting it inside the manifest would change the state root and break the existing verifier.

A second Ed25519 log shape also exists. `scripts/trusted-release-evidence.mjs` signs the canonical form of `{artifact_type, key_id, payload}` and stores `algorithm`, `public_key` (base64 of the raw 32-byte key), and `signature` (base64). `key_id` is the first 24 hex characters of SHA-256(raw public key). Archive Seal verifies that shape as well. Envelope Seal does not replace `verifyReleaseEnvelope`.

## Composite construction

The memo's RFC 10073 construction is implemented as published: prefix `CompositeAlgorithmSignatures2025`, label `COMPSIG-MLDSA65-Ed25519-SHA512`, one-byte context length, SHA-512 of `M`, ML-DSA context equal to the label, Ed25519 over `M'` with no Ed25519 context, signature `mldsaSig || edSig`. The OID is `1.3.6.1.5.5.7.6.48`.

JSON names use camelCase (`suiteOid`) because that is the style of the provenance verifier. The memo wrote `suite_oid`.

## What stayed out

The memo's v1 cuts still hold: no ML-KEM, no FN-DSA, no HSM, no hosted service. SLH-DSA for a governance root and ML-DSA-87 are not in this module. The full RFC 10073 published test-vector files and the FIPS 204 ACVP files are not embedded. The suite has a deterministic known-answer vector for this module's seeds, plus round-trip and negative tests. No hardware latency number is claimed. `@noble/post-quantum` 0.7.1 is the same version the repository already pins for FN-DSA. It is not a FIPS 140-3 module.
