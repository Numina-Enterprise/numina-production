# Numina singular control plane 1.0.0

The production entry point is `/`. Public readiness is `/api/control/v1/health`. Sign in with ChatGPT as the configured owner, or as a delegate whose email was granted access. The existing Numina Labs pages remain under `/labs.html`; the frozen Core v1.8 source and reference calculations are preserved.

## Preserved architecture

One `DB` binding holds a single authoritative `numina_control_state` row. Every command compares the current revision, rechecks authority and evidence, and atomically changes that row with one hash-linked journal event. No browser storage is authoritative. The historical test ledger is preserved as read-only history and cannot authorize production commands.

One authority model uses a root identity and attenuated grants. Authentication maps the Sites dispatch identity or the owner's API credential to that same principal. The root is bound to `NUMINA_CONTROL_OWNER`; changing the configured root does not rewrite stored authority and instead makes the service unavailable. Delegation narrows scopes, record prefixes, and expiration. Revocation and expiry affect every descendant. Private state is filtered by the caller's authority; only the root can export the entire journal.

One interoperability registry supports **internal.record.v1** (legacy exact resource + plaintext payload) and **internal.commitment.v1** (opaque resource + client-prepared SHA-256 commitment, with no plaintext payload field). Both record only internal effects. The commitment route rejects unexpected fields, freeform IDs, non-opaque resources, and attestations. Unsupported external routes return `ESCALATE` and cannot execute. No external payment, trading, custody, or settlement adapter is connected. This release does not claim complete hosted certification of the preserved Core C1–C14 economic invariants.

One evidence graph records immutable operator attestations, explicit resolutions, dependencies, and committed record effects. Every node is hashed. Every state read validates the complete journal's revision sequence, hashes and links, its binding to the current state, and the evidence-node hashes. Contradictions, revoked resolvers, expired attestations, and invalidated parent evidence block pending execution. Operator testimony is labeled as testimony, not external system verification. Hashes detect inconsistency; privileged database administrators remain outside this application's security boundary.

One event-driven reconciliation function derives decisions for each mutation and each state/next-action read. There is no background scheduler or implied polling of external systems. Completed internal records remain historical facts; later authority changes do not erase them.

One verified-next-action endpoint returns `ALLOW`, `DENY`, or `ESCALATE`. An actionable token binds actor, request, whole-state hash, and revision. Execution recomputes the decision and token, then uses a database transaction-time expiry fence. Concurrent stale changes fail with 409 and require a fresh decision. Identical authenticated command retries return the existing result; reusing an ID for changed input is rejected.

## API

All mutation bodies are exact canonical JSON: UTF-8, sorted object keys, no extra whitespace, unique keys, safe integers. Requests are limited to 16 KiB and five seconds. Platform-IP limits are 30 API calls/minute and 300/minute globally; limits are shared in D1. Browser mutations require a matching Origin. API clients authenticate with the owner's bearer credential; the server retains only its SHA-256 digest in a secret environment variable.

- `GET /api/control/v1/health`: public readiness and integrity evidence, no private payloads.
- `GET /api/control/v1/manifest`: actual adapter and limit declarations.
- `GET /api/control/v1/state`: caller-scoped projection of the single state.
- `GET /api/control/v1/next-action`: current caller-scoped decisions and action tokens.
- `POST /api/control/v1/commands`: `{id,expectedRevision,type,data}`. Types: request, attest, resolve, delegate, revoke, execute, reconcile.
- `GET /api/control/v1/journal?after=-1`: root-only, 100 immutable events per page. `next` is the last returned revision.
- `POST /api/control/v1/bootstrap`: root-only explicit initialization, `{initialize:true}`. Available only for an empty journal and absent state. A missing state during normal operation returns 503 and is never implicitly recreated.

The journal stores canonical commands, actor, event time, prior hash, resulting state hash, and decision hash, allowing deterministic replay. Dependency provenance and exact adapter version are retained. Production commits are internal records in the same transaction as state/evidence; there is no external dual-write.

### Optional commitment-only private record route (draft, no production approval)

`internal.commitment.v1` accepts an opaque request ID and command ID (each exactly 32 lowercase hexadecimal characters) and a private resource `record:private/<32-lowercase-hex>`. The only `wants` keys are `resource` and `commitment`. The commitment is the text `sha256:<64-lowercase-hex>`. `requiredEvidence` **must be an empty list**. A valid commitment-only request may be committed to an internal record using the same revision- and actor-bound next-action protocol as the legacy adapter; its execution command ID must also be an opaque 32-character hexadecimal value. No external activity is permitted.

For confidential data, the **client** must generate a fresh high-entropy secret salt, compute a commitment over an unambiguous versioned encoding containing the salt and confidential content, and submit **only the commitment**. Preserve the salt and source payload separately under appropriately restricted access for a later authorized reviewer. Numina does not receive, encrypt, store, or verify that private payload, and cannot verify salt quality from a digest alone. Unsalted hashing of low-entropy identifiers is vulnerable to guessing and should not be used for privacy. A SHA-256 digest is **not encryption, selective disclosure, a zero-knowledge proof, BBS+ credential, or a signed receipt**.

This route reduces *content* stored for that class of record; it **does not eliminate identity information** about authenticated actors or grants, and it does not protect against a compromised client, a caller encoding personal details into other allowed fields, or privileged database access. Legacy `internal.record.v1` requests and historical journals still contain exact plaintext payloads. There is **no retroactive redaction**; do not rewrite historical journal bytes or delete nonce/replay evidence to force privacy.

Example synthetic command with no customer data:

```json
{"data":{"id":"11111111111111111111111111111111","requiredEvidence":[],"route":"internal.commitment.v1","wants":{"commitment":"sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","resource":"record:private/22222222222222222222222222222222"}},"expectedRevision":0,"id":"33333333333333333333333333333333","type":"request"}
```

Example uses a placeholder digest, **not** evidence of a real commitment. An actual client should compute the digest locally.

## Deployment and recovery

Build with `node scripts/build.mjs` and verify the generated distribution with `node scripts/sync-application-release-pin.mjs`. The generated Drizzle migration adds only the two control tables and one index; existing test tables and receipts remain intact. Schema changes are applied by Sites before Worker publication. Never edit applied migration history or clear journal/nonces to resolve a failure.

Runtime settings: `NUMINA_CONTROL_OWNER` is the owner's `email:` principal. `NUMINA_CONTROL_API_KEY_SHA256` is the secret digest of a high-entropy API credential. The deployment verification credential is held only in ignored local work files; the browser does not receive it. Rotate the digest through Sites environment settings and redeploy the same saved version. Preserve the root identity and database when rotating credentials. Legacy receipt signing is retired; its public key remains available for historical receipt verification.

The application-level 2,048-command and 512 KiB serialized-state stops were removed on 2026-09-15, retaining the singleton and complete journal. Operation-specific bounds remain: 100 requests, 100 grants, 400 evidence nodes and the frozen native treasury reducer's 100 prepared requests. Request-body limits, integer precision, provider storage quotas and runtime resource limits remain enforced. Reads still verify the full journal; their cost grows with its length. There is no automatic deletion, archival or replacement root. Retained validation records cover crossing the former journal/state thresholds and restarting from the same persisted database. No independently tested backup restoration, continuous uptime alerting, or external execution is claimed.

Rollback uses the previous saved Sites version while retaining DB and keys. The prior version is the public test service; rolling back would remove the new control interface. Do not describe that rollback as equivalent control-plane enforcement. Investigate 503 via worker logs and integrity evidence before retrying commands.
