# Numina evidence integration gates — 2026-10-11

Status: **development implementation with local tests**; NOT deployed, audited,
provider-connected, or adopted as a legally applicable regulatory obligation.

## Source-of-truth boundaries

- NCUA **91 FR 64699**, dated 2026-10-09:
  https://www.federalregister.gov/documents/2026/10/09/2026-20729/proposed-agency-information-collection-activities-comment-request
  OMB 3133-0004; **proposed** Schedule J: 8 reserve custody, 9 key custody,
  5 permitted-issuer exposure, 4 balance-sheet stablecoins. Comment deadline
  2026-12-08. Proposed reporting date 2027-03-31. Federal credit unions/
  federally insured credit unions are the listed respondents; this does NOT
  establish Numina reporting duties. No official 26-account codes or exact
  definitions appear in the notice. Placeholder IDs are NOT account codes.
- NCUA proposed Form 5300 source search:
  https://ncua.gov/regulation-supervision/regulatory-reporting/cuonline
  Account-level promotion remains blocked until an authoritative revised
  definition and source digest are independently retrieved and reviewed.
- Signed authorization verdict (individual, descriptive Internet-Draft):
  https://datatracker.ietf.org/doc/html/draft-dias-agent-payment-verdicts-00
  Sections 6, 7, 10.1–10.7 and Appendix B. Not an approved IETF standard.
  This work defines a STRICTER internal profile, not interoperable conformance.
- Consent-bound subject settlement (individual Internet-Draft):
  https://datatracker.ietf.org/doc/html/draft-morrison-consent-settlement-06
  Sections 6.2 and 7. Deferred settlement requires an irrevocable committed
  subject share. An aging trigger, hold, or missing destination cannot cancel
  or reduce that share; subject_share_settled must be linked to a receipt.
- SATP core (IETF work in progress, draft revision 17):
  https://datatracker.ietf.org/doc/draft-ietf-satp-core/
  Transport Area review "Not ready", dated 2026-10-04:
  https://datatracker.ietf.org/doc/review-ietf-satp-core-17-tsvart-lc-rose-2026-10-04/
  Reference baseline only. No claim of IESG approval, RFC, production
  interoperability, or federal adoption.

## Code artifacts and gates

- src/schedule-j-evidence.js: 26 internally numbered placeholders and separate
  documentedDesign, implementedControls, independentVerification and
  legalApplicability records; requires external independent source matching
  before an official code can enter review; internal treasury assertion types
  cannot automatically establish independent settlement.
- src/payment-authorization-gates.js: exact-byte ES256/JWS verification,
  reject unknown top-level claims, explicit issuer/operator/payer/audience/
  recipient/asset/amount/settlement-endpoint binding, immutable policy SHA-256,
  signed historic issuer keyset anchored in pinned authority key, signer PoP,
  nonce replay and cumulative spending-limit **atomic durable adapter required**.
  Even ALLOW returns authorization-to-attempt, not payment/compliance/finality.
  The adapter interface is tested against a mock; persistent production
  storage and independently reviewed integration are NOT established.
- src/settlement-evidence-gates.js: irrevocable COMMITTED_UNSETTLED,
  SETTLED_UNRECONCILED and SETTLED_RECONCILED stages; signed-authority
  verification callback required for destination updates; holds and aging
  never extinguish obligations; no automatic resubmit after unknown outcomes;
  external finality and reconciliation require different verifier callbacks;
  the hash chain is NOT itself an independent trusted audit anchor.
- tests/*-evidence-gates.test.mjs, tests/schedule-j-evidence.test.mjs and
  tests/payment-authorization-gates.test.mjs: isolated fixture tests; no
  financial services or network transactions.

## SATP reviewer failure-scenario gap matrix

| Failure scenario | Development control | Production acceptance gate |
| --- | --- | --- |
| Message identity / duplicate POST | idempotencyKey + exact requestHash; same-key conflict rejected | Persist idempotency keys before outbound I/O; concurrency test under multiple workers |
| Replay / agent delegation | issuer-bound nonce, PoP, expiry, audience, endpoint; unknown claims reject | Atomic shared nonce+limit store, restart and concurrent replay tests |
| Retry semantics / ambiguous response | unknown outcome blocks novel attempt | Provider receipt lookup, safe retry protocol and recovery after lost responses |
| Finality ambiguity | FINALITY_VERIFIED needs a separate independently retrieved callback | Pin chain/network/contract, finality policy, independently verified RPC/provider receipts |
| Partitions and timeouts | unresolved attempts cannot become settled by timeout | Crash recovery, delayed message, reorg, partition and reconciliation testing |
| Cryptographic validation | exact-input ES256 and signed historical keys | Key rotation/revocation tests, issuer pinning, external security review |
| Operator roles / payer authority | explicit operator/payer/mandate/destination binding | Approved role registry, KYC/CDD and organizational delegation proofs |
| Third-party reconstruction | event hash chain and externally anchored head comparison | Tamper-evident independently held journal heads, original messages and receipts |

## Evidence dimensions (must remain independent)

| Dimension | Present acceptance status | What would change it |
| --- | --- | --- |
| Documented design | Development specification supplied | Controlled review and approved source identity |
| Implemented controls | Local code and isolated tests only | Merge, reproducible Node 26 CI, deployment receipt, runtime exercise |
| Independently verified evidence | NOT VERIFIED | Independently acquired keys, provider confirmations, chain finality, trusted audit anchor |
| Applicable legal requirements | PROPOSED / NOT DETERMINED FOR NUMINA | Official final texts, effective dates, regulated entity and counsel assessment |

## Deployment blockers (do not silently waive)

1. Acquire authoritative **account-level** NCUA proposal text and its exact
   26 codes; source-date/hash and applicability review before promotion.
2. Integrate transactional, durable nonce/cumulative-limit storage, and
   execute the concurrency/restart negative tests.
3. Implement independently verified beneficiary destination authority,
   provider/RPC finality, audit anchoring and reconciliation adapters.
4. Run full Node 26 hosted CI and a security review on this PR before
   any treasury-path integration. Do not add self-hosted runners.
5. Preserve one Numina treasury with three separately evidenced asset roles.
   No user-facing application should label internal software digests,
   self-asserted balances or proposed accounts as external confirmation.

No external submissions, payments, mints, deposits or signatures are performed
by this development work.
