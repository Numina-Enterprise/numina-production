---
name: tailscale-zero-trust
description: Operational runbook for Tailscale zero-trust ACLs, SSH check-mode enforcement, and host hardening.
---

# Tailscale Zero-Trust Hardening Runbook

Use this skill when auditing or configuring Tailscale security, ACLs, and SSH access.

## 1. ACL Syntax Invariants
- In `tests`, `deny` and `accept` rules MUST include an explicit port (e.g. `tag:server:8080`, `tag:server:3000`). Never use bare `*`.
- Declare `tagOwners` before referencing tags in `acls` or `ssh` blocks:
  ```hujson
  "tagOwners": {
    "tag:server": ["autogroup:admin"],
    "tag:admin": ["autogroup:admin"]
  }
  ```

## 2. Tailscale SSH Check Mode
- Enforce periodic 2FA re-authentication:
  ```hujson
  "ssh": [
    {
      "action": "check",
      "src": ["autogroup:admin"],
      "dst": ["tag:server"],
      "users": ["root", "ubuntu", "sam"],
      "checkPeriod": "12h"
    }
  ]
  ```

## 3. Host Isolation Checklist
- Always enable `--shields-up=true` to drop unsolicited inbound mesh probes.
- Always set `--accept-routes=false` to reject rogue route advertisements.
- Audit ports 1–65,535 locally using socket sweeps to verify zero public application listeners.
- Quarantine external tunnel configurations (e.g. `.cloudflared`) under read-only NTFS DACLs.

---

## 4. Universal Enforcement Across All Agent Operations

1. **Mandatory Perimeter**:
   - All inter-agent traffic, API calls, and developer tool chains across this workspace must communicate over the encrypted WireGuard mesh.
   - Public port 22 and external unauthenticated listeners are strictly prohibited across all nodes.
2. **Identity-Bound Execution**:
   - Administrative remote executions must pass Tailscale SSH Check Mode (`12h` expiration).
   - Server nodes must remain tagged `tag:server` to decouple infrastructure access from individual user account lifecycles.
3. **Cross-Rule Integration**:
   - Complements `numina-zero-trust-contract.md` and `mesh-router-architecture.md` by providing the underlying authenticated, zero-trust network fabric for all 16 enterprise agent divisions.
