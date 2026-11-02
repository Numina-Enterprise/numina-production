# Merge report — Numina Core V2.0

**Local only. Not pushed, not deployed, not signed.**
**Status: FROZEN. Only Samuel J. Kott may change frozen V2.0, and only by
creating a new version.**

## 1. What was merged

- **Frozen core v1.8** (Python verifier / reference runtime, from
  `runtime/verifier-rc27/` in Numina-Enterprise/numina-production, branch
  main, head 1c719bd3f7475863e4d8e20d32958181a74020fd):
  deterministic clearing / systemic stability runtime, rights runtime,
  institutional compiler, constitutional market, institution network,
  plus `numina_prod/` production verifier, specs, examples, tests,
  `tests_prod/`, and deploy files.
- **Financial core v1.0.0** (Node, from `numina-financial-core/` in the
  same repo): triple-entry BigInt ledger, money parsing, connector
  config, settlement-rail connector, Stripe bridges, BofA CashPro,
  camt.053 parser, ISO 20022 reconciler, NCUA Schedule J, simulation
  exporter, RWA tokenization, cloud HSM / KMS verifier, GCP secret
  resolver, security utils, demos, and tests.

They were merged into **one unified tree** under `core/` in this package,
not two sealed subpackages: Python verifier code and Node financial code
live side by side, sharing `core/interface/` (cluster identity in both
languages + fail-closed guard), one top-level `package.json` /
`pyproject.toml`, one frozen manifest, and one set of unified tests.
Languages were **not** rewritten into each other — a Python-to-Node or
Node-to-Python rewrite would be a different project, not a merge, and
would invalidate the existing test suites. Integration is therefore:
shared cluster identity, shared manifest, shared guards, shared
verification / scan scripts, and unified test entry points.

## 2. Unfreeze, then freeze again (owner directions, in order)

1. **Original plan:** preserve v1.8 verbatim as a frozen subpackage.
2. **Owner correction:** unfreeze the core and merge it. V2.0 is a
   unified, editable working core; its hash manifest is versioned and
   changes on each revision, not frozen.
3. **Owner direction, superseding the working state for the final V2.0:**
   after the merge is complete, freeze V2.0 again. This package is that
   frozen final V2.0.
4. **Consequence, stated clearly:** v1.8 was unfrozen by owner direction,
   its frozen verification **no longer applies to V2.0**, V2.0 supersedes
   v1.8 as the working core, and v1.8 remains only as an archived
   historical record in `archive/v1.8/`. Any later change requires a
   new version, not an edit to frozen V2.0.

## 3. What was kept separate, and why

- **Languages:** Python and Node remain in their own languages, because
  their test suites, dependencies, and runtimes are language-specific.
  Merging them into one language would discard those suites.
- **Quarantine evidence:** `evidence/quarantine/` is isolated from live
  code. It is not imported, not a root, not verification — it is evidence.
- **Sign-and-bind package:** `sign-and-bind/` is excluded from the frozen
  manifest (see §7) to avoid circularity. It is the thing to be signed,
  not part of what the frozen manifest hashes.
- **Archive:** `archive/v1.8/` is historical only, not current verification.

## 4. What changed vs v1.8 and vs financial core v1.0.0

### vs v1.8

- Verifier code moved from `runtime/verifier-rc27/` to `core/` in V2.0.
- `numina_prod/frozen.py` now reads the V2.0 frozen manifest, not v1.8's.
- v1.8-era manifests (`FROZEN-CORE-v1.8.sha256`, `MANIFEST.sha256`,
  `MANIFEST.production.sha256`, `SOURCE-ARCHIVE.sha256`) and the v1.8
  README moved to `archive/v1.8/`.
- New: shared interface, unified tests, security / scan / verify scripts,
  sign-and-bind package, and this report.
- No verifier logic was changed except the frozen.py manifest pointer
  and the addition of the shared interface files. Verifier tests still
  pass (see §8).

### vs financial core v1.0.0

- Financial code moved from `numina-financial-core/` to
  `core/financial/` in V2.0.
- **Cluster root replaced in 9 files** (listed in AUDIT-LOG): the former
  quarantined root is now the Genesis hash in all live code, demos,
  and mock-secret derivatives. Mock secrets that embedded old-root
  fragments are now plain `MOCK_ONLY` labels.
