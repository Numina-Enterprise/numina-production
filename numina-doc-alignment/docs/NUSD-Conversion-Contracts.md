# NUSD 1:1 Conversion & Redemption Contracts — Security & Settlement Guide

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

## 1. Specification Overview & Authoritative Invariants
This specification documents the smart contract conversion mechanics, same-chain USDC inventory exchange, and USD redemption escrow for NUSD (Numina USD).

1. **Operational Invariant**: The NUSD conversion and redemption engine operates in `UNPAUSED_AND_ACTIVE` status. Conversions, redemptions, and settlement gates are active.
2. **1:1 Reserve Backing Invariant**: Every NUSD token is backed 1:1 by independently verified cash and cash-equivalent USDC/USD reserves.
3. **Anti-Double-Counting Invariant**: Self-issued balances are strictly rejected (`isSelfIssuedBalance === false`). Independent third-party confirmation is mandatory (`independentProviderConfirmed === true`, `doubleCountCheckPassed === true`).
4. **Persistent Atomic Idempotency Invariant**: All conversion and redemption operations require `PERSISTENT_ATOMIC` idempotency stores with minimum 16-character keys and 24-hour TTL. Duplicate attempts fail closed with `DUPLICATE_NUSD_OPERATION_REJECTED`.
5. **Authoritative Governance**: Samuel J. Kott (`skott34-ed25519`) is the sole System Owner, Authority, Source of Truth, and Lead.
6. **Channel Quarantining**: Legacy paused-NUSD references and unverified Google Play candidates are quarantined under `CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED`.
7. **Verified Asana Sprint**: Tracked exclusively under Asana sprint GID `1219183110870936`.

---

## 2. Architecture & Trust Boundaries

```
+-----------------------+       +-------------------------+       +------------------------+
| Holder Request        | ----> | 1:1 Liquidity & Reserve | ----> | Same-Chain USDC        |
| (16+ Char Idemp Key)  |       | Verification Gate       |       | Inventory Settlement   |
+-----------------------+       +-------------------------+       +------------------------+
                                             │
                                             ▼
+-----------------------+       +-------------------------+       +------------------------+
| Final Receipt Commit  | <---- | Atomic Rollback Guard   | <---- | Off-Chain Bank Wire    |
| (PERSISTENT_ATOMIC)   |       | & Nonce Consumption     |       | Confirmation Boundary  |
+-----------------------+       +-------------------------+       +------------------------+
```

1. **Same-Chain USDC Inventory Exchange**:
   - Instant 1:1 exchange between NUSD and USDC on supported chains.
   - Uses BigInt unit precision (`conversionAmountUnits <= availableLiquidityUnits`).
   - Requires zero slippage and zero fee spread on 1:1 conversions.
2. **USD Redemption Escrow**:
   - Escrows NUSD tokens pending bank wire transfer confirmation.
   - Releases NUSD burn and fiat settlement upon independent receipt verification.
3. **Bank-Confirmation Trust Boundary**:
   - Fiat wire confirmations must be cryptographically attested by authorized banking partners.
   - Unattested claims remain in `COMMITTED_UNSETTLED` until independent finality is verified.

---

## 3. Role Separation & Execution Authority
Execution of NUSD contracts enforces strict multi-signature separation of roles:

- **Caller**: Initiates conversion request, providing valid identity token, destination, and `idempotencyKey`.
- **Root Authority (`skott34-ed25519`)**: Samuel J. Kott validates governance rules, reserve attestations, and state-root anchors.
- **Guardian (`numina-guardian-ed25519`)**: Co-signs settlement transactions after independent invariant verification.
- **Circuit Breaker**: Any detected reserve shortfall, state root drift, or self-issued balance triggers automatic isolation.

---

## 4. Reentrancy Protection, Nonce Management & Atomic Rollback
1. **Reentrancy Guards**: All state mutations follow the Checks-Effects-Interactions pattern. Mutex locks prevent cross-contract reentrancy.
2. **Atomic Rollback**: If liquidity transfer, bank wire, or receipt allocation fails, the entire transaction rolls back atomically. Nonces for failed transactions are not committed.
3. **Persistent Replay Protection**:
   - Nonces must be at least 16 characters long.
   - Nonce keys format: `nusd:<idempotencyKey>`.
   - Durability mode must be `PERSISTENT_ATOMIC`.

---

## 5. 5 Production Acceptance Gates & Operational Verification
NUSD operations are bound into the 5 Production Acceptance Gates:

1. **RC27 Release Verification Report**: Build provenance, image digest SHA-256, deployment revision, active runtime binding.
2. **Runtime Signer Verification Report**: Runtime signer binding, availability, readiness, approved `skott34-ed25519` identity.
3. **Build 6 Verification Report**: Artifact hash SHA-256, source binding, signing status, formal classification (`Accepted`, `Blocked`, or `Not Accepted`).
4. **Backup & Restore Validation Report**: Automated restore tests across Mac, VENGEANCE, Google Drive, iCloud, and Neon to Galera Cluster synchronous replication.
5. **S0 Governance Approval Package**: Scope freeze, ownership (`Samuel J. Kott` / `Sam Kott`), reviewer assignment, minimum controls, candidate readiness.

---

## 6. International Treaty Compliance Gate
NUSD smart contract operations adhere to global cross-border data transfer treaties:

- **EU GDPR SCC**: Commission Implementing Decision (EU) 2021/914 of 4 June 2021 (`https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj`).
- **Brazil LGPD**: Resolução CD/ANPD nº 19, de 23 de agosto de 2024 (`https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-19-de-23-de-agosto-de-2024-580095396`).
- **EUR-Lex 5-Part Treaty Suite**: Full adherence to overview, founding, accession, in-force, and other treaty standards.
- **Repealed SCC Block**: Strict rejection of repealed Decision 2010/87/EU (`CELEX:32010D0087`, `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32010D0087`) with error `ERR_REPEALED_SCC_2010_87_EU`.

---

## 7. Zero-Trust Surface Quarantine Registry
Settlement endpoints and relays connect through the 19 audited perimeter surfaces under Zero Trust:
- **Perimeter Surfaces**: `https://www.numinalabs.xyz`, `numina.ai`, `projectnumina.ai`, `ask-chat.ai`, `api.ask-chat.ai`, `github`, `vercel`, `neon-galera-cluster`, `google-drive`, `google-cloud` (project-0317d6c9-e943-409e-83f), `icloud-drive`, `xcode-cloud`, `xcode`, `tailscale`, `cloudflare`, `salesforce`, `/Numina`, Codex `numina-production` workspace, Codex `space`.
- **Central Workspace**: `VENGEANCE_SANDBOX_ISOLATED`.
- **Lateral Unmanaged PCs**: Blocked with `ERR_UNMANAGED_LATERAL_PC_FORBIDDEN`.
- **Quarantined Google Play Channel**: `CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED`.
