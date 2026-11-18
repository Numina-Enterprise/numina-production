# Numina FedRAMP 20x Key Security Indicator (KSI) Mapping

**Date:** 2026-11-18
**Repo:** `~/workspace/numina-production`, branch `review/v5.0.0-website-node26-2026-11-17`, HEAD `0b1e44b`
**Scope:** the two KSIs named by the owner — KSI-CMT-LMC and KSI-CNA-RNT only.

> **THIS IS A MAPPING, NOT A CERTIFICATION, AUTHORIZATION, OR COMPLIANCE CLAIM.**
> Numina is **NOT FedRAMP authorized**. Nothing in this document claims FedRAMP
> authorization, certification, or compliance, and nothing here should be read as
> asserting that Numina meets any FedRAMP requirement. This document only records
> (a) what FedRAMP actually publishes for two KSI identifiers, verified against
> fedramp.gov on 2026-11-18, and (b) what telemetry and network-policy material
> this repository actually contains, with file/line references, plus the gaps
> where the repository produces nothing relevant. An assessor, not this mapping,
> would decide whether any KSI is met.

## 1. Official sources read (2026-11-18)

| # | Source | What was read from it |
|---|--------|-----------------------|
| 1 | <https://www.fedramp.gov/2026/reference/key-security-indicators/> | FedRAMP "Key Security Indicators — FedRAMP Consolidated Rules for 2026" reference page. Both KSI IDs, titles, and (for KSI-CNA-RNT) the published outcome sentence were read here. Page crawled 2026-11-18 19:33 UTC per the fetch. Changelog on the page: official launch 2026-06-24; control-mapping update 2026-10-13. |
| 2 | <https://www.fedramp.gov/2026/providers/20x/rules/fedramp-certification/> | FedRAMP "Certification — FedRAMP Consolidated Rules for 2026". Both KSIs appear in the mandatory Class A list (rule FRC-CLA-MFR, items 18–19). Page crawled 2026-11-18 19:33 UTC per the fetch. |

No other source was used to verify an identifier. A secondary source is quoted
once, in §2.1, and is labelled secondary there.

## 2. Identifier verification — exact results

### 2.1 KSI-CMT-LMC — CONFIRMED (identifier is real; title differs from the owner's description)

- **Published ID (character-for-character):** `KSI-CMT-LMC`
- **Published title:** **Logging Changes** (theme: Change Management)
- **Owner's description:** "configuration change logging". That description is a
  paraphrase, **not** the published title. It is close in substance — the KSI is
  about logging changes — but the words "configuration change logging" do not
  appear as the KSI's title on fedramp.gov. Use the published title
  "Logging Changes" in any external reference.
- **Where confirmed:** the KSI reference page (§1, source 1) lists the heading
  "Logging Changes" with ID `KSI-CMT-LMC` directly beneath it; the certification
  rules page (§1, source 2) lists item 18 as
  "Key Security Indicators: KSI-CMT-LMC (Logging Changes)".
- **Changelog note (from the official page):** 2026-10-13 control-mapping update —
  added ca-7.4, cm-3.1, cm-3.6; removed ma-2. The full related-controls list was
  not present in the fetched copy of the page and is therefore not reproduced here.
- **Published outcome sentence:** the one-sentence outcome statement for this KSI
  was **not visible in the fetched text** of the official KSI page (the section
  showed the heading, ID, and changelog only), so no outcome sentence is quoted
  here as FedRAMP-verified. A secondary source (complianceone.ai,
  "FedRAMP 20x KSIs explained", read 2026-11-18 — **secondary, not official**)
  quotes it as: "Modifications to the cloud service offering are logged and
  monitored." That wording is reported second-hand only; do not cite it as
  FedRAMP's text without checking the official page directly.

### 2.2 KSI-CNA-RNT — CONFIRMED (identifier is real; title differs from the owner's description)

- **Published ID (character-for-character):** `KSI-CNA-RNT`
- **Published title:** **Restricting Network Traffic** (theme: Cloud Native Architecture)
- **Owner's description:** "network traffic micro-segmentation". That description
  is a paraphrase, **not** the published title, and the concept differs from the
  published scope in one material way: FedRAMP's text is about limiting inbound
  and outbound traffic on machine-based resources, not about micro-segmentation
  as such. No KSI on the official list is titled "micro-segmentation".
