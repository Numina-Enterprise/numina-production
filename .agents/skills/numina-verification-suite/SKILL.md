---
name: numina-verification-suite
description: Dual-engine provenance verification, Node.js test suite execution, and GCS/Tailscale audit logging verification for Numina.
---

# Numina Verification Suite

Use this skill when auditing, verifying, or testing Numina manifests, mesh routers, or cloud logging integrations.

## Workflows

### 1. Dual-Engine Manifest Verification (Python + OpenSSL 3.5.7)
Always run with `--openssl` flag and reference the pinned trust store:
```powershell
python verify_manifest.py provenance-manifest.json \
  --repo-root . \
  --trusted-keys trusted.json \
  --openssl
```
*Expected Result:* 19 passed, 0 failed with exit code 0.

### 2. Node.js Mesh Router & E2E Suites
Always execute tests from the project root directory where `src/` resides so that dynamic imports resolve correctly:
```powershell
# Run mesh router suite
node --test tests/numina-mesh-router.test.mjs

# Run full opaque-box E2E suite
node --test tests/e2e-suite.test.mjs
```
*Expected Result:* 12/12 mesh router tests pass, 34/34 E2E tests pass (0 skipped).

### 3. Google Cloud Storage (GCS) Audit Log Verification
To verify GCS bucket accessibility, IAM permissions (`roles/storage.objectCreator`), and end-to-end canary log streaming:

**Windows (PowerShell):**
```powershell
powershell -File gcs-verify.ps1 -Bucket "gs://<bucket-name>" -TailscaleServiceAccount "<tailscale-sa>@<project>.iam.gserviceaccount.com"
```

**Linux / Bash:**
```bash
./gcs-verify.sh "gs://<bucket-name>" "<tailscale-sa>@<project>.iam.gserviceaccount.com"
```

*Prerequisites Check:* Ensure `gcloud` CLI is installed (`winget install Google.CloudSDK`) and authenticated (`gcloud auth login`) before executing.

### 4. Windows Host & Sandbox Privilege Handling
- In standard sandboxed user sessions, check Secure Boot via registry:
  `Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name 'UEFISecureBootEnabled'`
- SFC, DISM, and service modifications require an elevated administrator console session (`Run as Administrator`).

---

## 5. Non-Negotiable Invariant Pre-Conditions

Every verification run within this suite strictly enforces the workspace rules:
1. **Rule Binding: `numina-zero-trust-contract.md`**:
   - Authority (`skott34-ed25519`) fingerprint must match `46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce`.
   - Guardian (`numina-guardian-ed25519`) fingerprint must match `465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c`.
   - Documents must be clean UTF-8 with zero BOM (`EF BB BF`) and zero mojibake (`C3 A2 E2 82 AC`).
2. **Rule Binding: `numina-provenance.md`**:
   - Cluster state root must equal `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`.
   - Fail-closed execution: any single failure halts downstream operations immediately.
3. **Rule Binding: `security-coexistence.md`**:
   - Treat `RealTimeProtectionEnabled: False` in Defender as normal when McAfee is active. Check `root/SecurityCenter2` first.
