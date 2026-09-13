# Install Numina integration kit 3.0.0

Extract the ZIP to a trusted directory. Use Node.js 22 or later. The package requires no npm dependency install and is not an npm registry release.

## Local MCP-capable host

Use `examples/mcp-host.example.json` as a template. Replace the script placeholder with the actual absolute path to the extracted `bin/mcp-stdio.js`. Keep:

```json
{
  "NUMINA_BASE_URL": "https://numinalabs.xyz",
  "NUMINA_TOOL_PROFILE": "discovery"
}
```

Launch command: `node`; argument: that absolute script path. Restart/reload the host according to its instructions. The host should initialize the supported MCP revision and discover five tools, including `numina_application_release`. This is an installation procedure, not a record that an installation was performed.

The process communicates over stdio; an interactive shell may appear silent while awaiting JSON-RPC. Diagnostics use stderr. Host configuration formats vary. A remote-only host needs a separately implemented and authorized remote service; do not enter the Numina website URL as a claimed MCP endpoint.

## Provider API integration

Choose the exact adapter in [COMPATIBILITY.md](COMPATIBILITY.md). Import `NuminaClient`, `providerTools` and the executor from `src/index.js`. Supply your own configured official SDK client and permitted model; see `examples/provider-roundtrips.mjs`. The examples do not select a model, acquire credentials or run automatically.

Use the generated provider descriptor from `schemas/` or `providerTools(provider)`. Pass completed tool calls to the bounded executor, then return its provider-specific outputs using the matching call IDs and preserved conversation history. Default discovery is read-only. The host remains responsible for permissions, repeated turns, provider charges and any user confirmation required by its workflow.

## First release read

Call `numina_application_release` with `{}`. It targets `GET /v3/release/manifest`. The application version comes from that response; do not infer deployment success from the kit's own 3.0.0 version. A missing or incompatible server response is an error, not a fabricated fallback.

## Credentials and unavailable workflows

Public release/status/network/catalog reads need no token. Keep provider credentials in the host; this kit never sends them to Numina. Do not place secrets in prompts, model arguments, browser/mobile bundles or this archive.

Private status needs a real scoped server-issued Numina token. Quote/request additionally need the verified canonical NUSD asset pin and active server capabilities. They are not presently made available by this distribution. Do not reuse an owner credential to bypass missing onboarding. The package has no mint, transfer, settlement, payment-claim or result-unlock action.

Version 3.0.0 tests were not run. No provider account was configured, installed, certified or submitted as part of packaging.

## Runtime evidence read

Call numina_runtime_build with an empty JSON object. This reads the same public application manifest and returns its execution-runtime record and evidence links. RUNTIME_BUILD_UNAVAILABLE means that the current server manifest has no execution-runtime record; it is not a zero balance or an unsuccessful contract transaction. Signature and artifact verification remain separate, described in [EVIDENCE.md](EVIDENCE.md). No owner-only financial endpoints are accessed.

## Production control v2
Set NUMINA_API_TOKEN to your provisioned owner or delegated agent token, then use node bin/control-mcp-stdio.js as your MCP host command. It connects only to the production endpoint at https://numinalabs.xyz/api/control/v2/mcp. Live mode is enabled; no sandbox is provided. The existing discovery client is retained. See https://numinalabs.xyz/downloads/Frontier-v2.md for owner provisioning and human approvals.