- **Published outcome sentence (read verbatim on fedramp.gov, source 1):**
  > "Machine-based information resources are persistently reviewed to ensure they
  > are appropriately configured to limit inbound and outbound network traffic."
- **Related SP 800-53 controls (as published on the official page):**
  AC-17 (03), CA-09, CM-07 (01), SC-07 (10), SC-07 (18), SC-07 (20), SC-07 (21),
  SC-07 (05), SI-10, SI-04 (11), SI-04 (18), SI-04 (04), SI-08.
- **Changelog note (from the official page):** 2026-10-13 control-mapping update —
  added sc-7.10, sc-7.18, sc-7.20, sc-7.21, si-10, si-4.11, si-4.18, si-4.4.
- **Where confirmed:** the KSI reference page (§1, source 1) lists the heading
  "Restricting Network Traffic" with ID `KSI-CNA-RNT` directly beneath it,
  followed by the outcome sentence above; the certification rules page (§1,
  source 2) lists item 19 as
  "Key Security Indicators: KSI-CNA-RNT (Restricting Network Traffic)".
- **Neighbouring KSIs, for accuracy:** the closest related indicators on the same
  official page are KSI-CNA-MAT ("Minimizing Attack Surface" — "lateral movement
  is minimized if compromised") and KSI-CNA-ULN ("Using Logical Networking" —
  "Logical networking and related capabilities are used and persistently reviewed
  to enforce traffic flow controls"). Neither is titled "micro-segmentation"
  either. KSI-CNA-RNT remains the correct ID for the network-traffic restriction
  the owner named; do not relabel it as a micro-segmentation KSI.

### 2.3 Summary of verification

| Identifier as named | Exists on fedramp.gov? | Published title | Owner's description |
|---|---|---|---|
| KSI-CMT-LMC | **Yes — confirmed** | Logging Changes | "configuration change logging" — paraphrase, not the published title |
| KSI-CNA-RNT | **Yes — confirmed** | Restricting Network Traffic | "network traffic micro-segmentation" — paraphrase, not the published title; "micro-segmentation" is not FedRAMP's wording |

Neither identifier was invented, and neither was rejected: both IDs are real and
both appear in FedRAMP's mandatory Class A KSI list. The discrepancies are in
the descriptive titles supplied with them, not in the IDs.

## 3. Mapping: KSI-CMT-LMC — Logging Changes

FedRAMP's KSI is about changes being logged (and, per the secondary wording in
§2.1, monitored). What follows is what this repository actually produces that
relates to logging changes, with file/line references. Line numbers were read
on 2026-11-18; the raft files were being edited concurrently by a sibling task
(see §5), so line numbers there may shift.

### 3.1 What the repo produces

| # | Repo material | File:line | What it actually does |
|---|---|---|---|
| 1 | HTTP request event logging | `src/telemetry.js:57-62` | Emits a structured `numina.http-request.v1` / `http_request` event per request: `requestId`, `route`, `method`, `status`, `durationMs`, `instanceId`, `observedAt`. `requestId`/`route` assigned at `src/telemetry.js:42-43`. Wired into the Worker request path at `src/worker.js:28`; owner metrics endpoint at `src/telemetry-http.js:7`. A `loggingFailures` counter tracks failed emits (`src/telemetry.js:27,62,89`). |
| 2 | Pair-binding raft append-only log | `src/numina-pair-binding-raft.js:586-597` | On commit, pushes `{index, term, digest, owner, payload}` onto `this.stateLog`. Predecessor hash-chaining is described at `src/numina-pair-binding-raft.js:47-62` (each entry stores `prevEntryHash` alongside its digest). |
| 3 | Git history (the repo itself) | — | Every modification to the repo is recorded as a commit with author, timestamp, and hash (e.g. HEAD `0b1e44b`, 2026-11-18). This is the de facto change log for configuration and code. It is version-control history, not application telemetry. |
| 4 | CI run logs | `.github/workflows/deploy-cloudflare.yml`, `.github/workflows/numina-release.yml` (among 29 workflows in `.github/workflows/`) | GitHub Actions records each build/deploy run. These logs are provider-side (GitHub); no repo code emits them. |
| 5 | Cross-platform audit scripts | `unified_audit_orchestrator.ps1:21-40` (runs `audit_acls.ps1`, `audit_services.ps1`, `audit_sizes.ps1`); scheduled via `register_audit_schedule.ps1` | Produces point-in-time audit output for host ACLs, services, and sizes. It audits host state; it does not log configuration changes. |

