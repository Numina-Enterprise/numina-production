<!-- Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs. Author: Samuel J. Kott. Operator: SK Consulting LLC dba Numina Labs. License: BSD-3-Clause. -->

# Singularity Seal

Author: Samuel J. Kott
Operator: SK Consulting LLC dba Numina Labs
Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
License: BSD-3-Clause. This module uses the repository license. See [LICENSE.md](LICENSE.md) and [NOTICE](NOTICE).

Two offline tools:

1. **Envelope Seal** signs and verifies Singularity task envelopes, provenance transcripts, and governance policy objects with an Ed25519 + ML-DSA-65 composite (RFC 10073, FIPS 204). A composite signature verifies only when both halves verify. Legacy Ed25519 signatures are accepted only with an explicit flag, and the verdict is then `legacy`, never `valid`.
2. **Archive Seal** counter-signs batches of existing Ed25519 logs with ML-DSA-65 over a Merkle root. It does not change the logs or the live signing path.

## Read first

- [docs/ENVELOPE-SIGNATURE-SPEC-v1.md](docs/ENVELOPE-SIGNATURE-SPEC-v1.md)
- [docs/ENCODING-DIFFERENCES.md](docs/ENCODING-DIFFERENCES.md)
- [docs/ARCHIVE-SEAL.md](docs/ARCHIVE-SEAL.md)

## Library

| Piece | Implementation | Version |
|---|---|---|
| ML-DSA-65 | `@noble/post-quantum` `ml_dsa65` | 0.7.1 |
| Ed25519 | Node.js `node:crypto`, pure RFC 8032 | Node 20 or newer (repository pin is 26.13.0) |
| Composite | RFC 10073 `id-MLDSA65-Ed25519-SHA512` (`1.3.6.1.5.5.7.6.48`) | RFC 10073, November 2026 |

Install once inside this directory:

```text
npm install
```

## Commands

```text
node bin/seal.mjs --version
node bin/seal.mjs --help
node bin/seal.mjs verify --envelope envelope.json --policy policy.json
node bin/seal.mjs verify --envelope envelope.json --policy policy.json --legacy
node bin/seal.mjs verify --provenance manifest.json --seal seal.json --policy policy.json
node bin/seal.mjs archive --batch logs.json --key archive-key.json --batch-id batch-1 --out archive.json
node bin/seal.mjs archive-verify --archive archive.json --batch logs.json
```

`--version` and `--help` print the author and operator lines. The verifier prints one line per signer and a threshold line that counts distinct people, not algorithms. Exit 0 means `valid` or explicit `legacy`. Exit 1 means rejected. Exit 2 means a usage error.

SDK entry: `src/index.mjs`.

## Tests

From this directory:

```text
npm test
```

That command runs:

```text
node --test test/composite.test.mjs test/governance.test.mjs test/archive.test.mjs test/cli.test.mjs
```

`scripts/run-tests.mjs` writes the full stdout, stderr, start time, end time, and exit code to `test-results/node-test.txt`. The root `.gitignore` ignores `*.log`, so the saved result uses a `.txt` name and can be committed with the module. Tests generate throwaway keys in memory or in a temporary directory and delete that directory. Do not point the tools at operational keys. The module refuses the published authority and guardian public keys.

## Gaps relative to the memo

- Task envelopes were not encoded in the repository. This module defines that encoding. Provenance signing uses the labeled transcript, with PEM keys embedded. See the encoding note.
- Published RFC 10073 and FIPS 204 ACVP vector files are not bundled. Tests cover a frozen deterministic vector, round trips, and the negative cases in the memo's v1 list that this scope can execute.
- No latency numbers, no FIPS 140-3 validation claim, no ML-DSA-87, no SLH-DSA governance root, no phase 3.
- ML-KEM, FN-DSA, HSM support, and a hosted service are out of scope, as the memo required.
- Archive Seal uses ML-DSA-65. The memo's SLH-DSA fallback, if ML-DSA itself were broken, is not implemented.
