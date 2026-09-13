# Numina 3 source alignment

Numina is the existing authority root. The website, Numina OS, native clients, integration kit and Codex plugin use the same production control journal and native treasury. Each architecture layer extends that record.

| Layer | Canonical responsibility | Source |
| --- | --- | --- |
| L1 | Root, state, journal and blockchain observation | `src/control.js`, `src/control-store.js` |
| L2 | Intent, scoped requests and evidence lineage | `src/frontier.js` |
| L3 | Agent principals, delegated authority, policy and human approval | `src/control.js`, `src/frontier.js` |
| L4 | Governed execution, provider preparation, MCP and A2A | `src/frontier.js`, `src/frontier-http.js` |
| L5 | Signed provenance and the singular NUSD projection | `src/frontier-http.js`, `src/native-treasury.js`, `src/native-treasury-model.js` |

The canonical root identity is retained in `mobile/signing/release-identities.json`; its head is read at `/api/control/v2/head`. Current control state and treasury are `/api/control/v2/state` and `/api/control/v1/treasury`. A package does not initialize another root or duplicate an account balance.

The product and maintained packages are version 3.0.0. Existing HTTP and receipt schemas retain v1/v2 identifiers for compatibility. Platform certificates retain their actual issuer and status. The reconstructed rc26 verifier is deployed with its own source and artifact identity. The frozen v1.8 core and historical build assessments retain their original identities. The existing owner, journal, treasury and native signing identities are preserved.

The build runs `scripts/source-alignment.mjs`. It rejects inconsistent maintained versions, stale integration file inventories, changed runtime pins or mismatched Android release identity. The resulting `/source-alignment.json` lists source hashes, the shared routes and L1–L5. Its hash is included in the application artifact inventory.

After editing distributed sources, run `python scripts/package-distributions.py`, then `node scripts/build.mjs`. Packaging regenerates integration metadata, plugin and native source archives and verifies their bytes. Existing native binaries retain their exact builder/source records. Recompile when native executable inputs change. These commands do not run application tests, submit store applications or create financial receipts.
