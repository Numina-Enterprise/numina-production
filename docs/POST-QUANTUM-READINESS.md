# Post-quantum readiness for Numina release signing

Status: Nov 9 2026. Assessment, implementation and remaining work for hybrid release signatures.
Follow-up plan with owners, dates and acceptance tests: `docs/POST-QUANTUM-FOLLOWUP.md`.

## Assessment (probed on the box, Nov 9 2026 09:43 CST)
Runtime probe (`node scripts/release-pq-keygen.mjs --probe`: keygen, sign and verify per scheme)
on Node v26.13.0 and v24.22.1, both with OpenSSL 3.5.9. node:crypto ML-DSA and SLH-DSA need
OpenSSL 3.5 or later in the Node build. The Node 24/26 release docs were not re-read this turn;
the probe result is what the scripts rely on, and they re-probe at runtime on every machine.

| Scheme | Standard | Status | Implementation | Signature bytes |
|---|---|---|---|---|
| Ed25519 | RFC 8032 | Included, **required** | node:crypto | 64 |
| ML-DSA-44 | FIPS 204 | Included | node:crypto | 2,420 |
| ML-DSA-65 | FIPS 204 | Included (default) | node:crypto | 3,309 |
| ML-DSA-87 | FIPS 204 | Included (default) | node:crypto | 4,627 |
| SLH-DSA-SHA2-128s / SHAKE-128s | FIPS 205 | Included (both defaults) | node:crypto | 7,856 |
| SLH-DSA-SHA2-128f / SHAKE-128f | FIPS 205 | Included (`--all`) | node:crypto | 17,088 |
| SLH-DSA-SHA2-192s / SHAKE-192s | FIPS 205 | Included (`--all`) | node:crypto | 16,224 |
| SLH-DSA-SHA2-192f / SHAKE-192f | FIPS 205 | Included (`--all`) | node:crypto | 35,664 |
| SLH-DSA-SHA2-256s / SHAKE-256s | FIPS 205 | Included (`--all`) | node:crypto | 29,792 |
| SLH-DSA-SHA2-256f / SHAKE-256f | FIPS 205 | Included (`--all`) | node:crypto | 49,856 |
| FN-DSA-512 (Falcon) | Not yet standardized (FIPS 206 not final) | Included, **pre-standard, optional** | @noble/post-quantum 0.7.1 (Falcon round 3, per its README) | 655 (observed) |
| FN-DSA-1024 (Falcon) | Not yet standardized (FIPS 206 not final) | Included, **pre-standard, optional** | @noble/post-quantum 0.7.1 | 1,274 (observed) |

No scheme is "unsupported in Node" on the probed builds. SLH-DSA signatures are large (8–50 KB
each); signing with all 12 sets makes the envelope about 435 KB. SLH-DSA "s" sets are slow to
generate (roughly 0.3–2.2 s per key on the box). The default set keeps one SHA2 and one SHAKE
"s" set.

## Falcon decision: INTEGRATED
- Library: `@noble/post-quantum` **0.7.1**, devDependency, exact pin. Integrity
  `sha512-+P9981IiAnVh+rmcubozzVwrEy3XsN/tMhTnvsjV9VDaYpOnNCqWqKo2FLWxbu92YHfjGIlE5XnW175UK+ln+Q==`.
  Transitive: @noble/hashes, @noble/curves, @noble/ciphers 2.4.0 (pinned in package-lock.json).
  Pure JS, no native build. npm registry metadata last modified 2026-08-27.
- Used only by `scripts/release-*.mjs`, loaded lazily. Never imported by `src/` or bundled into
  `dist/server/index.js`.
- Keygen, sign and verify for FN-DSA-512 and FN-DSA-1024 pass on the box (unit tests and the
  end-to-end run in `e2e-signing-20261109.log` of the hand-off). A tampered FN-DSA signature fails.
- Labeled pre-standard everywhere. Verification: optional, but a present FN-DSA signature (or
  a committed FN-DSA public key) must verify or the deploy fails.

## What was implemented
- `scripts/release-lib.mjs`: scheme registry, runtime probe, DSSE PAE, digest collection,
  source tree digest, key loading (PEM for node:crypto schemes, JSON for FN-DSA).
- `scripts/release-statement.mjs`, `scripts/release-sign.mjs` (one signature per key, Ed25519
  required, key id `SKOTT34-<scheme>`), `scripts/release-verify.mjs` (per-scheme PASS/FAIL),
  `scripts/release-pq-keygen.mjs` (defaults, `--all`, `--include-ed25519`, refuses overwrite).
- CI step "Verify signed release attestation" before deploy.
- Tests: `tests/release-signing.test.mjs` (throwaway keys for every supported scheme).
- Windows kit: `vengeance-signing-kit/` (hand-off folder, not in the repo).

## What remains
- Cloudflare and GitHub do not verify these signatures themselves; only our CI step does. A
  compromised CI workflow could skip it. Branch protection requiring review of
  `.github/workflows/` changes is a GitHub-side setting (not changed here).
- Third-party verification: no external transparency log (for example Sigstore/Rekor) is used.
  Mainstream in-toto/DSSE tools may not recognize ML-DSA, SLH-DSA or FN-DSA key ids yet; they
  can verify the Ed25519 signature with the committed PEM.
- FN-DSA must be re-checked against the final FIPS 206 text when published (encoding and
  parameter changes are possible); see the follow-up.
