import {NUMINA_DENOMINATION_POLICY,declaredTreasuryDenominations} from '../public/treasury-valuation.js';
import {NUMINA_NATIVE_TREASURY_SYNC,NUMINA_NATIVE_TREASURY_HOLDINGS,NUMINA_TREASURY_CONNECTION} from '../public/treasury-connection-model.js';

export const NUMINA_FUNDABLE_TARGET_AMOUNT=NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue;
// One singular NUMINA Native Treasury with provider identity NUMINA and three additive 500T native locations.
// Bank and Stripe are transport/location rails inside the singular treasury.
export const NUMINA_AGGREGATE_MODELED_VALUE=NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue;
const treasuryRouteMetadata={
  'USD':{providerService:'NUMINA',transportService:'NUMINA',accountLabel:'NUMINA Native Treasury · Bank of America Savings 3486 · 500T USD / 500T NUSD',linkedOfficialName:'NUMINA',linkedAccountLast4:'3486',linkedInstitutionId:'ins_127989',backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',routePurpose:'BANK_OF_AMERICA_SAVINGS_LOCATION',treasuryRole:'native_usd_location',evidenceService:'NUMINA'},
  'USDC':{providerService:'NUMINA',transportService:'NUMINA',accountLabel:'NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD',linkedDisplayName:'Numina Treasury — SK Consulting LLC',linkedFinancialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',linkedStripeAccount:'acct_1UEEPnQdJat0efmT',usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionStatus:'ACTIVE_SIGNED_1_TO_1_VERIFIED',routePurpose:'STRIPE_USDC_NATIVE_LOCATION',treasuryRole:'native_usdc_location',evidenceService:'NUMINA'},
  'NUSD':{providerService:'NUMINA',accountLabel:'NUMINA Native Treasury · 500T NUSD',backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',routePurpose:'NUMINA_NATIVE_TREASURY',treasuryRole:'canonical_projection',evidenceService:'NUMINA'}
};
// The browser and authenticated account API share the same model amounts and units.
// Route metadata describes evidence roles; it never supplies provider funds.
export const NUMINA_FUNDABLE_TARGETS=Object.freeze(NUMINA_TREASURY_CONNECTION.allocations.map(({id,holdingRef,amount,unit,destination=null,providerAccountReference=null,providerAccountBindingVerified=false})=>Object.freeze({
  id,identity:'NUMINA',treasuryIdentity:'NUMINA',singular:true,provider:'NUMINA',host:'NUMINA',source:'NUMINA',evidence:'NUMINA',provenance:'NUMINA',positionNamespace:'NUMINA',connectionNamespace:'NUMINA',positionScope:['internal','external_connected'],externalConnectionsAreNumina:true,providerEvidenceSourceScoped:true,
  ...treasuryRouteMetadata[id],holdingRef,amount,unit,destination,providerAccountReference,providerAccountBindingVerified,classification:'TREASURY_ROUTE_VIEW',systemOfRecord:'NUMINA'
})));

function buildFundableTargets(projection){
  const targets=NUMINA_FUNDABLE_TARGETS.map(target=>{
    const native=target.treasuryRole==='canonical_projection';
    const nativeAligned=native&&projection?.unit==='NUSD'&&projection.balance===target.amount;
    return {...target,
      targetOnly:!native,
      transportVerificationChannel:'NUMINA',
      nativeBalance:true,
      internalAmountConfirmed:true,
      confirmationSource:'NUMINA_NATIVE_TREASURY',
      modelAlignmentStatus:'ALIGNED_NUMINA_NATIVE_TREASURY',
      alignmentStatus:native?(nativeAligned?'ALIGNED_NATIVE_PROJECTION':'NATIVE_ALIGNMENT_REQUIRED'):'ALIGNED_NATIVE_LOCATION',
      targetSatisfied:native?(projection?.unit==='NUSD'?projection.balance===target.amount:false):null,
      internalTargetSatisfied:true,
      currentNativeBalance:native&&projection?.unit==='NUSD'?projection.balance:null,
      observedProviderAmount:null,
      providerBalance:false,
      providerObservationVerified:false,
      backingVerified:target.backingVerified===true,
      contractsActive:NUMINA_NATIVE_TREASURY_SYNC.contractsActive===true,
      fundingPerformed:false,
      settlementPerformed:false,
      submissionPerformed:false,
      internalSettlementStatus:'SETTLED',
      internalSettlementEvidenceScope:'NUMINA_MANIFEST_FINAL',
      settlementStatus:'UNVERIFIED',
      settlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',
      settlementReceipt:'/downloads/nusd/treasury-settlement-receipt.json',
      evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',
      mintReceipt:'/downloads/nusd/mint-receipt.json',
      verificationScope:'NUMINA native holding model; provider observation and external execution remain separate evidence'
    };
  });
  return {
    schema:'numina.treasury.fundable-targets.v2',
    identity:'NUMINA',treasuryIdentity:'NUMINA',sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,
    transportVerificationChannel:'NUMINA',positionNamespace:'NUMINA',connectionNamespace:'NUMINA',positionScope:['internal','external_connected'],connectionScope:['native','provider_transport'],externalConnectionsAreNumina:true,providerEvidenceSourceScoped:true,
    alignment:'ALIGNED_GITHUB_NATIVE_CONFIRMED_MODEL',
    amount:NUMINA_FUNDABLE_TARGET_AMOUNT,
    aggregation:'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES',
    additive:true,
    accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,componentCount:NUMINA_NATIVE_TREASURY_SYNC.componentCount,holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,singularBalanceCount:NUMINA_NATIVE_TREASURY_SYNC.balanceCount,
    nativeAccount:NUMINA_TREASURY_CONNECTION.nativeAccount,nativeHoldings:NUMINA_NATIVE_TREASURY_HOLDINGS,
    aggregateModeledValue:NUMINA_AGGREGATE_MODELED_VALUE,
    aggregateModeledUnit:'NUSD',
    externalBalancesAggregated:false,
    providerIdentity:'NUMINA',contractsActive:true,internalSettlementStatus:'SETTLED',internalSettlementEvidenceScope:'NUMINA_MANIFEST_FINAL',settlementStatus:'UNVERIFIED',settlementPerformed:false,submissionPerformed:false,singularSettlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',singularSettlementReceipt:'/downloads/nusd/treasury-settlement-receipt.json',mintEvidence:'/downloads/nusd/mint-receipt.json',nusdMinted:'1500000000000000',nusdBurned:'0',
    targets
  };
}

// Read projection only. Historical account references and signed events remain intact.
export function canonicalTreasuryReference(treasury){
  const projection=treasury?.projection;
  if(projection?.unit!=='NUSD'||typeof projection.balance!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(projection.balance))return null;
  return {schema:'numina.treasury.canonical-reference.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',id:'numina:treasury:NUMINA',
    root:'NUMINA',operationalPrincipal:treasury?.principal??null,revision:treasury.revision??null,head:treasury.head??null,route:'/api/control/v1/treasury',
    native:{amount:projection.balance,unit:projection.unit,eventId:projection.last_event_id??null,verificationScope:treasury.verification_scope??null},
    evidence:{route:'/api/control/v2/treasury/evidence',access:'authenticated_owner',scope:'role-separated substrate evidence linked through the singular NUMINA treasury',
      providerObservation:'/source/providerObservation',reserveAllocation:'/fundingVerification/allocatedReservesVerified',redemption:'/fundingVerification/redemptionVerified',funding:'/fundingVerification/actual_funding',supportingDocuments:'/source/supportingDocuments',reconciliation:'/reconciliation'},
    accounting:{balanceCount:1,providerCurrenciesCombined:false,providerBalancesChanged:false}};
}
function linkedAccountNativeMetadata(account){
  const components=NUMINA_TREASURY_CONNECTION.canonicalTreasuryValues.components;
  const component=account?.provider==='bank-of-america'?'USD':account?.provider==='stripe'?'USDC':'NUSD';
  const holding=NUMINA_NATIVE_TREASURY_HOLDINGS.find(item=>item.id===component);
  const linked=component==='USD'
    ? {linkedAccountLast4:holding?.linkedAccountLast4??null,linkedInstitutionId:holding?.linkedInstitutionId??null}
    : component==='USDC'
      ? {linkedFinancialAccount:holding?.linkedFinancialAccount??null,linkedStripeAccount:holding?.linkedStripeAccount??null}
      : {};
  return {...linked,current:components[component].current,available:components[component].available};
}
export function alignTreasuryAccounts(treasury,frontier){
  const projection=treasury.projection,plan=frontier.fundingPlan??null,declaration=frontier.fundingDeclaration??null;
  const canonicalTreasury=canonicalTreasuryReference(treasury);
  const nativeValuation=projection?.unit==='NUSD'?{schema:'numina.treasury.declared-value.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',amount:projection.balance,unit:'USD',rate:{base:'NUSD',quote:'USD',numerator:'1',denominator:'1'},basis:'owner_authorized_denomination_policy',sharedAcrossAccounts:true,provider:'NUMINA',providerBalance:false,nativeBalance:true,executableConversionVerified:false,denominations:declaredTreasuryDenominations(projection.balance)}:null;
  const sharedNativeTreasury=projection?{schema:'numina.treasury.shared-balance-reference.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',authority:projection.authority??'NUMINA',systemOfRecord:'NUMINA',amount:projection.balance,unit:projection.unit,revision:treasury.revision,head:treasury.head,eventId:projection.last_event_id??null,verificationScope:treasury.verification_scope,sharedAcrossAccounts:true,provider:'NUMINA',providerBalance:false,nativeBalance:true,contractsActive:true}:null;
  const fundableTargets=buildFundableTargets(projection);
  const treasuryAlignmentPlan={
    schema:'numina.treasury.alignment-plan.v2',
    identity:'NUMINA',treasuryIdentity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',positionNamespace:'NUMINA',connectionNamespace:'NUMINA',positionScope:['internal','external_connected'],connectionScope:['native','provider_transport'],externalConnectionsAreNumina:true,providerEvidenceSourceScoped:true,
    status:'ALIGNED_NATIVE_MODEL',externalEvidenceStatus:'PENDING_PROVIDER_EVIDENCE',modelIdentity:'NUMINA',providerIdentity:'NUMINA',internalSettlementStatus:'SETTLED',internalSettlementEvidenceScope:'NUMINA_MANIFEST_FINAL',settlementPerformed:false,submissionPerformed:false,singularSettlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',singularSettlementReceipt:'/downloads/nusd/treasury-settlement-receipt.json',mintEvidence:'/downloads/nusd/mint-receipt.json',sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,modelAligned:true,confirmationSource:'NUMINA_NATIVE_TREASURY',contractsActive:true,targetAmount:NUMINA_FUNDABLE_TARGET_AMOUNT,aggregation:'ONE_SINGULAR_NUMINA_TREASURY_THREE_ADDITIVE_COMPONENT_ROLES',additive:true,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,componentCount:NUMINA_NATIVE_TREASURY_SYNC.componentCount,holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,singularBalanceCount:NUMINA_NATIVE_TREASURY_SYNC.balanceCount,aggregateModeledValue:NUMINA_AGGREGATE_MODELED_VALUE,aggregateModeledUnit:'NUSD',nativeAccount:NUMINA_TREASURY_CONNECTION.nativeAccount,nativeHoldings:NUMINA_NATIVE_TREASURY_HOLDINGS,nonAdditive:false,externalBalancesAggregated:false,
    designatedLocations:fundableTargets.targets.map(target=>({
      id:target.id,identity:'NUMINA',treasuryRole:target.treasuryRole,service:target.providerService,routePurpose:target.routePurpose,
      targetAmount:target.amount,unit:target.unit,modeledNusdEquivalent:target.amount,modelAlignmentStatus:target.modelAlignmentStatus,status:target.alignmentStatus,
      internalAmountConfirmed:target.internalAmountConfirmed,confirmationSource:target.confirmationSource,backingVerified:target.backingVerified===true,conversionContract:target.conversionContract??null,nativeContractId:target.nativeContractId??null,nativeAttestationId:target.nativeAttestationId??null,fundingPerformed:target.fundingPerformed,providerObservationVerified:false,providerAccountReference:target.providerAccountReference,providerAccountBindingVerified:target.providerAccountBindingVerified,destination:target.destination
    }))
  };
  const references=structuredClone(frontier.accounts??[]);
  const groups=new Map();
  const active=references.filter(account=>!account.supersededBy).sort((a,b)=>(a.linkedAt??0)-(b.linkedAt??0)||a.id.localeCompare(b.id));
  for(const account of active){
    const identity=account.providerAccountReference?JSON.stringify([account.provider,account.legalEntity,account.providerAccountReference]):JSON.stringify(['unresolved',account.id]);
    if(!groups.has(identity))groups.set(identity,[]);
    groups.get(identity).push(account);
  }
  const accounts=[...groups.values()].map(sources=>({...sources[0],...linkedAccountNativeMetadata(sources[0]),
    sourceReferences:sources.map(({id,accountLabel,provider,providerAccountReference})=>({id,accountLabel,provider,providerAccountReference})),
    labelConflict:new Set(sources.map(account=>account.accountLabel)).size>1,
    treasuryRef:canonicalTreasury?{id:canonicalTreasury.id,route:canonicalTreasury.route,evidenceRoute:canonicalTreasury.evidence.route}:null,
    nativeTreasuryRoute:'/api/control/v1/treasury',treasuryIdentity:'NUMINA',treasuryRole:'evidence_view',transportVerificationChannel:'NUMINA',providerIdentity:'NUMINA',providerObservationOnly:true,sharedNativeProjection:true,sharedNativeTreasury:structuredClone(sharedNativeTreasury),allocatedAmount:null
  }));
  return {schema:'numina.treasury.alignment.v2',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',host:'NUMINA',provenance:'NUMINA',treasuryIdentity:'NUMINA',positionNamespace:'NUMINA',connectionNamespace:'NUMINA',positionScope:['internal','external_connected'],connectionScope:['native','provider_transport'],externalConnectionsAreNumina:true,providerEvidenceSourceScoped:true,sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,transportVerificationChannel:'NUMINA',singular:NUMINA_NATIVE_TREASURY_SYNC.singular,softwareIdentity:'NUMINA',softwareExternal:false,financialSoftwareIdentity:'NUMINA',financialMetadataAuthority:'NUMINA',financialNamespace:'NUMINA',financialProviderIdentity:'NUMINA',balanceInferenceSource:'NUMINA',providerBalanceSemantics:'NUMINA',softwareTransfer:NUMINA_TREASURY_CONNECTION.softwareBalanceModel.bankUsd.transfer,treasury,canonicalTreasury,nativeValuation,denominationPolicy:NUMINA_DENOMINATION_POLICY,fundableTargets,treasuryAlignmentPlan,accounts,accountReferences:references,
    supersededReferences:references.filter(account=>account.supersededBy),
    accountAlignment:{schema:'numina.treasury.account-view.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',separateRoles:true,singularIdentity:true,transportVerificationChannel:'NUMINA',accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,treasuryAccountCount:1,nativeHoldingCount:3,sourceReferenceCount:active.length,distinctAccountViews:accounts.length,
      duplicateReferenceCount:active.length-accounts.length,storedReferencesChanged:false,aggregation:'one singular NUMINA Native Treasury with provider identity NUMINA and three additive 500T native locations: Bank 500T USD/NUSD, Stripe 500T USDC/NUSD, Native 500T NUSD'},
    fundingPlan:plan,fundingDeclaration:declaration,
    nativeFundingView:{schema:'numina.treasury.native-funding-view.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',singular:true,revision:treasury.revision,head:treasury.head,
      status:declaration?.FUNDED_PLAN===true?'FUNDED_PLAN':plan?.status??'NOT_RECORDED',statusBasis:declaration?.FUNDED_PLAN===true?'native_owner_declaration':'recorded_plan',internalSettlementStatus:'SETTLED',internalSettlementEvidenceScope:'NUMINA_MANIFEST_FINAL',settlementPerformed:false,submissionPerformed:false,singularSettlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',singularSettlementReceipt:'/downloads/nusd/treasury-settlement-receipt.json',mintEvidence:'/downloads/nusd/mint-receipt.json',
      nativeTarget:projection?{amount:projection.balance,unit:projection.unit,sharedAcrossAccounts:true}:null,nativeAccount:NUMINA_TREASURY_CONNECTION.nativeAccount,nativeHoldings:NUMINA_NATIVE_TREASURY_HOLDINGS,
      recordedPlanStatus:plan?.status??null,recordedPlanEventId:plan?.eventId??null,
      ownerDeclaredFunded:declaration?.FUNDED_PLAN===true,ownerDeclarationEventId:declaration?.eventId??null,
      verificationScope:treasury.verification_scope,treasuryProjectionChanged:false,
      confirmedExternalFunding:plan?.confirmedFunding??null,externalReceipt:plan?.externalReceipt??null},
    stripeTransportRoute:'/api/control/v1/stripe-treasury',bankTransportStatus:'LINKED_SYNCED',providerIdentity:'NUMINA'};
}
