---
name: provenance-signer-pipeline
description: Comprehensive operational guide for running OpenSSL + Python manifest verification, generating Ed25519 signatures, and provisioning Tailscale Zero-Trust hosts.
---

# Provenance Signer & Verification Pipeline

Use this skill when auditing manifest integrity, re-signing roots after documentation updates, or provisioning Zero-Trust Linux/Tailscale hosts.

## Core Procedures

### 1. 19-Point Manifest Verification
Run with the pinned trust store and dual-engine cross-checking:
```powershell
python verify_manifest.py provenance-manifest.json \
  --repo-root /path/to/repo \
  --trusted-keys trusted.json \
  --max-skew-ms 86400000 \
  --openssl
```
*Criteria:* All 19 checks must return `[PASS]`, exit code `0`.

### 2. Computing Roots & Signing Updated Payloads
When documents in `docs/` change:
1. Strip `multiSignature`, `clusterStateRootSha256`, and `manifestSha256` from the manifest.
2. Serialize using RFC 8785 canonical JSON (`canonicalPayloadString`).
3. Compute SHA-256 state root: `clusterStateRootSha256 = sha256(canonicalPayload)`.
4. Derive signing transcript:
   ```
   NUMINA-PROVENANCE-MANIFEST-V1\n<clusterStateRootSha256>\n<canonicalPayloadString>
   ```
5. Sign the transcript with Ed25519 private keys using `sign_root.py`:
   ```powershell
   python sign_root.py provenance-manifest.json skott34.pem
   ```

### 3. Linux Host Hardening & Tailscale Mesh Deployment
To enforce WireGuard isolation and close public port 22 on Linux nodes:
```bash
bash harden-linux-tailscale.sh
```
*Validates:* UFW default-deny incoming, `tailscale0` virtual interface allow, `--shields-up`, and 12h 2FA check period in `tailscale-hardened-policy.hujson`.

---

## 4. Cross-Skill Signing & Network Perimeter Invariants

1. **Isolation Invariant**:
   - Signing operations using private keys must NEVER execute over unencrypted, public, or untrusted networks.
   - Hosts running `sign_root.py` must have active Tailscale mesh encryption (`tailscale-zero-trust`) with `--shields-up=true` and `--accept-routes=false`.
2. **Zero Key Leakage**:
   - Private key files (`*.pem`, `*.key`) must never be passed to subagents, output into stdout, or saved in public git tracking.
   - Keys must be accessed exclusively by the local signer script and wiped from memory after signing.
3. **Canonical Determinism**:
   - Every sign operation must strictly adhere to `numina-provenance.md` and `numina-zero-trust-contract.md`. Never sign non-canonical JSON or unverified transcripts.
