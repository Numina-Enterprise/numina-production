# Post-quantum follow-up plan (dated)

Created Nov 9 2026. Owner for every item: Sam Kott (owner, SK Consulting LLC dba Numina Labs)
unless reassigned. Dates are proposed targets, not commitments.

| # | Item | Proposed date | Acceptance test |
|---|---|---|---|
| 1 | Generate SKOTT34 PQ keys on Vengeance (default set) and commit public keys | Before the 5.0.0 push | `node scripts/release-verify.mjs` passes in CI with Ed25519 + ML-DSA-65/87 + SLH-DSA-SHA2/SHAKE-128s + FN-DSA-512/1024 |
| 2 | Record public key fingerprints out of band (password manager + offline backup log) | Same day as item 1 | Fingerprints match `Get-FileHash release-evidence\pubkeys\*` |
| 3 | FN-DSA / Falcon: re-check when NIST publishes final FIPS 206 | Review quarterly; first review Feb 9 2027 | Library release notes state FIPS 206 conformance; known-answer tests from the final standard pass; then decide whether FN-DSA becomes required |
| 4 | @noble/post-quantum upgrade review (pinned 0.7.1) | Feb 9 2027, then each minor release | Upgrade PR passes `tests/release-signing.test.mjs`; integrity hash recorded |
| 5 | Any scheme a future Node build lacks (probe reports `unsupported`) | On each Node upgrade | `node scripts/release-pq-keygen.mjs --probe` on Vengeance and CI shows every committed scheme supported; otherwise keep the public key out of `release-evidence/pubkeys/` until supported |
| 6 | Third-party verifiability (external log or tooling that understands PQ key ids) | Evaluate by May 2027 | A party outside the repo can verify the Ed25519 and at least one PQ signature with documented commands |
| 7 | Key rotation drill | Nov 2027 (annual) | Rotate one PQ key per runbook section 4; CI verifies the next release with the new key |
