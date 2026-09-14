// Read projection only. Historical account references and signed events remain intact.
export function alignTreasuryAccounts(treasury,frontier){
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
    nativeTreasuryRoute:'/api/control/v1/treasury',sharedNativeProjection:true,allocatedAmount:null
  }));
  const projection=treasury.projection,plan=frontier.fundingPlan??null,declaration=frontier.fundingDeclaration??null;
  return {treasury,accounts,accountReferences:references,
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
