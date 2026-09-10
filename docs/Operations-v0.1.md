# Numina Authority demo operations v0.1

Release 0.1.0 · 2026-09-10

## Deployment

Existing Sites project and custom domain are reused. The package contains `dist/server/index.js`, static assets in `dist/client`, and `dist/.openai/hosting.json`. D1 binding is `DB`. Runtime secrets stay in Sites environment settings. Tables are created idempotently by fixed application SQL. No request accepts SQL or database configuration.

`NUMINA_RECEIPT_PRIVATE_JWK` is a secret Ed25519 private JWK. `NUMINA_RECEIPT_PUBLIC_JWK` is its public counterpart. The deployed receipt key is separate from the intentionally public EAC fixture key. Never expose the receipt private key in source or logs. Rotate receipt signing with a new key ID and retain old public keys before changing keys. Current v0.1 uses one receipt key; no automated rotation is provided.

Build: `npm run build`. Tests: `npm test`. Local service: `npm start`, bound to 127.0.0.1:8787. Local development generates an ephemeral receipt key each startup; old local receipts will not verify against the new key. Deployed keys persist in Sites.

## Limits and durability

- Body limit: 8,192 bytes, measured while streaming; only canonical JSON, no content encoding.
- API rate limits: 30 requests/minute per platform IP, 300/minute globally, shared in D1. Health is a minimal liveness exception. Static assets are served by the platform. These are application limits, not a comprehensive DDoS guarantee.
- Ledger and violation tables each stop accepting new rows at 10,000. No automatic event/nonce deletion; deleting events weakens replay protection. Raise capacity only after storage review. A full event ledger fails closed. Full violation storage still returns a downloadable signed receipt marked `persisted: false`.
- Rate buckets expire and are cleaned by subsequent requests. Logs contain no raw credentials, private keys or IP addresses. Hashes and receipt IDs are test pseudonymous data.
- Commit atomicity covers the event and signed receipt in the same D1 row. It does not cover an external execution system. Read errors never become valid authorization.

## Observability

GET `/api/v0.1/health` proves the worker responds, not storage readiness. GET `/api/v0.1/status` checks database access and signing configuration; GET `/api/v0.1/coverage` reports ledger counts and structural receipt gaps. Response headers expose Numina version/profile and request ID. API responses are not cached. HTTPS, CSP, anti-framing, nosniff, referrer and permissions policies are set by the Worker.

Structured JSON logs: `http_request` contains request ID, route, method, HTTP status, outcome/reason when available, duration and version. `authority_decision` adds credential digest, receipt ID and persistence. View them through Sites worker logs. A separate external log sink, log retention SLA, uptime schedule, and alert recipient are not configured by this release. No claim of tamper-proof logs or continuous independent monitoring is made.

Investigate 503 immediately: inspect Sites logs, D1 binding/tables, and receipt key configuration. Inspect 429 for expected test traffic versus abuse. Alert on nonzero receipt gaps, high table counts and unexpected version changes. External monitors should check health/status at a reasonable interval and run conformance only when appropriate because it writes a simulated event.

## Rollback and recovery

Retain the previously saved Sites version. Redeploy it to roll back the website; the prior static version has no verifier. Preserve the D1 database and runtime keys. Never clear replay state as a deployment fix. Before a future destructive schema change, export/backup state and rehearse restoration with nonce preservation. Backups, restore drills, and automatic rollback are not verified in this run.

## Scope limitations

No financial execution, authenticated issuer identity, delegation, live revocation registry, institutional recognition, independent audit, or exact C1–C14 mapping. Authority Coverage checks this ledger only. This release does not prove universal bypass prevention. Use only synthetic data; receipt URLs expose non-sensitive test receipts to anyone holding their opaque identifier.
