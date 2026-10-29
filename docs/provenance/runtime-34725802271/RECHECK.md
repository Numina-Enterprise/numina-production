# Recheck the historical runtime subjects

The original `completion-record.json` retains its original bytes and its three per-file exit codes. It is an unsigned index. One builder-signed DSSE statement covers all three subjects, so identical signed-statement content in their verification outputs is expected.

`verification-recheck-2026-09-14.json` records a fresh authenticated GitHub CLI run for each file, including the exact verified artifact digest, separate command exit code and output digest. Its referenced output files contain the original signed statement and the verifier's result. The commands all exited 0 and passed the explicit source, builder, ref, issuer, predicate and GitHub-hosted-runner checks. Neither the original completion index nor this observation is a newly signed builder attestation.

From the repository root, use the current authenticated GitHub CLI and retained original subject files:

```text
node scripts/verify-completion-record.mjs --completion /path/to/original/completion-record.json --bundle /path/to/original/provenance.jsonl --gh /path/to/gh --output-dir /path/to/new-observation
```

The output directory must be new and separate from the historical inputs. The verifier enforces the pinned NUSD build source and signer, hashes every subject independently, invokes GH separately without a shell, and retains actual stdout/stderr bytes and exit codes. It continues to record the remaining subjects when one fails, but exits unsuccessfully unless all three verify.

These historical NUSD build signatures do not sign new application or NVIDIA adapter bytes. They establish no live GPU endpoint, NGC account permission, NVIDIA license entitlement, reserves, mint, bank transfer or settlement. The rc26 and application artifacts retain their own distinct source and builder bindings within the singular Numina architecture.