- Added: shared interface, unified tests, guard module, security /
  scan / verify scripts, sign-and-bind package.
- `package-lock.json` was not copied (see AUDIT-LOG).
- No financial logic, gate, or test assertion was changed except the
  cluster-root value and the RWA constant alias (value = Genesis,
  name kept for test compatibility).

## 5. Cluster root — Genesis, and the quarantine route

- **Live V2.0 cluster root: 0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1**
  Chain 962421430, block 0.
- The Genesis hash is **recorded / collected block-zero material**. It is
  **not derived from the pair**, **not a signature**, and **not proof**
  of settlement, verification, or activation. It is an identifier /
  root label only.
- **Quarantine route preserved:** the former quarantined root, its
  quarantine note, and its verification package are preserved verbatim
  in `evidence/quarantine/`, labeled DO-NOT-USE, not deleted, not used
  as a live cluster or verification root. The quarantine is **not
  lifted** by this replacement, and it is **not lifted** by V2.0.
- **Only lift, stated precisely:** V2.0 is no longer blocked by that
  root, because its live cluster root is now the Genesis hash. That is
  a routing / identifier change, not a verification lift.

## 6. Break / complete analysis — does replacing the root break anything, or complete things?

**Answer: it breaks nothing in live code that was updated, and it
completes nothing except the identifier change.**

### What was checked for breaks

- **Tests that previously expected the old root:** principally the RWA
  tokenization test, which asserts `solvency.clusterStateRoot` equals
  the canonical cluster root. That test was **not** rewritten; the
  constant it imports now holds the Genesis value (alias kept), so it
  passes with the new root (see §8, RWA suite 3/3).
- **Tests that compute their own root:** the financial-infrastructure
  test computes its cluster root from its own payload, and the M2
  challenger tests use payload-derived roots — they were not
  root-sensitive and did not need updating.
- **Demos that printed / seeded the old root:** `run-all-core-modules`,
  `advance-treasury`, and the other 7 transformed files now print / seed
  the Genesis value. Their logic (in-memory, mock, dry-run) is unchanged.
- **Hash checks that previously expected the old root:** none. The
  v1.8 frozen manifest does not contain the cluster root as a file hash,
  and no V2.0 file hash depends on the cluster-root value. Changing the
  root therefore did not break any hash check; it created new file
  hashes, which are captured in the new V2.0 frozen manifest.
- **Verifier tests:** no verifier test references the cluster root, so
  none was affected. Python verifier tests pass 309/309 (see §8).

### What would have failed until updated

- Any test, demo, or report asserting the old root value verbatim —
  in practice, the RWA test above, plus any external report quoting
  the old root as the live cluster root. Those are now outdated and
  must be updated to the Genesis value if they are re-run or re-quoted.
- Any downstream system that hard-coded the old root as a trust anchor
  would fail closed / mismatch — that is the intended effect of
  replacing a quarantined root, not a regression to fix by restoring it.

### What is NOT completed by this replacement

Replacement alone does **not** complete any of the following, and no
claim to the contrary is made in V2.0:

1. **Signing** — blocked (see §7). No signature exists.
2. **Binding** — final-build / final-manifest are prepared, not bound
   by a signature.
3. **Verification** — manifest verification (file hashes) passes, but
   that is not the same as signature verification, provider verification,
   or independent audit. Signature verification cannot pass until a
   signature and public key exist.
4. **Activation** — no financial operation is activated. Dry-run /
   read-only gates remain. A code flag change is not a real settlement,
   and no bank / Stripe / chain provider verification is on file.
5. **Freeze sign-off** — V2.0 is frozen as a package, but owner sign-off
   of that freeze (by signature, in a separate step) has not happened.
6. **Repo push / deploy** — not done, not authorized by this merge.
   A future push still needs the SECURITY.md review.
7. **Quarantine lift** — not lifted, not claimed.

## 7. Sign-and-bind — BLOCKED, package only (Genesis key chosen)

**Status: BLOCKED, not complete. No signature exists for V2.0.**

