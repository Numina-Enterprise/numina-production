# Numina Zero-Trust Master Operational Contract (PROOF-NUMINA-SEC-V1)

Authority: Samuel J. Kott (skott34-ed25519) | Operator: SK Consulting LLC
Canonical Origin: https://www.numinalabs.xyz
Singularity Motto: "Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned."

## 1. Cryptographic Invariants & Pinned Anchors
- Cluster State Root: `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`
- Authority Keypin: `46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce` (skott34-ed25519)
- Guardian Keypin: `465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c` (numina-guardian-ed25519)
- Canonical Serialization: RFC 8785 (keys sorted alphabetically, zero structural whitespace, UTF-8, zero BOM `EF BB BF`, zero mojibake `C3 A2 E2 82 AC`).
- Fail-Closed: 1-byte drift, missing gate report, or signature failure fails the task immediately.

## 2. Mesh Router & 3-Pillar Message Gate
- Every routed channel message must satisfy:
  1. Pillar 1: Valid E2EE Envelope (x25519 ECDH + AES-256-GCM).
  2. Pillar 2: State Root Match (`expectedClusterStateRoot` == `currentClusterStateRoot`).
  3. Pillar 3: Multi-Sig Activation Grant (dual signatures from skott34 and numina-guardian).
- Runtime: Pure Node 26 built-in modules only (`node:crypto`, `node:test`, `node:assert/strict`, `node:fs`). Zero third-party npm runtime dependencies.
- Treaties: Active EU GDPR SCC 2021/914 & Brazil LGPD Res. 19; reject repealed Commission Decision 2010/87/EU with `ERR_REPEALED_SCC_2010_87_EU`.
- Asana Sprint Boundary: Strictly verified GID `1219183110870936`; forbidden GID `1219187222788173`.

## 3. Host Hardening & Zero-Trust Boundary (UFW Default Deny)
- Public ingress (including raw port 22) must remain strictly closed.
- Linux hosts enforce: `sudo ufw default deny incoming` + `sudo ufw allow in on tailscale0`.
- Tailscale daemon brought up with `--ssh`, `--shields-up`, `--accept-routes=false`.
- Administrative SSH access governed by `tailscale-hardened-policy.hujson` with 12-hour 2FA check period.

## 4. Verification & Signing Tools
- Automated Proof Command: `python verify_manifest.py provenance-manifest.json --repo-root . --trusted-keys trusted.json --openssl` (Must pass 19/19 with exit code 0).
- Re-signing: Use `sign_root.py provenance-manifest.json <key.pem>` over the 32-byte canonical root.
