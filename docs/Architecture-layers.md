# Numina L3, L4 and L5

Numina implements three functional architecture layers over one control journal. The layer numbers describe the architecture.

| Layer | Responsibility | Current production scope |
| --- | --- | --- |
| L3 — Authority | Agent identity, delegated authority, policy and human decisions | ALLOW / DENY / ESCALATE; approval bound to the request and immutable policy version |
| L4 — Execution | Requests, provider orchestration, MCP and A2A | Authorized internal records can reach FINAL; external adapters prepare handoffs |
| L5 — Canonical evidence | Provenance, journal head and the singular NUSD projection | Ed25519 receipts bind internal journal events; owner-authenticated treasury reads the same canonical lineage |

The public [architecture manifest](https://numinalabs.xyz/api/control/v2/architecture) and [journal health](https://numinalabs.xyz/api/control/v1/health) identify these surfaces. The authenticated state supplies the current head; a packaged release never substitutes a fabricated head.

The treasury model is singular: one Numina-native NUSD projection under NUMINA authority. Provider balances and approvals retain their actual provider identity and evidence. Production deployment enables the shipped software; individual authorizations, account connections and external outcomes are recorded when they occur.
