---
name: tailscale-zero-trust
description: >-
  Use this skill when designing, managing, or auditing Tailscale SSH zero-trust policies,
  HuJSON ACL rules, ephemeral step-up authentication, host firewall hardening, or Google
  Cloud Storage (GCS) audit log streaming and cross-platform verification within this workspace.
---

# Tailscale Zero-Trust & SSH Architecture Skill

## 1. Verified Access Control (HuJSON) Specification
When authoring or updating `acl_policy.hujson`:
- **Tag Ownership**:
  ```jsonc
  "tagOwners": {
    "tag:server": ["autogroup:admin"]
  }
  ```
- **Least-Privilege Network ACLs**:
  ```jsonc
  "acls": [
    {
      "action": "accept",
      "src": ["autogroup:admin"],
      "dst": ["tag:server:22"]
    }
  ]
  ```
- **SSH Step-Up Rule**:
  ```jsonc
  "ssh": [
    {
      "action": "check",
      "src": ["autogroup:admin"],
      "dst": ["tag:server"],
      "users": ["sam", "ubuntu"],
      "checkPeriod": "12h"
    }
  ]
  ```
- **Pre-Commit Test Assertions**:
  ```jsonc
  "tests": [
    { "src": "skott34@gmail.com", "accept": ["tag:server:22"] },
    { "src": "autogroup:member", "deny": ["tag:server:22"] }
  ]
  ```

## 2. Server Host Hardening Workflow
1. Enable Tailscale SSH non-disruptively: `sudo tailscale set --ssh=true`.
2. Verify node status: `tailscale status --json | grep -i '"ssh": true'`.
3. Restrict TCP 22 ingress to `tailscale0` interface via UFW:
   ```bash
   sudo ufw allow in on tailscale0 to any port 22 proto tcp
   sudo ufw delete allow 22/tcp || true
   sudo ufw reload
   ```

## 3. PowerShell Diagnostic Script (`gcs-verify.ps1`) Specification
`gcs-verify.ps1` runs natively in PowerShell on Windows hosts without requiring a Bash subsystem.

### Syntax & Parameter Contract:
```powershell
.\gcs-verify.ps1 -Bucket "gs://<bucket-name>" [-TailscaleServiceAccount "<SA_EMAIL>"]
```
- `-Bucket` (Mandatory): Strips leading `gs://` prefix automatically and enforces URI formatting.
- `-TailscaleServiceAccount` (Optional): Target service account email to validate for IAM object creation.

### The 5-Stage Evaluation Criteria & Remediation Matrix:

| Stage | Checkpoint | Success Criteria | Remediation if Failed |
| :--- | :--- | :--- | :--- |
| **1. CLI Auth** | `gcloud auth list` | Active authenticated account found | Run `gcloud auth login` or `gcloud auth activate-service-account` |
| **2. Bucket Health** | `gcloud storage buckets describe` | Bucket exists & metadata retrieved | Verify bucket name, regional location, and check account `storage.buckets.get` permissions |
| **3. IAM Write** | `gcloud storage buckets get-iam-policy` | Tailscale SA has `roles/storage.objectCreator` | Run: `gcloud storage buckets add-iam-policy-binding gs://<bkt> --member="serviceAccount:<SA>" --role="roles/storage.objectCreator"` |
| **4. Lifecycle** | `lifecycle_config` inspection | Retention rules present (e.g. 90d/365d) | Configure lifecycle rule via Console or `gcloud storage buckets update gs://<bkt> --lifecycle-file=...` |
| **5. Synthetic Canary** | Write, Read, Delete `.tailscale-canary/verify-<epoch>.json` | Object written, verified with `"status": "HEALTHY"`, and deleted | Check project storage quota, bucket lock, or KMS key permissions if customer-managed encryption is enabled |

---

## 4. Emergency Node Revocation Workflow

When an admin device or server node is compromised or stolen:

### Tier 1: Immediate Control Plane Revocation (Sub-Second Severance)
1. Navigate to [Tailscale Machines Console](https://console.tailscale.com/admin/machines).
2. Select the compromised machine and open the action menu (`...`).
3. Click **Suspend Machine** (or **Delete Machine** for permanent decommission).
4. **Wire-Level Effect**:
   - The Tailscale control plane issues an immediate WireGuard peer key revocation map to all nodes in the mesh.
   - The compromised node's WireGuard peer association is wiped from kernel memory across all active nodes.
   - **Active SSH sessions terminate immediately** (TCP packets drop with no route to host).
   - Local OS sshd intervention or server reboot is **not required**.

### Tier 2: CLI Node Revocation (Host-Side Isolation)
If you have console access to the affected node:
```bash
# Immediately drop virtual adapter and clear credentials
sudo tailscale logout
# Or stop the daemon service
sudo systemctl stop tailscaled
```

### Tier 3: Post-Revocation Forensic Investigation (GCS Log Analysis)
1. Query the GCS audit logs for the compromised node's session activity:
   ```bash
   gcloud storage ls "gs://<bucket-name>/tailscale-audit-logs/"
   ```
2. Inspect SSH session timestamps, source IPs, and target OS principals (`sam` or `ubuntu`).
3. Cross-reference the 12-hour session ticket issuance times to determine the exact blast-radius window.
