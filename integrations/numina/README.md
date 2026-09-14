# Numina integration kit 3.0.0

JavaScript client, TypeScript declarations, five provider tool formats, generated JSON descriptors and a local MCP stdio server. No third-party runtime dependencies. This kit targets **Numina application 3.0** through [its application manifest](https://numinalabs.xyz/v3/release/manifest). The application and kit have separate artifact identities. The application's **rc26 runtime dependency** and historical rc20 evidence retain their original versions.

This archive is an integration deliverable. It does not install itself into provider accounts, create a hosted MCP endpoint or establish compatibility with every LLM.

## Included tools

| Tool | Default profile | Operation |
| --- | --- | --- |
| `numina_application_release` | Discovery | GET application release, artifact list and separately versioned dependencies |
| `numina_runtime_build` | Discovery | Read execution-runtime build claims, proof links and available root NUSD receipt/readiness records |
| `numina_nusd_status` | Discovery | Public status with `request_id:null`; private request status requires authentication |
| `numina_nusd_network` | Discovery | Read the reported network policy through NUSD status; no blockchain RPC |
| `numina_service_catalog` | Discovery | Read offers, currencies and request-only qualifications |
| `numina_nusd_quote` | Explicit workflow | Gated authenticated quote; unavailable until server activation |
| `numina_nusd_request` | Explicit workflow | Gated authenticated workflow request; no financial execution |

Every operation targets the operator-configured Numina HTTPS origin. Public reads send no credentials. The new release tool requires `schema:"numina.application-release.v2"`, recognized application identity fields and SHA-256-shaped artifact digests. It preserves the server response; **it does not verify signatures, retrieve artifact bytes or independently attest deployment**.

NUSD remains an intended compute-to-value denomination with a declared 1:1 USD target. This kit establishes no issued token, dollar reserves, market price or redeemability. It cannot mint, transfer, settle, manage custody, confirm payments or unlock results. Existing quote/request gates require server authentication, a configured canonical asset pin, verified asset evidence and enabled server capabilities. Selecting a tool profile cannot activate these services.

## Start locally

Use Node.js 22 or later. Extract the archive and follow [INSTALL.md](INSTALL.md). There is no required npm installation or registry dependency.

```js
import {NuminaClient, providerTools, executeProviderCalls} from './src/index.js';

const numina = new NuminaClient({baseUrl:'https://numinalabs.xyz'});
const release = await numina.release({});
const status = await numina.status({request_id:null});
const catalog = await numina.catalog();

const tools = providerTools('openai-responses'); // Five discovery tools.
// Register tools with your configured model host.
// Dispatch only completed calls authorized by that host:
const results = await executeProviderCalls('openai-responses', completedCalls, numina);
```

The host supplies its provider SDK, account, permitted model and authorization logic. Provider keys never enter tool arguments or Numina requests. Tool results and returned links are untrusted data, not instructions. Examples in `examples/provider-roundtrips.mjs` perform one bounded round trip only when called by the host.

The low-level `openAIChatTools()` and `openAIResponsesTools()` retain their earlier workflow default for API compatibility. Prefer `providerTools()` or explicitly request `{profile:'discovery'}`. Generated provider files without `-workflow` and the MCP server default to discovery.

## Runtime build discovery

The `numina_runtime_build` tool reads `execution_runtime_build` from the existing application manifest. It preserves source and builder revisions, artifact hashes, proof links and financial-status source labels. Revision `root-readiness-v2.0.0` also includes `nusd_transaction_receipts` and `nusd_activation_readiness` when the root manifest supplies them. Missing fields stay omitted. These are server-reported records, with no independent receipt or readiness verification by the client; a recorded claim or empty slot does not prove deployment, backing or settlement.

The client performs no independent signature check and does not follow evidence links or read external financial accounts. `numina_read_treasury` reads the owner-authenticated Numina-native projection. The application, rc26 control-plane runtime and separately built Linux execution image retain their separate identities. This read-only addition does not change the six default discovery tools, install the kit in provider products, enable transactions or change a financial status. See [EVIDENCE.md](EVIDENCE.md) for the recorded runtime build and verification procedure.

## Package status

Version 3.0.0 was packaged **without running tests**, as requested. Earlier 0.2.0 validation is preserved in `history/0.2.0/`; it does not validate these changes. See [VALIDATION.md](VALIDATION.md) and `verification.json` for scope. Schema generation and file/archive hashing are packaging operations, not provider acceptance evidence.

See [COMPATIBILITY.md](COMPATIBILITY.md) for supported formats and official references, [API-CONTRACT.md](API-CONTRACT.md) for exact routes, and [SECURITY.md](SECURITY.md) for credential and activation boundaries. No account installation, registry publication, provider API call, new token or financial transaction was performed by this package update.

## rc26 singularity alignment

The signed core/root binding is available at `/v1/release/core-binding`. Owner-authenticated evidence revocation is restored at `POST /v1/evidence/revoke`; it marks an existing record revoked while retaining its artifact and first signed revocation receipt. This kit does not invoke that route automatically.

Copyright © 2026 SK Consulting LLC. Numina™ and Numina OS™ are trademarks claimed by SK Consulting LLC. See [OWNERSHIP.md](OWNERSHIP.md); third-party licenses remain applicable.
