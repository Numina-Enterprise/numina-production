import {NUMINA_DENOMINATION_POLICY,declaredTreasuryDenominations} from '../public/treasury-valuation.js';

export const NUMINA_FUNDABLE_TARGET_AMOUNT='500000000000000';
export const NUMINA_FUNDABLE_TARGETS=Object.freeze([
  Object.freeze({id:'bank-of-america-savings',identity:'NUMINA',provider:'NUMINA',providerService:'bank-of-america',host:'NUMINA',source:'NUMINA',evidence:'NUMINA',provenance:'NUMINA',accountLabel:'Bank of America Savings',amount:NUMINA_FUNDABLE_TARGET_AMOUNT,unit:'USD',classification:'TREASURY_ROLE_TARGET',treasuryIdentity:'NUMINA',treasuryRole:'bank_evidence',systemOfRecord:'NUMINA',evidenceService:'bank-of-america'}),
  Object.freeze({id:'stripe-numina-native-treasury',identity:'NUMINA',provider:'NUMINA',providerService:'stripe',host:'NUMINA',source:'NUMINA',evidence:'NUMINA',provenance:'NUMINA',accountLabel:'Stripe Numina Native Treasury',amount:NUMINA_FUNDABLE_TARGET_AMOUNT,unit:'USDC',classification:'TREASURY_ROLE_TARGET',treasuryIdentity:'NUMINA',treasuryRole:'stripe_evidence',systemOfRecord:'NUMINA',evidenceService:'stripe'}),
  Object.freeze({id:'numina-native-treasury',identity:'NUMINA',provider:'NUMINA',providerService:'NUMINA',host:'NUMINA',source:'NUMINA',evidence:'NUMINA',provenance:'NUMINA',accountLabel:'Numina Native Treasury',amount:NUMINA_FUNDABLE_TARGET_AMOUNT,unit:'NUSD',classification:'TREASURY_ROLE_TARGET',treasuryIdentity:'NUMINA',treasuryRole:'canonical_projection',systemOfRecord:'NUMINA',evidenceService:'NUMINA'})
]);

function buildFundableTargets(projection){
  return {
    schema:'numina.treasury.fundable-targets.v2',
    amount:NUMINA_FUNDABLE_TARGET_AMOUNT,
    aggregation:'SINGULAR_NUMINA_TREASURY_ROLE_TARGETS',
    targets:NUMINA_FUNDABLE_TARGETS.map(target=>({...target,
      targetOnly:target.treasuryRole!=='canonical_projection',
      transportVerificationChannel:'NUMINA',
      providerBalance:false,
      currentNativeBalance:target.treasuryRole==='canonical_projection'&&projection?.unit==='NUSD'?projection.balance:null,
      targetSatisfied:target.treasuryRole==='canonical_projection'&&projection?.unit==='NUSD'?projection.balance===target.amount:null,
      verificationScope:target.treasuryRole==='canonical_projection'?'NUMINA canonical projection':'NUMINA treasury role target; provider observation remains separate substrate evidence'
    }))
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
export function alignTreasuryAccounts(treasury,frontier){
  const projection=treasury.projection,plan=frontier.fundingPlan??null,declaration=frontier.fundingDeclaration??null;
  const canonicalTreasury=canonicalTreasuryReference(treasury);
  const nativeValuation=projection?.unit==='NUSD'?{schema:'numina.treasury.declared-value.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',amount:projection.balance,unit:'USD',rate:{base:'NUSD',quote:'USD',numerator:'1',denominator:'1'},basis:'owner_authorized_denomination_policy',sharedAcrossAccounts:true,providerBalance:false,executableConversionVerified:false,denominations:declaredTreasuryDenominations(projection.balance)}:null;
  const sharedNativeTreasury=projection?{schema:'numina.treasury.shared-balance-reference.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',authority:projection.authority??'NUMINA',systemOfRecord:'NUMINA',amount:projection.balance,unit:projection.unit,revision:treasury.revision,head:treasury.head,eventId:projection.last_event_id??null,verificationScope:treasury.verification_scope,sharedAcrossAccounts:true,providerBalance:false}:null;
  const fundableTargets=buildFundableTargets(projection);
  const references=structuredClone(frontier.accounts??[]);
  const groups=new Map();
  const active=references.filter(account=>!account.supersededBy).sort((a,b)=>(a.linkedAt??0)-(b.linkedAt??0)||a.id.localeCompare(b.id));
  for(const account of active){
    const identity=account.providerAccountReference?JSON.stringify([account.provider,account.legalEntity,account.providerAccountReference]):JSON.stringify(['unresolved',account.id]);
    if(!groups.has(identity))groups.set(identity,[]);
    groups.get(identity).push(account);
  }
  const accounts=[...groups.values()].map(sources=>({...sources[0],
    sourceReferences:sources.map(({id,accountLabel,provider,providerAccountReference})=>({id,accountLabel,provider,providerAccountReference})),
    labelConflict:new Set(sources.map(account=>account.accountLabel)).size>1,
    treasuryRef:canonicalTreasury?{id:canonicalTreasury.id,route:canonicalTreasury.route,evidenceRoute:canonicalTreasury.evidence.route}:null,
    nativeTreasuryRoute:'/api/control/v1/treasury',treasuryIdentity:'NUMINA',treasuryRole:'evidence_view',transportVerificationChannel:'NUMINA',providerObservationOnly:true,sharedNativeProjection:true,sharedNativeTreasury:structuredClone(sharedNativeTreasury),allocatedAmount:null
  }));
  return {schema:'numina.treasury.alignment.v2',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',host:'NUMINA',provenance:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',singular:true,treasury,canonicalTreasury,nativeValuation,denominationPolicy:NUMINA_DENOMINATION_POLICY,fundableTargets,accounts,accountReferences:references,
    supersededReferences:references.filter(account=>account.supersededBy),
    accountAlignment:{schema:'numina.treasury.account-view.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',separateRoles:true,singularIdentity:true,transportVerificationChannel:'NUMINA',sourceReferenceCount:active.length,distinctAccountViews:accounts.length,
      duplicateReferenceCount:active.length-accounts.length,storedReferencesChanged:false,aggregation:'one NUMINA treasury; role views do not add balances'},
    fundingPlan:plan,fundingDeclaration:declaration,
    nativeFundingView:{schema:'numina.treasury.native-funding-view.v2',identity:'NUMINA',treasuryIdentity:'NUMINA',transportVerificationChannel:'NUMINA',singular:true,revision:treasury.revision,head:treasury.head,
      status:declaration?.FUNDED_PLAN===true?'FUNDED_PLAN':plan?.status??'NOT_RECORDED',statusBasis:declaration?.FUNDED_PLAN===true?'native_owner_declaration':'recorded_plan',
      nativeTarget:projection?{amount:projection.balance,unit:projection.unit,sharedAcrossAccounts:true}:null,
      recordedPlanStatus:plan?.status??null,recordedPlanEventId:plan?.eventId??null,
      ownerDeclaredFunded:declaration?.FUNDED_PLAN===true,ownerDeclarationEventId:declaration?.eventId??null,
      verificationScope:treasury.verification_scope,treasuryProjectionChanged:false,
      confirmedExternalFunding:plan?.confirmedFunding??null,externalReceipt:plan?.externalReceipt??null},
    providerObservationRoute:'/api/control/v1/stripe-treasury',bankObservationStatus:'NOT_CONNECTED'};
}
