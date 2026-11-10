# MCP authentication inventory (Numina 5.0.0)

Recorded 2026-11-09 (America/Chicago). No live network calls were made to Stripe or other providers while building this table.

| Connection | Path | Role | Transport | Provider | Before | After | Provider supports | Test status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stripe Treasury MCP (local admin) | `local/treasury/*` → `https://mcp.stripe.com` | client | Streamable HTTP | Stripe | OAuth **or** `agent_api_key` | **OAuth 2.1 only** (PKCE S256, public client, resource, iss; agent API key removed) | OAuth for MCP (docs.stripe.com/mcp); agent keys being retired | `tests/treasury/*` (mock) |
| Stripe MCP (Cursor, developer tooling) | `.cursor/mcp.json` → `https://mcp.stripe.com` | client config | Streamable HTTP | Stripe | none | **OAuth only** (URL in config, no API key) | OAuth for MCP | Config-only. Not used by the website Worker. Website checkout is `src/stripe-checkout.js` |
| Numina control MCP | `src/frontier-http.js` `/api/control/v2/mcp` | server | Streamable HTTP | Numina (self) | Owner/agent **Bearer** (SHA-256 of `NUMINA_*` credential) | **Unchanged** — existing Bearer; no OAuth AS hosted | Self-issued bearer; full OAuth 2.1 AS **not** implemented (honest: out of reach this release) | Existing frontier/control tests |
| Numina discovery MCP | `src/frontier-http.js` `/api/control/v2/discovery-mcp` | server | Streamable HTTP | Numina (self) | Public read-only (no auth) | **Unchanged** public discovery | N/A (public) | Existing discovery tests |
| Sites MCP | `src/sites-mcp-http.js` `/mcp` | server | Streamable HTTP | Numina (self) | Sites identity headers **or** existing control Bearer for owner tools; public tools unauth | **Unchanged** | Self; no OAuth AS | `tests/sites-mcp.test.mjs` |
| Integration kit local MCP | `integrations/numina/bin/mcp-stdio.js` + `src/mcp.js` | server | **stdio** | Numina (local) | stdio, no OAuth | **stdio, spec-exempt** (MCP auth spec: stdio SHOULD NOT use OAuth) | N/A | `integrations/numina/tests/*` |
| Control stdio bridge | `integrations/numina/bin/control-mcp-stdio.js` | client (host-facing stdio) | stdio → HTTP | Numina production | Bearer `NUMINA_API_TOKEN` from env | **stdio, spec-exempt**; HTTP still uses env bearer (provider requires existing owner token; no OAuth AS to speak to) | Numina Bearer today | Kit / INSTALL docs |
| Codex plugin discovery | `integrations/codex/numina/.mcp.json` | client config | HTTP | Numina discovery | none (public URL) | **Unchanged** | Public discovery | Config-only |
| GitHub agentic workflows MCP | `.github/mcp.json` | client config | **stdio** (`gh aw mcp-server`) | GitHub CLI | local stdio | **stdio, spec-exempt** | GitHub CLI local | Config-only |
| Treasury mock AS/MCP | `tests/treasury/mock-mcp-server.mjs` | mock server | HTTP (loopback) | test double | OAuth mock + optional API key | OAuth 2.1 mock (iss, refresh_token, PKCE) | N/A (test) | treasury suite |

## Shared OAuth module

`local/treasury/oauth.mjs` is the shared client. Default `{oauth21:true}` enforces Stripe/OAuth 2.1 rules. Pass `{oauth21:false}` for providers that only expose OAuth 2.0-style metadata (resource/iss optional). Do not force OAuth 2.1 onto a provider that does not advertise it.

## Hosted authorization server

This release does **not** ship an OAuth 2.1 authorization server for Numina-hosted MCP. Control and Sites MCP continue to use the existing owner/agent Bearer model. Adding protected-resource metadata + a full AS is future work; it is not faked here.
