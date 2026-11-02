# V2.0 audit log — merge changes

Local only. No repo push, no deploy, no signing.

## Sources (read from Numina-Enterprise/numina-production, branch main,
## head 1c719bd3f7475863e4d8e20d32958181a74020fd, via GitHub connector + public sparse checkout)

- `runtime/verifier-rc27/` — frozen core v1.8 verifier (Python).
- `numina-financial-core/` — financial core v1.0.0 (Node).
- Local records in `~/workspace/your_files/` for the quarantine evidence
  folder only: `state-root-726e-quarantine-2026-10-23.md`,
  `state-root-726e-verification-package-2026-10-23.md`,
  `state-root-726e-verify.py` (copied verbatim into `evidence/quarantine/`).

## Files copied unchanged (except cluster-root replacement below)

- All verifier files under `core/` (Python `numina/`, `numina_prod/`,
  `specs/`, `tests/`, `tests_prod/`, examples, `deploy/`, artifacts),
  except:
  - `core/FROZEN-CORE-v1.8.sha256`, `core/MANIFEST.sha256`,
    `core/MANIFEST.production.sha256`, `core/SOURCE-ARCHIVE.sha256`,
    `core/README.md` (v1.8-era) — moved to `archive/v1.8/` as historical
    records, not live verification.
  - `core/numina_prod/frozen.py` — replaced with a V2.0 shim (see below).
- All financial files under `core/financial/` (`src/`, `tests/`, `scripts/`,
  `staging.env.example`), except `package-lock.json`, which was not copied
  (it pinned the old financial-core name/version; a future push regenerates
  it with `npm ci` / `npm install` — it is not part of the frozen V2.0
  manifest, and its absence does not change any source file).

## Files transformed — cluster root replacement (9 files)

In each file below, the former quarantined cluster root (full 64-hex value,
and any mock-secret / mock-token fragment derived from it) was replaced
with the Genesis hash (see V2.0-CLUSTER-IDENTITY.md). No other logic was
changed in these files, except the RWA constant naming noted below.

1. `core/financial/src/rwa-tokenization-engine.mjs`
   - Comment updated to Genesis cluster root, identifier only.
   - Added `GENESIS_CLUSTER_ROOT` (Genesis hash); kept
     `CANONICAL_CLUSTER_STATE_ROOT` as an alias to the same value, so the
     existing RWA test continues to pass without a test rewrite.
2. `core/financial/src/run-all-core-modules.mjs`
   - `CLUSTER_ROOT` = Genesis hash.
   - Webhook secret changed to `whsec_MOCK_ONLY_TEST` (was a test secret
     embedding a fragment of the old root).
3. `core/financial/src/advance-treasury.mjs`
   - `CLUSTER_ROOT` = Genesis hash.
4. `core/financial/src/run-stripe-demo.mjs`
   - `CLUSTER_ROOT` = Genesis hash.
   - Webhook secret changed to `whsec_MOCK_ONLY_TEST` (was a
     "prod_live_secret" mock label embedding an old-root fragment — the
     "prod_live" wording was misleading and was removed).
5. `core/financial/src/run-reconciler-demo.mjs`
   - `clusterRoot` / `clusterState.root` = Genesis hash.
6. `core/financial/src/run-kms-demo.mjs`
   - Demo payload string updated to `NUMINA_V2_CLUSTER_ROOT:` + Genesis hash.
7. `core/financial/src/run-http-demo.mjs`
   - `clusterRoot` = Genesis hash.
8. `core/financial/src/run-bofa-demo.mjs`
   - Mock token changed to `bofa_cashpro_MOCK_TOKEN_ONLY` (was a mock token
     embedding an old-root fragment).
9. `core/financial/src/test-hsm-signing.mjs`
   - Demo payload string updated to `NUMINA_V2_CLUSTER_ROOT:` + Genesis hash.

No other source file contained the former cluster root. A full-tree grep
for the full former root value in live code (excluding `evidence/`) after
these changes returns zero hits; `scripts/scan-v2.py` reconstructs the
value from fragments at runtime for scanning, so the scanner itself does
not embed the full value in live code.

## Files created (new in V2.0)

- `README.md`, `SECURITY.md`, `V2.0-CLUSTER-IDENTITY.md`,
  `MERGE-REPORT-v2.0.md` (this package's report), `AUDIT-LOG.md` (this file).
- `core/interface/cluster.py`, `core/interface/cluster.mjs` — shared Genesis
  cluster identity for both languages.
- `core/interface/guard.mjs` — fail-closed guard (read-only / dry-run).
- `core/tests-unified/v2-cluster-and-gates.test.mjs` — Node unified tests
  (cluster root, dry-run gate, read-only config).
- `core/tests-unified/test_v2_cluster.py` — Python unified test
  (Genesis identity).
- `core/numina_prod/frozen.py` — replaced (see above) with a V2.0 shim that
  reads `FROZEN-CORE-V2.0.sha256` at the package root. The original v1.8
  frozen.py logic (read a manifest, hash-check listed files) is preserved
  in structure; the manifest it reads is now V2.0's, not v1.8's.
- `package.json`, `pyproject.toml` — V2.0 package metadata (name
  `numina-core-v2.0`, version 2.0.0, private, UNLICENSED, same as sources).
- `scripts/verify-manifest.py`, `scripts/scan-v2.py`.
- `sign-and-bind/` — final-build, final-manifest, signing payload,
  verification script, sign-package manifest, and sign-and-bind README.
  No signature, no public key supplied (see MERGE-REPORT, signing blocked).
- `FROZEN-CORE-V2.0.sha256` — frozen manifest, generated after all other
  files, listing all package files except itself and except `sign-and-bind/`.
- `archive/v1.8/README-HISTORICAL.md`, `evidence/quarantine/QUARANTINE-ROUTE-README.md`.

## Files NOT updated, and why (not silently stale)

- `core/financial/tests/none-null-coercion-safety.test.mjs` imports
  `../../numina-agent-swarm/src/swarm-dispatcher.mjs`, which was outside
  the merge scope (verifier + financial core only). It was copied as-is
  and therefore cannot run in V2.0 as scoped. It is **not** claimed to
  pass. Adding the swarm is a future-version decision, not a silent fix.
- `core/financial/tests/connectors.test.mjs` imports `fast-xml-parser`
  (via camt-parser) and other external packages. It was copied as-is and
  cannot run without `npm install` of those packages. See MERGE-REPORT
  for the dependency-install re-run note.
- Python `tests_prod/` modules importing `sqlalchemy`, `fastapi`, or a
  live Postgres database were copied as-is and cannot run without those
  dependencies / services. See MERGE-REPORT.
- The org audit report cell calling the RWA engine "($1.5B 1:1 backing)"
  is **not** in V2.0 (that report was not copied into the package). It is
  recorded in MERGE-REPORT as an inconsistency/error, and V2.0 uses
  1.5 quadrillion consistently (see below).

## Scale figure — 1.5 quadrillion, not 1.5 billion

V2.0 uses **1.5 quadrillion** consistently for the financial core scale:
1,500 trillion, 1,500,000,000,000,000,000,000 micro-units at 1,000,000
micro-units per dollar. Correcting the unit does **not** change the
dry-run / no-activation status. No $1.5B cap figure is used in V2.0.
