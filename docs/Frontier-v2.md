# Numina production control v2

Production origin: https://numinalabs.xyz. Workspace: `/frontier`. Capability manifest: `/api/control/v2/manifest`. This release uses `livemode: true`.

The existing control root, state, journal and `readTreasury()` / `writeTreasury(event)` remain canonical. Frontier records extend that same state. This release does not replace historical rc22/rc26 attestations or claim a new core-runtime release.

All private operations require the configured owner credential, the existing authenticated Sites session, or a registered agent bearer token. Agent credentials are stored as SHA-256 digests; use a cryptographically random token with at least 32 random bytes. Do not use a password. Register an immutable principal using the owner route, then use the existing `/api/control/v1/commands` delegation mechanism with an `agent:` subject. Grant scopes and resource prefixes can only narrow down the parent chain; revoking any parent invalidates its descendants.

## HTTP operations

Canonical JSON is UTF-8 JSON with object keys sorted recursively, no extra whitespace and safe integer numbers. Amounts are decimal integer strings. Each mutation body is `{ "id": "unique-command-id", "expectedRevision": 1, "data": { ... } }`. Reuse the exact body on retry. Read the current revision from `GET /api/control/v2/state`.

| POST path under `/api/control/v2/` | data |
| --- | --- |
| `principals` | `id` (`agent:name`), `name`, `credentialSha256` |
| `revoke` | `principal` |
| `policies` | `id`, `version`, `actions`, `providers`, `resourcePrefix`, `currency`, `maxAmountMinor`, `totalAmountMinor`, `requireHumanApproval`, `expiresAt` |
| `requests` | `id`, `Principal`, `Authority` (existing grant ID), `Objective`, `Intent`, `policyId` |
| `approvals` | `requestId`, `decision` (`ALLOW` or `DENY`), `expiresAt` (within one hour), `reason` |
| `prepare` | `requestId` |
| `execute` | `requestId` |
| `treasury/accounts` | `id`, `provider` (`stripe` or `bank-of-america`), `legalEntity`, `accountLabel`, `providerAccountReference` |

Intent has exactly `action`, `provider`, `resource`, `amountMinor`, `currency`, `payload`. Internal execution uses `record.write`, provider `internal.record.v1`, a `record:` resource, and amount `"0"`. External providers support prepared handoff records only. No external funds submission is enabled by this release.

`POST decisions` is read-only and takes `{ "requestId": "..." }`. It derives ALLOW, DENY or ESCALATE from the stored policy, current authority chain, bounds and approval. Approval is a separate owner-only journal event bound to the request hash and immutable policy hash. Clients cannot supply approval flags. Execution re-evaluates current state and expiry before its atomic journal commit.

`GET receipts/{command-id}` returns an Ed25519 signed provenance receipt. Pin the established public JWK from `GET keys` out of band. Verify the signed `{schema,keyId,payload}` with Numina canonical JSON. A caller-supplied key is not a trust anchor. Receipts identify internal journal scope and never invent provider confirmations.

## Agent transports

MCP: `POST /api/control/v2/mcp`, Streamable HTTP JSON responses, explicit compatibility version `2025-11-25`. Initialize before tool calls. Tools: `numina_request`, `numina_policy_decision`, `numina_prepare`, `numina_execute`. The mutation tool arguments use the HTTP body above. No SSE or server-originated requests are supported. This is a compatibility profile, not a claim of support for every newer MCP revision.

A2A: `/.well-known/agent-card.json`, JSON-RPC compatibility version `0.3.0`, `message/send`. Send a user message with one data part containing `{ "tool": "numina_policy_decision", "arguments": { "requestId": "..." } }`. Responses are Messages; streaming and push notifications are not advertised. Both transports use the same authentication, decisions, reducer and journal as HTTP.

## Treasury and distribution

`GET treasury/accounts` returns the singular native treasury plus owner-designated external account references. References do not establish provider ownership, balances, reserves, or settlement. Stripe live observations remain at `/api/control/v1/stripe-treasury`. Bank of America connectivity requires bank-authorized access.

The hosted website and mobile web app share this release. Native store approval and third-party marketplace publication are separate external states. Existing native wrappers point at the hosted application; no store approval is asserted.

Further tests were skipped at the owner's request. Build completion and production observations are reported separately.

## Architecture and adoption

Numina L3 (authority), L4 (execution) and L5 (canonical evidence) share one journal. See [Architecture-layers.md](Architecture-layers.md). Public MCP discovery is available at `/api/control/v2/discovery-mcp`; it reads architecture, capabilities and the current head without authentication. The Codex plugin uses that endpoint. Private operations remain at `/api/control/v2/mcp`. The web app runs on desktop and mobile browsers; native-store status is recorded separately.

## Policy decision batches

POST `/api/control/v2/decisions/batch` with canonical JSON `{"requestIds":["request-id"]}`. At most 100 unique request IDs are evaluated from one authorized state snapshot. The response includes revision, head, observation time and decisions. The control room uses one batch call for the displayed queue; a 50-request queue reduces decision HTTP calls from 50 to 1. Execution still re-evaluates policy and current authority at commit time. No wall-clock speedup benchmark is claimed.
