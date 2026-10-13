# Numina: Project Aurum Phase 2-inspired privacy/control verification
Date: 2026-10-13
Status: DRAFT, OFFLINE CONTRACT TESTS ONLY. NOT a BIS conformity report, regulatory approval, production release, or external settlement verification.

## Authoritative research baseline
- BIS Innovation Hub, "Project Aurum Phase 2: exploring privacy-enhancing technologies for digital cash" (published 2026-10-13):
  https://www.bis.org/publications/project-aurum-phase-2-exploring-privacy-enhancing-technologies-digital-cash
- BIS Project Aurum 2.0:
  https://www.bis.org/project/aurum-2

The BIS characterizes Aurum Phase 2 as an exploratory proof of concept in the retail-digital-cash context. Its privacy mechanisms include encryption, BBS+ signatures, pseudonym-based ownership and zero-knowledge proofs. These results are an architectural inspiration, not an applicable technical certification or obligation for Numina's Ethereum or institutional execution products.

## Actual Numina source boundary inspected
- src/control.js: the only supported production control adapter on this path is internal.record.v1; unsupported routes produce ESCALATE, with no verified next action.
- src/control-store.js: grant-filtered delegate projections and an integrity-checked, hash-linked event journal; privileged owner can reconstruct complete state.
- docs/Control-Plane-v1.md: no external payment, custody, trading or settlement adapter is connected to this control path.
- tests/control.test.mjs: existing coverage of authorization, atomic commits, stale revisions, delegation and evidence integrity.
- runtime/verifier-rc27/numina_prod/control_gateway.py: a separate deterministic decision-only Python control surface; its apparent execution gate does not prove an external adapter is active.

Source inspection is not source-to-build-to-deployment binding. No production service or external provider was queried during this work.

## Executable tests added
Run from the repository root on the repository's Node 26 toolchain:

    node --test tests/aurum-privacy-controls.test.mjs

Tests must operate on temporary, in-memory SQLite data and synthetic identities only.

| Case | Expected outcome | Scope |
| --- | --- | --- |
| AURUM-C01 | Unrelated synthetic private subject absent from scoped reviewer projection, retained for privileged owner reconstruction | Existing access-boundary regression |
| AURUM-C02 | Unknown actor denied; revoking the delegated grant removes access | Existing authority regression |
| AURUM-C03 | Unsupported Ethereum transfer adapter escalates and cannot create an internal execution record | Existing execution boundary |
| AURUM-C04 | Corruption of journal event bytes is detected on read | Existing hash-integrity check |

Passing C01 does NOT mean the private data are never stored: the current journal intentionally retains original command bodies. Passing C04 does NOT mean receipts are digitally signed or resilient to coordinated changes by a privileged database administrator.

## Control gap register (not yet implemented or verified)
| ID | Proposed requirement | Closure evidence |
| --- | --- | --- |
| AURUM-P01 | Minimize and classify subject data before request/journal ingestion; avoid raw KYC/PII in generic record payloads | Schema-level whitelist and negative tests proving persistence never includes prohibited sensitive fields |
| AURUM-P02 | Bind a transaction's identity, wallet, issuer/asset eligibility, jurisdiction, limits, policy version and approval/deny/escalate reason before an external provider handoff | Request-schema controls, denial corpus, durable policy version and fresh external authorization proof |
| AURUM-P03 | Purpose-limited, recipient-bound disclosure of only permitted attributes; explicit expiry, revocation, and independently enforceable reviewer scope | Tests for correct reviewer, wrong reviewer, wrong purpose, stale/revoked grants and replay |
| AURUM-P04 | PET implementation with separately reviewed cryptographic design (eg selective disclosure / ZKP) and cryptographic negative corpus | Independently reproducible proof verification, key/algorithm governance, constant-time/privacy review, correctness and performance receipts |
| AURUM-P05 | Cryptographically signed immutable authorization and settlement receipts, complete signer provenance and externally verifiable key references | Independent signature verification across canonical bytes, bad-signature, tampering and replay tests |
| AURUM-P06 | Real issuer/reserve/redemption and AML/sanctions attestations from authoritative sources without disclosing private customer data unnecessarily | Provider-bound receipt and provenance with permitted access control, retention, audit and regulatory export evaluation |
| AURUM-P07 | Legal settlement-finality and reconciliation evidence distinct from merely submitted, mined, confirmed or internally recorded | Named counterparties and ledger/legal finality proofs plus contradictory/timeout/reorg corpus |
| AURUM-P08 | Bind independently tested source hash, build digest, deployment identity and runtime policy before enablement | External source/build/runtime receipts and independently repeatable live acceptance report |

No production wallet, private key, customer identity, digital money, financial account, money movement, sanctions API, or central-bank infrastructure is used. No new permission is granted.

## Review and acceptance
- Keep this as a draft PR. Do not merge/deploy from this test exercise without review of CI, Node version, actual source/build binding and privacy implications.
- Keep treasury/financial execution gates unchanged and closed unless independently authorized and proven.
- Record the exact test invocation, Node version, commit SHA, CI provider, job conclusion and time. Absence of a test receipt means NOT VERIFIED, not PASS.
- Scope is existing control boundary verification. A compliant PET implementation requires separate architecture and cryptographic review.
