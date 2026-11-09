# KYC / AML working checklist: S K Consulting LLC dba Numina Labs

**Working checklist, not legal advice.** Prepared Nov 9 2026 from public sources fetched that
day (listed below). It has not been reviewed by counsel. Attorney review packet:
`docs/COMPLIANCE-ATTORNEY-REVIEW.md`. A separate local-only code module (`local/compliance/`,
`npm run compliance:gate`) is being built and will be merged later.

## 1. Current business: consulting paid by card through Stripe
| Control | Applies? | What to do |
|---|---|---|
| Merchant KYC by Stripe | Yes | Stripe collects and verifies information about the business, its representative and owners before enabling charges and payouts, and may pause them if information is not provided or verified [Stripe-IDV]. Keep the Stripe account details current. Stripe's verification does not replace any obligation of ours [Stripe-IDV]. |
| Customer due diligence for engagements | Yes (good practice; contract and fraud risk) | Before an engagement payment: confirm the client's legal name, address, country, beneficial owner for companies, authorized signer and the purpose of the work. Keep the records. |
| OFAC sanctions screening of clients and counterparties | Yes | All U.S. persons, including U.S.-incorporated entities, must comply with OFAC sanctions [OFAC-FAQ 11]. U.S. persons are generally prohibited from dealing with persons on the SDN List [OFAC-SDN]. OFAC issues no "safe list" or non-inclusion certificates [OFAC-FAQ 469]; screen each client, owner and counterparty against the current list (Sanctions List Search) and comprehensively sanctioned jurisdictions [OFAC-FAQ 10], and record the date, list version and result. Blocked property must be reported to OFAC within 10 business days [OFAC-FAQ 9]. |
| Recordkeeping | Yes | Keep engagement, screening and payment records in a durable, access-controlled location. Retention period: ask counsel (no period is asserted here for a non-MSB consulting business). |

## 2. Anything involving treasury, tokens, NUSD, custody or moving money for others
Out of scope for the public site and **blocked until counsel reviews**. FinCEN treats a money
transmitter as a money services business with **no activity threshold**, and most MSBs must
register with FinCEN (Form 107 within 180 days, renewed every two years, records kept five
years); civil and criminal penalties apply [FinCEN-MSB]. Issuing, selling or redeeming stored
value is also an MSB activity [FinCEN-MSB]. Any treasury, token or NUSD issuance, redemption,
custody, transfer or conversion for others would raise FinCEN MSB and state money-transmitter
licensing questions that require counsel **before** launch.

## 3. Release checklist gate (see SITE-PLAN.md "KYC/AML gate")
- No financial or treasury claims, payment flows or token offers on public pages
  (`tests/site-navigation.test.mjs` blocks treasury/NUSD wording and KYC, custody, deposit,
  yield, investment and token-sale offer wording).
- Counterparty and sanctions screening recorded before any engagement payment.
- Counsel review signed off before any financial service is offered.

## Sources (fetched Nov 9 2026)
- [FinCEN-MSB] FinCEN, "Money Services Business (MSB) Registration" and MSB definition: https://www.fincen.gov/money-services-business-definition
- [OFAC-SDN] OFAC, Specially Designated Nationals List (last updated 11/6/2026 on the page): https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists
- [OFAC-FAQ] OFAC, Basic Information on OFAC and Sanctions (FAQs 9, 10, 11, 469): https://ofac.treasury.gov/faqs/topic/1501
- [Stripe-IDV] Stripe Docs, "Identity verification for connected accounts": https://docs.stripe.com/connect/identity-verification (describes Stripe's KYC model; Numina Labs is a direct Stripe account holder, not a Connect platform, so read it as background on Stripe's KYC practice)
