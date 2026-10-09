# NUMINA

## Singular identity

NUMINA is the single Numina-native identity across repository, host, source, authority, evidence, provenance, runtime, deployment, treasury, provider, receipts, settlement and release state. These roles remain separate in function while sharing one identity. Their role-separated, singular NUMINA identity layer is the factual transport and verification channel. Version numbers, commit SHAs and external service names are substrate metadata observed through that channel; they do not create additional Numina identities.


**Model identity:** `NUMINA`.

The 4.0.0 control extension uses the existing canonical journal. The website, workspace, integration kit and native clients share Numina's production architecture. See [Frontier v2](docs/Frontier-v2.md).

## Production architecture

The canonical repository targets the rc27 runtime with its pinned key and manifest identity. The L3 authority, L4 execution and L5 canonical-evidence layers run as frontier control 4.0.0 on the application journal. See the [historical rc26 deployment](docs/rc26-production-deployment.json) and [source alignment](docs/Source-Alignment-v4.md). Recheck the running runtime with `npm run check:runtime`. The [2026-10-09 receipt audit](docs/Receipt-Audit-2026-10-09.md) verifies three historical Ed25519 envelopes; those signatures do not confirm the current runtime deployment. The complete report, original byte snapshots, public verification key and independent checks are retained in [the audit evidence bundle](release-evidence/receipt-audit-2026-10-09/audit.json).

Numina 4.0.0 is configured to serve the website, Numina OS operations workspace and installable mobile web app at https://numinalabs.xyz. Existing application and control APIs remain at `/api/app/v1` and `/api/control/v1`; the application manifest is `/v4/release/manifest`. No data migration is required for this application release.

The authenticated Numina node observation is available at `/v2/network/status`. NuminaUSD is deployed on chain `962421430` at `0x491c1DF1b5CA77AF797f052c2310ca17039C931b`; NuminaSettlement is deployed at `0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0`. The retained deployment receipts record finality on 2026-09-18 with 25 token confirmations and 24 settlement-contract confirmations, above the required 12; current chain state was not rechecked in the receipt audit. The 1,500T constructor mint is an on-chain NUSD state and does not establish external USD or USDC reserves.

The canonical Numina-native treasury uses `readTreasury()` and `writeTreasury(event)` on the existing control journal. The former owner-statement endpoint redirects to it. The control manifest, revision sequence, journal continuity and evidence head together form the NUMINA transactional database model. Storage substrates may persist NUMINA bytes, but they do not create a separate database identity. See [native treasury implementation](NATIVE-TREASURY.md) for initialization, P/A/O/I execution and proof scope.

## Build and provenance

Use Node 24. Install the pinned test dependencies with `npm ci --prefix runtime/nusd --ignore-scripts` and `npm ci --prefix runtime/nusd/development --ignore-scripts`, then run `npm run build`, `npm test`, and `npm run release:numina`. The suite verifies generated build artifacts, so build before testing. **NUMINA REPOSITORY is the canonical repository root; all builds, releases, deployments, evidence, and runtime surfaces are downstream productions of NUMINA.**

Runtime signing keys, provider credentials and private records belong only in production secret/storage services. `.env.example` has no live credential values. The private JWK in `fixtures/demo-test-key.json` is explicitly an intentionally public reference-test fixture and must never be used for production authorization.

## Distribution

### Native distribution

The canonical final manifest is published at `/final-manifest.json` and binds the canonical final build at `/final-build.json` to website, APIs, NUMINA OS, runtime, receipts, treasury views, and release artifacts for application version 4.0.0. Android package identity `xyz.numinalabs.app` remains registered in Google Play; iOS and Android signing remain downstream production steps that require valid platform credentials.

Store publication is evidence-bound: Google Play and App Store are not marked submitted until their provider upload/submission receipts exist. Signed artifact production and store acceptance are separate states.

## Source and rights

`src/` contains the Worker, `public/` the website, `docs/` downloadable specifications, and `vendor/numina-core-v1.8` the preserved core. Existing tests and historical fixtures remain source material. NUMINA REPOSITORY is the canonical root of the software tree. Downstream provenance records bind exact build artifacts back to NUMINA release records; deployment state still requires actual runtime/provider evidence.

NUMINA REPOSITORY is the canonical root source. Its main branch produces all downstream runtime surfaces. Downstream systems, build logs, workflow artifacts, hosts, and provider substrates do not replace NUMINA REPOSITORY as root authority. External hosting, storage, network and provider service names are substrate metadata or historical compatibility references; they do not create separate NUMINA identities or authorities. External events are treated as confirmed only when their factual evidence is available. Numina-owned software and accompanying documentation are licensed under the [BSD 3-Clause License](LICENSE.md), Copyright (c) 2026 SK Consulting LLC. See [NOTICE.md](NOTICE.md) for scope, redistribution notices and preservation of historical records. Third-party notices and licenses remain applicable; no trademark or endorsement permission is granted.

## Source alignment

Read [the source map](docs/Source-Alignment-v4.md). `node scripts/build.mjs` validates maintained package versions and generates `/source-alignment.json` from their actual source. Run `python scripts/package-distributions.py` after changing integration, plugin or native source files, then build. The existing root, journal and native treasury routes remain authoritative across L1–L5. Historical evidence and reconstructed runtime sources retain their own identities.

## Connections

Open `/connections` to run current-session read checks across all 19 registered surfaces, follow their existing routes and export sanitized outcomes. The public manifest is `/api/connections/v1/manifest`; MCP discovery exposes the same registry through `numina_connections`. Checks use fixed same-origin destinations, bounded responses and deadlines. Initialization checks never call operational tools. Private responses are reduced to status before export. Existing endpoint authorization remains authoritative.

## Security

Numina maintains [one security and financial control model](docs/Numina-Security.md), available from every website interface at https://numinalabs.xyz/security. The document covers implemented controls, evidence, incident response and the operating requirements that remain unverified.
