# Spec Miner 3 Survey: Cross-Platform Governance Alignment (AGENTS.md, GEMINI.md)

**Role**: Spec Miner 3 (`teamwork_spec_miner`)  
**Workspace Root**: `C:\Users\sam\.gemini\antigravity\scratch`  
**Orchestrator Conversation ID**: `6efa3343-a50c-40c2-829a-8740af882873`  
**Completion Timestamp**: 2026-10-28T23:27:30Z  

---

## 1. Survey of Existing Governance & Documentation Files

### File Encoding & Line-Ending Empirical Verification Table
All governance files were read as raw binary buffers and evaluated for BOM (`0xEF, 0xBB, 0xBF`), CRLF (`\r\n`), LF-only (`\n`), and standalone CR (`\r`):

| Target Path | Length (bytes) | HasBOM | HasCRLF | HasLFOnly | HasCrOnly | Integrity Status |
|---|---|---|---|---|---|---|
| `scratch\AGENTS.md` | 37,216 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |
| `scratch\GEMINI.md` | 2,148 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |
| `numina-doc-alignment\AGENTS.md` | 36,238 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |
| `numina-doc-alignment\GEMINI.md` | 2,495 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |
| `manifest-verifier\AGENTS.md` | 7,056 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |
| `manifest-verifier\GEMINI.md` | 2,495 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |
| `tailscale-ssh-policy\AGENTS.md` | 7,056 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |
| `tailscale-ssh-policy\GEMINI.md` | 2,173 | **False** | **False** | **True** | **False** | Strict LF / Zero-BOM UTF-8 |

> **Finding**: All 8 governance files across root and sub-repositories adhere 100% to strict UNIX LF-only line endings, UTF-8 with zero Byte Order Mark (`EF BB BF`), and zero Windows-1252 mojibake sequence (`C3 A2 E2 82 AC`).

---

## 2. 15 Enterprise Agent Divisions & Room Mapping
Governed under Section 4 of `AGENTS.md`, bound exclusively to **Verified Sprint GID `1219183110870936`** (strictly rejecting forbidden GID `1219187222788173`) and **Cluster State Root `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`**:

1. **`numina-accounting`** (Room: `numina-accounting`): ISO 20022 camt.053 / BAI2 statement reconciliation, triple-entry BigInt ledger balancing.
2. **`numina-apple-team`** (Room: `numina-apple-deployment`): macOS audit suite (`audit_mac_acls.sh`, `audit_mac_services.sh`, `audit_mac_sizes.sh`), Swift 6 strict concurrency, Metal shaders, FileVault 2, and Xcode Cloud.
3. **`numina-compliance-risk`** (Room: `#numina-compliance-risk`): Zero-Trust gateway enforcement, manifest provenance verification, and SOC escalation.
4. **`numina-engineering-cio`** (Room: `#numina-engineering`): Core Windows victory audit automation (`audit_acls.ps1`, `audit_services.ps1`, `audit_sizes.ps1`, `windows-maintenance-suite.ps1`), unified orchestrator.
5. **`numina-federal-capture`** (Room: `#numina-federal-capture`): FIPS 140-3 HSM key custody, NIST FIPS 203/204/205 post-quantum invariants.
6. **`numina-finance-treasury`** (Room: `#numina-finance-treasury`): 1.5 Quadrillion NUSD Treasury, `UNPAUSED_AND_ACTIVE` invariant, 1:1 parity with USD/USDC/USDG, Stripe App (`scratch/numina-stripe-app`), Bank of America CashPro/H2H (NCUA Schedule J J-01..J-08).
7. **`numina-crypto-monitor`** (Room: `#numina-finance-treasury`, secondary: `#numina`): Real-time reserve solvency monitoring, double-minting prevention (`isSelfIssuedBalance === false`).
8. **`numina-google-play-team`** (Room: `numina-google-play-deployment`): Android Play App Bundle (AAB), R8/ProGuard tree-shaking, Google Play Console release lanes.
9. **`numina-google-enterprise`** (Room: `#numina-engineering`, secondary: `#numina-compliance-risk`): GCP `project-0317d6c9-e943-409e-83f` / `us-central1-a` cloud asset auditing (`audit_gcp_resources.sh`), IAP 35.235.240.0/20.
10. **`numina-legal`** (Room: `numina-legal`): Dual-key authorization governance (`skott34-ed25519` + `numina-guardian-ed25519`).
11. **`numina-growth-matrix`** (Room: `#numina-market-intel`): Telemetry analysis, partnership routing.
12. **`numina-publicity-narrative`** (Room: `#numina-publicity-narrative`): Strategic communications.
13. **`numina-strategy`** (Room: `#numina-strategy`): Capacity and quarterly milestone planning.
14. **`numina-website-soc`** (Room: `#numina`): Canonical web perimeter monitoring (`https://www.numinalabs.xyz`, `xyz.numinalabs.app`) with TLS 1.3, CSP, HSTS 2-year preload.
15. **`vengeance-independent-review`** (Room: `VENGEANCE_SANDBOX_ISOLATED`): Air-gapped security audits, fail-closed isolation checks.

