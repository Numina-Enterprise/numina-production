---
description: Strict Zero-Trust Cryptographic Operational Contract and Invariants for Numina
always_on: true
---

# Numina Zero-Trust Cryptographic Operational Contract (PROOF-NUMINA-SEC-V1)

All agent tasks within this workspace must enforce the following non-negotiable operational invariants:

## 1. Fail-Closed Invariants
- If any signature fails, any bound document drifts by even 1 byte, or any gate report is missing, fail immediately.
- Self-asserted strings are never evidence; validation requires cryptographic verification.
- Zero BOM (`EF BB BF`), zero Windows-1252 mojibake sequence (`C3 A2 E2 82 AC`), and strict fatal UTF-8 decoding.

## 2. Pinned Cryptographic Anchors
- **Authority:** `skott34-ed25519` (SPKI SHA-256: `46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce`)
- **Guardian:** `numina-guardian-ed25519` (SPKI SHA-256: `465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c`)
- **Cluster State Root:** `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`
- **Canonical Origin:** `https://www.numinalabs.xyz`
- **Verified Asana Sprint GID:** `1219183110870936` (Forbidden: `1219187222788173`)

## 3. Serialization & Signing Standards
- Deterministic RFC 8785 canonical serialization (lexicographically sorted keys, zero structural whitespace, UTF-8).
- Reject prototype pollution keys (`__proto__`, `constructor`, `prototype`).
- Payload re-signing strictly employs `sign_root.py` over the derived 32-byte canonical root.

## 4. Key Security & Zero-Trust Boundary (UFW Default Deny)
- Private keys (`*.pem`, `*.key`) must never be leaked to stdout, transcripts, logs, or unencrypted storage.
- Inter-node communications flow exclusively over encrypted Tailscale WireGuard meshes; public ingress (including port 22) must remain closed.
- Linux hosts enforce: `sudo ufw default deny incoming` and `sudo ufw allow in on tailscale0` (`harden-linux-tailscale.sh`).
- Tailscale admin SSH access requires 12-hour 2FA check periods governed by `tailscale-hardened-policy.hujson`.
