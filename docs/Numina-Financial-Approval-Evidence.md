# Numina financial-service approval evidence pack

Prepared September 15, 2026. Package: `xyz.numinalabs.app`. Operator identified in the reviewed application: SK Consulting LLC. Support: skott34@numinalabs.xyz.

**Status: incomplete for approval.** This pack contains software evidence and draft operating-document worksheets. No regulator, provider or Google approval is represented by this document. The owner reports live financial services and has committed to provide provider, license and terms evidence; those claims remain unverified in this workstream.

## Evidence index

| Requirement | Available evidence | Remaining external or operational evidence |
| --- | --- | --- |
| Legal operator and provider roles | Operator identified in the app; private provider/entity/jurisdiction register implemented. | Legal entity verification and actual signed relationships for every declared lender, EWA provider, custodian, transfer operator and exchange. |
| Operating authority | Structured license/registration/exemption worksheet and issuer-source fields. | Original issued records, valid activity and territory coverage, and qualified exemption review where applicable. |
| Loan and EWA disclosures | Dedicated templates for terms, APR/fees, repayment example, payroll relationships and handling. | Approved actual product terms and calculations, provider evidence and matching customer experience. |
| Custody, transfers and exchange | Dedicated holder/custody, transfer and exchange worksheets. | Approved terms; real custody/key model; permitted assets/networks/corridors; signed provider agreements and tested integration. |
| Security controls | [Numina security model](Numina-Security.md); implemented authentication, own-record isolation, bounded inputs, replay protection and private document receipts. | Independent assessments, provider security evidence and any required remediation or certification. |
| Document identity and confidentiality | Hash-addressed private uploads; owner-only immutable registration and download; corruption and authorization tests. | Issuer authenticity and document validity. A checksum proves byte identity, not truth. |
| Data safety | Source-based data inventory below; published deletion-request route and privacy disclosures; Console draft saved. | Complete third-party processing, sharing, retention and deletion evidence, including actual financial-provider and AI flows. |
| Reviewer access | Dedicated reusable production login, own-record request persistence and live Stripe checkout observed; no agent payment submitted. | Free access to every reviewable workflow, including any paid or financial functionality; saved Play access declaration. |
| Adult audience and rating | 18+ notice deployed across maintained website/app footers; IARC marked Completed in Console. | Save the 18+ target-audience questionnaire after completing Sign in details. |
| Android identity | Existing AAB hash and original signing record below; source package identity preserved. | Actual Play upload and server validation, closed-test publication and physical-device installation. |

## Source-based data inventory

This inventory describes reviewed source paths. It is not a complete attestation of all downstream providers' practices.

| Data | Observed purpose and handling | Play category for review |
| --- | --- | --- |
| Account identifier and email | Sign-in and ownership checks; email associated with service requests. Sites supplies authenticated identity. | Personal info: User IDs, Email address. |
| Request title, brief, success criteria, business country, consent and activity notes | Stored in production account records; customer sees own records and the operator administers delivery. | App activity: Other user-generated content, App interactions; confirm any further specific types in actual contents. |
| Matched payment IDs, amounts, refunds and dispute facts | Stripe-signed events establish payment facts; Numina does not store full card numbers. | Financial info: Purchase history; evaluate provider-controlled payment collection separately. |
| Native treasury records and uploaded financial documents | Owner-private records and supporting documents; no independent reserve confirmation inferred. | Financial info: Other financial info; Files and docs. |
| Financial evidence files and provider metadata | Owner upload/registration; private object storage; immutable correction history; explicit export. | Files and docs; evaluate personal information contained in submitted documents. |
| IP-derived and account-derived limiter buckets | Hashed identifiers and short-lived counters for abuse prevention. | Device or other IDs / User IDs as applicable; confirm IP-derived location use by providers. |
| Request count, duration, status and random request identifier | Application health and diagnostics; new telemetry excludes raw paths, queries, account IDs, bodies and treasury values. | App info and performance: Diagnostics. |
| Google Fonts, Sites sign-in/hosting, Cloudflare storage and Stripe | These dependencies process technical or account information under their own applicable terms. | Verify collection/sharing exemptions and complete provider-specific mappings before final submission. |

