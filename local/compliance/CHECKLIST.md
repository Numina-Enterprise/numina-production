# Numina Labs KYC / AML / sanctions checklist

<!-- Generated from checklist.json by `npm run compliance -- checklist --out local/compliance/CHECKLIST.md`. Do not edit by hand. -->

> Numina Labs is a consulting practice, not a bank or MSB. FFIEC BSA/AML Examination Manual sections are cited as the reference standard for good practice, not because the bank rules apply directly. Screening aid; not legal advice.

Status key: **automated** = enforced or computed by this module and exercised by `npm run compliance:gate`; **manual** = a human (Sam Kott) must do and record it.

## CIP

- [ ] **CIP-1** (automated) Collect name, date of birth (individuals), street address (no PO boxes) and an identification number before accepting a counterparty. Numina stores only the last 4 digits of a TIN/EIN.
  - Source: Customer Identification Program (2021), https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/01; fetched 2026-11-09
  - Implemented by: `kyc-schema.validateCounterparty`
- [ ] **CIP-2** (manual) Verify identity using documents or non-documentary methods. Requires a licensed IDV provider; the module ships a stub that never reports 'verified'.
  - Source: Customer Identification Program (2021), https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/01; fetched 2026-11-09
  - Implemented by: `idv-provider.NotConfiguredIdvProvider`
- [ ] **CIP-3** (manual) Keep identifying information for five years after the relationship ends; keep a record of verification methods and how discrepancies were resolved.
  - Source: Customer Identification Program (2021), https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/01; fetched 2026-11-09
  - Implemented by: `README#retention`

## CDD

- [ ] **CDD-1** (automated) Understand the nature and purpose of the relationship and keep a customer risk profile (products/services, customer type, geography).
  - Source: Customer Due Diligence (2018), https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/02; fetched 2026-11-09
  - Implemented by: `risk.riskScore`
- [ ] **CDD-2** (automated) Ongoing monitoring: re-screen on list changes and when activity is inconsistent with the profile; re-screening an approved case voids its sign-off until re-approved.
  - Source: Customer Due Diligence (2018), https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/02; fetched 2026-11-09
  - Implemented by: `workflow.runScreening + store.transition`
- [ ] **BO-1** (automated) For legal entities, identify each individual owning 25% or more and one control person; screen every one of them.
  - Source: Beneficial Ownership Requirements for Legal Entity Customers (2018); Appendix 1 - Beneficial Ownership (2018), https://bsaaml.ffiec.gov/manual; fetched 2026-11-09
  - Implemented by: `kyc-schema.partiesOf + workflow.approvalBlockers`

## OFAC

- [ ] **OFAC-1** (automated) Screen new counterparties and their beneficial owners against current OFAC SDN and consolidated lists before accepting them or any payment.
  - Source: Office of Foreign Assets Control (2014), https://bsaaml.ffiec.gov/manual/OfficeOfForeignAssetsControl/01; fetched 2026-11-09
  - Implemented by: `screen.screen / watchman.screenWithWatchman`
- [ ] **OFAC-2** (automated) Define name-matching criteria (fuzzy derivations) and how a hit is judged a valid match or a false hit; document every disposition.
  - Source: Office of Foreign Assets Control (2014), https://bsaaml.ffiec.gov/manual/OfficeOfForeignAssetsControl/01; fetched 2026-11-09
  - Implemented by: `workflow.disposition`
- [ ] **OFAC-3** (manual) Human cross-check of each party in OFAC Sanctions List Search, recorded on the case (not automated).
  - Source: OFAC Sanctions List Search (manual cross-check), https://ofac.treasury.gov/sanctions-list-search-tool; fetched 2026-11-09
  - Implemented by: `workflow.manualCheck`
- [ ] **OFAC-4** (automated) Keep lists current; record list version and sha256 on every screen; never auto-accept.
  - Source: Office of Foreign Assets Control (2014), https://bsaaml.ffiec.gov/manual/OfficeOfForeignAssetsControl/01; fetched 2026-11-09
  - Implemented by: `lists.updateLists`
