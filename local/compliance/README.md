# Numina Labs local compliance module (KYC / sanctions / AML)

For **SK Consulting LLC dba Numina Labs**. This module runs **only on Sam's machine**. Nothing in `src/`,
`scripts/`, `public/` or the Cloudflare Worker imports it, and the gate fails if anything does.

> **Limits.** This is a screening and record-keeping aid. It is **not legal advice**. It does **not**
> create attorney-client privilege. It does **not** replace a licensed identity-verification (IDV) provider,
> or an attorney's review before any financial service launches. A clear screen is not a legal
> determination. Every possible match goes to manual review, and nothing is ever auto-accepted.
> **Attorney review is PENDING** (follow-up due **2026-12-09**). That blocks the launch of any financial
> service. It does not block the numinalabs.xyz site push.

## What's here

| Part | Status | Where |
|---|---|---|
| Sanctions screening (built-in matcher) | implemented + tested | `lib/normalize.mjs`, `lib/similarity.mjs`, `lib/lists.mjs`, `lib/screen.mjs` |
| Moov Watchman client + fallback | implemented + tested (fake loopback server); real Watchman v1.2.2 run on the build box from a source build | `lib/watchman.mjs`, `watchman/` |
| KYC intake, validation, state machine, encrypted store, audit log | implemented + tested | `lib/kyc-schema.mjs`, `lib/store.mjs`, `lib/crypto-store.mjs`, `lib/audit.mjs`, `lib/workflow.mjs` |
| Identity verification | **interface stub only.** Needs a licensed IDV provider. It never returns "verified". | `lib/idv-provider.mjs` |
| AML monitoring (Stripe CSV) + risk score | implemented + tested | `lib/aml.mjs`, `lib/risk.mjs` |
| Ed25519 human sign-off + review packet | implemented + tested (throwaway keys) | `lib/signoff-core.mjs`, `lib/signoff.mjs`, `lib/packet.mjs` |
| Stripe prohibited/restricted merchant rules | implemented + tested | `lib/merchant-rules.mjs` |
| FFIEC / OFAC / Stripe checklist | implemented + gate-checked | `checklist.json` → `CHECKLIST.md` |
| Docassemble intake + packet-PDF interviews | **config only, not run** (no Docker on the build box). The intake mapping was checked with a Python harness. | `docassemble/` |
| Probo and Comp AI CE GRC workspaces + risk/control/evidence map | **config only, not run**. The mapping is gate-checked. | `grc/` |
| Gate | implemented | `bin/gate.mjs` |

## Setup (once)

```sh
node --version                       # 24+ (repo pins 26.13.0)
npm run compliance -- keygen-data-key  # prints a new AES-256 key; save it in your password manager
export NUMINA_COMPLIANCE_KEY=...       # PowerShell: $env:NUMINA_COMPLIANCE_KEY="..."
npm run compliance:update-sdn          # download OFAC lists into local/compliance/data/lists (gitignored)
```

| Env var | Purpose |
|---|---|
| `NUMINA_COMPLIANCE_KEY` | 32-byte AES-256-GCM key, as base64 or 64 hex. Required to read or write cases. |
| `NUMINA_COMPLIANCE_DATA_DIR` | Data dir override. Default `local/compliance/data/` (gitignored). |
| `NUMINA_COMPLIANCE_SIGNERS` | Signer registry override (tests only). Default `keys/signers.json`. |
| `NUMINA_WATCHMAN_URL` | Watchman base URL. Default `http://127.0.0.1:8084`. Must be loopback. |
| `NUMINA_WATCHMAN_ALLOW_LAN` | `1` also allows a private-LAN Watchman. Off by default. |

Optional overrides go in `local/compliance/data/config.json`. They are deep-merged over `config.default.json`.

## Commands

```sh
npm run compliance:update-sdn
npm run compliance -- engines
npm run compliance:screen -- --name "Name" --type business --country US      # exit 3 if not clear
npm run compliance:kyc -- new --file intake.json                              # -> case id cp_...
npm run compliance:kyc -- submit --case cp_...
npm run compliance:kyc -- screen --case cp_...                                # entity, DBA, control person, 25%+ owners
npm run compliance:kyc -- disposition --case cp_... --party bo0 --hit UID --as false_positive --reason "DOB and country differ from SDN entry"
npm run compliance:kyc -- manual-check --case cp_... --party entity --result no_match --note "OFAC SLS search 2026-11-09"
npm run compliance:kyc -- blockers --case cp_...
npm run compliance:aml -- --input stripe-payments.csv --open-cases            # exit 3 on high/critical alerts
npm run compliance:signoff -- --case cp_... --key <path-to-ed25519.pem>       # Sam only
npm run compliance:packet -- --case cp_... --out review.md [--html] [--redact]
npm run compliance:verify
npm run compliance -- merchant-scan --path numinalabs-web
npm run compliance -- checklist --out local/compliance/CHECKLIST.md
npm run compliance:gate                                                       # tests + self-check, no network
```

