# Numina Core V2.0 — unified, frozen working core

**Status: FROZEN. Local only. Not pushed, not deployed, not signed.**

V2.0 merges two earlier codebases into one unified, editable-then-frozen core:

- **Frozen core v1.8** — Python verifier / reference runtime, `runtime/verifier-rc27/`
  in Numina-Enterprise/numina-production (specs, `numina/`, `numina_prod/`,
  examples, tests, deploy files). Now in `core/` in this package.
- **Financial core v1.0.0** — Node treasury / ledger code, `numina-financial-core/`
  in the same repo (treasury engine, money, connectors, NCUA, ISO 20022, RWA,
  Stripe/BofA bridges, tests, demos). Now in `core/financial/` in this package.

## What changed, in one paragraph

V1.8 was **unfrozen by owner direction**, merged with the financial core, and
then **V2.0 was frozen again**. V1.8's frozen verification no longer applies to
V2.0; v1.8 remains only as an archived historical record in `archive/v1.8/`.
V2.0 supersedes v1.8 as the working core. Any later change requires a new
version, not an edit to frozen V2.0 — and **only Samuel J. Kott may change it
after freezing**.

## Cluster root — Genesis, not the quarantined root

- **Live V2.0 cluster root: 0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1**
  Chain 962421430, block 0 (Genesis block-zero hash).
- This hash is **recorded / collected block-zero material**. It is **not**
  derived from the pair, **not** a signature, and **not** proof of settlement,
  verification, or activation. It is an identifier / root label only.
- The former cluster root (quarantined, Oct 23 2026) is **not** a live cluster
  root or verification root anywhere in V2.0 live code. It is preserved only
  as isolated evidence in `evidence/quarantine/` (see below), labeled
  DO-NOT-USE. The quarantine is **not lifted** by this replacement.

## What V2.0 does NOT do

- No settlement, mint, transfer, or redemption is activated.
- NUSD issuance / transfers / redemption: **NOT activated**.
- Financial operations remain **read-only / dry-run**. `submitTransfer()`
  throws `DRY_RUN_REJECTED_BY_GATE`. Connector mode must remain `READ_ONLY`.
- Pair companion `numina.pair-binding.v1`: **unsigned / open**.
- No signature exists for V2.0 yet. See `sign-and-bind/` — signing is
  owner-only, on the owner's side, with the owner's own key. A typed approval
  is **not** a signature.

## Layout

- `core/` — unified code: Python verifier (`numina/`, `numina_prod/`, `specs/`,
  `tests/`, `tests_prod/`, examples, `deploy/`) + Node financial code
  (`financial/src/`, `financial/tests/`, `financial/scripts/`) +
  shared `interface/` (cluster identity in Python and Node, fail-closed guard)
  + `tests-unified/` (dependency-free cross-language tests).
- `core/interface/cluster.py`, `core/interface/cluster.mjs` — Genesis cluster
  identity, shared by both languages.
- `archive/v1.8/` — historical v1.8 record only: original
  `FROZEN-CORE-v1.8.sha256`, `MANIFEST.sha256`, `MANIFEST.production.sha256`,
  `SOURCE-ARCHIVE.sha256`, `README-v1.8.md`. Not current verification.
- `evidence/quarantine/` — isolated quarantine evidence, DO-NOT-USE. Contains
  the quarantined root, its quarantine note, and its verification package,
  copied verbatim from local records. This folder is **evidence only**; it is
  not imported by live code, not a verification root, and not a cluster root.
  Live-code scans exclude this folder by design and report it separately.
- `scripts/verify-manifest.py` — checks every file in the frozen manifest.
- `scripts/scan-v2.py` — scans live code for the quarantined root, secret-like
  values, and personal-data patterns; reports evidence-folder hits separately.
- `sign-and-bind/` — owner-only signing package. No signature exists yet.
- `FROZEN-CORE-V2.0.sha256` — frozen manifest for V2.0. It lists all package
  files **except itself and except `sign-and-bind/`** (the sign package is the
  thing to be signed, and its own hashes are recorded inside it — see
  `sign-and-bind/README-SIGN-AND-BIND.md` for why this avoids circularity).
- `MERGE-REPORT-v2.0.md`, `AUDIT-LOG.md`, `SECURITY.md`, `V2.0-CLUSTER-IDENTITY.md`.

## Verify (no credentials, no network, no live services)

```sh
python3 scripts/verify-manifest.py
python3 scripts/scan-v2.py
node --test core/tests-unified/*.test.mjs
python3 -m unittest core/tests-unified/test_v2_cluster.py
```

Python verifier tests that need `cryptography` require that package
(`pyproject.toml` lists `cryptography>=41`); Node financial tests that import
external packages (`stripe`, `@google-cloud/kms`, `fast-xml-parser`,
`numina-agent-swarm`) need those packages installed and are **not** run as
part of the dependency-free unified gate. See MERGE-REPORT for honest
pass/fail reporting.

## Future push (not done)

A push to the public repo must first pass the review in `SECURITY.md`:
secrets scan, personal-data scan, quarantined-root scan (live code only),
manifest verification, and owner review. Do not push V2.0 yet.
