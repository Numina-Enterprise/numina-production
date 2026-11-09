# Local Stripe Treasury MCP module (local admin console only)

Status as of 2026-11-09 (CST). Code lives in `local/treasury/`, tests in `tests/treasury/`.
**Local only:** nothing under `local/` is imported by `src/worker.js`, the `src/` tree, or `scripts/build.mjs`
(checked by `tests/treasury/isolation.test.mjs`). It is mounted only by the local console
(`npm run local-admin`, 127.0.0.1) at `/admin/treasury/*`, and it refuses requests whose Host is not loopback.

Source of truth: <https://docs.stripe.com/treasury/agents> and <https://docs.stripe.com/mcp> (read 2026-11-09).
The full tool table is in `TOOLS-FOUND.md` delivered with this patch; `local/treasury/registry.json` is the
single registry that adapters are generated from.

## Configuration (per Sam, 2026-11-09 09:45 CST: "This is a production deployment")

| Setting | Value |
| --- | --- |
| Profiles | `sandbox` and `live`, configured separately (different env var names, different encrypted session files, different OAuth sessions). Default profile: `sandbox`. |
| Adapters | All 16 registry tools enabled in both profiles. A tool can be switched off per profile (`{"enabled":false}`). |
| Numina internal locks | **None.** No compliance-gate lock, no sign-off lock, no attorney lock, no live hard-disable, no typed per-call confirmation. |
| Stripe live money-movement approval | Always `required`. Any config recording it as off/optional/skipped is rejected, and arguments that try to skip or pre-answer approval are never sent. The only approval field passed through is a top-level token field the server's own `inputSchema` declares (Stripe's documented "approve in Dashboard, then retry" flow). |
| Compliance screening | Informational. If `local/compliance/index.mjs` exports `screen()` (or `gate()`), its result is written to the audit log; it never blocks. Absent module is recorded as `not_installed`. |
| Audit log | Append-only JSONL, SHA-256 hash chain, each entry Ed25519-signed when `NUMINA_TREASURY_AUDIT_SIGNING_KEY` (PKCS#8, base64 DER or PEM) is set. Records every attempt (ok, pending approval, blocked, error) with an args digest and amount/currency fields only; no tokens, keys, recipient ids or bank details. |
| Secrets | Only from environment variables or the AES-256-GCM session file outside the repo. Never stored in config, never logged. |

Default environment variable names (values are never written anywhere):

| Purpose | sandbox | live |
| --- | --- | --- |
| Agent API key (if `auth.method` = `agent_api_key`) | `NUMINA_STRIPE_MCP_SANDBOX_AGENT_KEY` | `NUMINA_STRIPE_MCP_LIVE_AGENT_KEY` |
| OAuth session file key (base64, 32 bytes) | `NUMINA_TREASURY_SANDBOX_TOKEN_KEY` | `NUMINA_TREASURY_LIVE_TOKEN_KEY` |
| Session file | `~/.numina/treasury-mcp/sandbox.oauth-session.enc` | `~/.numina/treasury-mcp/live.oauth-session.enc` |
| Audit log / signing key env | `~/.numina/treasury-mcp/audit.jsonl` / `NUMINA_TREASURY_AUDIT_SIGNING_KEY` | same log, `profile` field per entry |

Config file: `local-data/treasury-mcp-config.json` (git-ignored), edited via `PUT /admin/treasury/config` with the admin token.

> **Agent API key deadline:** Stripe MCP stops accepting full-access secret keys and restricted keys without the
> Agent tag in December 2026. Use agent API keys or OAuth; migrate by **2026-11-30**. Unsupported keys get a 401 with
> an OAuth discovery challenge.

## How a call runs

1. Profile resolved (default sandbox); tool must be in the registry and enabled for that profile.
2. `initialize` + `tools/list` discovery against that profile's server; the tool must be returned by the server.
3. Approval guard, semantic validation (amounts as integer minor units or decimal strings, ISO 4217 currencies,
   Stripe ids), adapter checks, then validation against the **server-provided** `inputSchema`.
4. Compliance screen (informational) -> `tools/call` -> result. A Stripe "requires approval" result is returned as
   `pending_stripe_approval` with the Dashboard URL; approve there, then retry.
5. Audit entry appended for every outcome.

## Console routes (`npm run local-admin`, then http://127.0.0.1:8790)

Reads: `GET /admin/treasury`, `/status`, `/tools`, `/config`, `/sessions`, `/sessions/runbook`, `/audit`, `/audit/verify`.
Writes (need `Authorization: Bearer $NUMINA_LOCAL_ADMIN_TOKEN`): `PUT /config`, `POST /discover?profile=`,
`POST /call/<tool>` with `{"profile":"sandbox","args":{...}}`, `DELETE /sessions/<profile>`.

CLI: `npm run treasury -- status | tools | sessions | runbook | revoke --profile P | audit [--verify] | login --profile P | discover [--profile P] | call <tool> --profile P --args '{...}'`.
`login`, `discover` and `call` contact the configured server; the rest are local.

## OAuth

OAuth 2.1 authorization code + PKCE (S256) per the MCP authorization spec: protected-resource metadata (RFC 9728),
authorization-server metadata (RFC 8414), dynamic client registration (RFC 7591) when offered, browser consent,
loopback redirect on `127.0.0.1:<ephemeral>/callback`, code exchange with the `resource` indicator (RFC 8707),
refresh on 401. Tokens are saved only encrypted, per profile.

## Revoking sessions

Local: `DELETE /admin/treasury/sessions/<profile>` or `npm run treasury -- revoke --profile <profile>` deletes the
encrypted token file. Stripe side (from docs.stripe.com/treasury/agents):
- Your sessions: user settings > OAuth sessions > find the client > overflow menu (⋯) > Revoke access.
- As an administrator: Team and security > select the member > OAuth sessions > overflow menu > Revoke access, or Revoke all.
- Revocation is scoped to the account/organization and environment you are viewing: do it in both sandbox and live.
- Agent API keys: expire the key in the Dashboard and unset the env var.

## Tests (mock only)

`npm run test:treasury` runs `tests/treasury/*.test.mjs` against a local mock MCP + OAuth server on 127.0.0.1.
A global fetch guard and `NUMINA_TREASURY_NETWORK_GUARD=loopback-only` refuse any non-loopback request.
The mock's tool input schemas are guesses; real schemas come from `tools/list` at run time.

## Not verified against the live server

Exact tool input schemas, the exact shape of Stripe's "requires approval" response and the retry/approval-token
field, OAuth scopes and whether mcp.stripe.com supports dynamic client registration, agent API key prefixes, and
`stripe_reports` (seen only in a search-index snapshot of the docs). None of this module has contacted Stripe.
