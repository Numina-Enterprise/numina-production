# Numina financial services: evidence and operating controls

Date: September 15, 2026. Operator: SK Consulting LLC, Iowa, USA. Application: Numina, package `xyz.numinalabs.app`.

## What this software provides

The [financial evidence workspace](https://numinalabs.xyz/financial-services) provides private supporting-document upload, provider and jurisdiction registration, document coverage and expiry checks, and downloadable review packets. These functions use Numina's existing owner authority and private storage. They are evidence-management functions, not an authorization to conduct regulated activity.

The owner reports that financial services are live and will supply provider, license and terms evidence. At this review date, those materials have not been supplied to this workstream. The reviewed hosted customer application provides service-request intake, own-record access, consulting checkout, and request history. Its NUSD-priced requests are scope requests; payment and result unlocking are not activated. Native smart-contract source, contract deployment, issuer permissions, mint transactions and customer availability must each be evidenced separately. A native treasury record or source implementation does not alone establish any of them.

## Working with the register

1. Open Financial evidence, sign in with the existing Numina owner account and select **Load private records**.
2. Select one of the seven financial service categories and the document purpose.
3. Enter the operating legal entity, provider or issuer, actual relationship, jurisdiction codes and document reference. Record an expiry date when the document states one. An omitted date means unknown or not stated; it does not prove perpetual validity.
4. Upload the original PDF, PNG or JPEG, up to 10 MB. Avoid credentials, customer files and unrelated personal information.
5. Register the document. The server binds its actual uploaded-file SHA-256 to immutable metadata. An identical retry returns the original receipt; corrections create a new record. The first copy is retained.
6. Load all pages before interpreting document coverage. The coverage display groups loaded records by service and purpose and flags declared expired documents. It does not check whether a document covers every named state, entity, service or activity.
7. Download the private review packet. It includes provider metadata and document references, not the private document bytes. This action downloads to the owner; it does not send anything to Google or a regulator. Supply only appropriate evidence to each authorized recipient.

Every saved record is **owner submitted, unverified**. All documents present means **present for review**, never licensed, reserve-backed, regulator-approved, or ready for Play. Generated templates cannot replace issued licenses or signed provider agreements.

## Service-specific operating evidence

| Service | Evidence that must be reviewed before a release claim |
| --- | --- |
| Personal loan direct lender | Actual lender and operating entity; jurisdiction-specific authority or reviewed exemption; loan terms; all fees and APR; minimum/maximum repayment periods; worked repayment example; servicing, complaints and collections process. |
| Loan facilitator | Each actual lender; signed referral/facilitation relationship; user-facing identification of the lender and Numina's role; lender terms; compensation, fees and applicable authority. |
| Earned wage advances | Provider, employer/payroll relationship and earned-wage verification; advance eligibility; repayment and failed-deduction handling; mandatory and optional charges/tips; required disclosures and privacy practices. |
| Digital wallets | Custodian and legal holder; assets and supported networks; safeguarding and reconciliation; control of signing keys; deposits, withdrawals, error resolution, fees and applicable authority. |
| Money transfers | Sending/receiving providers and corridors; funding method; charges and exchange rate; execution time; limits, cancellation, refunds, complaints and transaction receipts. |
| Cryptocurrency wallet | Custodial or non-custodial design; key custody/recovery; networks and assets; fee and withdrawal terms; issuer/holder risks and jurisdiction-specific licensing or exemptions. |
| Cryptocurrency exchange | Actual exchange operator and counterparties; authority; custody; execution/quote/slippage rules; market and liquidity risks; fees, withdrawals, reconciliation and disputes. |

All seven categories also require a data-flow and retention record, tested security controls, and a repeatable reviewer walkthrough. Requirements above are an evidence checklist; applicable law and current Play requirements still need qualified review.

## Integration and release sequence

Registering documents does not install a provider connector. Provider integration requires the actual provider API, permitted account scope, scoped server secrets, webhook verification rules and a test environment. Implement and verify authentication, idempotency, amount/currency precision, signed events, balance reconciliation, timeouts and recovery before enabling a financial operation. A prepared operation must be distinguished from a submitted transaction and a confirmed settlement.

The existing native treasury is a single internal record. USD, USDC and NUSD must preserve their asset identities, networks, provider source and timestamps. Never overwrite a bank or payment-provider observation using an owner-declared native balance. An asserted 1:1 denomination is not independent reserve or redemption evidence. Use the existing [treasury status](https://numinalabs.xyz/api/nusd/v1/status) and authenticated treasury routes for their stated scopes.

For Google Play, reconcile each declared category with the exact hosted pages and Android candidate, prepare complete access to reviewable functionality without purchases, complete Data safety and target audience, upload the signed bundle and actual store assets, resolve Console validation, and perform a real closed-track Android installation. The evidence workspace cannot submit these attestations automatically. It always reports `readyForPlaySubmission: false` because its checks cover document registration only.

## Security and storage

- Owner identity: existing `controlActor` and canonical root check. A reviewer session is explicitly rejected for private financial evidence, even when owner headers were originally present. Customer and reviewer own-record access is unchanged.
- Writes: authenticated POST, exact same-origin check for browser sessions, existing rate limiting, bounded canonical JSON and a five-second body deadline. No GET creates a record.
- Files: reuse the existing private supporting-document store. PDF/PNG/JPEG signatures and filenames are checked, uploads are bounded, content is hash-addressed, and downloads are attachments with a sandbox policy. Format checks are not antivirus scanning or proof of issuer authenticity; review downloaded files in an appropriate controlled environment.
- Registry: immutable JSON evidence packets are stored in the existing private object bucket under a hash-derived owner prefix. An immutable packet contains the document hash and metadata; it does not create a second treasury or new financial ledger. There is no destructive delete endpoint.
- Confidentiality: private responses use no-store caching. Public discovery lists function names and documentation only; it does not list documents, provider details, license identifiers or counts. Form rendering uses text nodes. Source URLs are recorded as references, never fetched by the server.
- Recovery: an identical registration is idempotent. An upload can succeed even if registration fails; retry with the unchanged file and details. Refresh after an uncertain result. No automatic retry submits a changed record.
- Retention: immutable evidence is retained until the operator completes an authorized retention/deletion review. This feature does not assert a statutory retention period. Handle requests through the [published privacy process](https://numinalabs.xyz/privacy#delete-account), account for provider obligations and record any retention reason. No deletion or backup-recovery drill is claimed by these documents.
- Operational review: independently verify issuers and authority, perform provider and transaction failure testing, maintain incident contacts, review access periodically, record secret rotation and restore exercises, and keep the full [Numina security model](https://numinalabs.xyz/security) current. No independent certification is claimed.

## API functions

| Method and route | Behavior |
| --- | --- |
| GET `/api/financial/v1/manifest` | Public function and document requirements; no private evidence. |
| POST `/api/control/v1/treasury-documents` | Existing owner-only file upload; returns actual stored-byte receipt. |
| POST `/api/financial/v1/evidence` | Owner-only immutable evidence registration; requires an existing owner file receipt. |
| GET `/api/financial/v1/evidence?cursor=…` | Owner-only pages of up to 50 records and coverage of that page. |
| GET `/api/financial/v1/review-packet?cursor=…` | Owner-only review packet page with unresolved checks. |

The browser exporter collects all pages up to 1,000 records; it stops with an explicit error instead of silently truncating a larger export. The module has no signing, minting, settlement, loan-approval, credit-scoring or regulatory-approval endpoint.

## Primary references

- [Google Play financial declaration](https://support.google.com/googleplay/android-developer/answer/13849271)
- [Google Play Financial Services policy](https://support.google.com/googleplay/android-developer/answer/9876821)
- [Cryptocurrency exchanges and software wallets policy guidance](https://support.google.com/googleplay/android-developer/answer/16329703)
- [Review access requirements](https://support.google.com/googleplay/android-developer/answer/15748846)
- [Data safety requirements](https://support.google.com/googleplay/android-developer/answer/10787469)

References reviewed September 15, 2026. These links are authoritative for their own policies; this implementation is not a legal opinion or an approval by Google.
