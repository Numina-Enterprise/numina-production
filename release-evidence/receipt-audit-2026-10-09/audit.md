Receipt audit — 2026-10-09

Local audit completed at 2026-10-09T11:40:35.872Z. Three stored Ed25519 envelopes were checked using the established repository runtime pin.

Key ID: 3a2fe594a7e10458ae89683f. Public-key OpenSSH representation fingerprint: SHA256:SX1kLMVocoZEblbGF2MSx7Rl/3kYvIpUuQM9CQ1bUJU.

Signature checks: PASS. Tamper-negative checks: PASS.

| Artifact | Signed type | Signature | Altered payload | Recorded runtime |
| --- | --- | --- | --- | --- |
| docs/runtime-pin-reconciliation-2026-09-15.json | NUMINA_RELEASE_ATTESTATION | PASS | Rejected | 1.9.0-rc26 |
| docs/runtime-pin-reconciliation-2026-09-16.json | NUMINA_RELEASE_ATTESTATION | PASS | Rejected | 1.9.0-rc26 |
| release-evidence/frontier-readiness-19c445b.json | NUMINA_FRONTIER_READINESS | PASS | Rejected | 1.9.0-rc26 |

The complete signed records describe rc26. The current repository expects rc27. Historical signatures remain valid; they do not prove current runtime deployment.

5 incomplete Ed25519 summaries cannot be signature-verified. No saved NUMINA_DEPLOYMENT_RECEIPT was found in the checked evidence. The NUSD deployment records are unsigned chain observations.

The documentation/runtime NUSD receipt copies are different. 2 parsed field differences were found; the runtime copy adds externalSettlement.declared=true and externalSettlement.canonicalReceipt=runtime/nusd/settlement-receipt.json. Their original bytes and separate hashes are retained.

The linked settlement receipt is an unsigned native declaration. It reports external settlement and reserves unverified, with no bank or provider receipt.

Fresh authenticated Sites readback reports version 160, deployment appgdep_6ac7895a86988191a154ac75d0a85b87, status succeeded, updated 2026-10-08T12:16:24.203432+00:00.

Source commit: 037ac3dba3bf4691a2aae009205d373ae0b0ebbe. Provider archive digest: sha256:f01756b52f568a4ef550ae89142d448360f70f54c332041bc897da8793f8c41b.

Those are authenticated provider records, not an Ed25519-signed deployment envelope. No production health request or archive-byte hashing was performed.

The separate public-key registry and signing-status references were unavailable. Registry role approval and private-signer custody remain unknown. No key was generated, rotated, exported or used to sign.

Original input snapshots, the public-key representation, provider observations and detailed hashes are retained alongside audit.json. Originals in the repository were left unchanged.

Next verifiable step: Obtain the existing complete signed deployment envelope for Sites version 160 (or identify the intended deployment), then verify its signature and source/artifact/deployment binding.
