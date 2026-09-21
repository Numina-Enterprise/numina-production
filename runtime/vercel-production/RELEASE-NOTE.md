# Production control gateway

NUMINA 4.0.0 is the singular current application/software identity and the manifest authority for every deployable runtime surface. The active runtime dependency remains `1.9.0-rc26` with the preserved `1.8.0` frozen core; current website, Worker, integration, and native-wrapper source consume that same release contract.

GitHub `main` is the canonical source lineage and `https://numinalabs.xyz` is the canonical public origin. Vercel is sunset and is not an active runtime, deployment dependency, publication target, readiness input, or authority. The directory name `runtime/vercel-production/` is retained only as a legacy source-path label so existing byte-history and imports remain traceable; it does not imply a Vercel service dependency.

The active v4 assembly is produced from the preserved rc26 verifier. The generated ASGI entrypoint adds bounded-route HTTP telemetry; the Node connection endpoint uses the same event schema. Owner operations, including Numina's classical quantum simulator, route to the canonical Numina application.

Historical rc20/rc22 gateway modules, signed records, and provider-specific evidence remain immutable archive context only and are not active release identities. Provider balances, external settlement, store publication, and hardware status remain separately evidenced outcomes; aligning NUMINA software does not fabricate those external states.
