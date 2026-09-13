# Numina 3 — one root, five layers

The 3.0.0 control extension uses live mode and the existing canonical journal. See [Frontier v2](docs/Frontier-v2.md). Runtime rc26 migration remains a separate incomplete dependency. Further tests were skipped at the owner's request.

## Production architecture

Production uses the rc22 runtime with its pinned key and manifest identity. The L3 authority, L4 execution and L5 canonical-evidence layers run as frontier control 3.0.0 on the application journal. The recovered rc26 package remains an incomplete future migration. See [rc26 alignment and blockers](RC26-ALIGNMENT.md). A configured target does not establish deployment or a live treasury balance.

Numina 3.0.0 serves the website, Numina OS operations workspace and installable mobile web app at https://numinalabs.xyz. Existing application and control APIs remain at `/api/app/v1` and `/api/control/v1`; the application manifest is `/v3/release/manifest`. No data migration is required for this application release.

The authenticated read-only Numina node observation is available at `/v2/network/status`. The control-plane runtime target is a separately identified v1.9.0-rc22 dependency. Node connectivity does not establish financial execution, token issuance, reserves or redemption.

The canonical Numina-native treasury uses `readTreasury()` and `writeTreasury(event)` on the existing control journal. The former owner-statement endpoint redirects to it. See [native treasury implementation](NATIVE-TREASURY.md) for initialization, P/A/O/I execution and proof scope.

## Build and provenance

Use Node 24 and `node scripts/build.mjs`, then `node scripts/package.mjs ../numina-site-v3.0.0.tar.gz`. The reviewed reusable workflow in `skott34-dot/numina-builder` builds from the source revision and creates detached SLSA provenance for both the exact deployment archive and application inventory. The calling workflow pins the builder by full commit. Verify the actual attestation bundle and artifact before deployment. Merely copying a workflow or changing a manifest field does not establish a SLSA level.

Runtime signing keys, provider credentials and private records belong only in production secret/storage services. `.env.example` has no live credential values. The private JWK in `fixtures/demo-test-key.json` is explicitly an intentionally public reference-test fixture and must never be used for production authorization.

## Distribution

The mobile web app is served at `/app`. Android and iOS device release packages compiled on GitHub-hosted builders. Their exact inputs, artifact hashes and signing/publication status are recorded in docs/native-package-record-v3.json. Native store publication is not established. The integration kit supports documented provider formats and local MCP configuration; publication does not install it in third-party LLM products.

## Source and rights

`src/` contains the Worker, `public/` the website, `docs/` downloadable specifications, and `vendor/numina-core-v1.8` the preserved core. Existing tests and historical fixtures remain as source; the provenance workflow does not run them or claim they ran.

Public source access is authorized by the owner. No new open-source license or trademark license is granted by this publication; existing third-party notices and licenses remain applicable. Copyright claims apply only to owned, copyrightable material.

## Source alignment

Read [the source map](docs/Source-Alignment-v3.md). `node scripts/build.mjs` validates maintained package versions and generates `/source-alignment.json` from their actual source. Run `python scripts/package-distributions.py` after changing integration, plugin or native source files, then build. The existing root, journal and native treasury routes remain authoritative across L1–L5. Historical evidence and reconstructed runtime sources retain their own identities.
