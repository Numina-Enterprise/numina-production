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

`isPublicSiteHost` only matches the public hostnames, so the workers.dev host (and preview URLs) bypass the
private-route lockdown entirely. Every private path blocked on `numinalabs.xyz` is reachable on
`numina-production.skott34.workers.dev` (endpoint-level auth still applies). Options, none applied here:
(a) give the control APIs a dedicated custom hostname (e.g. `control.numinalabs.xyz`) as a Worker route, move #1-#4
to it, then set `workers_dev`/`preview_urls` to `false`; or (b) keep workers.dev but add a host check for it.
Either changes live Worker behaviour and needs an explicit go-ahead.

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
* Behind those gates, `npm test` currently also fails (see section 3).
* Cloudflare side (read-only `wrangler deployments list`): production is not on CI builds. The latest deployments
  are local `wrangler` deploys at 2026-11-11 21:36, 22:01 and 22:06 CST (versions `6b846752`, `53c62bb0`,
  `91a0db93`), plus three `secret` versions at 18:20 (x2) and 21:10 CST. These bypassed the signed-attestation gate.
  `aa822bb2` (PR #167) is not deployed.

## 3. `verify` failures on main

| Check | Exact failure | Cause | Status |
|-------|---------------|-------|--------|
| Verify root Numina (`verify`) | `retired provider deployment config returned: vercel.json` | `vercel.json` re-added 2026-11-09 (`e291f1a3`, deployments disabled) and flipped to enabled 2026-11-10 (`1976d40d`). | **Fixed here**: file removed. `{"git":{"deploymentEnabled":true}}` is Vercel's default, so Vercel behaviour is unchanged. |
| Verify provider observations | `tests/otter-singularity-pin.test.mjs` latch: `scripts/build.mjs` sha256 `f35c83f3...` != pinned `a3822885...` | `9ba2ed5f` changed `scripts/build.mjs` after the latch in `docs/protocols/singularity-coordination-model.md` was pinned to `19997551`. | Needs Sam: pin lives in the protocol doc (protected). |
| Verify provider observations | `tests/release-signing.test.mjs`: `FN-DSA-512 must be supported on this Node` | Not a Node gap: FN-DSA comes from devDependency `@noble/post-quantum`, and this workflow never runs root `npm ci` (only `runtime/nusd*`). Passes locally after `npm ci`; the deploy workflow, which runs root `npm ci`, reports FN-DSA PASS. | Needs Sam: add `npm ci --ignore-scripts --no-audit --no-fund` before the `runtime/nusd` installs in `.github/workflows/verify-provider-observations.yml` (evidence-publishing workflow, not edited). No Node pin change needed. |
| Verify provider observations | `tests/site-navigation.test.mjs`: `services.html` matches `/Numina USD/` | `public/services.html` card `id="usdc-deposit"`: "Numina USDC Deposit" / "Open USDC deposit" (Payment Link added 2026-11-11). The public-copy and KYC/AML gate forbids treasury/NUSD wording and deposit offers. | Needs Sam: compliance decision (remove/rename the card, or approve a policy change). Not edited. |
| Deploy (pins step) | `git diff --exit-code -- src/application-release-contract.js` | Committed artifact pin stale vs. current build. | **Fixed here**: pin regenerated by `npm run build` (build id `4a50a56e...`, server sha `93b278e2...`). Must be re-checked on CI's Node 26.13.0. |
| Build and verify Numina Sites source | `"failure":"authentication"`, `"status":"push_failed"`, exit 128 pushing to `git.chatgpt-team.site` | Sites git credential invalid or revoked. | Needs Sam: restore the Sites push credential. |

## 4. What Sam must do to get a green deploy

1. Merge this PR (or equivalent).
2. Decide the `services.html` USDC card, update the otter latch pin, add root `npm ci` to the provider-observations workflow.
3. On the final `main` commit: `npm ci && npm run build && npm run release:statement && npm run release:sign` (Sam's keys), commit the statement and envelope, and push.

## 5. Follow-up on PR #168 (Sam's decisions, 2026-11-11 23:49 CST)

* The `usdc-deposit` card is removed from `public/services.html`. The section nav and heading no longer mention deposits.
* `src/worker.js` now applies the private-route lockdown to every `*.workers.dev` host (`isEdgeAliasHost`).
  - Only `numina-production.skott34.workers.dev` (`CONTROL_BACKEND_HOST`) still serves `/api/control/v2/*`, `/.well-known/agent-card.json` and `/api/control/v1/treasury`.
  - Those three paths keep their existing handler authentication.
  - Preview URLs get no exceptions.
  - Covered by `tests/edge-alias-gate.test.mjs`.
  - `workers_dev` and `preview_urls` are unchanged.
* Sites credential: the publish step passes no secret, and checkout uses `persist-credentials: false`.
  - `scripts/publish-with-telemetry.mjs` pushes with whatever git credential already exists on the host (`GIT_TERMINAL_PROMPT=0`). A hosted runner has none.
  - No repo or environment secret for `git.chatgpt-team.site` exists or is referenced.
  - Every run, including the last one marked successful on 2026-10-03 (run 37163299661), shows `push_failed` with `failure: authentication`.
* Resolved on PR #173 follow-up: otter latch entries for `scripts/build.mjs`, `tests/release-topology.test.mjs`, and `AGENTS.md` (operating index) now match `docs/protocols/singularity-coordination-model.md`; `verify-provider-observations` installs root `npm ci` before runtime packages.
* Still open after merge: Sam must re-sign `release-evidence/numina-5.0.0-release.statement.json` on the merged commit (`npm run release:statement && npm run release:sign`) before deploy attestation passes; configure `SITES_GIT_TOKEN` (or equivalent) if Sites publish should succeed on hosted runners.
