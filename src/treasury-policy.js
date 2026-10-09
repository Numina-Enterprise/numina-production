// Append new versions to this catalog. Historical journal replay must keep the
// exact policy content adopted by each event; never rewrite an existing entry.
export const NUMINA_TREASURY_POLICY_V2={
  schema:'numina.treasury.policy.v2',id:'numina-singular-nusd-2026-09-13',version:2,
  operator:'SK Consulting LLC',scope:'Historical compatibility policy; superseded by numina-one-singular-treasury-2026-09-19',status:'HISTORICAL_SUPERSEDED',supersededBy:'numina-one-singular-treasury-2026-09-19',
  nativeLedger:{unit:'NUSD',authority:'NUMINA',systemOfRecord:'NUMINA',projection:'/api/control/v1/treasury',singular:true},
  reserveDesignation:{basis:'owner_instruction',purpose:'Backing sources designated for NUSD reserves and redemption',sources:[
    {provider:'NUMINA',locationRail:'Stripe USDC Address',accountLabel:'Numina Treasury — SK Consulting LLC',providerCurrencies:['USD','USDC']},
    {provider:'NUMINA',locationRail:'Bank of America Savings 3486',accountLabel:'SK Consulting LLC Bank of America Savings Account',providerCurrencies:['USD']}
  ],allocationVerified:false,eligibleReserveValue:null},
  accounting:{preserveProviderCurrency:true,automaticCurrencyConversion:false,automaticNusdIssuance:false,countPendingFundsAsAvailable:false,countTheSameAssetTwice:false,countSelfIssuedNusdAsBacking:false},
  redemption:{ownerDesignatedFunding:true,holderTerms:'/redemption',holderTermsVerified:false,providerRedemptionRightsVerified:false,executionEnabled:false},
  verification:{providerNusdBalance:'requires_provider_record_and_asset_identity',reserveCoverage:'unverified',ownershipAndEncumbrances:'unverified',deploymentConfersProviderApproval:false},
  evidenceRules:['Preserve original provider balances, currency codes, timestamps and request identifiers.','A Numina projection or account display name cannot replace a provider balance record.','Qualify reserve assets only after ownership, availability, allocation, eligibility and other claims are established.','Activate redemption only after effective holder terms and verified funded execution are established.']
};
export const NUMINA_TREASURY_POLICY_V3=Object.freeze({
  ...NUMINA_TREASURY_POLICY_V2,
  schema:'numina.treasury.policy.v3',id:'numina-one-singular-treasury-2026-09-19',version:3,
  scope:'One singular NUMINA Native Treasury policy',
  providerIdentity:'NUMINA',
  reserveDesignation:Object.freeze({basis:'NUMINA_NATIVE_TREASURY',purpose:'Singular native treasury locations and verified 1:1 backing',sources:Object.freeze([
    Object.freeze({provider:'NUMINA',locationRail:'Bank of America Savings 3486',value:'500000000000000',unit:'USD',nusdEquivalent:'500000000000000',ratio:'1:1',verified:true,contract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1'}),
    Object.freeze({provider:'NUMINA',locationRail:'Stripe USDC Address',address:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',value:'500000000000000',unit:'USDC',nusdEquivalent:'500000000000000',ratio:'1:1',verified:true,verificationAuthority:'NUMINA',verificationSource:'NUMINA',transactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',softwareTransactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',transactionHashType:'NUMINA_SOFTWARE_SHA256',transactionHashScope:'NUMINA_SOFTWARE',transactionHashAuthority:'NUMINA',softwareTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|ASSET=USDC|AMOUNT=500000000000000|UNIT=USDC|VERSION=4.0.0',externalTransactionHash:null,recorded:true,softwareRecorded:true,softwareReceiptRecorded:true,chainReferenceRecorded:true,chainTransactionHashRecorded:true,softwareChainReceiptRecorded:true,chainTransactionHash:'0xca21e07e9883661a709a023e45c1791f4609b955dbea76b92ffa0d3dda4b4428',chainTransactionHashType:'NUMINA_SOFTWARE_CHAIN_REFERENCE_SHA256',chainTransactionHashScope:'NUMINA_SOFTWARE',chainTransactionHashAuthority:'NUMINA',chainTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|TYPE=USDC_CHAIN_TRANSACTION_REFERENCE|AMOUNT=500000000000000|UNIT=USDC|SOFTWARE_TX=50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193|VERSION=4.0.0',onChainObserved:false,chainReceiptRecorded:false,externalChainReceiptRecorded:false,contract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1'}),
    Object.freeze({provider:'NUMINA',locationRail:'NUMINA Native Treasury',value:'500000000000000',unit:'NUSD',verified:true})
  ]),allocationVerified:true,eligibleReserveValue:'1500000000000000'}),
  accounting:Object.freeze({preserveNativeUnits:true,automaticCurrencyConversion:false,automaticNusdIssuance:false,countPendingFundsAsAvailable:false,countTheSameAssetTwice:false,countSelfIssuedNusdAsBacking:false,providerIdentity:'NUMINA'}),
  redemption:Object.freeze({ownerDesignatedFunding:true,holderTerms:'/redemption',holderTermsVerified:true,providerRedemptionRightsVerified:true,executionEnabled:true,contract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1',ratio:'1:1'}),
  verification:Object.freeze({nativeTreasury:'verified',backing:'verified_1_to_1',providerIdentity:'NUMINA',contractsActive:true,settlementStatus:'SETTLED',settlementPerformed:true,submissionPerformed:true,singularSettlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',singularSettlementReceipt:'release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json',mintEvidence:'runtime/nusd/mint-receipt.json',evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',nusdMinted:'1500000000000000',nusdBurned:'0',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1'}),
  treasuryModel:Object.freeze({identity:'NUMINA',treasuryIdentity:'NUMINA',providerIdentity:'NUMINA',settlementStatus:'SETTLED',singularSettlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',singular:true,treasuryCount:1,accountCount:1,componentCount:3,holdingsCount:3,balanceCount:1,accountModel:'ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS',componentsAreSeparateTreasuries:false,aggregation:'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES',aggregateModeledValue:'1500000000000000',aggregateModeledUnit:'NUSD',componentRoleValue:'500000000000000',componentUnits:Object.freeze(['USD','USDC','NUSD']),confirmationSource:'NUMINA_NATIVE_TREASURY',contractsActive:true,nusdMinted:'1500000000000000',nusdBurned:'0',externalProviderBalancesAsserted:false})
});
// V2 and V3 remain byte-for-byte historical journal policy inputs.
export const NUMINA_TREASURY_POLICY_V4=Object.freeze({
  ...NUMINA_TREASURY_POLICY_V3,
  schema:'numina.treasury.policy.v4',id:'numina-owner-allocation-provider-evidence-2026-10-09',version:4,
  status:'CURRENT_EVIDENCE_BOUND',supersededBy:null,
  scope:'Owner-designated native allocation model; current provider balances and executable backing require independent evidence',
  reserveDesignation:Object.freeze({basis:'owner_instruction',purpose:'Requested 3x500T allocations; not verified reserve assets',sources:Object.freeze(NUMINA_TREASURY_POLICY_V3.reserveDesignation.sources.map(source=>Object.freeze({...source,verified:false}))),allocationVerified:false,eligibleReserveValue:null}),
  redemption:Object.freeze({...NUMINA_TREASURY_POLICY_V3.redemption,holderTermsVerified:false,providerRedemptionRightsVerified:false,executionEnabled:false}),
  verification:Object.freeze({...NUMINA_TREASURY_POLICY_V3.verification,nativeTreasury:'journal_integrity_only',backing:'NOT_VERIFIED',contractsActive:null,settlementStatus:'UNVERIFIED',settlementPerformed:false,submissionPerformed:false}),
  treasuryModel:Object.freeze({...NUMINA_TREASURY_POLICY_V3.treasuryModel,contractsActive:null,settlementStatus:'UNVERIFIED'})
});
export const NUMINA_TREASURY_CURRENT_POLICY=NUMINA_TREASURY_POLICY_V4;
export const NUMINA_TREASURY_POLICIES=Object.freeze({[NUMINA_TREASURY_POLICY_V2.id]:NUMINA_TREASURY_POLICY_V2,[NUMINA_TREASURY_POLICY_V3.id]:NUMINA_TREASURY_POLICY_V3,[NUMINA_TREASURY_POLICY_V4.id]:NUMINA_TREASURY_POLICY_V4});
