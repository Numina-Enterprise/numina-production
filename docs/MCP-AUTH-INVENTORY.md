# MCP authentication inventory (Numina 5.0.0)

Recorded 2026-11-09 (America/Chicago). No live network calls were made to Stripe or other providers while building this table.

| Connection | Path | Role | Transport | Provider | Before | After | Provider supports | Test status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stripe Treasury MCP (local admin) | `local/treasury/*` → `https://mcp.stripe.com` | client | Streamable HTTP | Stripe | OAuth **or** `agent_api_key` | **OAuth 2.1 only** (PKCE S256, public client, resource, iss; agent API key removed) | OAuth for MCP (docs.stripe.com/mcp); agent keys being retired | `tests/treasury/*` (mock) |
| Numina control MCP | `src/frontier-http.js` `/api/control/v2/mcp` | server | Streamable HTTP | Numina resource server | Owner/agent **Bearer** (SHA-256 of `NUMINA_*` credential) | Protected-resource metadata for `https://numinalabs.xyz/api/control/v2/mcp`; unauthenticated **401** with `WWW-Authenticate` `resource_metadata`. Issuer advertised is the configured GitHub Actions OIDC issuer. Numina does **not** host authorization-code, token, or OIDC discovery endpoints. Opaque owner bearer remains a pre-existing fallback and is not OAuth acceptance. No ChatGPT redirect is registered in this tree. | External GitHub Actions OIDC (`https://token.actions.githubusercontent.com`), audience = canonical resource, scope `numina.mcp`, plus the existing repository/workflow binding. Full local OAuth 2.1 AS **not** implemented. | `tests/mcp-resource-auth.test.mjs` |
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

This release does **not** ship an OAuth 2.1 authorization server for Numina-hosted MCP. Control MCP protected-resource metadata points only at the already configured GitHub Actions OIDC issuer. Sites MCP continues to rely on Sites-supplied identity headers and creates no issuer. A registered ChatGPT redirect URI was not found in repository configuration; authorization-code and PKCE acceptance stay fail-closed for the external issuer role. The connector gate is not closed by these source checks.