- [ ] **OFAC-5** (manual) A valid match: do not proceed; escalate to counsel / OFAC hotline; blocked or rejected transactions are reported to OFAC within 10 business days (by the financial institution holding the funds; counsel to advise Numina's role).
  - Source: Office of Foreign Assets Control (2014), https://bsaaml.ffiec.gov/manual/OfficeOfForeignAssetsControl/01; fetched 2026-11-09
  - Implemented by: `workflow.approvalBlockers (potential_match cannot be approved)`

## SAR

- [ ] **SAR-1** (manual) Alert -> manage -> decide -> document. Numina is not a SAR filer; suspicious activity is documented on the payment case and escalated to counsel and, where relevant, to Stripe.
  - Source: Suspicious Activity Reporting (2014; FAQ notice 2025), https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/04; fetched 2026-11-09
  - Implemented by: `workflow.alertNote`
- [ ] **SAR-2** (manual) Do not tip off a counterparty that activity has been escalated or reported.
  - Source: Suspicious Activity Reporting (2014; FAQ notice 2025), https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/04; fetched 2026-11-09
  - Implemented by: `policy`

## Red flags

- [ ] **RF-1** (automated) Structuring: amounts just under $10,000 or reporting/recordkeeping thresholds, alone or in clusters.
  - Source: Appendix G - Structuring (2014), https://bsaaml.ffiec.gov/manual; fetched 2026-11-09
  - Implemented by: `aml.RULES.structuring + threshold_adjacent`
- [ ] **RF-2** (automated) Round-dollar amounts; activity inconsistent with the customer's business or history; sudden change after dormancy.
  - Source: Appendix F - Money Laundering and Terrorist Financing Red Flags (2014), https://bsaaml.ffiec.gov/manual/Appendices/07; fetched 2026-11-09
  - Implemented by: `aml.RULES.round_amount + velocity + dormant_then_active`
- [ ] **RF-3** (automated) Higher-risk jurisdictions; payments not drawn from the purchasing entity's account (payer mismatch); many payers funnelling to one payee; quick in-and-out.
  - Source: Appendix F - Money Laundering and Terrorist Financing Red Flags (2014), https://bsaaml.ffiec.gov/manual/Appendices/07; fetched 2026-11-09
  - Implemented by: `aml.RULES.jurisdiction + payer_mismatch + rapid_in_out + fan_in`
- [ ] **RF-4** (manual) Reluctance to provide ownership or business information; shell-company indicators.
  - Source: Appendix F - Money Laundering and Terrorist Financing Red Flags (2014), https://bsaaml.ffiec.gov/manual/Appendices/07; fetched 2026-11-09
  - Implemented by: `kyc-schema (bo_required) + reviewer judgement`

## Merchant

- [ ] **STRIPE-1** (automated) No dealings with persons in Cuba, Iran, North Korea, Syria or the Crimea, Donetsk or Luhansk regions, or with restricted-party-list persons.
  - Source: Prohibited and Restricted Businesses, https://stripe.com/legal/restricted-businesses (source last updated 2026-09-22); fetched 2026-11-09
  - Implemented by: `merchant-rules.counterpartyMerchantFindings`
- [ ] **STRIPE-2** (automated) No management consulting or IT consultancy services to any person located in Russia.
  - Source: Prohibited and Restricted Businesses, https://stripe.com/legal/restricted-businesses (source last updated 2026-09-22); fetched 2026-11-09
  - Implemented by: `merchant-rules.counterpartyMerchantFindings`
- [ ] **STRIPE-3** (automated) Public offering text contains no prohibited categories (ICOs, get-rich-quick, P2P money transmission...) and no restricted financial-services claims (treasury, crypto, lending, escrow, stored value) without Stripe approval.
  - Source: Prohibited and Restricted Businesses, https://stripe.com/legal/restricted-businesses (source last updated 2026-09-22); fetched 2026-11-09
  - Implemented by: `merchant-rules.scanText (npm run compliance -- merchant-scan --path <dir>)`
- [ ] **STRIPE-4** (automated) Re-check the Stripe list at least every 180 days (gate fails when the recorded source date is older).
  - Source: Prohibited and Restricted Businesses, https://stripe.com/legal/restricted-businesses (source last updated 2026-09-22); fetched 2026-11-09
  - Implemented by: `selfcheck (merchant rules)`

## Governance

- [ ] **LEGAL-1** (manual) Attorney review PENDING (follow-up due 2026-12-09): blocks launch of any financial service; does not block the site push.
  - Source: https://bsaaml.ffiec.gov/manual; fetched 2026-11-09
  - Implemented by: `config.attorney_review`

## Sources

- `ffiec_manual`: https://bsaaml.ffiec.gov/manual, fetched 2026-11-09
- `ffiec_cip`: Customer Identification Program (2021) — https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/01, fetched 2026-11-09
- `ffiec_cdd`: Customer Due Diligence (2018) — https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/02, fetched 2026-11-09
- `ffiec_bo`: Beneficial Ownership Requirements for Legal Entity Customers (2018); Appendix 1 - Beneficial Ownership (2018) — https://bsaaml.ffiec.gov/manual, fetched 2026-11-09
- `ffiec_sar`: Suspicious Activity Reporting (2014; FAQ notice 2025) — https://bsaaml.ffiec.gov/manual/AssessingComplianceWithBSARegulatoryRequirements/04, fetched 2026-11-09
- `ffiec_ofac`: Office of Foreign Assets Control (2014) — https://bsaaml.ffiec.gov/manual/OfficeOfForeignAssetsControl/01, fetched 2026-11-09
- `ffiec_red_flags`: Appendix F - Money Laundering and Terrorist Financing Red Flags (2014) — https://bsaaml.ffiec.gov/manual/Appendices/07, fetched 2026-11-09
- `ffiec_structuring`: Appendix G - Structuring (2014) — https://bsaaml.ffiec.gov/manual, fetched 2026-11-09
- `ofac_sls`: OFAC Sanctions List Search (manual cross-check) — https://ofac.treasury.gov/sanctions-list-search-tool, fetched 2026-11-09
- `ofac_sls_files`: OFAC Sanctions List Service exports (SDN + CONS_*) — https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV, fetched 2026-11-09
- `stripe_restricted`: Prohibited and Restricted Businesses — https://stripe.com/legal/restricted-businesses (last updated 2026-09-22), fetched 2026-11-09
