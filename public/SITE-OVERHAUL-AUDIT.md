# Numina site overhaul — audit (Workstream C, Nov 19, 2026)

Staging dir: `~/workspace/your_files/numina-site-overhaul/` — mirrors `public/`.
Source (read-only): `~/workspace/numina-production/public/` at head `e28fd90` (PR #204 branch).
Nothing in the clone was edited. Nothing was committed, pushed, deployed, or merged.

## Live-site state, fresh curl Nov 19, 2026 ~10:18 CST (16:18 UTC)

| URL | Status | Finding |
|---|---|---|
| `https://numinalabs.xyz/` | 200 (8,904 B) | STALE. Title `Numina Labs | Emerging technology for global enterprise`. `$1,500` ×3 visible (`Operational Agent Diagnostic · $1,500`, `Pay $1,500`, `fixed-fee ($1,500)`). `$5,000` ×0. |
| `https://numinalabs.xyz/nn-llm` | 404 (0 B) | STALE. Page exists in branch (`nn-llm.html`, 28,531 B) but not deployed. |
| `https://numinalabs.xyz/master-spec` | 404 (0 B) | STALE. Page exists in branch (`master-spec.html`, 58,004 B) but not deployed. |
| `https://numinalabs.xyz/services` | 200 (18,950 B) | STALE. `$1,500` ×7, `$5,000` ×0. Meta description still `$1,500 Operational Agent Diagnostic`, `$7,500 Agentic Systems audit`. Live pay links point at the old `$1,500` Stripe payment links. |
| `https://numinalabs.xyz/nn-llm.html` | 404 | Same as clean URL — not deployed. |
| `https://numinalabs.xyz/master-spec.html` | 404 | Same as clean URL — not deployed. |
| `https://numinalabs.xyz/services.html` | 301 → `/services` | Redirect works; target is the stale page. |
| `https://numinalabs.xyz/testnet` | 404 | STALE. Page exists in branch (`testnet.html`, 15,112 B) but not deployed. |
| `https://numinalabs.xyz/economy` | 200 (3,339 B) | Serves a **"Page retired — Numina Labs"** stub (`This page is no longer published`), NOT the branch `economy.html`. See Decision D1. |
| `https://numinalabs.xyz/blockchain` | 200 (3,360 B) | Same retired stub. See Decision D1. |
| Live footer (all live pages) | — | Links `/ecosystem`, which has **no file** in `public/`, no sitemap entry, no route. Dead link on the live site. It does not exist in branch footers — it dies when PR #204 deploys. |

## Branch facts established by audit (all Verified by grep/file read)

- Exact `$1,500`: **zero occurrences in all of `public/`** (html/js/json, excluding frozen `final-build.json` / `final-manifest.json`). The `$1,500` lives ONLY on the deployed live site and dies when PR #204 deploys. No price code change was needed or made.
- `1,500` hits in branch files are the **1,500T token-supply figure** (`1,500,000,000,000,000.00 NUSD` = 1.5e15 tokens = 1.5e33 base units at 18 decimals), NOT a price. Untouched.
- `0x491c1DF1b5CA77AF797f052c2310ca17039C931b` (Sep 18, 2026) in `public/`: `economy.html` ×1, `blockchain.html` ×1, `business-core.json` ×1, `nusd-contract-record.js` ×3, `treasury-connection-model.js` ×2 (there labelled `historicalChainObservation`, dated Sep 18 — accurate), `architecture-layers.js` ×1 (via its `nusd` block).
- Nov 5–6, 2026 addresses (`0x5fbdb2315678afecb367f032d93f642f64180aa3` NUSD, `0xe7f1725e7734ce288f8367e1bb143e90bb3f0512` escrow) appeared **NOWHERE** in `public/` before this overhaul.
- Pricing in branch is correct: `services.html` `$5,000` ×5 (diagnostic), `$25,000` ×6 (audit + retainer), `$100,000`, `$250,000`, `$1,000,000`; `pricing.html` `$5,000` ×1; `frontier.html` / `app.html` `$5,000` ×1 each.
- All 96 `/downloads/…` hrefs resolve in the **build output** `dist/client/downloads/` (build copies `docs/` → `downloads/`). They look missing against `public/` alone — they are NOT dead in production. Verified: 0 missing in `dist/client`.
- `/source-alignment.json`, `/identity.json`, `/tasks.json`, `/workspaces.json` (linked from `build.html`, `core.html`, `security.html`, `integrations.html`, `task-ledger.html`, `workspaces.html`) all exist in `dist/client/` (generated/copied by `scripts/build.mjs`). NOT dead in production.
- Sitemap `/control-room` entry resolves via the Worker (`src/worker.js` serves `frontier.html` for `/control-room`). NOT dead.
- Worker routes verified in `src/worker.js`: `/platform` → 308 `/app`; `/pricing` → 308 `/services#pricing`; `/frontier` + `/control-room` → `frontier.html`. No route exists for `/signin-with-chatgpt` or `/signout-with-chatgpt` (grep count 0) — see Infra gap 3.
- Reference framing used for alignment: `nn-llm.html` ("Numina-NN / Numina-LLM", 12 H2 sections incl. "The neural-network research program", "An independent language-intelligence platform", "Five phases, one direction") and `master-spec.html` (Nov 15, 2026 spec, four verification tiers, "Official Numina Neural Network Architecture (Numina-NN / Sovereign Multi-Planetary Inference & Control Architecture)"). No new product claims were invented; anything unverified is labelled as such below.

## Page-by-page audit table (42 pages)

Severity: HIGH = wrong contract/price shown to visitors · MED = discoverability/dead-link · LOW = nav consistency.
"Fix staged" means the file in this staging dir; nothing was applied to the clone.

| File | Title / H1 | What's stale / wrong (exact strings) | Sev | Fix staged |
|---|---|---|---|---|
| `index.html` | Engineering the Next Generation of Independent Intelligence / same H1 | Correct title/H1, but header nav + footer did not link NN/LLM or Research (body buttons did: `Read the Numina-NN/LLM documentation`, `Read the master specification`). | LOW | Header nav + footer links added. |
| `nn-llm.html` | Numina-NN / Numina-LLM — Neural Network & Language Intelligence Documentation / `Numina-NN / Numina-LLM.` | Reference page, aligned. Nav wrongly marked `Frontier` as `aria-current="page"`; page itself unlinked from every header nav. | LOW | Nav links added; `aria-current` moved to its own link (desktop + mobile). Footer links added. |
| `master-spec.html` | Master Technical Integration & Theoretical Architecture Specification / same H1 | Reference page, aligned. Same nav `aria-current` issue as `nn-llm.html`; unlinked from header navs. | LOW | Nav links added; `aria-current` moved to its own link. Footer links added. |
| `testnet.html` | Robinhood Chain Testnet — Numina Testnet Trading Bot / `Robinhood Chain testnet.` | Aligned. Reachable only from index footer + sitemap; no header-nav link anywhere; no `_redirects` entry (`/testnet.html` 404s live). | MED | Header nav + footer links added; `_redirects` entry added. |
| `services.html` | Services & pricing — Numina / `Start with a diagnostic. Build toward independent intelligence.` | Pricing correct (`$5,000` ×5, `$25,000` ×6). No NN/LLM/Research nav or footer links. | LOW | Nav + footer links added. |
| `pricing.html` | Services & pricing — Numina Labs / `Services & pricing.` | Pricing correct (`$5,000` ×1). Worker 308s `/pricing` → `/services#pricing`, but `_redirects` had no `/pricing.html` entry; no nav/footer NN links. | LOW | Nav + footer links added; `_redirects` entry added. |
| `economy.html` | NUSD · Numina Native Network & Economy — Numina Labs / `One unit. Useful outcomes.` | **HIGH.** `The existing NuminaUSD contract 0x491c1DF1b5CA77AF797f052c2310ca17039C931b` presented as the current contract; `NUSD is issued: the existing 18-decimal contract and its 1,500T constructor mint are receipt-verified.`; `The finalized constructor receipt remains the canonical mint evidence`; receipt links labelled `Deployment receipt ↗` / `Finality and state verification ↗` (both point at the Sep 18 receipts). | HIGH | Contract section rewritten to current Nov 5–6 NUSD `0x5fbdb2…` + escrow `0xe7f1725e…`, both labelled deployed Nov 5–6, 2026; Sep 18 `0x491c…` retained once, labelled dated historical record, explicitly not current; receipt links relabelled `September 18, 2026 … (historical) ↗`; nav + footer links added. |
| `blockchain.html` | Numina Native Network — Blockchain \| Numina Labs / `The Numina native network. NUSD as the value unit.` | **HIGH.** `NuminaUSD is deployed at 0x491c1DF1b5CA77AF797f052c2310ca17039C931b on chain 962421430. The constructor minted 1,500,000,000,000,000.00 NUSD.`; `The existing contract is preserved.`; `the finalized deployment verification remains the canonical mint evidence.` | HIGH | Same treatment as `economy.html`: current Nov 5–6 NUSD + escrow, Sep 18 `0x491c…` demoted to one labelled historical mention; receipt anchors relabelled `The September 18, 2026 transaction receipt` / `finality verification … establish the historical issuance`; nav + footer links added. |
| `app.html` | Numina OS 4 — One connected operating system / `One core. A complete operating system.` | `$5,000` ×1 correct; `1,500T` figure is supply, not price. **Dead link:** `<a href="/signin-with-chatgpt?return_to=%2Fapp">Sign in</a>` — no Worker route (see Infra gap 3). `app-ui.js` / `frontier-ui.js` also generate `/signin-with-chatgpt` and `/signout-with-chatgpt` URLs. | MED | Nav + footer links added. Sign-in link deliberately LEFT in place (removing it would hide the entry point; the fix is the Worker route draft, not deleting the link). |
| `frontier.html` | Numina Frontier — Workflows, Software & Enterprise Services / `From business objective. To accepted work.` | `$5,000` ×1 correct; `1,500T` is supply. Already linked `/nn-llm` + `/master-spec` in body. No header-nav NN links. | LOW | Nav + footer links added. |
| `about.html` | About Samuel J. Kott — Numina Labs / `Sam Kott.` | No price/contract refs. No header-nav or footer NN/Research links. | LOW | Nav + footer links added. |
| `labs.html` | Numina Labs — Agent Architecture / `Coordinated intelligence. Governed agents.` | No price/contract refs. Already linked `/nn-llm` in body. No header-nav NN links. | LOW | Nav + footer links added. |
| `core.html` | Numina Core — Numina Labs / `Verifiable by design. The foundation.` | No price/contract refs. `/source-alignment.json` link resolves via build output (not dead). No NN nav/footer links. | LOW | Nav + footer links added. |
| `build.html` | Build manifest — Numina Labs / `Build manifest. Evidence you can inspect.` | No price/contract refs. `/source-alignment.json` + download links resolve via build output (not dead). No NN nav/footer links. | LOW | Nav + footer links added. |
| `control.html` | Numina 5 — Control plane / `One state. Recorded decisions.` | No price/contract refs. No NN nav/footer links. | LOW | Nav + footer links added. |
| `platform.html` | Numina 5 Platform — Numina Labs / `Numina 5 platform.` | No price/contract refs. Worker 308s `/platform` → `/app` (correct). No NN nav/footer links; no `_redirects` entry (had none — Worker covers it, entry added anyway for parity). | LOW | Nav + footer links added; `_redirects` entry added. |
| `connections.html` | Connections — Numina Labs / `One Numina. Every connection.` | No price/contract refs. Not in sitemap; no `_redirects` entry. No NN nav/footer links. | MED | Nav + footer links added; sitemap + `_redirects` entries added. |
| `deployment-readiness.html` | Deployment readiness — Numina / `Deployment readiness` | No price refs (`1,500T` is supply). Not in sitemap; no `_redirects` entry. Minimal footer (no link list) — header nav updated only. | MED | Nav links added; sitemap + `_redirects` entries added. |
| `developers.html` | Developers \| NUMINA / `Integrate with explicit boundaries.` | No price/contract refs. Institutional header nav had no NN links; footer links updated. | LOW | Institutional nav + footer links added. |
| `financial-services.html` | Financial evidence — Numina Labs / `Financial evidence` | No price refs (`1,500T` / `1,500,000,000,000,000` are supply). No `_redirects` entry; no NN nav/footer links. | LOW | Nav + footer links added; `_redirects` entry added. |
| `financial-institutions.html` | Financial Institutions \| NUMINA / `Controls that match institutional responsibility.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `government.html` | Government & Allied Institutions \| NUMINA / `Mission requirements. Verifiable outcomes.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `partners.html` | Partners \| NUMINA / `Build a defined institutional opportunity.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `trust.html` | Numina Trust — Cryptographically Governed Intelligence \| NUMINA / `Cryptographically governed intelligence.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `uk-eu.html` | UK & EU \| NUMINA / `A corridor-specific approach to Europe.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `mena.html` | MENA \| NUMINA / `Local requirements. Clear responsibilities.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `apac.html` | APAC \| NUMINA / `Build around each market's rules.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `contact.html` | Contact / Partner With NUMINA \| NUMINA / `Define the next institutional use case.` | No price/contract refs. Institutional nav, no NN links. | LOW | Institutional nav + footer links added. |
| `integrations.html` | Agent integrations — Numina Labs / `Your model. One value layer.` | No price/contract refs. `/identity.json` link resolves via build output (not dead). No `_redirects` entry; no NN nav/footer links. | LOW | Nav + footer links added; `_redirects` entry added. |
| `ownership.html` | Rights and reporting — Numina Labs / `Protect the work. Document the rights.` | No price/contract refs. No NN nav/footer links. | LOW | Nav + footer links added. |
| `privacy.html` | Workspace privacy — Numina Labs / `Your work. Your records.` | No price/contract refs. No `_redirects` entry; no NN nav/footer links. | LOW | Nav + footer links added; `_redirects` entry added. |
| `provenance.html` | Production provenance — Numina 5 \| Numina Labs / `Production provenance. Trace the release.` | No price/contract refs. Not in sitemap; no `_redirects` entry. No NN nav/footer links. | MED | Nav + footer links added; sitemap + `_redirects` entries added. |
| `redemption.html` | NUSD rate & redemption terms — Numina Labs / `1 NUSD. 1 US dollar.` | No price/contract refs. No `_redirects` entry; no NN nav/footer links. | LOW | Nav + footer links added; `_redirects` entry added. |
| `reviewer.html` | Reviewer access - Numina / `Reviewer access` | No price/contract refs. Gated tooling page — deliberately NOT added to sitemap. No `_redirects` entry; no NN nav/footer links. | LOW | Nav + footer links added; `_redirects` entry added. |
| `security.html` | Security — Numina Labs / `One system. Accountable controls.` | No price/contract refs. `/source-alignment.json` resolves via build output (not dead). Not in sitemap; no `_redirects` entry. | MED | Nav + footer links added; sitemap + `_redirects` entries added. |
| `status.html` | Live status — Numina Labs / `Current status. Connected to the live verifier.` | No price/contract refs. No NN nav/footer links. | LOW | Nav + footer links added. |
| `task-ledger.html` | Task ledger — Numina / `The next action. The actual receipt.` | No price/contract refs. `/tasks.json` resolves via build output (not dead). Utility nav (Frontier/Workspaces/Task ledger/Integrations); footer nav updated. Not in sitemap; no `_redirects` entry. | MED | Utility nav + footer-nav links added; sitemap + `_redirects` entries added. |
| `transfer-receipts.html` | Transfer evidence — NUMINA / `Import. Check. Preserve.` | No price/contract refs. No footer at all — header nav updated only. Not in sitemap; no `_redirects` entry. | MED | Nav links added; sitemap + `_redirects` entries added. |
| `treasury.html` | Singular Treasury — NUMINA / `One treasury. Three routes.` | No price refs (`1,500T` ×6 is the owner-designated aggregate, not a price). Minimal footer (no link list) — header nav updated only. Not in sitemap; no `_redirects` entry. | MED | Nav links added; sitemap + `_redirects` entries added. |
| `treasury-simulation.html` | 500T treasury simulation — Numina / `One supply. Three treasury views.` | No price refs (`1,500T` is supply). Minimal footer — header nav updated only. Not in sitemap; no `_redirects` entry. | MED | Nav links added; sitemap + `_redirects` entries added. |
| `wallet-signing.html` | Wallet signing controls — Numina / `Wallet signing controls` | No price refs (`1,500T` ×11 is the total-supply proposal, not a price). Gated owner tooling — deliberately NOT added to sitemap. Minimal footer — header nav updated only. No `_redirects` entry. | MED | Nav links added; `_redirects` entry added. |
| `workspaces.html` | Workspace house — Numina / `Room for every kind of work.` | No price/contract refs. `/workspaces.json` resolves via build output (not dead). Utility nav; footer nav updated. Not in sitemap; no `_redirects` entry. | MED | Utility nav + footer-nav links added; sitemap + `_redirects` entries added. |

## What was NOT changed, and why (open items)

1. **`business-core.json`** (staged: NO). Its `nusd.contract` is still the Sep 18 `0x491c…` with Sep 18 `transactionHash` `0x86578ab2…`. Updating the address without the Nov 5–6 deployment receipt (transaction hash, block) would leave a half-true record. Needs the Nov 5–6 receipt data — owner / Workstream A to supply. Do not invent a hash.
2. **`nusd-contract-record.js`** (staged: NO). Header says "Generated by scripts/nusd-contract-record.mjs. Do not edit." Must be regenerated from the Nov 5–6 record by its generator, not hand-edited.
3. **`treasury-connection-model.js`, `architecture-layers.js`, `src/nusd-http.js` + `/api/nusd/v1/*`** (staged: NO). The JS model already labels Sep 18 as `historicalChainObservation` (accurate); it needs a *new* current-deployment entry for Nov 5–6, which needs the receipt data from item 1. The API serves the same Sep 18 record — verify it after the data update.
4. **`final-build.json` / `final-manifest.json`** — frozen v155 draft commitments. Untouched, per instructions.
5. **Live "Page retired" stubs for `/economy` + `/blockchain`** — Decision D1 (see `INFRA-ASKS.md`): the deployed Worker serves retired stubs for these two routes while the branch holds full pages. Deploying the staged `economy.html` / `blockchain.html` republishes them. Owner must confirm republish-with-corrections vs keep-retired before merge.
6. **Nov 5–6 deployment receipt not yet published on-site.** The staged pages say so implicitly by labelling the Sep 18 receipts "(historical)". Publishing a Nov 5–6 receipt file under `/downloads/nusd/` needs the receipt data from item 1.

## Verification performed on staged files (Nov 19, 2026)

- `grep -r '$1,500' staging/` → no matches. (Branch already had none; live site is the only place it exists.)
- `grep -ri '0x491c' staging/` → exactly 2 matches, one each in `economy.html` / `blockchain.html`, both inside "retained only as a dated historical deployment record" sentences.
- Nov 5–6 NUSD `0x5fbdb2…` + escrow `0xe7f1725e…` → present in both `economy.html` and `blockchain.html`, each labelled deployed November 5–6, 2026.
- Every staged `.html` (42/42) links `/nn-llm` and `/master-spec`; `nn-llm.html` / `master-spec.html` carry `aria-current="page"` on their own nav link; no page still marks Frontier current on those two.
- `_redirects` staged: 42 rules — every page now has a `.html` → clean redirect (was 22, added 20).
- `sitemap.xml` staged: 40 URLs (was 31, added 9). All resolve to staged files except `/control-room` (Worker-served `frontier.html`). `reviewer.html` + `wallet-signing.html` deliberately excluded (gated tooling).
- Dead internal-link re-check on staged files (resolver: `public/` + staging + `dist/client/` + Worker routes): only remaining dead ref is `/signin-with-chatgpt` in `app.html` — expected, fixed by the drafted Worker route, not by deleting the link.
- Diff scope vs source: 2–8 changed lines per file (nav/footer insertions + the two contract rewrites). No other content touched.