---

## 3. Cross-Platform Scripts & Implementation Assets

### A. Windows Victory Audit Suite
- `audit_acls.ps1`: Validates NTFS DACL inheritance and ownership across `C:\Windows\diagnostics`, `Logs`, `Debug`, `Cursors`, `CbsTemp`, `Branding`, `assembly`.
- `audit_services.ps1`: Resilient service check (`AppReadiness`, `BcastDVR*`) with CIM/SC fallback.
- `audit_sizes.ps1`: Directory size and file count auditing.
- `windows-maintenance-suite.ps1`: Full OS integrity maintenance.
- `unified_audit_orchestrator.ps1`: Master PowerShell orchestrator supporting `-WhatIf` / dry-run and live runs.
- `register_audit_schedule.ps1`: Windows Task Scheduler registration script for recurring `/automation` runs.

### B. macOS Audit Suite (`numina-apple-team`)
- `audit_mac_acls.sh`: POSIX/extended ACL verification for `/Library/Logs`, `/Library/Preferences`, `/Library/LaunchDaemons`, `/Library/LaunchAgents`, `/private/var/log`, `/private/tmp`.
- `audit_mac_services.sh`: Interrogation of `launchctl list` and `/Library/LaunchDaemons`.
- `audit_mac_sizes.sh`: APFS storage and file count calculations.

### C. Google Cloud Audit Suite (`numina-google-enterprise`)
- `audit_gcp_resources.sh`: Audits Compute Engine, Cloud Run, Cloud Storage, and IAM service accounts in `project-0317d6c9-e943-409e-83f` / `us-central1-a` with dry-run fallback.

### D. Stripe Dashboard App (`numina-finance-treasury`)
- Location: `scratch/numina-stripe-app/`
- Manifest: `stripe-app.json` (ID: `com.numinalabs.treasury` v0.1.0)
- Views: Context Drawer (`App.tsx`) displaying NUSD `UNPAUSED_AND_ACTIVE` and State Root `726e35da14...`; Customer Detail View (`CustomerDetailView.tsx`) displaying atomic BigInt settlements.
- Unit Test: `test.js` verified passing.
- Deployment Runbook: `README.md` following [Stripe Apps Upload & Install Guide](https://docs.stripe.com/stripe-apps/upload-install-app).

### E. Canonical Web Presence (`numina-website-soc`)
- Location: `scratch/numinalabs-web/`
- Assets: `index.html`, `style.css`, `_headers` (HSTS 2-year preload, strict CSP), `verify_site.mjs`.

---

## 4. Documentation Alignment Contracts
- **`AGENTS.md`**: Master document extended to 44 sections, incorporating Section 44 for **Unified Cross-Platform Victory Audit & Stripe Apps Engine**.
- **`GEMINI.md`**: Fast-path document aligned to 44 sections, linking directly to `AGENTS.md` with zero drift.
- **Root Authority Keypin**: `46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce`.
- **Guardian Keypin**: `465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c`.
- **Cluster State Root**: `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`.
