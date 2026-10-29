# Numina receipt audit — 2026-10-09

The audit completed with findings. Three retained Ed25519 envelopes verified against the established runtime public key, and all three rejected altered payloads. Five summaries lack complete signed bodies. No complete `NUMINA_DEPLOYMENT_RECEIPT` was found in the checked evidence.

The audited canonical repository was at commit `20cdc916dbe9e39a8a498d7cc9782ddf27f6705b`. The audit checked 192 JSON files under `docs`, `release-evidence`, `public`, `runtime`, and `config`, excluding fixture, vendor, archive and dependency directories. It did not generate a key, issue an operational signature, or modify source receipts.

## Signature evidence

Numina's `square_root`, canonical source and routing tree root resolve to `NUMINA`, with `ROOT_TO_LEAVES` propagation. `numina-production` remains the source of record; provider publication metadata records downstream delivery.

The raw Ed25519 public key is `UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=`, with key ID `3a2fe594a7e10458ae89683f`. Its OpenSSH public representation has fingerprint `SHA256:SX1kLMVocoZEblbGF2MSx7Rl/3kYvIpUuQM9CQ1bUJU`. This identifies the repository runtime verification pin; the separate signing-role registry was unavailable and private-signer custody was not tested.

| Retained artifact | Signed type | Signature | Altered payload | Recorded runtime |
| --- | --- | --- | --- | --- |
| `docs/runtime-pin-reconciliation-2026-09-15.json` | `NUMINA_RELEASE_ATTESTATION` | Valid | Rejected | rc26 |
| `docs/runtime-pin-reconciliation-2026-09-16.json` | `NUMINA_RELEASE_ATTESTATION` | Valid | Rejected | rc26 |
| `release-evidence/frontier-readiness-19c445b.json` | `NUMINA_FRONTIER_READINESS` | Valid | Rejected | rc26 |

The signed bytes are canonical UTF-8 JSON of `{artifact_type,key_id,payload}`, with sorted object keys and compact separators. Node crypto, the repository's Node and WebCrypto verifiers, and an independent Python cryptography check passed. Each complete source artifact and canonical signed-body digest is recorded in the audit bundle.

These signatures authenticate historical statements. The canonical repository expected rc27 at audit time, while the three complete retained envelopes describe rc26. Their valid signatures do not establish a current rc27 deployment, current runtime health, or external financial settlement.

## Deployment observations

Authenticated Sites readback at `2026-10-09T11:36:10.204Z` reported saved version **160** and a successful publication:

- Project: `appgprj_6aa1a5988258819196abc45e9ac02796`.
- Deployment: `appgdep_6ac7895a86988191a154ac75d0a85b87`, updated `2026-10-08T12:16:24.203432+00:00`.
- Source commit: `037ac3dba3bf4691a2aae009205d373ae0b0ebbe`.
- Provider archive digest: `sha256:f01756b52f568a4ef550ae89142d448360f70f54c332041bc897da8793f8c41b`.
- Deployment URL: <https://personal-space-m7q9.skott34.chatgpt.site>.

This is a dated authenticated provider observation, without an Ed25519 envelope. The archive bytes were not independently hashed. The API did not expose a separate current live version ID, and no runtime health request was performed. Later publications must retain their own source, archive and deployment observations; they do not change this historical audit.

## Receipt-copy findings

The two nUSD deployment receipt copies have different original bytes:

| Source | Bytes | SHA-256 |
| --- | --- | --- |
| `docs/nusd/deployment-receipt.json` | 3,726 | `d44b863bd9a0a68fe06f69a8439c2fa01204e4ada1c93e0fb29936731728427a` |
| `runtime/nusd/deployment-receipt.json` | 3,812 | `6d7d2a3c3f4ee9fe2b95f02a5abf000626bd2e66735bedb0ab78f81883b86e53` |

Only the runtime copy contains `/externalSettlement/declared: true` and `/externalSettlement/canonicalReceipt: "runtime/nusd/settlement-receipt.json"`. The linked record is an unsigned native declaration: it explicitly reports external settlement and reserves unverified, with no bank or provider receipt. The audit preserves both variants and does not reconcile them by changing their bytes.

## Retained audit record

The canonical Numina tree retains the complete `audit.json`, original artifact snapshots under `evidence/`, public-key representation, provider observations, report checksum and independent verification in `release-evidence/receipt-audit-2026-10-09/`. These paths identify the source-of-record artifacts; this dated audit makes no claim that another hosting surface has received them.

The captured `run-receipt-audit.mjs` is the exact historical audit program, with its hash bound in the report. It uses absolute paths from the original managed workspace and is retained as execution evidence. Its exit code 1 records the receipt-copy finding; the three signature checks and tamper-negative checks passed.

From the audit bundle directory, verify the report bytes with `sha256sum -c audit.json.sha256`. Signature verification uses the original snapshots under `evidence/`, not any later rewritten projection. The report and independent verification are unsigned audit records; they do not create a new deployment receipt.

**Next verifiable step:** obtain the complete signed deployment envelope for the intended publication, then verify the established public-key signature and match its deployment ID, source commit, artifact digest, target and environment to authoritative deployment records.
