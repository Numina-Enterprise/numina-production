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
node --test test/composite.test.mjs test/governance.test.mjs test/archive.test.mjs test/cli.test.mjs test/vectors.test.mjs
```

`npm run bench` writes `test-results/bench.txt` (composite keygen, sign, verify, and Archive Seal at 1000 and 10000 records), including the Node version and machine info.

`scripts/run-tests.mjs` writes the full stdout, stderr, start time, end time, and exit code to `test-results/node-test.txt`. The root `.gitignore` ignores `*.log`, so saved results use `.txt` names and can be committed with the module. Tests generate throwaway keys in memory or in a temporary directory and delete that directory. Do not point the tools at operational keys. The module refuses the published authority and guardian public keys.

Official vectors and their source commits are in [vectors/README.md](vectors/README.md). There is no FIPS 140-3 certificate. See [docs/FIPS-140-3.md](docs/FIPS-140-3.md).

## Gaps relative to the memo

- Task envelopes were not encoded in the repository. This module defines that encoding. Provenance signing uses the labeled transcript, with PEM keys embedded. See the encoding note.
- ACVP coverage is the ML-DSA-65 external pure sample groups (keyGen, deterministic and hedged sigGen, sigVer). Pre-hash and internal-interface groups, and the other ML-DSA parameter sets, were not copied.
- The RFC 10073 file contributes the `id-MLDSA65-Ed25519-SHA512` case. Its signatures are checked by verification. The file does not include the hedged ML-DSA randomness, so the signature bytes are not regenerated.
- No ML-DSA-87, no SLH-DSA governance root, no phase 3.
- ML-KEM, FN-DSA, HSM support, and a hosted service are out of scope, as the memo required.
- Archive Seal uses ML-DSA-65. The memo's SLH-DSA fallback, if ML-DSA itself were broken, is not implemented.
- This module is not FIPS 140-3 validated. See [docs/FIPS-140-3.md](docs/FIPS-140-3.md).
