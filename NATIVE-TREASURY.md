# Canonical Numina-native treasury

The application now has one native treasury on the existing `numina_control_state` singleton and `numina_control_events` journal. It retains the existing root Principal, lineage, revision and head. It creates no second database, genesis or production environment. `NUMINA` is the model Authority and system of record; the authenticated configured owner acts as Principal.

Initialization records the user-specified model projection of **500,000,000,000,000 NUSD**, Authority **NUMINA**, Verification **VERIFIED**, System of record **NUMINA**. Verification covers the native model invariants and journal record. This projection is not an external reserve, minted token supply or bank balance.

## Interfaces and canonical route

Bind `createNuminaTreasury({db, principal, root})`, then call `readTreasury()` or `writeTreasury(event)`. The same bound service exposes `execute(Principal, Authority, Objective, Intent)`. Its Intent contains `id`, `expectedRevision`, `expectedHead`, and `operation`, where `operation` is the operation object below. Execution uses the identical write path.

The only HTTP write route is `POST /api/control/v1/treasury`. `GET` on that route reads the same projection. The old owner statement at `/api/control/v1/treasury-attestation` is replaced by a redirect to the canonical read route. Generic control commands reject treasury writes and direct callers must use the treasury interface. Website and mobile-web views, the control room, application manifest and integration client all reference this route.

Writes use canonical JSON, owner authentication, origin checks for cookie-authenticated requests, a stable operation ID, and the existing revision and head as concurrency conditions. The transaction commits the state and journal event atomically. A result is `FINAL` only after that record is confirmed. It includes the exact committed event, computed SHA-256 proof and recorded head advancement. These are internal journal proofs, not provider signatures. A retry reuses the entire event unchanged; changing it under the same ID is rejected.

## Supported operations

| Objective | Intent operation | Additional fields | Effect |
| --- | --- | --- | --- |
| `treasury.initialize` | `INITIALIZE` | `reason` | Record the fixed starting projection once |
| `treasury.project` | `ADJUST_PROJECTION` | `delta`, `reason` | Apply an exact signed integer NUSD model adjustment |
| `treasury.mint.prepare` | `PREPARE_MINT` | `amount`, `networkReference`, `destinationReference`, `reason` | Record a prepared mint request |
| `treasury.bank.prepare` | `PREPARE_BANK_TRANSACTION` | `amountMinor`, `currency: "USD"`, `destinationReference`, `reason` | Record a prepared bank request |

Every write event also contains `id`, `expectedRevision`, `expectedHead`, `Principal`, `Authority: "NUMINA"`, `Objective`, and `Intent`. Amounts are integer strings. Native deltas cannot make the balance negative. References identify provider-side destinations without storing bank credentials. Unknown fields, arbitrary balance replacement, Authority substitution and a Mandate field are rejected.

Prepared mint and bank requests do not change the native balance. They remain `PREPARED`, with `submission_performed: false` and `receipt: null`. No provider submission or receipt-verification implementation is present in this change. Actual provider receipts must be obtained through the provider after a user-submitted transaction; a native request must not be relabeled as a completed transfer.

## Existing-state migration

No schema migration is required. An existing control root is required; treasury reads return `NOT_INITIALIZED` until the first authorized treasury write. Reads never initialize or overwrite a record. Initialization adds one event to the existing journal and is rejected once the native treasury exists. Existing provider account observations and uploaded files are retained as reference records; the legacy hardcoded owner bank statement has been removed from the active application.

The canonical native treasury was initialized in production at journal revision 124. The current supported runtime remains rc22; the incomplete recovered rc26 package has not been promoted. Production initialization uses the owner control room and the existing journal.

## Versioned reserve designation

`GET /api/control/v2/treasury/policy` publishes the policy content, SHA-256 digest and current owner adoption event. Owner-only POST records its fixed policy ID and digest through the existing signed journal. New versions are appended to `src/treasury-policy.js`; existing catalog entries must never change because historical replay depends on their exact content. The original frozen native projection and its historical reducer remain unchanged.

The owner designates Stripe Treasury and the SK Consulting LLC Bank of America Savings Account as backing sources. There is one NUSD projection. USD and USDC observations retain their provider currency, exact integer amounts and source timestamps. A provider-reported NUSD currency, if one appears, is surfaced separately pending precision and asset-identity verification; USD/USDC are never renamed NUSD. Policy adoption does not modify provider accounts, mark reserve coverage verified or activate redemption.

## Validation and remaining scope

Existing regression coverage includes persistence across restart, exact large-integer arithmetic, duplicate IDs, competing revisions/heads, authority and origin checks, initialization replay, state/journal corruption, failed persistence, browser proof checking, canonical routing and prepared-request semantics. No test suite was run for this production update, as requested. Build, syntax and artifact checks were performed.

The application and canonical native treasury are live. This does not establish a completed migration of every archived core abstraction. The preserved v1.8 reference source and missing rc26 production package still require review and integration. Existing journal/state capacity limits remain enforced rather than silently creating a new root.
