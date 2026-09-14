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

Numina v4 keeps the `1.9.0-rc26` verifier and frozen 1.8.0 core identities. `/v2/release/manifest` and `/v3/release/manifest` remain aliases of the current inventory; the JSON schema stays `numina.application-release.v2`. Native 4.0.0 sources use build number 3 and have not been compiled. This distribution retains Android 3.0.0 binaries and reuses the iOS executable with v4 bundle version metadata; its original build and changed archive hashes are recorded explicitly. The hosted application can update independently of these native launchers.

The canonical treasury remains one 500,000,000,000,000 NUSD native projection shared across L1–L5 through `readTreasury()` and `writeTreasury(event)`. Funding status comes from `/api/control/v2/treasury/accounts`, not duplicated static balances. This release performs no treasury write or external transfer.
