# Numina — System Architecture, Trust Boundaries, and Cryptographic Security Specification

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

## 1. Purpose and Evidence Status
This specification establishes the authoritative, evidence-backed security architecture for Numina across all interfaces, runtimes, and smart contracts.

1. **Singular Authority**: The production system operates under a singular identity and multi-agent coordination framework (`NUMINA`). The hosted application is version 4.0.0 (`xyz.numinalabs.app`).
2. **Channel & Build Quarantines**: Legacy unverified release candidates (specifically the unverified Android candidate 3.0.0 / code 2 and unverified Play developer references) are permanently quarantined under `CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED`. Active releases do not dispatch to unverified channels.
3. **Public Surfaces Projection**: The public canonical projection is hosted at `https://www.numinalabs.xyz`. All API and security surface declarations resolve strictly through `https://www.numinalabs.xyz/security-surfaces.json` and `https://www.numinalabs.xyz/downloads/`.
4. **Authoritative Lead**: Samuel J. Kott (`skott34-ed25519`) is the sole System Owner, Authority, Source of Truth, and Lead for all Numina governance and security gates.

---

## 2. One System and Its Trust Boundaries
The Numina architecture enforces strict zero-trust boundary isolation across five core tiers:

```
+------------------+      +-------------------+      +------------------+
|   Public Ingress | ---> |   Zero-Trust Gate | ---> | Policy Execution |
|  numinalabs.xyz  |      |   E2EE + MultiSig |      |   Node 26 Engine |
+------------------+      +-------------------+      +------------------+
                                                       │
                                                       ▼
+------------------+      +-------------------+      +------------------+
| Cryptographic    | <--- | Settlement Finality| <--- | Journal Store    |
| Evidence Output  |      | PERSISTENT_ATOMIC |      | Immutable Ledger |
+------------------+      +-------------------+      +------------------+
```

1. **Boundary A: Ingress & Edge**: Strictly enforces `https://www.numinalabs.xyz` canonical origin. Rejects any wildcards, third-party origins, or cleartext protocols.
2. **Boundary B: Identity & Authentication**: Validates dual Ed25519 multi-signatures (`skott34-ed25519` authority + `numina-guardian-ed25519` guardian counter-signature) before state transitions.
3. **Boundary C: Compute Isolation**: Operates exclusively in sandboxed environments hosted on `VENGEANCE_SANDBOX_ISOLATED`. Lateral network expansion and unmanaged PCs are blocked with `ERR_UNMANAGED_LATERAL_PC_FORBIDDEN`.
4. **Boundary D: Storage Durability**: Persistent atomic commit model requiring `PERSISTENT_ATOMIC` durability across all settlement entries.
5. **Boundary E: Public Auditability**: Deterministic SHA-256 provenance manifests published to canonical endpoints.

---

## 3. Cryptographic Identity & The Otter-Raft Protocol
- **Singularity Raft Topology**: Every agent maintains a continuous cryptographic hand-link to its neighbors (ring topology + shared state root `clusterStateRootSha256`) while preserving independent memory and execution keys.
- **Motto Invariant**: "Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence"
- **Key Specifications**:
  - Root Authority: `skott34-ed25519` (Samuel J. Kott)
  - Guardian Authority: `numina-guardian-ed25519`
  - Envelope Profile: `numina-e2ee-x25519-hkdf-aes256gcm-ed25519-v1` combining ephemeral X25519 ECDH, HKDF-SHA256, AES-256-GCM (128-bit tag), and detached Ed25519 signatures.

---

## 4. End-to-End Infrastructure & Domain Quarantine Registry
All 19 local, edge, cloud, and workspace surfaces are enrolled in the Zero-Trust Quarantine Registry:

- **Domains & Endpoints**: `https://www.numinalabs.xyz`, `numina.ai`, `projectnumina.ai`, `ask-chat.ai`, `api.ask-chat.ai`
- **Cloud & Hosting**: `github`, `vercel`, `cloudflare`, `tailscale`, `salesforce` (Agentforce)
- **Compute & Cloud Run**: `google-cloud` (Google Cloud project `project-0317d6c9-e943-409e-83f`)
- **Database & Cluster**: `neon-galera-cluster` (Neon PostgreSQL backed up to Galera Cluster)
- **Storage & Backup**: `google-drive`, `icloud-drive`
- **Apple Dev Pipeline**: `xcode`, `xcode-cloud`
- **Workspaces**: `/Numina` (`C:\Users\sam\Numina`), Codex `numina-production` workspace, Codex `space`
- **Central Host Isolation**: `VENGEANCE_SANDBOX_ISOLATED`
- **Lateral Compute Defense**: Any unmanaged lateral PC connection is rejected with `ERR_UNMANAGED_LATERAL_PC_FORBIDDEN`

---