### Case states
Counterparty: `draft → submitted → screening → needs_review → approved | rejected`.
Payment: `needs_review → cleared | rejected`.
`approved` and `cleared` are reachable **only** through a valid sign-off. Re-screening, or any change after
approval, supersedes the sign-off, and the case needs a new one. Every transition is appended to the
hash-chained audit log (`data/audit.log.jsonl`). The log rejects PII-like keys.

### Approval blockers
Counterparty approval needs all of the following:
- a valid intake, and lists no more than 7 days old when screened
- a screen no more than 30 days old that covers every party
- every hit dispositioned with a written reason. A hit at or above 0.97 can't be marked false positive.
- a manual OFAC Sanctions List Search check recorded as `no_match` for every party
- no Stripe prohibited-jurisdiction findings
- no critical AML alert on the counterparty

Payment clearance needs a linked KYC case that is approved with a valid sign-off, a review note on every
medium-or-higher alert, and no critical alert.

The IDV result is shown as "not performed" until a licensed provider is configured. Set `kyc.require_idv`
to `true` to make it a blocker.

## Human sign-off (Sam Kott, SKOTT34-Ed25519)
`compliance:signoff` prints the full packet: KYC, every screening hit, the manual checks, AML alerts, the
risk score, merchant findings and blockers. It refuses `approve`/`clear` while blockers remain, then asks Sam to
type the case id. It signs canonical JSON with these fields:
- case id and type
- decision
- sha256 of the full compliance output
- signer label and public-key fingerprint
- timestamp and organization

It then verifies the signature against `keys/signers.json` and appends the record to the audit log.

- The committed public key is `keys/signers.json` (SPKI sha256 `46b301f0…be8ce`), copied from
  `manifest-verifier/openssl_check/skott34-ed25519.pub.pem`. **Confirm that this is the key you want to
  sign compliance decisions with.** To rotate it, replace the `publicKeyPem` and `publicKeySha256` entries
  with your own public key. Get the values from `openssl pkey -in key.pem -pubout`. Never commit a private key.
- An encrypted PEM works with `--passphrase-env VAR`.
- The packet's signature block ("Signature: ____") is left unsigned for a wet or PDF signature.

## Data sources (verified 2026-11-09)
- **OFAC Sanctions List Service** (SDN + consolidated non-SDN):
  `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/` + `SDN.CSV`, `ALT.CSV`, `ADD.CSV`,
  `CONS_PRIM.CSV`, `CONS_ALT.CSV`, `CONS_ADD.CSV`. Each URL answers with a 302 to a presigned S3 object
  whose path carries the publication date. The latest is 2026-11-05: SDN.CSV has 19,563 rows,
  sha256 `7f43332d…ff55b8`. The manifest records sha256, bytes, rows and fetched-at time.
- **Manual cross-check:** OFAC Sanctions List Search, https://ofac.treasury.gov/sanctions-list-search-tool
  (a human step, recorded on the case).
- **Moov Watchman v1.2.2** (Apache-2.0) loads US OFAC SDN, US non-SDN, US CSL, FinCEN 311, UK, EU and UN
  lists, all downloaded from government sources by Watchman itself.
- **Stripe Prohibited and Restricted Businesses:** https://stripe.com/legal/restricted-businesses (last updated
  2026-09-22). The gate fails once that date is more than 180 days old.
- **FFIEC BSA/AML Examination Manual:** https://bsaaml.ffiec.gov/manual. It is cited section by section in
  `CHECKLIST.md`. It is a bank exam manual, used here as the reference standard for good practice.
- **Not used:** OpenSanctions data and yente (business use needs a paid licence), and any legal LLM.

## Retention
Keep KYC records, screening results, dispositions, sign-offs and the audit log for **5 years after the
relationship ends**. Keep payment-review records for 5 years after the transaction. This mirrors the
CIP/SAR/OFAC record periods in the FFIEC manual and is **pending attorney confirmation**. Records
stay encrypted in `data/`. Back that folder up encrypted. Losing `NUMINA_COMPLIANCE_KEY` means losing
the records. Delete exports such as `intake.json` and unredacted packets after use.

## Gate
`npm run compliance:gate` does the following:
- runs every `tests/compliance/*.test.mjs` with `node --test`, with network blocked and `NUMINA_COMPLIANCE_*` stripped
- runs the self-check: config, signer registry, isolation, no secrets/PII, merchant source age, checklist and
  mapping, loopback-only configs, AES round-trip, all AML rules, a synthetic end-to-end sign-off with a
  throwaway key, and a Watchman probe
- prints which screening engine is active

It exits non-zero on any failure. It does not use live data, and the only network contact is the Watchman
probe on 127.0.0.1.