Account/data deletion requests are available at https://numinalabs.xyz/privacy#delete-account. An operator-handled request process is implemented and described. A completed deletion, restore test, exact financial record retention period and provider deletion result have not been demonstrated in this workstream.

## Software verification

The financial evidence feature was exercised with local fixtures for actual file receipts, persistent registration, identical retry behavior, missing-file rejection, unsafe-field rejection, private access denial, origin checks, storage failure recovery, corrupted-record rejection and unchanged treasury state. Complete document coverage remains explicitly unverified and does not enable financial execution. A full application test run passed 322 tests; the final evidence-input/navigation adjustments passed 18 focused tests. The combined financial-evidence and unsigned mint-preparation update then passed all 346 tests. See the [machine-readable verification record](financial-software-verification.json). These tests use local fixtures, not financial operations. Final publication results are recorded in issue #25.

The local browser preview verified the owner form and seven service categories at desktop and phone sizes with no observed horizontal overflow. This is a browser preview, not an Android device install. File transport and registration were tested with clearly labeled local fixtures; no generated file was uploaded to production as an issuer document.

## Original Android candidate

- Filename: `numina-3.0.0-upload-signed.aab`
- Version: 3.0.0; version code: 2.
- Size: 3,617,114 bytes.
- SHA-256: `d25633e4aa9fa75f509cc145506462e49e083ddc3cb8f13872e00e5ea699d550`.
- Source commit: `7e0de0c9e789cb9ab6aa499e891235b56510eb84`.
- GitHub Actions build: `34785067667`; original [signed build record](android-signed-build-record-v3.json).
- Play bundle upload remains uncompleted after browser file-access restrictions. No Play signing/SDK/package validation result is inferred from local checks.

## Reviewer walkthrough currently established

1. Open https://numinalabs.xyz/reviewer using the dedicated credentials supplied privately to Play.
2. Sign in without a ChatGPT account or one-time password. Session cookies last eight hours; sign in again as needed.
3. Open Numina OS, create a clearly labeled service request, reopen it and inspect its own activity history.
4. The observed consulting checkout is live and can charge money. Do not purchase to obtain review access. The previously observed verification request is cancelled with no confirmed payments or refunds.
5. Other customers' records, owner credentials and private financial evidence remain restricted. Those restrictions alone do not require disclosure to Google; every actually reviewable product workflow still needs an accessible example or no-charge entitlement.

This walkthrough does not attest free review access to unverified live lending, EWA, custody, exchange, settlement or post-payment delivery functions. Play's full-access checkbox remains unsaved until the complete reviewable scope is established.

## Approval handoff

Use the [eight document worksheets](Numina-Financial-Document-Templates.md) to collect missing facts, register original supporting files in [Financial evidence](https://numinalabs.xyz/financial-services), and independently check the source/issuer, entity, service, territory, dates and restrictions. Export the private packet for the authorized reviewer. Then complete the actual Play declarations and upload/validation workflow. Record Google or issuer responses verbatim as observed; do not mark approval based on a generated document or software test.

Current workstream: [Google Play Academy Ignite — closed testing release, issue #25](https://github.com/skott34-dot/numina-production/issues/25).

Primary policy references: [Financial declaration](https://support.google.com/googleplay/android-developer/answer/13849271), [Financial Services](https://support.google.com/googleplay/android-developer/answer/9876821), [Crypto wallets and exchanges](https://support.google.com/googleplay/android-developer/answer/16329703), [Data safety](https://support.google.com/googleplay/android-developer/answer/10787469), [review access](https://support.google.com/googleplay/android-developer/answer/15748846).
