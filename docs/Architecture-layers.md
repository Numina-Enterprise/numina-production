# Numina L1 through L5

Numina implements five functional architecture layers as projections of one finalized singular build. The current public Cloudflare frontier is a finalized-build projection: it does not require a mutable application database or journal to expose release identity, readiness, architecture, discovery, network observation, or canonical evidence.

| Layer | Responsibility | Current production scope |
| --- | --- | --- |
| L1 — Root and build head | Singular root, deterministic finalized-build head and connected network observation | One NUMINA root and one finalized-build head derived from the finalized build; network observations retain their provider evidence |
| L2 — Intent and evidence | Intent/evidence schemas, release manifest and finalized build projection | Public manifest and final-build evidence; no mutable public state is required |
| L3 — Authority | Authority model, policy vocabulary and architectural controls | Public architecture and business-core policy projection; no stateful authority store is required for public readiness |
| L4 — Execution transports | MCP and A2A transport discovery | Public MCP discovery and A2A agent card are live; private mutation handlers remain outside the public frontier |
| L5 — Canonical evidence | Release provenance, signed readiness and NUSD deployment evidence | Signed frontier readiness, release manifest and deployment receipt bind the finalized singular build |

The public [architecture manifest](https://numinalabs.xyz/api/control/v2/architecture), [build head](https://numinalabs.xyz/api/control/v2/head), and [frontier readiness](https://numinalabs.xyz/v1/frontier/readiness) identify these surfaces. The public head is a deterministic projection of the finalized build and does not claim a mutable journal revision.

Android and iOS are two native delivery planes, not architectural L6/L7. Together with L1–L5 they form the seven-plane frontier release view.

The treasury presentation remains part of the finalized NUMINA software projection. External provider balances, settlements, store submissions, and other third-party outcomes remain separately evidenced and are not created by this finalized release projection.
