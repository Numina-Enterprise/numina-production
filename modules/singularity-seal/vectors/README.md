<!-- Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs. Author: Samuel J. Kott. Operator: SK Consulting LLC dba Numina Labs. License: BSD-3-Clause. -->

# Vendored test vectors

Author: Samuel J. Kott
Operator: SK Consulting LLC dba Numina Labs
Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs

These files are subsets copied from public sources. No vector was invented here. Hex and base64 fields are the upstream strings.

## NIST ACVP, ML-DSA-65, FIPS 204

Repository: https://github.com/usnistgov/ACVP-Server
Commit: `975de31eb83d87039ec88934fdc47d8c312b892d` (master at the time of the copy, message `RELEASE/v1.1.0.43 including hotfix patches`, 2026-08-12)

| File in this directory | Upstream files | What was copied |
|---|---|---|
| `acvp-mldsa65-keygen.json` | [prompt.json](https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-keyGen-FIPS204/prompt.json) and [expectedResults.json](https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-keyGen-FIPS204/expectedResults.json) | All 25 tests in test group `tgId` 2, `parameterSet` `ML-DSA-65`. Each row joins `seed` from the prompt to `pk` and `sk` from the expected results. |
| `acvp-mldsa65-siggen.json` | [prompt.json](https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-sigGen-FIPS204/prompt.json) and [expectedResults.json](https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-sigGen-FIPS204/expectedResults.json) | `tgId` 3 (deterministic, external, pure, 15 tests) and `tgId` 15 (hedged, external, pure, 15 tests). The signature comes from the expected results. |
| `acvp-mldsa65-sigver.json` | [prompt.json](https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-sigVer-FIPS204/prompt.json) and [expectedResults.json](https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-sigVer-FIPS204/expectedResults.json) | `tgId` 3, external pure, all 15 tests, including `testPassed`. |

Not copied: ML-DSA-44, ML-DSA-87, and the sigGen/sigVer groups whose `preHash` is `preHash` or whose `signatureInterface` is `internal`. Those groups are still in the upstream files. This module signs and verifies pure external ML-DSA-65, which is the FIPS 204 operation RFC 10073 uses inside the composite.

SHA-256 of the upstream files that were read:

| Upstream file | SHA-256 |
|---|---|
| keyGen prompt.json | `43e81ad820e495dbcad086fe27c1008393a8c32100bbbff77c558c3f06dcefef` |
| keyGen expectedResults.json | `361f47ca19d592adcc66ff2cb591686ad785fea157b295648738bed6921a68df` |
| sigGen prompt.json | `447749d72817b211160d243311ce32302f3023e59c355b0f70be2bd3e9e7830d` |
| sigGen expectedResults.json | `228d011bbe274aeb93e22eea1e0d57b78f43795cf6a64fb5ef1e626485a0bedb` |
| sigVer prompt.json | `e2cba4589389756fa0bea1a7e6837138bf0a81f9d14234c9ee8f6d33caa1654e` |
| sigVer expectedResults.json | `e1d84ef1b2f35196278ab0b0ed6a46ec62cc03d2dfa92c564199e1999bfb8ea6` |

## RFC 10073 composite, ML-DSA-65 + Ed25519

Repository: https://github.com/lamps-wg/draft-composite-sigs
Commit: `7b2bf64dc4a7df710c19ca330adc15a4163100bb` (main at the time of the copy, 2026-11-23)
File: [src/testvectors.json](https://github.com/lamps-wg/draft-composite-sigs/blob/7b2bf64dc4a7df710c19ca330adc15a4163100bb/src/testvectors.json)
SHA-256 of that file: `a60f697f9fd94c3cd5e4501a40c4396d9a9ffc7cf0f8a1ddd87dedbb46a7abf0`
RFC: https://www.rfc-editor.org/rfc/rfc10073

`rfc10073-mldsa65-ed25519.json` keeps the shared `m` and `ctx` and the one test whose `tcId` is `id-MLDSA65-Ed25519-SHA512`. The other algorithms in `testvectors.json` were not copied. `s` is the empty-context signature. `sWithContext` uses `ctx`. The private key is the 32-byte ML-DSA seed followed by the 32-byte Ed25519 seed. The published signatures verify. They are not regenerated here, because the ML-DSA half in that file is hedged and the file does not publish the randomness.
