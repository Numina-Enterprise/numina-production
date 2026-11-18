# Command-Center Webhook — Endpoint Contract and Deploy Path

**Status:** code in the working tree only (uncommitted). No deploy, no DNS
change, no Stripe change in this task. The Singularity Protocol.

## What it is

A webhook receiver on the app that feeds a centralized command center: one
append-only event log for Stripe events, treasury gap-change notices,
quantum job status updates, and Gmail triage alerts. The feed and a plain
HTML view show the log to the operator.

## Endpoint contract

### POST /api/app/v1/command-center/webhook — receive a verified event

Two sender classes. An event without a valid signature is rejected before
anything is stored. No unauthenticated writes.

**Stripe events** — header `Stripe-Signature: t=<unix>,v1=<hex>`, verified
with `NUMINA_COMMAND_CENTER_STRIPE_SECRET` via `appVerifyStripe`
(HMAC-SHA256 over `timestamp.raw-body`, 300s tolerance, live mode only,
account must be `acct_1UEEPnQdJat0efmT`). Any Stripe event type is
accepted and logged (checkout sessions, payouts, invoices, …). The payment
webhook at `/api/app/v1/stripe-webhook` is untouched and stays the only
route that moves money; this log only records what happened.

**Internal events** (treasury / quantum / gmail) — header
`X-Numina-Command-Center-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 over
the same `timestamp.raw-body` construction, verified with
`NUMINA_COMMAND_CENTER_SECRET`, same 300s tolerance. Envelope (JSON):

```json
{
  "source": "treasury",
  "type": "treasury.gap_changed",
  "event_id": "treasury-gap-8-2026-11-14T21:30:00Z",
  "summary": "Gap 8 changed: deposit still 0 USDC",
  "payload": {"gap": 8, "balance_usdc": 0}
}
```

Rules: `source` is one of `stripe` (Stripe path only — never via the
internal HMAC path), `treasury`, `quantum`, `gmail`; `type` is
`[a-z0-9][a-z0-9._-]{0,119}`; `event_id` is required (idempotency key,
max 200 chars); `summary` optional (max 500 chars, else `source type`);
`payload` must be an object, max 16,384 bytes when stringified (larger
internal payloads are rejected 413 — send a concise summary instead).
Oversized Stripe events are still recorded with their identity intact and
`payload_truncated: true`; the full body stays in the Stripe Dashboard.

**Responses:** `{received: true, matched: true}` on first receipt,
`{received: true, replayed: true}` for a byte-identical retry of the same
`(source, event_id)`, `409 EVENT_ID_CONFLICT` for a different body under
the same id. Errors: `401 UNAUTHENTICATED` (no signature),
`400 INVALID_SIGNATURE` / `INVALID_EVENT` / `INVALID_JSON` /
`AMBIGUOUS_SIGNATURE` (both signature headers present),
`413 BODY_TOO_LARGE` / `PAYLOAD_TOO_LARGE`, `429 RATE_LIMITED`
(120/min per sender class), `503 COMMAND_CENTER_UNAVAILABLE` (secret not
configured — fail closed). Raw body max 262,144 bytes.

**Retention:** the log keeps the newest 1,000 events; older rows are pruned
in the same transaction as the insert.

### GET /api/app/v1/command-center/events — operator-only JSON feed

Requires a signed-in operator (Sites identity + `NUMINA_CONTROL_OWNER`).
`?after=<row id>&limit=<1..100, default 50>`; returns
`{events: [{id, source, type, event_id, summary, received_at, payload}],
next: <last id or null>}` in chronological order.

### GET /api/app/v1/command-center — operator-only HTML view

Server-rendered list of the latest 100 events, no JavaScript (CSP-safe),
all values HTML-escaped.

## Secrets (runtime only — never in the codebase)

- `NUMINA_COMMAND_CENTER_STRIPE_SECRET` — the `whsec_…` signing secret
  of the command-center webhook endpoint in Stripe (a second endpoint;
  Stripe generates a distinct secret per endpoint).
- `NUMINA_COMMAND_CENTER_SECRET` — HMAC secret shared with the internal
  senders (treasury cron, quantum scripts, Gmail triage). Provision it in
  each sender's environment; it is never committed, logged, or printed.

If either secret is absent, that sender class is rejected with 503.

## Storage

D1 table `numina_command_center_events` (see
`drizzle/0006_command_center_events.sql`, journal entry idx 6).
Additive only. It is **not** part of the v5.0.0 release record — do not
edit `scripts/release-manifest.mjs` or `releases/v5.0.0/` for this feature;
the migration ships with the next release cut.

## How to test locally

```bash
PATH=/home/hatch/workspace/.numina-tools/node-v26.13.1-linux-x64/bin:$PATH \
  node --test tests/command-center-webhook.test.mjs
