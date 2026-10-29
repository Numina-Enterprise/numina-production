---
description: Architecture, routing invariants, and treaty compliance for Numina Mesh Router
always_on: true
---

# Numina Mesh Router & Document Alignment Invariants

When developing or executing tests within `numina-doc-alignment`:

## 1. Zero External Runtime Dependencies
- Must strictly use Node 26 built-in modules: `node:crypto`, `node:test`, `node:assert/strict`, `node:fs`, `node:path`.
- Never introduce third-party npm runtime dependencies for crypto or routing.

## 2. 3-Pillar Message Gate Architecture
Every message routed through `routeChannelMessage()` must pass all three pillars:
1. **Pillar 1 (E2EE Envelope):** Valid x25519 ECDH key exchange + AES-256-GCM authenticated encryption.
2. **Pillar 2 (State Root Binding):** Message `expectedClusterStateRoot` must match `currentClusterStateRoot` exactly (1-byte drift triggers auto-quarantine).
3. **Pillar 3 (Multi-Sig Room Grant):** Target channel must be in active state via dual-signed multi-sig attestation from `skott34-ed25519` and `numina-guardian-ed25519`.

## 3. Data Privacy & Treaty Guardrails
- **Active Treaties:** EU GDPR SCC 2021/914 and Brazil LGPD Resolution CD/ANPD 19/2024.
- **Fail-Closed Rejection:** Immediate rejection with `ERR_REPEALED_SCC_2010_87_EU` if repealed Commission Decision 2010/87/EU is referenced.
- **Sprint Tracking:** Permitted Asana Sprint GID is strictly `1219183110870936`; reject forbidden GID `1219187222788173`.