### 3.2 Gaps — stated plainly

- **No dedicated configuration-change audit log in application code.** No code
  path in `src/` or `scripts/` emits an event when a configuration file or value
  changes. The HTTP telemetry in §3.1(1) logs *requests*, not *changes*.
- **The raft log is in-memory only.** `src/numina-pair-binding-raft.js:65-66`
  states it plainly: "plus an append-only in-memory log. What it is NOT: full
  Raft (no leader election, no log replication, **no persistence**)". A process
  restart loses it; it is not persisted, shipped, or monitored. It also logs
  pair-binding state transitions, not configuration changes.
- **Telemetry is ephemeral and process-local.** The snapshot declares
  `scope: 'current_process_only'` and `persistence: 'ephemeral'`
  (`src/telemetry.js:85,87`), and fleet aggregation requires "the provider log
  pipeline" (`src/telemetry.js:87`; `docs/Telemetry-and-Quantum.md:29,33` — no
  telemetry drain is configured by repo code, and `NUMINA_TELEMETRY_LOGS=false`
  disables the HTTP event logs).
- **No persistent review loop for change logs.** Nothing in the repo periodically
  reviews change logs for completeness or anomalies. The KSI's "logged and
  monitored" element is therefore only half present: request logging exists,
  change-log monitoring does not.
- **Overall for KSI-CMT-LMC: PARTIAL at best, and only via git history plus
  request logging.** There is no instrumented, persisted, monitored
  configuration-change log in this codebase.

## 4. Mapping: KSI-CNA-RNT — Restricting Network Traffic

FedRAMP's published outcome requires machine-based resources to be
"persistently reviewed" so they are "appropriately configured to limit inbound
and outbound network traffic". What follows is what this repository actually
contains on that point.

### 4.1 What the repo produces

| # | Repo material | File:line | What it actually does |
|---|---|---|---|
| 1 | Tailscale ACL policy-as-code | `tailscale-ssh-policy/acl_policy.hujson:9-17` | Single accept rule: only `autogroup:admin` may reach `tag:server:22` (Tailscale SSH). `tailscale-ssh-policy/acl_policy.hujson:21-30` requires step-up authentication (`checkPeriod: "12h"`) for users `sam`, `ubuntu`. `tailscale-ssh-policy/acl_policy.hujson:33-42` contains policy tests: `autogroup:member` is denied `tag:server:22`. |
| 2 | Host firewall hardening (Ansible) | `tailscale-ssh-policy/playbook-tailscale-ssh.yml:119-151` | Deletes legacy port-22 allow rules, sets `ufw default deny incoming`, `ufw default allow outgoing`, enables UFW. Same logic in `tailscale-ssh-policy/setup-tailscale-ssh.sh:116-138`. `tailscale-ssh-policy/SECURITY.md:9-11` records UFW deny-by-default with no TCP/22 allow rule, including on `tailscale0`. |
| 3 | Cloudflare WAF / custom rules (intended config) | `CLOUDFLARE_ZONE_HARDENING_NUMINALABS.yaml:64-100` | CRITICAL-01 blocks non-HTTPS ingress; CRITICAL-02 blocks methods other than GET/POST/HEAD/OPTIONS; CRITICAL-03 applies a managed challenge to `/control-room`, `/admin`, `/ops`; CRITICAL-04 rate-limits `/simulate`, `/voice/stream`, `/linear/task`; CRITICAL-05 blocks traversal and prototype-pollution patterns. |
| 4 | Worker routing | `wrangler.jsonc` (`routes` — `numinalabs.xyz/*` and `www.numinalabs.xyz/*` served by the Worker) | Defines the public edge surface. It is a routing declaration, not a traffic-restriction mechanism. |
| 5 | Documented ingress policy | `AGENTS.md` §39 | States ingress is restricted to IAP `35.235.240.0/20` and the Tailscale mesh, and that open ports 22/2389 must never be re-enabled. This is a documented policy statement in the repo, not a verified live enforcement. |
| 6 | Tailscale audit-log verification scripts | `tailscale-ssh-policy/gcs-verify.sh:113-117`, `tailscale-ssh-policy/gcs-verify.ps1:103-106` | Write, verify, and delete a canary object in a GCS bucket to check Tailscale audit-log delivery. The bucket is a caller-supplied parameter (example name `my-tailscale-audit-logs`); no live bucket or drain is configured in the repo. |

