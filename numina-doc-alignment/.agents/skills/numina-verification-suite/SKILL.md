---
name: numina-verification-suite
description: Dual-engine provenance verification, Node.js test suite execution, GCS/Tailscale audit logging verification, and PowerShell Zero-BOM JSON tooling for Numina.
---

# Numina Verification Suite

Use this skill when auditing, verifying, or testing Numina manifests, mesh routers, cloud logging integrations, or manipulating JSON in PowerShell.

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

### 3. Production Acceptance Manifest Derivation Pipeline
When updating bound documents in `docs/`:
1. **Strip Volatile Fields:** Remove `multiSignature`, `clusterStateRootSha256`, and `manifestSha256`.
2. **Canonicalize:** Apply RFC 8785 canonical serialization (sorted keys, zero whitespace, UTF-8).
3. **Derive State Root:** `clusterStateRootSha256 = sha256(canonicalPayload)` (baseline: `726e35da14...`).
4. **Construct Binary Signing Transcript:**
   ```
   Buffer.from("NUMINA-PROVENANCE-MANIFEST-V1\n" + clusterStateRootSha256 + "\n" + canonicalPayloadString, 'utf8')
   ```
5. **Sign:** Dual co-signing using `sign_root.py` with `skott34-ed25519` and `numina-guardian-ed25519`.

### 4. PowerShell JSON & `package.json` Zero-BOM Tooling
When reading or modifying JSON or `package.json` in PowerShell:
* **Avoid Variable Drive Collision:** Use `${variable}: ` instead of `$variable:`.
* **Zero-BOM File Writing:** Avoid `Set-Content` default BOM injection. Use:
```powershell
function Save-JsonNoBom([string]$path, $data, [switch]$Format) {
    $json = if ($Format) { $data | ConvertTo-Json -Depth 100 } else { $data }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText((Resolve-Path $path), ($json + "`n"), $utf8NoBom)
}
```

### 5. Google Cloud Storage (GCS) Audit Log Verification
To verify GCS bucket accessibility, IAM permissions (`roles/storage.objectCreator`), and canary log streaming:
```powershell
powershell -File gcs-verify.ps1 -Bucket "gs://<bucket-name>" -TailscaleServiceAccount "<tailscale-sa>@<project>.iam.gserviceaccount.com"
```

### 6. Windows Host & Sandbox Privilege Handling
- In standard sandboxed user sessions, check Secure Boot via registry:
  `Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -Name 'UEFISecureBootEnabled'`
- SFC, DISM, and service modifications require an elevated administrator console session (`Run as Administrator`).
