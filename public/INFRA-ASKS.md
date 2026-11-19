# Infrastructure gaps — owner asks + decisions (Workstream C, Nov 19, 2026)

Cloudflare is owner-hand. No Cloudflare change was attempted. Each item below is
one owner ask (one line) plus the exact steps / prepared change.

## Gap 1 — Worker bindings unset: `NUMINA_CONTROL_API_KEY_SHA256` + `NUMINA_CONTROL_OWNER`

**Owner ask (one line):** In the Cloudflare dashboard for the `numina-production` Worker, set the secret `NUMINA_CONTROL_API_KEY_SHA256` to the SHA-256 hex digest of the high-entropy control API credential, and the variable `NUMINA_CONTROL_OWNER` to your owner email principal, then redeploy the Worker.

Why it matters (Verified from `src/control-http.js` + `src/worker.js`): the Worker reads
`env.NUMINA_CONTROL_API_KEY_SHA256` (falls back to a pinned value when unset) and requires
`env.NUMINA_CONTROL_OWNER` — without the owner binding, control-plane calls fail with
`AUTHORITY_CONFIGURATION_MISSING` (503). `wrangler.jsonc` declares no `vars`, so these are
dashboard-set, not config-set. `docs/Control-Plane-v1.md` confirms the same two settings.

Exact owner steps — Cloudflare dashboard (owner-hand):
1. Open Cloudflare dashboard → Workers & Pages → `numina-production` → Settings → Variables.
2. Add secret `NUMINA_CONTROL_API_KEY_SHA256` = the 64-hex-character SHA-256 digest of the API credential (the digest, never the credential itself).
3. Add variable `NUMINA_CONTROL_OWNER` = your owner email address as the `email:` principal.
4. Redeploy the Worker (Deployments → Redeploy, or re-run the deploy workflow).

Alternative — Mac Terminal (owner-hand, only if wrangler is logged in on that machine):
```
npx wrangler secret put NUMINA_CONTROL_API_KEY_SHA256
```
then paste the 64-hex digest when prompted (never paste the raw credential). `NUMINA_CONTROL_OWNER` has no `wrangler secret` equivalent as a plain variable; set it in the dashboard.

## Gap 2 — Repo secret `NUMINA_CONTROL_API_KEY` existence UNVERIFIED

**Owner ask (one line):** Open the repo Settings → Secrets and variables → Actions for `Numina-Enterprise/numina-production` and confirm a secret named `NUMINA_CONTROL_API_KEY` exists; if it is missing, create it (value = the high-entropy control API credential, entered only in that secrets form, never in chat).

Why it matters (Verified from `.github/workflows/`): **7 workflows** read
`secrets.NUMINA_CONTROL_API_KEY` — `sync-control-key-pin.yml` (derives the SHA-256 pin from it),
`diagnose-control-auth.yml`, `check-sites-control-origin.yml`, `align-native-treasury-500t.yml`,
`initiate-treasury-aggregate-model.yml`, `settle-numina-aggregate-model.yml`, and
`deploy-cloudflare.yml`. If the secret is missing, `sync-control-key-pin.yml` fails with
`NUMINA_CONTROL_API_KEY is not configured` and the treasury workflows skip their writes.

Flag — one secret, two jobs (owner to confirm intended): `deploy-cloudflare.yml:37` also uses
the same secret as `CLOUDFLARE_API_TOKEN` for the Cloudflare deploy. That means one value is
currently both the control-plane API key and the Cloudflare deploy token. If that conflation is
not intended, split them (separate Cloudflare API token secret for deploy) — owner decision.

How to verify without touching secrets (owner or parent): watch the next run of
`sync-control-key-pin.yml` — green means the secret exists; the `is not configured` error
means it does not. Secret values are not readable via the API, so this cannot be verified
from the VM.

## Gap 3 — Sign-in flow dead at Worker level (`/signin-with-chatgpt`)

**Owner ask (one line):** Confirm sign-in stays on the ChatGPT Sites host and confirm its exact sign-in URL, then apply the drafted Worker route in `worker-signin-route-DRAFT.js` (in this staging dir) to `src/worker.js`.

Why it matters (Verified): `app.html` links `/signin-with-chatgpt?return_to=%2Fapp`, and
`app-ui.js` / `frontier-ui.js` generate `/signin-with-chatgpt` and `/signout-with-chatgpt`
URLs — but `src/worker.js` contains **zero** occurrences of `signin` (grep count 0), so every
sign-in click on `numinalabs.xyz` 404s. Sign-in is documented as a Sites-platform feature
(`docs/Control-Plane-v1.md`: "Sign in with ChatGPT as the configured owner"; `privacy.html`:
"The application uses Sites hosting and sign-in"), and the retained application backend host
is `https://personal-space-m7q9.skott34.chatgpt.site` (`docs/Source-Alignment-v4.md`,
`docs/Receipt-Audit-2026-10-09.md`).

Prepared change (NOT applied): `worker-signin-route-DRAFT.js` in this staging dir — a
302-redirect route for `/signin-with-chatgpt` and `/signout-with-chatgpt` to the Sites host,
preserving `return_to`. The upstream base URL in the draft is the best-known value
(`https://personal-space-m7q9.skott34.chatgpt.site`) and is marked `OWNER-TO-CONFIRM` in the
file: if the Sites sign-in lives at a different path, only that one constant changes.
Insert point is the line before `return finish(await env.ASSETS.fetch(req));` in
`src/worker.js`. Do not apply until the owner confirms the upstream sign-in URL.

## Decision D1 — Republish `/economy` + `/blockchain`, or keep retired? (owner decision)

**Owner ask (one line):** Confirm the corrected `economy.html` / `blockchain.html` in this staging dir should be republished on deploy, or say keep-retired and I will withdraw them from the staged set.

Context (Verified by curl Nov 19): the live Worker serves a "Page retired — Numina Labs"
stub (200) for `/economy` and `/blockchain`, while the PR #204 branch holds full pages for
both. Deploying the branch as-is republishes them with the corrected Nov 5–6 contract
record. If the retirement was deliberate and should stand, the staged pages must NOT be
applied and the sitemap entries for `/economy` / `/blockchain` should be removed instead.

## Decision D2 — Nov 5–6 deployment receipt (data needed, not a decision to guess)

**Owner / Workstream A ask (one line):** Supply the Nov 5–6, 2026 NUSD deployment receipt (transaction hash, block number, deployer) so `business-core.json`, `nusd-contract-record.js` (via its generator), `treasury-connection-model.js`, and `/api/nusd/v1/*` can be updated from the Sep 18 record — no hash will be invented.

Context: the staged HTML pages are fully corrected without this data (they cite addresses +
dates only). The data files cannot be corrected without it, so they were deliberately left
unstaged — see `SITE-OVERHAUL-AUDIT.md` § "What was NOT changed".
