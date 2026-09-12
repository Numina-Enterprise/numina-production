# Numina 2.0

Numina 2.0.0 serves the website, Numina OS operations workspace and installable mobile web app at https://numinalabs.xyz. Existing application and control APIs remain at `/api/app/v1` and `/api/control/v1`; the application manifest is `/v2/release/manifest`. No data migration is required for this application release.

The authenticated read-only Numina node observation is available at `/v2/network/status`. The control-plane runtime remains a separately identified v1.9.0-rc22 dependency. Node connectivity does not establish financial execution, token issuance, reserves or redemption.

## Build and provenance

Use Node 24 and `node scripts/build.mjs`, then `node scripts/package.mjs ../numina-site-v2.0.0.tar.gz`. The reviewed reusable workflow in `skott34-dot/numina-builder` builds from the source revision and creates detached SLSA provenance for both the exact deployment archive and application inventory. The calling workflow pins the builder by full commit. Verify the actual attestation bundle and artifact before deployment. Merely copying a workflow or changing a manifest field does not establish a SLSA level.

Runtime signing keys, provider credentials and private records belong only in production secret/storage services. `.env.example` has no live credential values. The private JWK in `fixtures/demo-test-key.json` is explicitly an intentionally public reference-test fixture and must never be used for production authorization.

## Distribution

The mobile web app is served at `/app`. Android and iOS source projects are prepared separately; native store publication is not established. The integration kit supports documented provider formats and local MCP configuration; publication does not install it in third-party LLM products.

## Source and rights

`src/` contains the Worker, `public/` the website, `docs/` downloadable specifications, and `vendor/numina-core-v1.8` the preserved core. Existing tests and historical fixtures remain as source; the provenance workflow does not run them or claim they ran.

Public source access is authorized by the owner. No new open-source license or trademark license is granted by this publication; existing third-party notices and licenses remain applicable. Copyright claims apply only to owned, copyrightable material.
