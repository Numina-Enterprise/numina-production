---
description: Cryptographic invariants and verification contract for Numina manifests
globs: ["*manifest*.json", "*provenance*", "src/provenance*"]
---

# Numina Cryptographic Provenance Invariants

When inspecting, generating, or verifying Numina provenance manifests:

1. **State Root Derivation**:
   - The cluster state root (`clusterStateRootSha256` and `manifestSha256`) MUST equal the SHA-256 digest of the canonical JSON body stripped of `multiSignature`, `manifestSha256`, and `clusterStateRootSha256`.
   - Always apply RFC 8785 canonical JSON formatting (sorted keys, no extraneous whitespace, UTF-8 encoding without BOM).
   - Expected State Root: `726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd`.

2. **Deterministic Signing Transcript**:
   - Signatures MUST NOT be computed over raw hashes or unformatted JSON alone.
   - Dual signers must sign the binary transcript:
     `NUMINA-PROVENANCE-MANIFEST-V1\n<clusterStateRootSha256>\n<canonicalPayloadString>`

3. **Pinned Key Fingerprints**:
   - Always verify the DER SubjectPublicKeyInfo SHA-256 fingerprint against the out-of-band trust store:
     - Authority (`skott34-ed25519`): `46b301f039fcf3fdfa7eeda9cacd9a8614c3c9e9e4e88a47f53c12fc859be8ce`
     - Guardian (`numina-guardian-ed25519`): `465d10c9e7e1ff1ba2e740773c8de67b349ec6b8ffbb9fe2e584d902c6c19b6c`
   - Algorithm MUST be Pure Ed25519 (RFC 8032).

4. **Fail-Closed Execution**:
   - If any gate evidence report is missing, any document SHA-256 or byte count drifts, or any signature fails verification across Python/OpenSSL engines, the task must fail closed immediately.
