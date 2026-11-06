# Project 1 — one-day KSI evidence engine

Owner: KSI workstream. Target: reviewable evidence collection, not certification or production acceptance.

This dependency-free Node module observes pinned source artifacts, creates an exact-version dependency inventory, validates imported vulnerability reports, freezes a candidate S0 boundary digest, and verifies fresh Ed25519 signing challenges. It makes no network requests, changes no cloud settings, and never reads a private key. The checked-in report is unsigned source-observation evidence.

## Run

From the repository root, using the repository-approved Node runtime:

```sh
node --test tools/one-day/ksi/evidence-engine.test.mjs
node tools/one-day/ksi/evidence-engine.mjs collect \
  --root tools/one-day/ksi \
  --config collector-config.json \
  --output /path/to/new/ksi-evidence.json
```

Use a writable `TMPDIR` for tests if the environment lacks `/tmp`. The output must be a new file; `wx` prevents overwriting existing evidence. The checked-in `observed-evidence.json` records an actual source-only run. Runtime tests generate ephemeral keys in memory and persist no private material.

The three `reference/` snapshots come from `Numina-Enterprise/numina-production` at commit `23c38e1e3a15e8f6559486ca024edb2faa3244cb`. `reference/source.json` binds each source path to its exact Git blob. The collector independently recomputes the Git blob hash and SHA-256 from bytes. Preserve line endings: the npm lockfile uses CRLF. Source commit membership is recorded from the GitHub retrieval, not independently proven by the local collector; a trusted checkout/attestation remains a separate source trust boundary.

## Observed day-one result

- The scoped `runtime/nusd/package-lock.json` contains **9 dependency entries**, all with integrity strings. This is a scoped inventory, not the entire repository SBOM or verification of package tarballs.
- No fresh vulnerability scanner report was supplied. The scan status remains blocked; no clean-CVE claim is made.
- All 20 NIST SP 800-53 families are listed for applicability review. The five backup surfaces are candidate scope from the security document, not an approved boundary. Every family remains unreviewed; restoration was not performed.
- Full source public key: `UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=`.
- Raw-key SHA-256: `3a2fe594a7e10458ae89683fdda0291af282690825be3062ef7ac2721137deff`.
- SPKI DER SHA-256: `566684c7b0915d3eac8b59642ccb06e798165ad476f2241d931fb839ca804bde`.
- This is the **source runtime candidate** key, distinct from the root AGENTS owner-authority pin (`46b301...`) and guardian pin (`465d10...`). No owner or guardian pin was replaced. Runtime trust-pin adoption needs owner confirmation and deployed binding.
- The previously supplied key ID is a prefix of the raw hash, not a full identity or KMS resource. Source pins do not prove deployed identity. No key version or fresh provider-origin proof was supplied; the runtime signer remains blocked.
- **0 KSIs are marked validated.** There is no claim that four implemented collector types satisfy two validation methods for every KSI, or that continuous collection has been established.

## Signed challenge path

Google's current algorithms page lists `EC_SIGN_ED25519` for **SOFTWARE** protection, using raw PureEdDSA input. Its HSM/HSM_SINGLE_TENANT elliptic-curve tables do not list Ed25519. This implementation rejects an Ed25519 HSM claim instead of silently downgrading or rotating the existing identity. Protection level, algorithm, import support, organizational policy and FIPS requirements require their own review.

The inspected `src/runtime-release-local.js` imports PKCS#8 bytes from `NUMINA_RUNTIME_SIGNING_KEY_DER_B64`; it does not call Cloud KMS. This engine is an offline verifier, not a replacement runtime signing adapter. Neither production signer migration nor IAM changes were attempted.

After a full approved KMS version resource is known, make a new challenge:

```sh
node tools/one-day/ksi/evidence-engine.mjs challenge \
  --audience https://numinalabs.xyz \
  --key-version projects/PROJECT/locations/LOCATION/keyRings/RING/cryptoKeys/KEY/cryptoKeyVersions/VERSION \
  --output /path/to/new/challenge.json
```

Replace placeholders with the actual resource before use. A binding must contain schema `numina.runtime-signer-binding.v1`, algorithm `EC_SIGN_ED25519`, protection level `SOFTWARE`, full `keyVersion`, public-key SPKI PEM, and a 64-byte signature encoded as standard base64. Sign the canonical challenge bytes, not a SHA-256 digest. The candidate config's approved full key version must match. Use `collect --binding <relative-path> --challenge <relative-path>`; all input paths must resolve inside `--root`.

The verifier checks key type, full SPKI fingerprint, resource version, audience, nonce shape, five-minute lifetime and signature. A successful result means cryptographic possession of that key. It **does not** establish that KMS or the deployed runtime produced the signature. Provider key metadata, audit logs, workload identity and deployed revision binding remain separate required evidence. This probe makes no operational authorization decisions and is not a persistent replay-prevention store.

## Vulnerability-report ingestion

Pass `--audit <relative-path>` with a fresh JSON envelope containing:

- `schema: numina.npm-audit-input.v1`
- `sourceLockSha256`: SHA-256 of exact lockfile bytes
- `observedAt`: scanner observation timestamp (maximum age 24 hours, five-minute future skew)
- `scanner`: name and version
- `report`: npm audit v2 JSON, including `auditReportVersion: 2` and `vulnerabilities`

The parser rejects mismatched locks, stale evidence and findings for names absent from the inventory. It preserves severity/advisory IDs without inventing vulnerability results. Importing a JSON report does not authenticate scanner execution, establish complete scanning or qualify a second KSI method. No provider scanner or paid service was provisioned.

## Standards check — 2 November 2026

| Item | Verified primary reference | Consequence |
| --- | --- | --- |
| NIST control families | [NIST RMF user guide](https://csrc.nist.gov/projects/risk-management/sp800-53-controls/public-comments-home/user-guide) | Catalog has 20 families. An 11-family boundary would need explicit applicability rationale. |
| Class C automated methods | [FedRAMP 2026 certification reference, FRC-CSX-VVK](https://preview.fedramp.gov/2026/reference/fedramp-certification/#automated-verification-and-validation-of-key-security-indicators) | Official preview-hosted reference inspected states at least two automated methods per KSI for Class C, dated 13 October 2026. Confirm the adopted ruleset with the assessor before treating this collector's local policy as the official schema. |
| Current 20x program | [FedRAMP 20x](https://www.fedramp.gov/20x/) | Public program page says Classes A, B and C are available. This sprint makes no blanket January 2027 mandate claim. |
| Ed25519 KMS support | [Cloud KMS algorithms](https://docs.cloud.google.com/kms/docs/algorithms) | SOFTWARE Ed25519 raw-data signing is listed; HSM support cannot be assumed. |

## Release gate and next handoff

`releaseGate` intentionally stays `blocked`. Before production use: approve S0 scope with reviewer/evidence references; produce and assess restore receipts; run authenticated dependency scans; supply full signer/KMS/deployment evidence; map each applicable KSI to validated methods and exceptions; obtain the applicable independent assessment. A local digest or passing unit test cannot satisfy those requirements.

12 tests exercise invalid signatures, key/resource/audience substitution, expiry, unsupported HSM claims, stale or wrong-lock scanner input, source tampering, path escape, malformed canonical values and boundary self-approval. Full repository CI and deployed collection are separate checks.