- Package prepared in `sign-and-bind/`: exact signing payload
  (`signing-payload.json`, canonical bytes as defined in its README),
  exact final-build (`final-build.json`) and final-manifest
  (`final-manifest.json`) files with their SHA-256 hashes recorded in
  the payload, and a verification script (`verify-signature.py`) that
  checks a signature against a supplied public key.
- **Signing key chosen by the owner, superseding the previous
  operational-runtime-key plan: the Genesis key.**
  - Raw Ed25519 public key (published in draft Appendix I, verified
    Oct 20 2026): `d6f1f949c1cc2ef38360668bc2270f847a790e95c882ca6945f7d56fed84bb3c`
  - OpenSSH fingerprint: `SHA256:EUTRdHI7yKEgsiCvob3uDx/kDFwjeiDusoEUqfCvVNc`
    (recomputed in this build from the raw key and matched exactly).
  - Signer principal in Appendix I: `skott34@gmail.com`.
  - Owner spelled the same fingerprint in chat, confirming it as the
    V2.0 sign-and-bind verification key, matching the Appendix I
    genesis key. VM SSH key and operational runtime key are not used.
  - SSHSIG namespace in Appendix I: `numina-evidence`, SHA-512 prehash,
    for the genesis evidence package
    `Numina-Final-Genesis-Record-and-IP-Intake-v1.zip`
    (SHA-256 a74e4b07…a92). That Appendix I signature verifies over
    that package only — **do NOT conflate it with the pair companion,
    which remains unsigned**, and do NOT claim the Appendix I signature
    signs V2.0.
- **VM SSH key is login only and must NOT be used as a signing key,
  and was NOT substituted.** The operational runtime private key is
  also not used: the owner stated he does **not** have the Ed25519
  operational runtime private key, and that key is not the chosen key
  for V2.0.
- **Whether the owner has the Genesis private key is not established
  in this build.** If the owner does not have it either, signing
  remains blocked, not complete. Do not invent a signature, and do
  not claim a signature exists until the owner signs on the owner's
  side with the Genesis private key and the signature verifies with
  `verify-signature.py` against the Genesis public key above.
- **A typed approval is not a signature.** No chat message, tap, or
  pasted approval line is recorded as a signature in V2.0.
- Verification script behaviour confirmed: `--canonical` prints the
  exact bytes to sign; with no signature it fails (exit 1); with a
  missing key file it fails (exit 1). No valid V2.0 signature was
  produced or claimed.

## 8. Tests — honest pass / fail

All tests below were run locally, no credentials, no network (except
the optional dependency-install re-run noted for connectors), no live
services. "Pass" means the test actually ran and passed in this run.

### Dependency-free unified gate — PASS

- Node unified tests (`core/tests-unified/*.test.mjs`): **3/3 pass**
  (Genesis cluster root, dry-run gate, read-only config).
- Python unified test (`core/tests-unified/test_v2_cluster.py`): **1/1 pass**
  (Genesis identity, chain, block).

### Python verifier suite — PASS

- `core/tests/` + `core/test_numina_core.py` (pytest, PYTHONPATH=core,
  `cryptography` installed in this VM only, not in V2.0): **309 passed**.
  This matches the v1.8 README's 309/309 claim for the verifier core.
- `core/tests_prod/` excluding 9 modules that fail collection for
  missing `sqlalchemy` / `fastapi` / Postgres: **96 passed, 1 failed**
  (the 1 failure is also a missing `fastapi` import in service code,
  not a V2.0 logic failure).
- `core/tests_prod/` full run: **not run to completion** — 9 modules
  fail collection for missing dependencies / services (sqlalchemy,
  fastapi, Postgres). Those are environment gaps, not V2.0 regressions,
  and are not claimed as passes.

### Node financial suite — PARTIAL, honestly reported

- Full financial test run (`node --test core/financial/tests/*.test.mjs`):
  **17 passed, 2 failed** (file-level).
  - Passing suites include: financial-infrastructure (7 tests),
    M2 empirical challenger (4 tests), RWA tokenization (3 tests).
  - Failing file 1: `connectors.test.mjs` — **missing package
    `fast-xml-parser`** (imported via camt-parser) in the frozen tree.
    Not a logic failure. In a scratch copy outside V2.0, with
    `stripe`, `fast-xml-parser`, `@google-cloud/kms`, and
    `@google-cloud/secret-manager` installed, this suite passed
    **7/7** (sandbox / read-only, camt parser, CashPro mTLS read-only,
    Stripe webhook, KMS fingerprint, NCUA simulation, settlement
    rejection). That scratch result does not change V2.0's frozen files,
    and V2.0 itself ships no `node_modules`.
  - Failing file 2: `none-null-coercion-safety.test.mjs` — imports
    `../../numina-agent-swarm/src/swarm-dispatcher.mjs`, which was
    outside the merge scope and was not copied into V2.0. Not a V2.0
    regression; adding the swarm is a future-version decision.