### 4.2 Gaps — stated plainly

- **No micro-segmentation anywhere in the repo.** The term "micro-segment" (or
  "microsegment") occurs **zero times** in the repository (grep over all files
  excluding `node_modules`/`.git`, 2026-11-18). There is no segmentation policy
  for service-to-service traffic, namespaces, or east-west traffic in code.
  What exists is host-level SSH restriction (Tailscale ACL + UFW) and edge WAF
  rules — a much narrower control than micro-segmentation.
- **Outbound traffic is not restricted.** UFW's default is `allow outgoing`
  (`tailscale-ssh-policy/playbook-tailscale-ssh.yml:144-145`;
  `tailscale-ssh-policy/setup-tailscale-ssh.sh:120`). The KSI covers inbound
  **and** outbound traffic; the repo restricts inbound SSH only and leaves
  outbound open.
- **No persistent review of network configuration.** Nothing in repo code
  periodically reviews machine network configurations against the intended
  state. The audit orchestrator (§3.1(5)) covers host ACLs/services/sizes, not
  network-traffic configuration. The KSI's "persistently reviewed" element is
  not instrumented.
- **Live enforcement is unverified.** The Tailscale ACL file itself says
  "Review identity values and run Tailscale's policy preview/tests before
  applying" (`tailscale-ssh-policy/acl_policy.hujson:2`), and
  `tailscale-ssh-policy/SECURITY.md:3-5` says to review the policy "against the
  actual Tailnet, host inventory, and identity provider before deployment". The
  Cloudflare WAF YAML is a manifest of intended dashboard settings; whether
  those rules are live in the Cloudflare dashboard was **not** verified here.
  Policy-as-code in the repo is not proof of enforcement on the live tailnet,
  zone, or hosts.
- **Topology file contains no network controls.** `numina-multi-cloud-topology.yaml`
  (75 lines) declares the GCP project/zone and KMS keys; a grep for
  segment/firewall/ACL/ingress/egress/deny returns no matches.
- **Overall for KSI-CNA-RNT: PARTIAL at best, and only for inbound SSH at the
  host/edge layer.** Outbound restriction, micro-segmentation, persistent
  review, and verified live enforcement are all absent from the repo.

## 5. Method, limits, and open items

- **Method.** KSI IDs and titles were verified by reading the two fedramp.gov
  pages listed in §1 on 2026-11-18. Repo mappings were grounded by grepping the
  clone at HEAD `0b1e44b` and reading the cited files; every file:line reference
  above was read, not inferred. No telemetry, KSI ID, or coverage was invented.
- **What was NOT checked.** The live Tailscale tailnet, the live Cloudflare
  dashboard/zone, live GCP firewall rules, and GitHub Actions run history were
  not accessed. Whether the ACL policy or WAF rules are actually applied and
  effective is therefore unestablished.
- **Concurrent-edit note.** At the time of writing, `git status` showed
  `M src/numina-pair-binding-raft.js` and `M src/pair-binding.schema.json` —
  working-tree edits by a sibling subagent (the raft/consensus task, Part 1 of
  this package), not by this task. The raft line numbers in §3.1 were read on
  2026-11-18 and may shift when that work lands. This task created only
  `docs/numina-fedramp-20x-ksi-mapping.md` and touched no other file.
- **KSIs not mapped.** Only the two KSIs named by the owner are mapped here.
  The other Class A KSIs (KSI-CED-RAT, KSI-IAM-AAM, KSI-IAM-APM, KSI-INR-RIR,
  KSI-SVC-SIN) and the remaining 20x KSIs are out of scope for this document.
- **No new dependencies, no code changes** were made for this mapping.