```

9 tests: valid signed Stripe event accepted (incl. an arbitrary type such
as `payout.created`); unsigned / tampered / stale Stripe events rejected;
malformed payloads rejected; duplicates replay once, conflicts 409;
verified internal events per source; strict internal envelope; feed
pagination and HTML escaping; 1,000-event retention; missing secret fails
closed. Full suite: `npm test` from the clone (baseline after the PQC
build: 996 pass; this feature adds 9).

To try the endpoint by hand against a local Worker, set the two secrets in
the environment and sign a body: `t=$(date +%s)`, then HMAC-SHA256 of
`$t.<raw body>` with the secret, and send
`Stripe-Signature: t=$t,v1=<hex>` (Stripe) or
`X-Numina-Command-Center-Signature: t=$t,v1=<hex>` (internal).

## Deploy path (what it needs — nothing done here)

1. **Release cut (owner decision).** The code ships with the next release
   after v5.0.0 (version is the owner's call). No commit/tag/push in this
   task.
2. **D1 migration.** Apply `0006_command_center_events` to the
   production D1 database (`wrangler d1 migrations apply`) before the code
   serves traffic; without the table every webhook call fails.
3. **Serving path (owner decision).** The Worker already serves
   `/api/*` first (`run_worker_first` in `wrangler.jsonc`), so once the
   release is deployed the routes are live at
   `https://numinalabs.xyz/api/app/v1/command-center/webhook` (and
   `/events`, and the HTML view). Which deployment carries the release to
   numinalabs.xyz — the Cloudflare Worker or Cloud Run behind the load
   balancer — is a separate owner decision and is **not** part of this
   task. No DNS change was made here.
4. **Stripe (owner / Dashboard).** In the Stripe Dashboard, add a second
   webhook endpoint pointing at
   `https://numinalabs.xyz/api/app/v1/command-center/webhook`, and set
   its signing secret as `NUMINA_COMMAND_CENTER_STRIPE_SECRET`. The
   existing endpoint (`/api/app/v1/stripe-webhook`, for payments) stays
   as it is.
5. **Internal senders (owner).** Provision `NUMINA_COMMAND_CENTER_SECRET`
   to the treasury cron, the quantum job scripts, and the Gmail triage
   job, and have them sign as above. Nothing in this task sends or
   configures those jobs.

## Out of scope / known limits

- The existing failing Stripe endpoint (`/api/app/v1/stripe-webhook`,
  147 failed attempts since Nov 12, Stripe stops Nov 21) is a **separate**
  serving issue: the code implements it (POST-only, HMAC-verified), and a
  live GET returns 403 upstream of the app. Per the parent's Nov 14 note,
  the homepage now shows the live practice site rather than the
  placeholder recorded Nov 2, and a live-browser check of the webhook
  path is running; the fix path for that endpoint is TBD on that check.
  This task does not fix it and does not change it.
- The existing Numina Labs Command Center artifact (slug
  `numina-labs-command-center`) is unchanged; this extends the concept in
  the clone. Its KPI typo ("38 of 55 stuck" should read 42) is a
  parent-side artifact fix, not done here.
- The feed/view are operator-only; there is no per-customer view and no
  public feed. The log is append-only; there is no delete endpoint.
