# Numina 5 — Shared Capability Architecture and Product Economics
Date: 2026-11-15
Status: DESIGN SPECIFICATION / NOT PRODUCTION VERIFIED
Owner: SK Consulting LLC dba Numina Labs
Related review: https://github.com/Numina-Enterprise/numina-production/pull/196

## Architecture contract
All client surfaces (web, iOS, Android, desktop, developer API, agent SDK, multimodal interfaces) use versioned API contracts through a single identity-aware gateway. No client may assert trusted identity via forwarded headers. The gateway validates authorization, tenant, purpose, entitlements, rate limits and data residency before dispatch. Agents receive scoped, expiring capabilities, explicit human approval for consequential actions, and auditable tool invocation. Models are replaceable backends with recorded checkpoint digest, license, tokenizer, runtime, safety profile, evaluation version and per-request receipt.

## Shared reusable services
- Identity, tenancy, authorization, key management, consent and policy enforcement
- Model routing, inference and multimodal processing with usage metering
- Retrieval, memory and provenance with retention controls
- Agent orchestration with sandboxed tools, replay protection and approval gates
- Domain modules: geospatial analysis, cybersecurity, distributed systems, simulation, automation and scientific research
- Evidence registry: source revision, CI, SBOM, signed manifest, model checkpoint, benchmarks, inference receipts and release approval
- Billing, licensing, entitlements, metering and cost attribution

Each domain module must expose a versioned schema, explicit data classification, tenant boundary, deterministic test fixtures, contract tests, adversarial security tests, performance benchmarks and a rollback path. Domain modules must not bypass the shared policy gateway.

## Product family boundaries
- Numina Core / Intelligence API: text and multimodal inference; isolate model execution and customer prompts.
- Numina Applications: web/mobile/desktop experiences; token-based client sessions, no embedded service secrets.
- Numina Agents: automation and delegated workflows; explicit tool scopes and human approvals.
- Numina Geo & Science: geospatial, simulation and research; licensed data, provenance and reproducibility.
- Numina Cyber & Infrastructure: cyber provenance, telemetry, distributed systems; read-only default and production change gates.
- Numina Enterprise Private: dedicated tenant/private deployment; environment-specific controls and auditable customer acceptance.

## Commercial models
Subscription tiers, usage-priced developer APIs, enterprise licensing, private deployments and vertical offerings are separate SKU families. Do not represent pricing, customer adoption, revenue or model readiness as established without records. Corporate equity issuance is not an LLC product offering.

## Unit economics and retention schema
For each product_family_id, SKU, customer segment, environment and calendar month, capture:
- gross revenue, discounts/refunds, net revenue, active paying customers, new customers, retained customers, churned customers
- inference tokens/images/audio seconds, GPU/CPU seconds, model hosting and storage costs, egress, third-party API fees
- support, sales, payment processing, security/compliance and allocated infrastructure costs
- gross margin = (net revenue - direct cost of revenue) / net revenue when net revenue > 0
- contribution margin = (net revenue - direct cost of revenue - attributable variable operating costs) / net revenue when net revenue > 0
- customer retention = retained prior-period customers / prior-period customers when denominator > 0
- inference cost per successful request = attributed inference cost / successful inference requests when denominator > 0
- profitability = net revenue - direct costs - attributable operating expenses; distinguish this from gross margin
Use NOT AVAILABLE rather than zero for missing data; maintain allocation method and source receipt per metric. Reconcile Stripe invoices/refunds, usage meter, cloud billing and general ledger before reporting financial actuals.

## Independent verification gates
1. Contract and authorization tests per client; forged identity-header rejection and tenant isolation.
2. Model checkpoint license/hash verification plus real inference receipt; mock tests alone insufficient.
3. Domain module correctness, reproducibility and abuse-case tests.
4. CI artifacts, supply-chain attestation, benchmark reproducibility and regression thresholds.
5. Billing meter reconciliation and per-family margin dashboard.
6. Explicit authority approval before merge, production release, signing, customer activation or financial movement.

## Cross-surface evidence publication
GitHub stores versioned source and release manifests; Google Drive stores reviewed business and engineering records; numinalabs.xyz publishes only approved public claims and linked version status. Every surface must identify the same release version, source commit, SHA-256 artifact digests, CI evidence, benchmark receipt and approval state. A draft branch is not a production release.
