# Recognition Profile v0.1

Web release 0.2.0 · Implementation draft · 2026-09-10

Profile ID: `numina-demo-rp-0.1`. This is local recognition policy for a public test service, not institutional or standards-body recognition.

| Dimension | Pinned requirement |
|---|---|
| Credential | EAC `0.1` |
| Environment | `test` only |
| Issuer | `numina-demo` |
| Key purpose | `eac-test-authorization` |
| Algorithm | Ed25519 only |
| Key ID | `numina-demo-eac-1` |
| Trust | Public key embedded in versioned source; never supplied by caller |
| Audience | `numina-demo-gateway` |
| Action and resource | `simulate.commit`, `demo:ledger` |
| Validity | Maximum 600 seconds, no clock skew allowance |
| Serialization | `numina-ascii-json-v0.1` |
| Replay boundary | Global demo event ID and nonce uniqueness |
| Commit effect | Insert one simulated event with its signed receipt |
| Receipt key purpose | `external-test-receipt`, separate from EAC key |
| Financial execution | Disabled by implementation; no adapter exists |

Issuer conformance: generate every required field, use unpredictable nonces for new events, sign canonical protected data, and never represent the downloadable demo key as a real issuer identity. Subject is a test label, not authenticated identity.

Verifier conformance: enforce the ordered EAC decision procedure, trust only embedded issuer keys, check key purpose, and fail closed on missing dependencies. This version has a revoked-key check in the verifier library; changing the deployed trust set requires a new release. It does not implement a live revocation registry or credential delegation.

Execution endpoint conformance: accept only the canonical signed EAC at the single registered simulation gateway; re-check validity and use database uniqueness for concurrent replay prevention. Verification alone is not a reservation. Do not attach financial adapters to this profile.

Authority Coverage is scoped to this simulated ledger. It enumerates the registered commit endpoint and checks recorded receipt presence/JSON validity. It does not discover external execution routes or attest that an administrator has not modified storage. External receipts allow a recipient to independently verify the server signature; they are not an external monitoring service.

## Frozen constitutional source register

The supplied Core v1.8 package contains the C1–C14 names in specs/AUTHORITY-PHYSICS-v0.2.md and the original twenty scenarios in tests/test_frozen.py. They are preserved verbatim in source. The source digest and names appear in core-v1.8-manifest.json. The web adapter does not implement or certify the whole constitution; its bounded credential and observation functions are listed separately.

Changes to trust, lifetime, audience, or semantics require a new versioned profile. An EAC naming another profile produces REVALIDATION_REQUIRED after signature and scope checks. No external standards recognition is claimed.
