import {NUMINA_DENOMINATION_POLICY,declaredTreasuryDenominations} from '../public/treasury-valuation.js';

export const NUMINA_FUNDABLE_TARGET_AMOUNT='500000000000000';
export const NUMINA_FUNDABLE_TARGETS=Object.freeze([
  Object.freeze({id:'bank-of-america-savings',provider:'bank-of-america',accountLabel:'Bank of America Savings',amount:NUMINA_FUNDABLE_TARGET_AMOUNT,unit:'USD',classification:'FUNDABLE_TARGET',systemOfRecord:'EXTERNAL_PROVIDER'}),
  Object.freeze({id:'stripe-numina-native-treasury',provider:'stripe',accountLabel:'Stripe Numina Native Treasury',amount:NUMINA_FUNDABLE_TARGET_AMOUNT,unit:'USDC',classification:'FUNDABLE_TARGET',systemOfRecord:'EXTERNAL_PROVIDER'}),
  Object.freeze({id:'numina-native-treasury',provider:'numina',accountLabel:'Numina Native Treasury',amount:NUMINA_FUNDABLE_TARGET_AMOUNT,unit:'NUSD',classification:'FUNDABLE_TARGET',systemOfRecord:'NUMINA'})
]);

function buildFundableTargets(projection){
  return {
    schema:'numina.treasury.fundable-targets.v1',
    amount:NUMINA_FUNDABLE_TARGET_AMOUNT,
    aggregation:'NON_ADDITIVE_TARGETS',
    targets:NUMINA_FUNDABLE_TARGETS.map(target=>({...target,
      targetOnly:target.systemOfRecord!=='NUMINA',
      providerBalance:false,
      currentNativeBalance:target.systemOfRecord==='NUMINA'&&projection?.unit==='NUSD'?projection.balance:null,
      targetSatisfied:target.systemOfRecord==='NUMINA'&&projection?.unit==='NUSD'?projection.balance===target.amount:null,
      verificationScope:target.systemOfRecord==='NUMINA'?'Numina-native projection':'Funding objective only; external provider balance requires independent observation'
    }))
  };
}

// Read projection only. Historical account references and signed events remain intact.
export function canonicalTreasuryReference(treasury){
  const projection=treasury?.projection;
  if(typeof treasury?.root!=='string'||!treasury.root||projection?.unit!=='NUSD'||typeof projection.balance!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(projection.balance))return null;
  return {schema:'numina.treasury.canonical-reference.v1',id:'numina:treasury:'+encodeURIComponent(treasury.root),
    root:treasury.root,revision:treasury.revision??null,head:treasury.head??null,route:'/api/control/v1/treasury',
    native:{amount:projection.balance,unit:projection.unit,eventId:projection.last_event_id??null,verificationScope:treasury.verification_scope??null},
    evidence:{route:'/api/control/v2/treasury/evidence',access:'authenticated_owner',scope:'separate source records linked to the native treasury',
      providerObservation:'/source/providerObservation',reserveAllocation:'/fundingVerification/allocatedReservesVerified',redemption:'/fundingVerification/redemptionVerified',funding:'/fundingVerification/actual_funding',supportingDocuments:'/source/supportingDocuments',reconciliation:'/reconciliation'},
    accounting:{balanceCount:1,providerCurrenciesCombined:false,providerBalancesChanged:false}};
}
export function alignTreasuryAccounts(treasury,frontier){
  const projection=treasury.projection,plan=frontier.fundingPlan??null,declaration=frontier.fundingDeclaration??null;
  const canonicalTreasury=canonicalTreasuryReference(treasury);
  const nativeValuation=projection?.unit==='NUSD'?{schema:'numina.treasury.declared-value.v1',amount:projection.balance,unit:'USD',rate:{base:'NUSD',quote:'USD',numerator:'1',denominator:'1'},basis:'owner_authorized_denomination_policy',sharedAcrossAccounts:true,providerBalance:false,executableConversionVerified:false,denominations:declaredTreasuryDenominations(projection.balance)}:null;
  const sharedNativeTreasury=projection?{schema:'numina.treasury.shared-balance-reference.v1',authority:projection.authority??'NUMINA',systemOfRecord:'NUMINA',amount:projection.balance,unit:projection.unit,revision:treasury.revision,head:treasury.head,eventId:projection.last_event_id??null,verificationScope:treasury.verification_scope,sharedAcrossAccounts:true,providerBalance:false}:null;
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
    nativeTreasuryRoute:'/api/control/v1/treasury',sharedNativeProjection:true,sharedNativeTreasury:structuredClone(sharedNativeTreasury),allocatedAmount:null
  }));
  return {treasury,canonicalTreasury,nativeValuation,denominationPolicy:NUMINA_DENOMINATION_POLICY,fundableTargets,accounts,accountReferences:references,
    supersededReferences:references.filter(account=>account.supersededBy),
    accountAlignment:{schema:'numina.treasury.account-view.v1',sourceReferenceCount:active.length,distinctAccountViews:accounts.length,
      duplicateReferenceCount:active.length-accounts.length,storedReferencesChanged:false,aggregation:'one shared native projection; no account amounts added'},
    fundingPlan:plan,fundingDeclaration:declaration,
    nativeFundingView:{schema:'numina.treasury.native-funding-view.v1',revision:treasury.revision,head:treasury.head,
      status:declaration?.FUNDED_PLAN===true?'FUNDED_PLAN':plan?.status??'NOT_RECORDED',statusBasis:declaration?.FUNDED_PLAN===true?'native_owner_declaration':'recorded_plan',
      nativeTarget:projection?{amount:projection.balance,unit:projection.unit,sharedAcrossAccounts:true}:null,
      recordedPlanStatus:plan?.status??null,recordedPlanEventId:plan?.eventId??null,
      ownerDeclaredFunded:declaration?.FUNDED_PLAN===true,ownerDeclarationEventId:declaration?.eventId??null,
      verificationScope:treasury.verification_scope,treasuryProjectionChanged:false,
      confirmedExternalFunding:plan?.confirmedFunding??null,externalReceipt:plan?.externalReceipt??null},
    providerObservationRoute:'/api/control/v1/stripe-treasury',bankObservationStatus:'NOT_CONNECTED'};
}
