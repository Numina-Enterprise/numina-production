# Workspace Guidelines: Tailscale Zero-Trust & GCS Policy

## 1. Operational Scope & Tool Safety Boundaries
- **Workspace Encapsulation**: All files, scripts, skills, and configuration edits must remain strictly within `tailscale-ssh-policy`.
- **System Protection Invariant**: Never attempt file reads, writes, or directory scans on `~/.gemini/config/` or system boundary paths.
- **Path Verification**: Before calling file modification or execution tools, verify paths resolve within this workspace root.

## 2. Architectural Mandates
- **Keyless SSH**: Terminate sessions directly over the WireGuard mesh using IdP tokens. Static SSH key pairs (`id_rsa`, `id_ed25519`, `authorized_keys`) are prohibited.
- **Step-Up Authentication**: Enforce `"action": "check"` with `"checkPeriod": "12h"` for all server SSH connections.
- **Strict Principal Containment**: OS shell principals are strictly limited to enumerated identities: `["sam", "ubuntu"]`. System accounts (`postgres`, `www-data`, `daemon`) are blocked at the protocol layer.
- **Zero Public WAN Exposure**: WAN interfaces (`eth0`, `enp*`) must deny TCP port 22. Ingress is restricted exclusively to `tailscale0`.

## 3. Verified Policy Assertions & Pre-Commit Gate
- Any change to `acl_policy.hujson` must pass automated assertions in the `"tests"` block prior to deployment:
  - **Positive Authorization**: `"src": "skott34@gmail.com"` -> `"accept": ["tag:server:22"]`
  - **Negative Denial**: `"src": "autogroup:member"` -> `"deny": ["tag:server:22"]`
- No rule may be committed if test assertions fail or if unauthenticated members gain SSH access.

## 4. Diagnostics & Emergency Incident Response Standards
- **GCS Verification**: Run `.\gcs-verify.ps1` on Windows or `./gcs-verify.sh` on Linux. All 5 evaluation criteria (CLI Auth, Bucket Uniform Access, IAM `roles/storage.objectCreator`, Lifecycle Policy, Canary Write/Read/Cleanup) must pass before approving log streaming configurations.
- **Emergency Revocation Protocol**: In the event of device compromise, execute Tier 1 Control Plane Suspension via the Tailscale Console. WireGuard peer disconnection takes precedence over host OS PAM/sshd actions.
