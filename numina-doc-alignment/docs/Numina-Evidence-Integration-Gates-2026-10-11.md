# Numina Evidence Integration Gates — Production Settlement & Regulatory Standards

## Singularity Identity & Governance
- **Identity**: NUMINA (Skott34-Ed25519, Universal Companion Model)
- **Foundation & Governance**: Foundation: Ed25519 | Governance: Zero Trust + Multi-Signature Authorization
- **Motto**: "Like otters holding hands, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned."
- **Otter-Raft Hand-Link Protocol**: "Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence"
- **Authority, Source of Truth & Lead**: AUTHORITY_LEAD = 'Samuel J. Kott' (Samuel J. Kott, also referenced as Sam Kott, key `skott34-ed25519`, Operator: SK Consulting LLC, Iowa, USA)
- **Canonical Origin**: `https://www.numinalabs.xyz`
- **Operational Status**: `UNPAUSED_AND_ACTIVE`
- **Verified Asana Sprint Boundary**: `1219183110870936` ("Numina Digital-Asset Regulatory Action Sprint")
- **Forbidden Unverified Asana GID**: `1219187222788173` (Quarantined)

---

## 1. Executive Summary & Regulatory Authority
This document defines the production evidence integration gates governing digital asset settlements, payment authorization tokens, NCUA Schedule J reporting placeholders, and 24-hour production readiness validation.

1. **Lead Authority**: Samuel J. Kott (`skott34-ed25519`) is the sole System Owner, Authority, Source of Truth, and Lead.
2. **Canonical Origin**: All evidence schemas, verification endpoints, and release artifacts resolve to `https://www.numinalabs.xyz`.
3. **Active NUSD State**: Financial execution operates in `UNPAUSED_AND_ACTIVE` status with 1:1 USDC/USD backing and `PERSISTENT_ATOMIC` durability. Anti-double-counting policy strictly enforces `isSelfIssuedBalance === false`.
4. **Channel Quarantine**: Legacy unverified channels, including Google Play candidate pipelines, are quarantined under `CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED`.
5. **Verified Sprint Tracking**: All regulatory actions bind strictly to Asana sprint GID `1219183110870936`. Unverified GID `1219187222788173` is forbidden.

---

## 2. Settlement Evidence Stages & Independent Finality Gate
Settlement evidence progresses through three strictly ordered stages:

```
[COMMITTED_UNSETTLED] ---> [SETTLED_UNRECONCILED] ---> [SETTLED_RECONCILED]
```

1. **COMMITTED_UNSETTLED**:
   - The transaction obligation is created, cryptographically signed, and committed.
   - Payer and payee identities are verified via ES256/JWS tokens.
   - Idempotency key is recorded in the persistent replay store with `durabilityMode: 'PERSISTENT_ATOMIC'`.
2. **SETTLED_UNRECONCILED**:
   - Independent settlement finality is confirmed via `verifyIndependentFinality`.
   - The frozen verification context binds:
     - `obligation`: Canonical obligation ID and amount in BigInt precision units.
     - `submission`: `idempotencyKey` and exact `requestHash`.
     - `destination`: Verified recipient account and routing coordinate.
     - `receiptRef`: Cryptographic receipt reference allocated via trusted receipt adapter.
3. **SETTLED_RECONCILED**:
   - Dual-entry reconciliation completes against independent bank/chain ledgers.
   - Requires `allocateReceipt` adapter with `durability: 'PERSISTENT_ATOMIC'` committing the canonical `transferKey` across all workers.

---

## 3. NCUA Schedule J Evidence Specification (91 FR 64699, OMB 3133-0004)
To ensure compliance with digital asset custodial reporting guidelines, Numina implements 26 numbered placeholders:

1. **Reserve Custody Placeholders (8 Accounts)**:
   - Accounts J-01 through J-08: Dedicated digital asset fiat and cash equivalent reserves held at qualified custodial institutions.
