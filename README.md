# NUMINA

## Singular identity

NUMINA is the single Numina-native identity across repository, host, source, authority, evidence, provenance, runtime, deployment, treasury, provider, receipts, settlement and release state. Version numbers, commit SHAs and external service names remain factual metadata or evidence channels; they do not create additional Numina identities.


**Canonical repository:** `skott34-dot/numina-production` on GitHub. `main` is the sole authoritative Numina source and release branch. No other repository is a Numina source of truth.

The 4.0.0 control extension uses the existing canonical journal. The website, workspace, integration kit and native clients share Numina's production architecture. See [Frontier v2](docs/Frontier-v2.md).

## Production architecture

Production uses the rc26 runtime with its pinned key and manifest identity. The L3 authority, L4 execution and L5 canonical-evidence layers run as frontier control 4.0.0 on the application journal. See the [recorded rc26 deployment](docs/rc26-production-deployment.json) and [source alignment](docs/Source-Alignment-v4.md). Recheck the running runtime with `npm run check:runtime`.

Numina 4.0.0 is configured to serve the website, Numina OS operations workspace and installable mobile web app at https://numinalabs.xyz. Existing application and control APIs remain at `/api/app/v1` and `/api/control/v1`; the application manifest is `/v4/release/manifest`. No data migration is required for this application release.

The authenticated read-only Numina node observation is available at `/v2/network/status`. The control-plane runtime target is a separately identified v1.9.0-rc26 dependency. Node connectivity does not establish financial execution, token issuance, reserves or redemption.

The canonical Numina-native treasury uses `readTreasury()` and `writeTreasury(event)` on the existing control journal. The former owner-statement endpoint redirects to it. See [native treasury implementation](NATIVE-TREASURY.md) for initialization, P/A/O/I execution and proof scope.

## Build and provenance

Use Node 24 and `node scripts/build.mjs`, then `node scripts/package.mjs ../numina-site-v4.0.0.tar.gz`. Builds, release artifacts and provenance originate only from protected `main` in `skott34-dot/numina-production`. **NUMINA is the provenance identity.** GitHub Actions, artifact attestations and Sigstore provide verification evidence for exact bytes; they are not a second Numina repository or authority.

Runtime signing keys, provider credentials and private records belong only in production secret/storage services. `.env.example` has no live credential values. The private JWK in `fixtures/demo-test-key.json` is explicitly an intentionally public reference-test fixture and must never be used for production authorization.

## Distribution

### Google Play Ignite

The authenticated rollout observations and unresolved declarations are tracked in [the September 15 evidence record](release-evidence/play-ignite-2026-09-15.md) and [issue #25](https://github.com/skott34-dot/numina-production/issues/25). `node scripts/check-play-readiness.mjs` checks source safeguards and reports remaining release evidence gates; it exits 1 while the release remains blocked. Builds run the source-only checks. To also verify the exact staged candidate bytes, use `node scripts/check-play-readiness.mjs --source-only --aab PATH_TO_AAB`. Current hosted source is 4.0.0; the requested upload candidate remains 3.0.0.

The mobile web app is served at `/app`. The v4 distribution retains Android 3.0.0 binaries and reuses the iOS executable with v4 bundle metadata. Actual input/output hashes and signing status are in docs/native-package-record-v4.json. The shared Numina distribution team policy and macOS signing host workflow are described in mobile/signing/APPLE-SIGNING.md. Android and iOS source candidates are 4.0.0 with build number 3 and have not been compiled. Prior 3.0.0 device binaries retain their exact hashes and build evidence in docs/native-package-record-v3.json. Native store publication is not established. The integration kit supports documented provider formats and local MCP configuration; publication does not install it in third-party LLM products.

## Source and rights

`src/` contains the Worker, `public/` the website, `docs/` downloadable specifications, and `vendor/numina-core-v1.8` the preserved core. Existing tests and historical fixtures remain source material. The restored provenance workflows operate inside the canonical repository and bind exact build artifacts to NUMINA release records; deployment state still requires actual runtime/provider evidence.

The production GitHub repository is private. GitHub source, build logs and workflow artifacts require repository access. Vercel's connected project has Build Logs and Source Protection enabled. The public website and its explicitly published downloads remain available. No new open-source license or trademark license is granted; existing third-party notices and licenses remain applicable.

## Source alignment

Read [the source map](docs/Source-Alignment-v4.md). `node scripts/build.mjs` validates maintained package versions and generates `/source-alignment.json` from their actual source. Run `python scripts/package-distributions.py` after changing integration, plugin or native source files, then build. The existing root, journal and native treasury routes remain authoritative across L1–L5. Historical evidence and reconstructed runtime sources retain their own identities.

## Connections

Open `/connections` to run current-session read checks across all 19 registered surfaces, follow their existing routes and export sanitized outcomes. The public manifest is `/api/connections/v1/manifest`; MCP discovery exposes the same registry through `numina_connections`. Checks use fixed same-origin destinations, bounded responses and deadlines. Initialization checks never call operational tools. Private responses are reduced to status before export. Existing endpoint authorization remains authoritative.

## Security

Numina maintains [one security and financial control model](docs/Numina-Security.md), available from every website interface at https://numinalabs.xyz/security. The document covers implemented controls, evidence, incident response and the operating requirements that remain unverified.