- Demo runners: `run-money-demo.mjs` runs and passes its BigInt audit;
  `run-all-core-modules.mjs` fails at import for missing `stripe`
  package (same dependency gap as connectors.test). No demo was run
  against a live service, and none claims a live result.

### Manifest and scan — PASS

- `scripts/verify-manifest.py`: **PASS, 0 failures** (file count is
  reported by the script at run time; see the frozen manifest file
  itself for the authoritative list).
- `scripts/scan-v2.py`: **PASS for live code** — 0 live-code files
  contain the full quarantined root; 3 evidence-folder files contain
  it, as expected and isolated. Warnings for manual review (4) were
  inspected: mock / test webhook secrets (`MOCK_ONLY`, and one test
  fixture `whsec_test_secret_key_12345`, which is a placeholder, not a
  real secret) and mock token labels. No real secret value was found.

## 9. Scale — 1.5 quadrillion, not 1.5 billion

- V2.0 uses **1.5 quadrillion** consistently: 1,500 trillion,
  1,500,000,000,000,000,000,000 micro-units at 1,000,000 micro-units
  per dollar.
- The org audit report cell calling the RWA engine "($1.5B 1:1 backing)"
  is treated as an **inconsistency / error, not the V2.0 figure**. That
  report was not copied into V2.0, and no $1.5B cap figure is used in
  V2.0. (A $1.5B sub-amount appearing as a circulating subset in one
  display demo is not the cap and was not changed.)
- Correcting the unit does **not** change the dry-run / no-activation
  status.

## 10. Safeguards (see SECURITY.md for full text)

- No secret values, tokens, private keys, passwords, or credential
  values in V2.0; secret reference names only; demo/mock keys labeled
  MOCK / TEST ONLY.
- Fail-closed by default: `READ_ONLY`, `DRY_RUN_REJECTED_BY_GATE`,
  `allowSettlementSubmission=false`, NCUA submission disabled.
- Integrity: frozen manifest + verification script + audit log.
- Access: only Samuel J. Kott may change frozen V2.0, and only by a
  new version; changes go through review; a public-repo push must be
  reviewed for secrets, personal data, and quarantined-root references
  before it happens.
- No personal data added; no new account identifiers added.
- Quarantined root: preserved as evidence only, not a live root.

## 11. What a future repo push would need

1. Owner review of this report, SECURITY.md, and the frozen manifest.
2. `scripts/verify-manifest.py` PASS and `scripts/scan-v2.py` PASS
   (live code) on the exact tree to be pushed.
3. Resolution of the two financial test gaps (install external Node
   packages, and either add the swarm scope or remove / quarantine
   that test file in a new version) — or an explicit owner decision
   to push with those gaps recorded, not hidden.
4. Resolution of the `tests_prod/` dependency gaps, or the same
   explicit recorded decision.
5. A separate, owner-only signing step, if a signature is wanted:
   owner creates / recovers / names an Ed25519 operational runtime
   key, supplies its public key, signs the canonical payload on the
   owner's side, and the signature is verified with
   `sign-and-bind/verify-signature.py`. Until then, V2.0 remains
   FROZEN_DRAFT_NOT_SIGNED.
6. A new version number for any post-freeze change. No in-place edits
   to frozen V2.0.

## 12. Files that could not be updated, and why

- See AUDIT-LOG.md § "Files NOT updated, and why". In short: the swarm
  test (out of scope), external-dependency tests (environment gaps),
  and the org audit $1.5B cell (not in V2.0, recorded as an error, not
  silently corrected in place). No other file was left silently stale:
  every live cluster-root occurrence was updated, and the manifest
  was regenerated after every file change in this build.