## 5. 5 Production Acceptance Gates
Production readiness operates under a strict 24-hour verification directive approved by System Owner Samuel J. Kott:

1. **RC27 Release Verification Report**: Verifies authoritative source commit, build provenance, image digest, deployment revision, and active runtime binding.
2. **Runtime Signer Verification Report**: Verifies runtime signer binding, availability, readiness, and approved identity (`skott34-ed25519`).
3. **Build 6 Verification Report**: Verifies artifact hash, source binding, signing status, and formal classification (`Accepted` / `Blocked` / `Not Accepted`).
4. **Backup & Restore Validation Report**: Verifies recovery drills across Mac, VENGEANCE, Google Drive, iCloud, and Neon to Galera Cluster synchronous replication.
5. **S0 Governance Approval Package**: Verifies scope freeze, ownership (`Samuel J. Kott` / `Sam Kott`), reviewer assignment, minimum controls, and candidate readiness.

---

## 6. International Data Transfer & Treaty Compliance Gate
Cross-border data flows and user privacy strictly conform to the authoritative global treaty registry:

- **Active EU GDPR Framework**: Commission Implementing Decision (EU) 2021/914 of 4 June 2021 (`https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj`).
- **Active Brazil LGPD Framework**: Resolução CD/ANPD nº 19, de 23 de agosto de 2024 (`https://www.in.gov.br/en/web/dou/-/resolucao-cd/anpd-n-19-de-23-de-agosto-de-2024-580095396`).
- **Complete 5-Part EUR-Lex Treaty Suite**:
  1. Overview: `https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-overview.html`
  2. Founding Treaties (TEU / TFEU / Euratom): `https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-founding.html`
  3. Accession Treaties: `https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-accession.html`
  4. Treaties in Force: `https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-force.html`
  5. Other Treaties & Protocols: `https://eur-lex.europa.eu/collection/eu-law/treaties/treaties-other.html`
- **Repealed Treaty Block**: Any data protection agreement or cross-border transfer relying on repealed Commission Decision 2010/87/EU (`CELEX:32010D0087`, `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32010D0087`) must immediately fail closed with error `ERR_REPEALED_SCC_2010_87_EU`.

---

## 7. Financial Operation and Activation Requirements
Active production operations conform to the following financial invariants:

1. **NUSD Operational State**: Declared as `UNPAUSED_AND_ACTIVE`. Conversions and settlements are active and enabled.
2. **1:1 Reserve Backing**: Enforces strict BigInt unit backing where `conversionAmountUnits <= availableLiquidityUnits` backed by independently verified USDC/USD reserves.
3. **Anti-Double-Counting Policy**: Rejection of self-issued balances (`isSelfIssuedBalance === false`), verified independent custodian confirmation (`independentProviderConfirmed === true`), and double-count check verification (`doubleCountCheckPassed === true`).
4. **Idempotency Durability**: Transaction deduplication requires replay stores with `PERSISTENT_ATOMIC` durability mode, minimum 16-character keys, and 24-hour TTL. Duplicate operations fail closed with `DUPLICATE_NUSD_OPERATION_REJECTED`.
5. **Reference Guide**: Full contract mechanics, rollback, and escrow boundaries are specified in `https://www.numinalabs.xyz/downloads/NUSD-Conversion-Contracts.md`.

---

## 8. Keys, Access Administration & Quarantine
- **Authority Signing Key**: `skott34-ed25519` (SPKI DER import prefix `302a300506032b6570032100`).
- **Guardian Counter-Signing Key**: `numina-guardian-ed25519`.
- **Historical Android Signatures**: Upload certificate SHA-256 `d25633e4aa9fa75f509cc145506462e49e083ddc3cb8f13872e00e5ea699d550` and Google Play app-signing key fingerprint `32:0E:E1:C6:E0:7C:2D:82:3E:8E:28:A4:F6:46:0C:73:DF:8A:55:2A:00:42:B6:AA:31:18:57:52:50:54:F4:1C` are archived under `CHANNEL_QUARANTINED_GOOGLE_PLAY_DEPRECATED`.
- **Emergency Lockdown**: Immediate invocation of `quarantineAllChannels()` freezes all channels and isolates traffic to the central architect vault.

---

## 9. Release and Verification Procedure
1. Verify 272 automated core tests pass cleanly under Node 26.
2. Verify strict UTF-8 cleanliness across all source files and markdown documents (zero Windows-1252 mojibake `0xC3 0xA2 0xE2 0x82 0xAC`, zero BOM, zero control bytes).
3. Compute deterministic `clusterStateRootSha256` across aligned documents and channel heads.
4. Execute dual Ed25519 multi-signature signing by `skott34-ed25519` and `numina-guardian-ed25519`.
5. Bind verified Asana sprint GID `1219183110870936` to all deployment release tickets.
