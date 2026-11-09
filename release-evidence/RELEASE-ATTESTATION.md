# Numina release attestation: what the signatures cover

Files: `release-evidence/numina-<version>-release.statement.json` (in-toto Statement v1),
`release-evidence/numina-<version>-release.dsse.json` (DSSE envelope, payloadType
`application/vnd.in-toto+json`), `release-evidence/pubkeys/SKOTT34-<scheme>.pub.(pem|json)`.

## What every signature covers
Each signature (Ed25519, ML-DSA, SLH-DSA, FN-DSA) signs the DSSE pre-authentication encoding of
the exact statement bytes. The statement records:
- **Subjects**: the sha256 of every file in `dist/client` (the published static assets) and
  `dist/server` (the Worker bundle) produced by `npm run build`, sorted by path.
- **Source tree**: sha256 over `git ls-tree -r --full-tree HEAD`, excluding the statement,
  envelope and `release-evidence/pubkeys/`, plus the commit and git tree ids for reference.
- Version, builder label (`local`), timestamp and the key label `SKOTT34-Ed25519`.

All schemes cover the same bytes; the post-quantum signatures add resistance to a future
quantum attack on Ed25519. FN-DSA (Falcon) is pre-standard (FIPS 206 not final) and optional.

## What it does NOT cover
- Runtime behavior of the deployed Worker, or anything that happens after deploy.
- Cloudflare-side configuration (routes, custom domains, DNS, workers.dev/preview URLs,
  environment variables, bindings), GitHub settings or any other hosting configuration.
- Secrets (the Cloudflare token, Worker secrets) and their handling.
- `dist/private-downloads/` (not published) and anything outside `dist/client` and `dist/server`.
- The identity of the key holder beyond possession of the private key. The key label is a label.
- Treasury, reserves, balances or any financial backing; any financial, payment or token claim.
- Legal or regulatory compliance (including KYC/AML, MSB or money transmission questions).
- Post-deploy changes, rollbacks or edits made in the Cloudflare dashboard.

## How to verify
1. Check out the commit, `npm ci`, `npm run build`.
2. `node scripts/release-verify.mjs`. It recomputes every dist digest, checks the source tree
   digest, and verifies every signature with a committed public key. It exits 0 only if the
   Ed25519 signature verifies, every present signature verifies, and every committed public key
   has a signature. CI runs this step before deploy (`.github/workflows/deploy-cloudflare.yml`).
3. Signatures only (no build): `node scripts/release-verify.mjs --signatures-only`.
4. Compare the public key fingerprints with the ones Sam recorded out of band.
