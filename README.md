# Numina 4 — one root, five layers

The 4.0.0 control extension uses the existing canonical journal. The website, workspace, integration kit and native clients share Numina's production architecture. See [Frontier v2](docs/Frontier-v2.md).

## Production architecture

Production uses the rc26 runtime with its pinned key and manifest identity. The L3 authority, L4 execution and L5 canonical-evidence layers run as frontier control 4.0.0 on the application journal. See the [recorded rc26 deployment](docs/rc26-production-deployment.json) and [source alignment](docs/Source-Alignment-v4.md). Recheck the running runtime with `npm run check:runtime`.

Numina 4.0.0 is configured to serve the website, Numina OS operations workspace and installable mobile web app at https://numinalabs.xyz. Existing application and control APIs remain at `/api/app/v1` and `/api/control/v1`; the application manifest is `/v4/release/manifest`. No data migration is required for this application release.

The authenticated read-only Numina node observation is available at `/v2/network/status`. The control-plane runtime target is a separately identified v1.9.0-rc26 dependency. Node connectivity does not establish financial execution, token issuance, reserves or redemption.

The canonical Numina-native treasury uses `readTreasury()` and `writeTreasury(event)` on the existing control journal. The former owner-statement endpoint redirects to it. See [native treasury implementation](NATIVE-TREASURY.md) for initialization, P/A/O/I execution and proof scope.

## Build and provenance

Use Node 24 and `node scripts/build.mjs`, then `node scripts/package.mjs ../numina-site-v4.0.0.tar.gz`. The reviewed reusable workflow in `skott34-dot/numina-builder` builds from the source revision and creates detached SLSA provenance for both the exact deployment archive and application inventory. The calling workflow pins the builder by full commit. Verify the actual attestation bundle and artifact before deployment. Merely copying a workflow or changing a manifest field does not establish a SLSA level.

Runtime signing keys, provider credentials and private records belong only in production secret/storage services. `.env.example` has no live credential values. The private JWK in `fixtures/demo-test-key.json` is explicitly an intentionally public reference-test fixture and must never be used for production authorization.

## Distribution

The mobile web app is served at `/app`. The v4 distribution reuses the existing native 3.0.0 binaries byte-for-byte; their original versions, signing status and hashes are referenced in docs/native-package-record-v4.json. Android and iOS source candidates are 4.0.0 with build number 3 and have not been compiled. Prior 3.0.0 device binaries retain their exact hashes and build evidence in docs/native-package-record-v3.json. Native store publication is not established. The integration kit supports documented provider formats and local MCP configuration; publication does not install it in third-party LLM products.

## Source and rights

`src/` contains the Worker, `public/` the website, `docs/` downloadable specifications, and `vendor/numina-core-v1.8` the preserved core. Existing tests and historical fixtures remain as source; the provenance workflow does not run them or claim they ran.

The production GitHub repository is private. GitHub source, build logs and workflow artifacts require repository access. Vercel's connected project has Build Logs and Source Protection enabled. The public website and its explicitly published downloads remain available. No new open-source license or trademark license is granted; existing third-party notices and licenses remain applicable.

## Source alignment

Read [the source map](docs/Source-Alignment-v4.md). `node scripts/build.mjs` validates maintained package versions and generates `/source-alignment.json` from their actual source. Run `python scripts/package-distributions.py` after changing integration, plugin or native source files, then build. The existing root, journal and native treasury routes remain authoritative across L1–L5. Historical evidence and reconstructed runtime sources retain their own identities.
