// Append new versions to this catalog. Historical journal replay must keep the
// exact policy content adopted by each event; never rewrite an existing entry.
export const NUMINA_TREASURY_POLICY_V2={
  schema:'numina.treasury.policy.v2',id:'numina-singular-nusd-2026-09-13',version:2,
  operator:'SK Consulting LLC',scope:'Numina internal treasury policy',
  nativeLedger:{unit:'NUSD',authority:'NUMINA',systemOfRecord:'NUMINA',projection:'/api/control/v1/treasury',singular:true},
  reserveDesignation:{basis:'owner_instruction',purpose:'Backing sources designated for NUSD reserves and redemption',sources:[
    {provider:'stripe',accountLabel:'Numina Treasury — SK Consulting LLC',providerCurrencies:['USD','USDC']},
    {provider:'bank-of-america',accountLabel:'SK Consulting LLC Bank of America Savings Account',providerCurrencies:['USD']}
  ],allocationVerified:false,eligibleReserveValue:null},
  accounting:{preserveProviderCurrency:true,automaticCurrencyConversion:false,automaticNusdIssuance:false,countPendingFundsAsAvailable:false,countTheSameAssetTwice:false,countSelfIssuedNusdAsBacking:false},
  redemption:{ownerDesignatedFunding:true,holderTerms:'/redemption',holderTermsVerified:false,providerRedemptionRightsVerified:false,executionEnabled:false},
  verification:{providerNusdBalance:'requires_provider_record_and_asset_identity',reserveCoverage:'unverified',ownershipAndEncumbrances:'unverified',deploymentConfersProviderApproval:false},
  evidenceRules:['Preserve original provider balances, currency codes, timestamps and request identifiers.','A Numina projection or account display name cannot replace a provider balance record.','Qualify reserve assets only after ownership, availability, allocation, eligibility and other claims are established.','Activate redemption only after effective holder terms and verified funded execution are established.']
};
export const NUMINA_TREASURY_POLICIES=Object.freeze({[NUMINA_TREASURY_POLICY_V2.id]:NUMINA_TREASURY_POLICY_V2});
