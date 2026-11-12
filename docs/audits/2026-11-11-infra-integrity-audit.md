# Infrastructure integrity audit (2026-11-11)

Base: `main` at `aa822bb2` (merge of PR #167). Read-only observation of GitHub Actions, Cloudflare
deployments (`wrangler deployments list`), public DNS and public HTTP responses. Nothing was deployed;
no DNS, route, Worker setting, secret or `workers_dev` change was made.

## 1. `workers.dev` inventory

`git grep -n -I 'workers\.dev'` plus Worker config flags. Host in every case: `numina-production.skott34.workers.dev`.

| # | File:line | What | Class | Reason |
|---|-----------|------|-------|--------|
| 1 | `.github/workflows/check-sites-control-origin.yml:21` | `NUMINA_WORKER_ORIGIN` | LIVE | Production-environment workflow reads `/api/control/v1/treasury` from the Worker with the owner credential. |
| 2 | `config/numina-routing.json:74` | rewrite `/api/control/v2/:path*` | LIVE (declared) | Production routing manifest names the Worker as the control-v2 backend. The Worker itself serves this path natively (`src/worker.js:108`), so the rewrite is used by manifest consumers, not by the Worker front door. |
| 3 | `config/numina-routing.json:78` | rewrite `/.well-known/agent-card.json` | LIVE (declared) | Same as #2. |
| 4 | `tests/production-routing.test.mjs:9` | `controlV2Backend` | DEV-ONLY | Test fixture asserting #2/#3; must move in lockstep with them. |
| 5 | `release-evidence/RELEASE-ATTESTATION.md:21` | prose ("workers.dev/preview URLs") | STALE | Historical attestation scope text; no URL; protected evidence. |
| 6 | `wrangler.jsonc:20-21` | `"workers_dev": true`, `"preview_urls": true` | LIVE (config flag) | Keeps the workers.dev host and preview URLs enabled on every deploy. |

Counts: LIVE 3 references (+1 config file with 2 flags), DEV-ONLY 1, STALE 1.

### Why no reference was moved to `numinalabs.xyz`

* `numinalabs.xyz` and `www` resolve to Cloudflare (NS fred/lola.ns.cloudflare.com) and are routed to the same
  Worker (`wrangler.jsonc` routes). Rewriting #2/#3 to `https://numinalabs.xyz/...` would point the Worker back at
  itself; `tests/production-routing.test.mjs` explicitly forbids public-origin destinations for this reason.
* The private-route lockdown (`src/worker.js:25-30`, `publicGateBlocks`) returns `403 {"error":"private"}` for
  `/api/`, `/.well-known/` (except allow-listed keys), `/mcp`, `/v1`..`/v5` on the public hosts. Observed:
  `GET https://numinalabs.xyz/.well-known/agent-card.json` -> 403; same path on workers.dev -> 200. Moving #1-#3 to the
  custom domain would break them.
* #1 is a treasury workflow (protected); not edited.

### Security finding (needs Sam's decision)

At audit time, `isPublicSiteHost` only matched the public hostnames, so the workers.dev host (and preview URLs) bypassed the
private-route lockdown entirely. Every private path blocked on `numinalabs.xyz` was reachable on
`numina-production.skott34.workers.dev` (endpoint-level auth still applied). Options, none applied in the original audit:
(a) give the control APIs a dedicated custom hostname (e.g. `control.numinalabs.xyz`) as a Worker route, move #1-#4
to it, then set `workers_dev`/`preview_urls` to `false`; or (b) keep workers.dev but add a host check for it.
Either changes live Worker behaviour and needs an explicit go-ahead.

PR #168 follow-up applied option (b) for `*.workers.dev` hosts. `publicGateBlocks` now treats those hosts like the public site, and only `CONTROL_BACKEND_HOST` (`numina-production.skott34.workers.dev`) still serves `/api/control/v2/*`, `/.well-known/agent-card.json`, and `/api/control/v1/treasury` under their existing handler authentication. Preview hostnames on `*.workers.dev` get no exception. `workers_dev` and `preview_urls` in `wrangler.jsonc` stay `true`. Details are in section 5.

## 2. Cloudflare deploy failures ("Deploy Numina to Cloudflare Edge" / Build and Deploy)

* Last green CI deploy: run 42689063765 on `db7c6dcf`, 2026-11-09 ~14:02 CST. Every push since (first
  failure `ea07008d`, run 42712238498) failed.
* Failing step on every recent run, including `aa822bb2` (run 43161334203): **Verify signed release attestation**
  (`node scripts/release-verify.mjs`). All 18 signatures PASS; the failure is staleness:
  `"Source tree digest does not match the statement"` and, since `5f5f37f2`,
  `"dist digests do not match the statement (4 differ, 0 missing, 2 extra)"` -
  differ: `dist/client/_headers`, `dist/client/services.css`, `dist/client/services.html`, `dist/server/index.js`;
  extra: `dist/client/checkout-cancel.html`, `dist/client/checkout-success.html`.
* Root cause: `release-evidence/numina-5.0.0-release.statement.json` + `.dsse.json` were last signed for `3b289616`
  (commit `86ed650c`). Every later source/dist change invalidates the statement, and only Sam can re-sign.
  Runs on the signing commits themselves (`86ed650c`, `e659e924`) passed attestation but failed the next step:
  `git diff --exit-code -- src/application-release-contract.js` after the build regenerated the artifact pin.
* At audit time, `npm test` also failed (section 3). On merge `1a39da47` (PR #173, 2026-11-12 10:22 CST), Verify provider observations run [43257992409](https://github.com/Numina-Enterprise/numina-production/actions/runs/43257992409) ran root `npm ci` and `npm test` and passed.
* Cloudflare side (read-only `wrangler deployments list`): production is not on CI builds. The latest deployments
  are local `wrangler` deploys at 2026-11-11 21:36, 22:01 and 22:06 CST (versions `6b846752`, `53c62bb0`,
  `91a0db93`), plus three `secret` versions at 18:20 (x2) and 21:10 CST. These bypassed the signed-attestation gate.
  `aa822bb2` (PR #167) is not deployed.

## 3. `verify` failures on main

| Check | Exact failure | Cause | Status |
|-------|---------------|-------|--------|
| Verify root Numina (`verify`) | `retired provider deployment config returned: vercel.json` | `vercel.json` re-added 2026-11-09 (`e291f1a3`, deployments disabled) and flipped to enabled 2026-11-10 (`1976d40d`). | **Fixed here**: file removed. `{"git":{"deploymentEnabled":true}}` is Vercel's default, so Vercel behaviour is unchanged. |
| Verify provider observations | `tests/otter-singularity-pin.test.mjs` latch: `scripts/build.mjs` sha256 `f35c83f3...` != pinned `a3822885...` | `9ba2ed5f` changed `scripts/build.mjs` after the latch in `docs/protocols/singularity-coordination-model.md` was pinned to `19997551`. | **Fixed** in PR #173. Latch entries for `scripts/build.mjs`, `tests/release-topology.test.mjs`, and `AGENTS.md` match that protocol doc. Run 43257992409 passed `npm test`. |
| Verify provider observations | `tests/release-signing.test.mjs`: `FN-DSA-512 must be supported on this Node` | Not a Node gap: FN-DSA comes from devDependency `@noble/post-quantum`. At audit time this workflow installed only `runtime/nusd*`, so the devDependency was missing. It passes after root `npm ci`; the deploy workflow, which already ran root `npm ci`, reported FN-DSA PASS. | **Fixed**. `.github/workflows/verify-provider-observations.yml` runs `npm ci --ignore-scripts --no-audit --no-fund` before the `runtime/nusd` installs. Run 43257992409 passed. |
| Verify provider observations | `tests/site-navigation.test.mjs`: `services.html` matches `/Numina USD/` | `public/services.html` card `id="usdc-deposit"`: "Numina USDC Deposit" / "Open USDC deposit" (Payment Link added 2026-11-11). The public-copy and KYC/AML gate forbids treasury/NUSD wording and deposit offers. | **Fixed** in the PR #168 follow-up. The `usdc-deposit` card is gone from `public/services.html`. Run 43257992409 passed `npm test`. |
| Deploy (pins step) | `git diff --exit-code -- src/application-release-contract.js` | Committed artifact pin stale vs. current build. | **Fixed** on PR #168, then regenerated again. `main` at `1a39da47` pins build id `b0599a3cb75a77eb34ca4edb4bf6a85e477f7299c683798c0a4bcae68885f4b1`. Deploy run 43257992268 stopped at attestation before "Verify release pins and tests". |
| Build and verify Numina Sites source | `"failure":"missing_sites_token"`, `"status":"blocked_before_push"` on run 43257992178 | `.github/workflows/publish-sites-control-source.yml` passes `SITES_GIT_TOKEN` into `npm run publish:source -- sites`. The production environment secret is empty, so the script exits before `git push`. Earlier runs (including 37163299661 on 2026-10-03) failed later with `failure: authentication` because the step had no credential at all. | **Open.** Sam sets the production environment secret `SITES_GIT_TOKEN`. |

## 4. What Sam must do to get a green deploy

1. Merge this PR (or equivalent).
2. Decide the `services.html` USDC card, update the otter latch pin, add root `npm ci` to the provider-observations workflow.
3. On the final `main` commit: `npm ci && npm run build && npm run release:statement && npm run release:sign` (Sam's keys), commit the statement and envelope, and push.

Status after `1a39da47` (PR #173, 2026-11-12 10:22 CST):

1. Done. PR #168 is merged.
2. Done. The USDC card is removed, PR #173 updated the otter latch, and the provider-observations workflow installs root dependencies before `npm test`.
3. Still required. Deploy run [43257992268](https://github.com/Numina-Enterprise/numina-production/actions/runs/43257992268) passed all 18 signature checks, then `scripts/release-verify.mjs` rejected the statement signed for `3b289616` / commit `86ed650c`. Dist paths that differ: `dist/client/_headers`, `dist/client/services.css`, `dist/client/services.html`, `dist/server/index.js`. Extra paths: `dist/client/checkout-cancel.html`, `dist/client/checkout-success.html`. Source tree digest expected `90a557eed740f75d9f04092ed14f853c124b63757dd91219fa21af396954efe8`, actual `4f244b4597fc3cf5f4650c39fe7b575f580b324ce747c903e410bf404653e128`.
4. Set production environment secret `SITES_GIT_TOKEN`. Sites run [43257992178](https://github.com/Numina-Enterprise/numina-production/actions/runs/43257992178) stopped with `missing_sites_token` before any git command.

## 5. Follow-up on PR #168 (Sam's decisions, 2026-11-11 23:49 CST)

* The `usdc-deposit` card is removed from `public/services.html`. The section nav and heading no longer mention deposits.
* `src/worker.js` now applies the private-route lockdown to every `*.workers.dev` host (`isEdgeAliasHost`).
  - Only `numina-production.skott34.workers.dev` (`CONTROL_BACKEND_HOST`) still serves `/api/control/v2/*`, `/.well-known/agent-card.json` and `/api/control/v1/treasury`.
  - Those three paths keep their existing handler authentication.
  - Preview URLs get no exceptions.
  - Covered by `tests/edge-alias-gate.test.mjs`.
  - `workers_dev` and `preview_urls` are unchanged.
* Sites publish now reads `SITES_GIT_TOKEN` from the production environment (`.github/workflows/publish-sites-control-source.yml`) and refuses to push when that value is empty. Run 43257992178 on `1a39da47` reported `failure: missing_sites_token` and `status: blocked_before_push`. Checkout still uses `persist-credentials: false`. Earlier runs, including 37163299661 on 2026-10-03, reached `git push` and failed with `failure: authentication` because the step had no credential.
* Resolved on PR #173: otter latch entries for `scripts/build.mjs`, `tests/release-topology.test.mjs`, and `AGENTS.md` match `docs/protocols/singularity-coordination-model.md`. Verify provider observations run 43257992409 passed, including root `npm ci` and `npm test`.
* Still open: Sam re-signs `release-evidence/numina-5.0.0-release.statement.json` and the DSSE envelope on current `main` (`npm ci && npm run build && npm run release:statement && npm run release:sign`). Deploy run 43257992268 failed attestation after every signature passed. Sam also sets production secret `SITES_GIT_TOKEN` when the Sites mirror should publish.


## 6. Live Cloudflare read (2026-11-12, 10:37 AM CST)

Read-only. No deploy, DNS edit, binding change, secret read, or schema write.

Account `3c1fd59ef2ef67f750b4bc23e656d722`. Zone `numinalabs.xyz` (`2f33643b75a07b13dd160957630ee615`) is active. SSL mode is strict, the certificate is active, Always Use HTTPS is on, and the minimum TLS version is 1.2. Apex and `www` are proxied AAAA records at `100::`. Worker routes `numinalabs.xyz/*` and `www.numinalabs.xyz/*` both use script `numina-production`. A proxied wildcard CNAME `*.numinalabs.xyz` points at the apex and has no Worker route; `https://not-a-real-host.numinalabs.xyz/` returned HTTP 523.

The production script was last modified `2026-11-12T04:06:24Z` (10:06 PM CST, Nov 11). The deployment at 100% is version `91a0db93-c985-439b-a575-3be81f621026`, source `wrangler`, created `2026-11-12T04:06:23Z`. The account workers.dev subdomain is `skott34`. This script has workers.dev and preview URLs enabled. Its bindings are the `ASSETS` binding and secret text bindings `NUMINA_CONTROL_API_KEY`, `NUMINA_CONTROL_API_KEY_SHA256`, `STRIPE_PRICE_AUDIT`, `STRIPE_PRICE_DIAGNOSTIC`, and `STRIPE_SECRET_KEY`. There is no D1 binding.

D1 database `numina-production` (`c203bfa3-8854-4705-8227-742cae3c11b5`) was created `2026-11-11T15:56:08Z` (9:56 AM CST) and reports 0 tables. `wrangler.jsonc` lists `d1` in `keep_bindings` and does not declare `d1_databases`, so a deploy does not attach this database.

HTTP responses at 10:37 AM CST:

| URL | Status |
|---|---|
| `https://numinalabs.xyz/` | 200 |
| `https://www.numinalabs.xyz/` | 200 |
| `https://numinalabs.xyz/services` | 200 |
| `https://numinalabs.xyz/.well-known/agent-card.json` | 403 `{"error":"private"}` |
| `https://numinalabs.xyz/api/control/v1/treasury` | 403 `{"error":"private"}` |
| `https://numina-production.skott34.workers.dev/` | 200 |
| `https://numina-production.skott34.workers.dev/.well-known/agent-card.json` | 200 |
| `https://numina-production.skott34.workers.dev/api/control/v1/treasury` | 503 `{"status":"unavailable","error":"DEPENDENCY_UNAVAILABLE"}` |

The apex and workers.dev homepages carry the same page copy. The apex response is larger because Cloudflare injects its challenge script into the cached HTML. The workers.dev agent-card response matches the control-backend exception in `src/worker.js`. The treasury request above sent no credential. `controlHttp` calls `rateLimit(env.DB, ...)` before authentication, and this script has no `DB` binding, so that route cannot return `READY` until a database is bound and initialized. That binding was not added. CI still cannot publish a Worker version until the release statement is re-signed.

## 7. Edge-alias gate is not the deployed Worker (2026-11-12, 10:52 AM CST)

Read-only GETs, no credentials. The active production script is still the wrangler version from section 6 (`91a0db93`, created `2026-11-12T04:06:23Z`, 10:06 PM CST on Nov 11). Commit `350d9a14` ("Apply the private-route lockdown to workers.dev and preview hosts") is `2026-11-11 23:54 CST`, after that deploy. Deploy run 43257992268 on `1a39da47` never published a newer version.

A 200 on `/.well-known/agent-card.json` at the control host does not show that the new exception is live. The pre-lockdown script served that path on workers.dev with no host gate. Paths `publicGateBlocks` would reject on `*.workers.dev` still reach handlers:

| URL | Live status | Current `src/worker.js` |
|---|---|---|
| `https://numinalabs.xyz/mcp` | 403 private notice | 403 |
| `https://www.numinalabs.xyz/mcp` | 403 private notice | 403 |
| `https://numina-production.skott34.workers.dev/mcp` | 405 from the MCP handler (POST required) | 403 private notice |
| `https://numinalabs.xyz/v5/release/manifest` | 403 private notice | 403 |
| `https://numina-production.skott34.workers.dev/v5/release/manifest` | 404 | 403 private notice |
| `https://numinalabs.xyz/downloads/application-release-v5.json` | 403 private notice | 403 |
| `https://numina-production.skott34.workers.dev/downloads/application-release-v5.json` | 404 | 403 private notice |
| `https://numinalabs.xyz/api/financial/v1/` | 403 private notice | 403 |
| `https://numina-production.skott34.workers.dev/api/financial/v1/` | 503 from that route | 403 private notice |

Public hosts match the lockdown. The workers.dev host does not. Section 5 describes the repository, not the Worker Cloudflare is serving. Shipping `isEdgeAliasHost` still depends on Sam re-signing the release statement so Deploy Numina to Cloudflare Edge can pass attestation and publish the current script.
