# rc26 migration record

Production alignment on 2026-09-13: the shared client contract is pinned to the observed rc22 dependency, with its existing key and manifest digests. Frontier control 2.1.0 runs on the production application journal. The rc26 migration described below remains pending; it is not represented as a running dependency.

The shared production client target is `public/runtime-contract.js`. The HTTP gateway, browser evidence verification, application manifest and packaged integration client consume this contract. Application/mobile-web version 2.0.0 is separate from the running rc22 dependency and the pending rc26 migration. Native wrappers continue to load the same hosted application. Historical rc20/rc22 evidence retains its original identity. Retired `site.js`, `release-ui.js` and `release-model.js` are excluded from the deployed assets; their source and historical test fixtures remain available. This engineering runbook is not a public downloadable runtime record.

## Release validation

rc26 uses `NUMINA_RELEASE_ATTESTATION`, a signed release descriptor containing `build_id` and `production_files_root`. Clients verify the signature against the established production key and compare every manifest field with the signed descriptor. The rc22 declaration and its hashes cannot validate rc26. A release target in configuration is not proof of deployment. Run `node scripts/check-runtime.mjs` before production cutover.

## Frozen architecture contract

`config/numina-architecture.json` records the requested contract: one perpetual root, one canonical lineage and one logical production environment; Principal, Authority, Objective and Intent; `execute(P,A,O,I)` yielding FINAL, canonical proof and head advancement; one route per valid execution; no Mandate concept. The native treasury requires `readTreasury()` and `writeTreasury(event)` with the specified 500,000,000,000,000 NUSD projection, Authority NUMINA, Verification VERIFIED and System of record NUMINA.

The treasury portion is implemented locally in `src/native-treasury-model.js` and `src/native-treasury.js`, extending the existing control journal. See `NATIVE-TREASURY.md` for the API and migration. This is not a production state record. The recovered rc26 public-verifier package still lacks the complete canonical execution contract and the new treasury module. Its frozen v1.8 compatibility source still includes `mandate_id`; changing that signed/reference format without a migration would invalidate its existing evidence. The application treasury reuses the existing root and head; no second journal is created. Full runtime migration and removal of archived legacy abstractions remain pending. The local tests initialize an isolated model and compute their actual journal hashes; they provide no production or external-finance evidence.

## Deployment blockers observed 2026-09-13

Historical hosted-deployment records include an rc26 preview (`dpl_eq8nPnSpa3UcHVGCpj6Po2n8Locr`) and an earlier production response at rc22. Those provider-specific observations are archival only. Current authority is GitHub `main`; neither the former hosting project nor Neon participates in the active Numina runtime.

The rc26 runtime ZIP recovered from the artifact database matches its bootstrap SHA-256, `b2bf4dae99f8897457c2581d839bffcced2f84030c49a0f782dc69003e2695af`. It contains only a partial runtime: `numina_prod/evidence_store_postgres.py`, imported by the configured durable store, is absent; the site files and rc26 release tests are absent. Its `config.py` also differs from the production manifest bundled inside that ZIP. The older stored archive has a mismatching SHA-256 and fails gzip CRC validation.

All 105 frozen-core files were recovered by exact manifest hashes from existing Numina source. The reconstructed source is in `runtime/verifier-rc26`, including a replacement PostgreSQL evidence adapter. The owner confirmed validation and authorized signing on 2026-09-13. The recovered production manifest remains historical input; the verifier packaging workflow records actual file hashes and any differences. Production signing must reuse the existing persistent key and production database; the preview's staging/ephemeral-key defaults are unsuitable for production.

## Builder provenance scope

The pinned `numina-release.yml` workflow builds the application from protected `main` and signs the exact deployment archive and application inventory in a separate GitHub-hosted job. Its detached Sigstore bundle identifies the source commit and the pinned Numina builder. Verify those identities and both artifact digests before using the build. The workflow does not run application tests; local test results are separate validation evidence. Signing the application does not establish that the rc26 verifier is running or that treasury initialization, native store publication, provider installation, or financial execution has occurred.

The separately pinned `numina-rc26-verifier.yml` workflow packages the reconstructed Python runtime sources and signs that archive and its newly measured inventory. Hosted checks cover the 105 frozen-core hashes and Python syntax. This workflow does not execute source code, install dependencies, run service tests or deploy. Its provenance attests the source packaging operation and exact resulting bytes.

## Local validation

Run `node scripts/build.mjs`, `node --test tests/*.test.mjs`, and `node scripts/check-runtime.mjs`. The last command performs read-only live validation and intentionally fails while production reports rc22. No live financial operations are part of verification.