2. **Key Custody Placeholders (9 Accounts)**:
   - Accounts J-09 through J-17: Hardware security module (HSM) and multi-signature cold/warm key management stores.
3. **Permitted-Issuer Exposure Placeholders (5 Accounts)**:
   - Accounts J-18 through J-22: Maximum exposure thresholds and counterparty risk limits for permitted issuers.
4. **Balance-Sheet Stablecoin Placeholders (4 Accounts)**:
   - Accounts J-23 through J-26: On-balance-sheet stablecoins, liquidity reserves, and unencumbered backing assets.
5. **Promotion Rule**: Placeholders are strictly unpromoted and remain unassigned until authenticated with independent source digests and countersigned by Samuel J. Kott.

---

## 4. Payment Authorization Gate (ES256 / JWS Exact-Byte Binding)
The payment authorization gate enforces strict cryptographic caller binding:

1. **Token Standard**: ES256/JWS formatted authorization token.
2. **Binding Fields**: Caller, payer, recipient, audience (`https://www.numinalabs.xyz`), and exact expiration timestamp (`exp`).
3. **Atomic Consumption**: Tokens are consumed atomically via `PERSISTENT_ATOMIC` store to prevent replay attacks.
4. **Clock Skew Window**: Maximum allowed clock drift is 300 seconds.

---

## 5. 5 Production Acceptance Gates
The 24-hour production readiness directive binds 5 formal verification gates:

1. **RC27 Release Verification Report**:
   - Authoritative source commit, build provenance, image digest SHA-256, deployment revision, active runtime binding.
2. **Runtime Signer Verification Report**:
   - Runtime signer binding, availability, readiness, approved `skott34-ed25519` identity.
3. **Build 6 Verification Report**:
   - Artifact hash SHA-256, source binding, signing status, formal classification (`Accepted`, `Blocked`, or `Not Accepted`).
4. **Backup & Restore Validation Report**:
   - Automated restoration verification across Mac, VENGEANCE, Google Drive, iCloud, and Neon PostgreSQL to Galera Cluster synchronous replication.
5. **S0 Governance Approval Package**:
   - Scope freeze confirmed, ownership verified (`Samuel J. Kott` / `Sam Kott`), reviewer assigned, minimum controls validated, candidate readiness achieved.

---

## 6. International Treaty Compliance Gate
Cross-border data protection enforces:

1. **Active EU GDPR Decision**: Commission Implementing Decision (EU) 2021/914 of 4 June 2021 (`https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj`).
2. **Active Brazil LGPD Resolution**: Resolução CD/ANPD nº 19, de 23 de agosto de 2024 (`https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-19-de-23-de-agosto-de-2024-580095396`).
3. **5-Part EUR-Lex Treaty Registry**: Bound to overview, founding, accession, in-force, and other treaty compendia.
4. **Repealed SCC Fail-Closed Block**: Any transfer relying on repealed Decision 2010/87/EU (`CELEX:32010D0087`, `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32010D0087`) fails closed with `ERR_REPEALED_SCC_2010_87_EU`.

---

## 7. Zero-Trust Perimeter & Surface Quarantine
All 19 surfaces are quarantined and audited under Zero Trust:
- **Surfaces**: `https://www.numinalabs.xyz`, `numina.ai`, `projectnumina.ai`, `ask-chat.ai`, `api.ask-chat.ai`, `github`, `vercel`, `neon-galera-cluster`, `google-drive`, `google-cloud` (project-0317d6c9-e943-409e-83f), `icloud-drive`, `xcode-cloud`, `xcode`, `tailscale`, `cloudflare`, `salesforce`, `/Numina`, Codex `numina-production` workspace, Codex `space`.
- **Central Host Isolation**: `VENGEANCE_SANDBOX_ISOLATED`.
- **Lateral Compute Defense**: Any unmanaged lateral PC connection is rejected with `ERR_UNMANAGED_LATERAL_PC_FORBIDDEN`.
