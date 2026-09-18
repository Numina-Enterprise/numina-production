# Numina 4 source alignment

Numina is the existing authority root. The website, Numina OS, native clients, integration kit and Codex plugin use the same production control journal and native treasury. Each architecture layer extends that record.

| Layer | Canonical responsibility | Source |
| --- | --- | --- |
| L1 | Root, state, journal and blockchain observation | `src/control.js`, `src/control-store.js` |
| L2 | Intent, scoped requests and evidence lineage | `src/frontier.js` |
| L3 | Agent principals, delegated authority, policy and human approval | `src/control.js`, `src/frontier.js` |
| L4 | Governed execution, provider preparation, MCP and A2A | `src/frontier.js`, `src/frontier-http.js` |
| L5 | Signed provenance and the singular NUSD projection | `src/frontier-http.js`, `src/native-treasury.js`, `src/native-treasury-model.js` |

The canonical root identity is retained in `mobile/signing/release-identities.json`; its head is read at `/api/control/v2/head`. Current control state and treasury are `/api/control/v2/state` and `/api/control/v1/treasury`. A package does not initialize another root or duplicate an account balance.

All five layers inherit the shared treasury reference in `/api/control/v2/architecture`. It identifies one NUSD balance, `readTreasury()` and `writeTreasury(event)`. The business metadata and `/source-alignment.json` reference that same treasury. Live amounts and funding status come from the authenticated `/api/control/v2/treasury/accounts` response, never from a static release value. The build rejects conflicting routes or a hard-coded original funding-plan status.

The funding panel displays `nativeFundingView.status` alongside the original plan and owner-declaration receipt links. The current native `FUNDED_PLAN` status derives from the recorded owner declaration; the original signed plan retains its historical status. Website and integration clients check that the derived view agrees with its source fields, native projection, revision and head. These consistency checks do not independently verify external reserves or settlement.

The product and maintained packages are version 4.0.0. Existing HTTP and receipt schemas retain v1/v2 identifiers for compatibility. Platform certificates retain their actual issuer and status. The reconstructed rc26 verifier is deployed with its own source and artifact identity. The frozen v1.8 core and historical build assessments retain their original identities. The existing owner, journal, treasury and native signing identities are preserved.

The build runs `scripts/source-alignment.mjs`. It rejects inconsistent maintained versions, stale integration file inventories, changed runtime pins or mismatched Android release identity. The resulting `/source-alignment.json` lists source hashes, the shared routes and L1–L5. Its hash is included in the application artifact inventory.

After editing distributed sources, run `python scripts/package-distributions.py`, then `node scripts/build.mjs`. Packaging regenerates integration metadata, plugin and native source archives and verifies their bytes. Existing native binaries retain their exact builder/source records. Recompile when native executable inputs change. These commands do not run application tests, submit store applications or create financial receipts.

The rc26 singularity binding and restored owner-authenticated revocation route are documented in RC26-Singularity-v3.md. The native treasury remains one 500T NUSD projection with original signed history preserved.

Numina v4 keeps the `1.9.0-rc26` verifier and frozen 1.8.0 core identities. `/v2/release/manifest` and `/v3/release/manifest` remain aliases of the current inventory; the JSON schema stays `numina.application-release.v2`. Maintained source is Android 4.0.0 / build 4 and iOS 4.0.0 / build 6. `native-package-record-v4.json` records signed Android 4/build 3 binaries and the unsigned iOS 4/build 5 bundle compiled from `cd28af207f39fe8ba010ef83eafbd832448ffbbf`. Prior Android 3 and iOS build 3 preparation records retain their original identities under the historical records referenced there. Manifest generation checks the recorded artifact bytes; it does not compile, re-sign, install or submit these binaries. The top-level `nativeBuildNumber` is the Android package version code; `nativeSourceBuildNumbers` reports both platforms separately. The hosted application can update independently of the native launchers.

The application inventory, source-alignment inventory and integration distribution share `treasury_client_verification`. This descriptor identifies the canonical treasury/account routes, account grouping and source-consistency checks, and the SHA-256 of the identical website/integration verifier bytes. The build rejects stale integration metadata. These checks use the authenticated response and do not independently verify provider accounts or enable financial execution. Integration packaging refreshes its file inventory and archive hash when the verifier changes.

`recorded_release_evidence` retains the original dated receipt content. `recorded_release_evidence_context` and the release UI label it historical. Current artifact identity is the generated `build_id`; historical publication receipts do not establish deployment of that build. Current native distribution metadata comes from `distribution.native_candidates` and its own recorded workflow evidence.

The canonical treasury remains one 500,000,000,000,000 NUSD native projection shared across L1–L5 through `readTreasury()` and `writeTreasury(event)`. Funding status comes from `/api/control/v2/treasury/accounts`, not duplicated static balances. This release performs no treasury write or external transfer.

## Source-input hash scopes

The top-level `sourceInputs` array in `/source-alignment.json` has one entry per path, in ascending order, with the byte count and SHA-256 of the exact checkout bytes (`sourceInputHashMode: raw_file_bytes`). Its nested `iosSource.sourceInputs` submanifest separately declares UTF-8/LF text normalization for portable iOS packaging. Never compare a normalized digest to raw Windows file bytes without applying that declared representation. No source or certificate-request bytes are changed to reconcile these two scopes.

The local generator reports source consistency only. It does not attest a public deployment, a native compile, an App Store upload, or a treasury/account update. Historical release evidence and preserved binary artifacts are not regenerated as current execution evidence.

## Current-build use

Active release reads use `/v4/release/manifest` with caching disabled. The integration client requires application 4.0.0 and the separately pinned rc26 dependency; older application releases returned on that route are rejected. The control room validates the current application, control and plugin versions plus the build identity before displaying them, and refreshes that identity with the workspace. A failed or superseded read cannot restore an old current-build label.

The installed web app requires a live connection. Its service worker removes prior Numina app caches and uses network requests with `cache: no-store`; it does not fall back to stored executable files after a failed request. This policy takes effect when the updated service worker activates; an already open document must reload to execute newly published code. Native launchers continue to open the canonical hosted application. Compatibility release aliases resolve the same current inventory, while explicitly historical artifacts retain their original identities.


## Production routing after the domain cutover

The public website is deployed on Vercel. `numinalabs.xyz` redirects to `www.numinalabs.xyz`; both domains have valid TLS. Vercel proxies the application API families to the existing Sites backend at `https://personal-space-m7q9.skott34.chatgpt.site`, preserving its D1 journal and R2 documents. Upstream routes must never point to either public website hostname, which would create a proxy loop. Wallet and deployment-readiness pages are served locally. Download fallback uses the existing backend and retains the recorded artifact identities.

The backend currently runs source `db71c054cda7442e4c5f357e9e27e542fd2a7db9`; it is not claimed to match the latest GitHub source. Android build 4 and iOS build 6 still require current-source signed artifacts and store submission receipts. The historical Android build 3 and iOS build 5 downloads are not relabeled as current-source builds.
