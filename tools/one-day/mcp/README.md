# Project 2: authorized MCP boundary — one-day review implementation

Status: local fixture and durable-store tests passed. No provider session,
production token issuer, live treasury/satellite action, deployment or runtime
signer binding has been established. The production routes are unchanged.

## What was built

- `authorization-boundary.mjs`: an isolated, narrow RFC 9068 ES256 JWT access-token
  profile. It requires a trusted issuer/resource, a configured key ID and an
  independently pinned SPKI SHA-256. It rejects token-selected keys/algorithms,
  ambiguous duplicate JSON members, changed signatures, wrong issuer/audience,
  expired/future/overlong tokens and insufficient scopes. Only configured
  read-only tools can receive an authorization decision; no tool is dispatched.
  Opaque tokens and other JWT profiles are intentionally unsupported.
- Protected resource metadata and PKCE S256 helpers. Callback validation checks
  exact state, expiry and issuer before code redemption, following the captured
  MCP spec. The helpers do not implement registration, metadata retrieval,
  token exchange, refresh, a network server or durable callback-session storage.
  A production client must use a reviewed OAuth SDK and securely consume its
  per-request state atomically. Never pass Numina bearer tokens to providers.
- `reservation-store.mjs`: a persistent SQLite adapter for the actual PR127
  `consumeAndReserve` contract. One `BEGIN IMMEDIATE` transaction checks trusted
  identity/mandate binding, consumes issuer-bound nonce and token ID, and reserves
  the cumulative amount. Units use BigInt and are persisted as decimal strings.
  WAL, `synchronous=FULL`, unique constraints, close/reopen and worker tests
  exercise local durability and concurrency. No in-memory fallback is accepted.
  Policy changes cannot reset a budget. Reservations are deliberately not
  released after ambiguous execution outcomes.

## Existing code reproduced

The relevant payment authorization and settlement recovery source is absent from
main `23c38e1e3a15e8f6559486ca024edb2faa3244cb`. It exists in unmerged
[PR127](https://github.com/Numina-Enterprise/numina-production/pull/127), captured
at `b4181eb325b89f541ba8cf96cc2568c7ac750ea4`.

`vendor/pr127/` contains six exact source/test Git blobs for payment verdicts,
settlement evidence/recovery and the Schedule J registry. The provenance JSON
records original Git blob SHA1 and content SHA256; an integrity test recomputes
both. These are review snapshots, not newly adopted production modules.

All 24 original tests run unchanged. A new integration test uses the actual
ES256/PoP verifier with SQLite and proves a consumed verdict cannot be replayed
after reopen. Fixture authority/issuer/agent keys are generated in memory and
are never written to files. No production signatures or trust keys are inferred.

## Run

From repository root:

```sh
TMPDIR="$RUNNER_TEMP" node tools/one-day/mcp/run-evidence.mjs "$RUNNER_TEMP/mcp-evidence.json"
```

For local use, set `TMPDIR` to an existing writable directory and choose a local
output path. `run-evidence.mjs` invokes the exact source snapshot and new tests,
records Node version, pass/fail counts and artifact hashes, and exits nonzero on
failure. Current captured result: **39 tests passed, zero failed, on Node
24.22.1**. GitHub-hosted Node **26.13.0** remains a distinct execution receipt.

Reuse an existing sanctioned GitHub-hosted job after runtime setup. Do not add a
runner declaration: `scripts/check-runner-policy.mjs` rejects new declarations
above its preserved count. The root build and this isolated suite must retain
separate status; one passing does not make the other pass.

## Promotion gates still open

1. Pin and independently verify the actual authorization server metadata,
   issuer key set, key rotation/revocation policy, resource and scopes. Do not
   substitute test keys or treat repository key strings as live signer evidence.
2. Complete provider-specific OAuth via approved SDK/client registration,
   secure state/token storage and explicit delegated scopes. SkyFi and SkyWatch
   adapters were not connected or exercised. Provider secrets are not included.
3. Integrate the boundary with the existing MCP transport and identity model
   after review. This code has no listener and no production routing changes.
4. SQLite is suitable only for workers sharing one trusted local database file.
   It is not a multi-region/shared-nothing production store. Distributed runtime
   adoption requires an independently reviewed transactional adapter and the
   same restart/concurrency tests against the actual storage service.
5. PR127 is a stricter internal experimental profile. A valid verdict permits an
   attempt; it does not prove payment, custody, independent finality,
   reconciliation, compliance or adherence to an entire Internet-Draft.
6. Obtain reviewed deployment/source binding and live runtime receipts before
   claiming any provider or production gate is cleared.

## Verified primary sources (retrieved 2026-11-02)

- [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):
  protected-resource metadata, exact issuer response comparison and RFC 8707
  resource indicators in both authorization and token requests; tokens must be
  intended for the receiving server. The July revision exists; no claim is made
  that this small boundary implements the full specification.
- [Official July specification announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/).
- [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707): resource URI binding.
- [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700): OAuth security BCP.
- [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636): PKCE S256.
- [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068): JWT access-token profile.
- [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207): issuer response parameter,
  referenced by the retrieved MCP specification; the separate RFC fetch was
  rate-limited, so its full text was not independently retrieved in this run.
- [Official Node downloads](https://nodejs.org/en/download): 26.13.0 LTS was
  listed at retrieval; the prior proposed 26.12.1 pin is not adopted here.

No external purchase, money movement, mint, cloud configuration change, provider
tasking, recipient outreach or production promotion was performed.
