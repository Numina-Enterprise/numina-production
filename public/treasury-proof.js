// Checks internal record consistency. Trust in the source and current journal ancestry
// still comes from the authenticated server; a SHA-256 digest is not a signature.
const treasuryHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const treasuryText = value => typeof value === 'string' && value.length > 0;
const treasuryRevision = value => Number.isSafeInteger(value) && value >= 0;
function treasuryJournalMetadataMatches(data) {
  const projection = data.projection;
  const settlement = projection?.transaction_requests?.findLast(request => request.kind === 'aggregate_settlement' && request.id === projection.last_event_id && request.status === 'SETTLED' && request.settlement === true && request.submission_performed === true && request.settlement_performed === true && typeof request.receipt?.id === 'string' && typeof request.receipt?.path === 'string' && request.unit === projection.unit && request.components?.some(component => component.id === 'native-retained' && component.settled_amount === projection.balance)) ?? null;
  const native = settlement?.components?.find(component => component.id === 'native-retained');
  const current = !!settlement && native?.settled_amount === projection.balance && settlement.unit === projection.unit;
  const receipt = current ? settlement.receipt : null;
  return data.settlementStatus === (current && settlement.settlement_performed === true ? 'SETTLED' : 'UNVERIFIED')
    && data.settlementPerformed === (current && settlement.settlement_performed === true)
    && data.submissionPerformed === (current && settlement.submission_performed === true)
    && data.submissionScope === 'NUMINA_NATIVE_TREASURY'
    && data.settlementScope === 'NUMINA_NATIVE_TREASURY'
    && data.externalProviderSubmissionPerformed === null
    && data.externalProviderSettlementVerified === null
    && data.externalProviderSubmissionStatus === 'UNVERIFIED'
    && data.externalProviderSettlementStatus === 'UNVERIFIED'
    && data.singularSettlementReceiptId === (receipt?.id ?? null)
    && data.singularSettlementReceipt === (receipt?.path ?? null)
    && data.mintEvidence === (receipt?.mint_receipt ?? null)
    && data.aggregateModeledValue === (current ? settlement.aggregate_amount : null)
    && data.aggregateModeledUnit === (current ? settlement.unit : null)
    && data.journalProjectionBalance === (typeof projection?.balance === 'string' ? projection.balance : null)
    && data.journalProjectionUnit === (projection?.unit === 'NUSD' ? 'NUSD' : null)
    && data.nativeBackingAttestationId === (receipt?.native_backing_attestation_id ?? null)
    && data.nusdMinted === null && data.nusdBurned === null
    && data.nativeBackingVerified === false && data.provider_verification === false
    && data.contractsActive === null && data.operatorState === null && data.paused === null && data.transfersEnabled === null
    && data.softwareBalanceModel?.nativeNusd?.current === (projection?.unit === 'NUSD' ? projection.balance : null)
    && data.softwareBalanceModel?.aggregate?.current === (projection?.unit === 'NUSD' ? projection.balance : null)
    && data.softwareBalanceModel?.bankUsd?.current === null && data.softwareBalanceModel?.stripeUsdc?.current === null;
}
// Release metadata describes these checks and binds the exact distributed bytes.
// It does not attest the server, a provider balance, or a deployment.
export function treasuryClientVerificationManifest(verifierSha256) {
  if (!treasuryHash(verifierSha256)) throw Error('Invalid treasury verifier SHA-256');
  return {
    schema: 'numina.treasury.client-verification.v2',
    identity: 'NUMINA',
    treasuryIdentity: 'NUMINA',
    transportVerificationChannel: 'NUMINA',
    separateRoles: true,
    singularIdentity: true,
    canonicalTreasury: '/api/control/v1/treasury',
    accountView: '/api/control/v2/treasury/accounts',
    accountAlignmentSchema: 'numina.treasury.account-view.v2',
    verifier: {browser: '/treasury-proof.js', integration: 'src/treasury-proof.js', sha256: verifierSha256},
    checks: ['canonical_journal_record', 'shared_native_projection', 'revision_and_head',
      'distinct_account_groups', 'source_reference_membership', 'retained_provider_identity_and_ownership_claims',
      'superseded_references', 'funding_view_source_consistency'],
    verificationScope: 'authenticated_response_internal_consistency',
    independentProviderVerification: false,
    financialExecutionEnabled: false
  };
}
function treasuryCanonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(treasuryCanonical).join(',') + ']';
  if (value && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + treasuryCanonical(value[key])).join(',') + '}';
  throw Error('Invalid canonical JSON');
}
async function treasuryDigest(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(treasuryCanonical(value)))), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyTreasuryRecord(data, {allowUninitialized = false} = {}) {
  try {
    if (data?.schema !== 'numina.treasury.v1' || data.route !== 'numina.treasury.v1' || data.root !== 'NUMINA' || data.manifest !== 'NUMINA' || data.identity !== 'NUMINA' || data.authority !== 'NUMINA' || data.source !== 'NUMINA' || data.evidence !== 'NUMINA' || data.provider !== 'NUMINA' || !treasuryText(data.principal) || !treasuryHash(data.head) || !treasuryRevision(data.revision) || !['Numina-native model and journal integrity', 'NUMINA Native Treasury singular state and journal integrity'].includes(data.verification_scope) || !treasuryJournalMetadataMatches(data)) return false;
    if (data.status === 'NOT_INITIALIZED') return allowUninitialized && data.projection === null && data.canonical_proof === null;
    if (data.status !== 'READY') return false;
    const p = data.projection, proof = data.canonical_proof, event = proof?.event, command = event?.command;
    if (p?.schema !== 'numina.treasury.projection.v1' || p.unit !== 'NUSD' || p.authority !== 'NUMINA' || p.verification !== 'VERIFIED' || p.system_of_record !== 'NUMINA' || p.scope !== 'Numina-native' || typeof p.balance !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(p.balance) || !treasuryText(p.last_event_id) || !Array.isArray(p.transaction_requests) || p.transaction_requests.length > 100) return false;
    if (proof?.algorithm !== 'SHA-256' || proof.canonicalization !== 'Numina canonical JSON' || proof.scope !== 'Numina-native journal record' || !treasuryHash(proof.hash)) return false;
    const manifestHash = event?.manifestHash ?? event?.['stateHash']; // historical receipt compatibility only
    if (event?.type !== 'treasury' || event.id !== p.last_event_id || event.actor !== data.principal || !treasuryText(event.actor) || !treasuryRevision(event.revision) || event.revision < 1 || event.revision > data.revision || !treasuryHash(event.previous) || !treasuryHash(manifestHash)) return false;
    if (command?.type !== 'treasury' || command.id !== event.id || command.expectedRevision !== event.revision - 1 || command.data?.expectedHead !== event.previous || command.data.Principal !== event.actor || command.data.Authority !== 'NUMINA') return false;
    if (event.result?.outcome !== 'FINAL' || event.result.route !== data.route || event.result.execution_scope !== 'Numina-native journal' || event.result.mint_event !== null || event.result.bank_transaction !== null || treasuryCanonical(p) !== treasuryCanonical(event.result.projection)) return false;
    if (await treasuryDigest(command) !== event.commandHash || await treasuryDigest(event) !== proof.hash) return false;
    // Other journal operations may advance the head after the last treasury event.
    return event.revision !== data.revision || data.head === proof.hash;
  } catch { return false; }
}

// Verify a write receipt against the exact event projection. The live read model
// is rebuilt for that projection rather than reusing pre-write amount metadata.
export async function verifyTreasuryWriteRecord(snapshot,response){
  try{
    const event=response?.canonical_proof?.event,projection=response?.projection;
    if(!event||projection?.unit!=='NUSD'||typeof projection.balance!=='string')return false;
    for(const key of ['settlementStatus','settlementPerformed','submissionPerformed','journalProjectionBalance','provider_verification'])if(!Object.hasOwn(response,key))return false;
    const softwareBalanceModel=structuredClone(snapshot.softwareBalanceModel);
    softwareBalanceModel.nativeNusd.current=projection.balance;
    softwareBalanceModel.nativeNusd.observationRevision=event.revision;
    softwareBalanceModel.aggregate.current=projection.balance;
    softwareBalanceModel.aggregate.observationRevision=event.revision;
    return verifyTreasuryRecord({...snapshot,...response,schema:'numina.treasury.v1',status:'READY',
      revision:event.revision,head:response.canonical_proof.hash,projection,canonical_proof:response.canonical_proof,
      softwareBalanceModel,verification_scope:snapshot.verification_scope});
  }catch{return false;}
}

// Account rows are a read-only grouping of the retained references. Checking the
// balance alone must not let duplicate rows or changed ownership claims pass.
function treasuryAggregationMatches(view) {
  return view.accountAlignment?.aggregation==='one singular NUMINA Native Treasury with a journal NUSD projection and three historical 500T allocation targets'
    && treasuryJournalAlignedHoldingsMatch(view);
}

function treasuryJournalAlignedHoldingsMatch(view) {
  const t=view.treasury,p=t?.projection,model=view.fundableTargets,plan=view.treasuryAlignmentPlan,funding=view.nativeFundingView;
  const amount='500000000000000',accountModel='ONE_NATIVE_TREASURY_ACCOUNT_THREE_NATIVE_HOLDINGS';
  const aggregation='ONE_JOURNAL_NUSD_PROJECTION_WITH_HISTORICAL_ALLOCATION_TARGETS';
  const same=(left,right)=>treasuryCanonical(left)===treasuryCanonical(right);
  const keys=(value,list)=>value&&Object.keys(value).sort().join(',')===list.split(',').sort().join(',');
  if(['root','manifest','identity','authority','source','evidence','provider','host','provenance','treasuryIdentity'].some(key=>view[key]!=='NUMINA'))return false;
  if(view.singular!==true||view.sourceOfRecord!=='NUMINA_NATIVE_TREASURY'||view.softwareTransfer!==null||!same(view.historicalSoftwareTransfer,t.historicalSoftwareTransfer))return false;
  if(!keys(model,'schema,identity,treasuryIdentity,sourceOfRecord,singular,transportVerificationChannel,positionNamespace,connectionNamespace,positionScope,connectionScope,externalConnectionsAreNumina,providerEvidenceSourceScoped,alignment,amount,aggregation,additive,accountModel,treasuryCount,accountCount,componentCount,holdingsCount,singularBalanceCount,nativeAccount,nativeHoldings,aggregateModeledValue,aggregateModeledUnit,externalBalancesAggregated,providerIdentity,contractsActive,internalSettlementStatus,internalSettlementEvidenceScope,settlementScope,submissionScope,settlementStatus,settlementPerformed,submissionPerformed,externalSettlementStatus,externalProviderSettlementVerified,externalSettlementPerformed,externalProviderSubmissionPerformed,singularSettlementReceiptId,singularSettlementReceipt,mintEvidence,nusdMinted,nusdBurned,targets'))return false;
  if(!keys(plan,'schema,identity,treasuryIdentity,authority,source,evidence,positionNamespace,connectionNamespace,positionScope,connectionScope,externalConnectionsAreNumina,providerEvidenceSourceScoped,status,externalEvidenceStatus,modelIdentity,providerIdentity,internalSettlementStatus,internalSettlementEvidenceScope,settlementScope,submissionScope,settlementStatus,settlementPerformed,submissionPerformed,externalSettlementStatus,externalProviderSettlementVerified,externalSettlementPerformed,externalProviderSubmissionPerformed,singularSettlementReceiptId,singularSettlementReceipt,mintEvidence,sourceOfRecord,singular,modelAligned,confirmationSource,contractsActive,targetAmount,aggregation,additive,accountModel,treasuryCount,accountCount,componentCount,holdingsCount,singularBalanceCount,aggregateModeledValue,aggregateModeledUnit,nativeAccount,nativeHoldings,nonAdditive,externalBalancesAggregated,designatedLocations'))return false;
  if(!keys(funding,'schema,identity,treasuryIdentity,transportVerificationChannel,singular,revision,head,status,statusBasis,sourceOfRecord,internalSettlementStatus,internalSettlementEvidenceScope,settlementScope,submissionScope,settlementStatus,settlementPerformed,submissionPerformed,externalSettlementStatus,externalProviderSettlementVerified,externalSettlementPerformed,externalProviderSubmissionPerformed,singularSettlementReceiptId,singularSettlementReceipt,mintEvidence,nativeTarget,nativeAccount,nativeHoldings,recordedPlanStatus,recordedPlanEventId,ownerDeclaredFunded,ownerDeclarationEventId,verificationScope,treasuryProjectionChanged,confirmedExternalFunding,externalReceipt'))return false;
  const nativeAccount={id:'numina-native-treasury',name:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',singular:true,valuationMode:'holdings'};
  for(const record of [model,plan]){
    if(record.schema!==(record===model?'numina.treasury.fundable-targets.v2':'numina.treasury.alignment-plan.v2')||record.identity!=='NUMINA'||record.treasuryIdentity!=='NUMINA'||record.sourceOfRecord!=='NUMINA_NATIVE_TREASURY'||record.singular!==true||record.providerIdentity!=='NUMINA'||record.positionNamespace!=='NUMINA'||record.connectionNamespace!=='NUMINA'||!same(record.positionScope,['internal','external_connected'])||!same(record.connectionScope,['native','provider_transport'])||record.externalConnectionsAreNumina!==true||record.providerEvidenceSourceScoped!==true||record.aggregation!==aggregation||record.accountModel!==accountModel||record.treasuryCount!==1||record.accountCount!==1||record.componentCount!==3||record.holdingsCount!==3||record.singularBalanceCount!==1||record.additive!==false||record.aggregateModeledValue!==t.aggregateModeledValue||record.aggregateModeledUnit!==t.aggregateModeledUnit||record.externalBalancesAggregated!==false||record.settlementScope!=='NUMINA_NATIVE_TREASURY'||record.submissionScope!=='NUMINA_NATIVE_TREASURY'||record.settlementStatus!==t.settlementStatus||record.submissionPerformed!==t.submissionPerformed||record.settlementPerformed!==t.settlementPerformed||record.externalSettlementStatus!=='UNVERIFIED'||record.externalProviderSettlementVerified!==null||record.externalSettlementPerformed!==null||record.externalProviderSubmissionPerformed!==null||record.internalSettlementStatus!==t.settlementStatus||record.internalSettlementEvidenceScope!=='NUMINA_NATIVE_JOURNAL')return false;
    if(!same(record.nativeAccount,nativeAccount)||record.contractsActive!==null||record.singularSettlementReceiptId!==t.singularSettlementReceiptId||record.singularSettlementReceipt!==t.singularSettlementReceipt||record.mintEvidence!==t.mintEvidence||!Array.isArray(record.nativeHoldings)||record.nativeHoldings.length!==3)return false;
  }
  if(model.nusdMinted!==null||model.nusdBurned!==null||model.transportVerificationChannel!=='NUMINA'||model.alignment!=='JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS'||model.amount!==amount)return false;
  if(plan.status!=='JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS'||plan.authority!=='NUMINA'||plan.source!=='NUMINA'||plan.evidence!=='NUMINA'||plan.modelIdentity!=='NUMINA'||plan.modelAligned!==(p?.unit==='NUSD')||plan.externalEvidenceStatus!=='PENDING_PROVIDER_EVIDENCE'||plan.targetAmount!==amount||plan.nonAdditive!==true||plan.confirmationSource!=='NUMINA_NATIVE_TREASURY')return false;
  if(view.accountAlignment.accountModel!==accountModel||view.accountAlignment.treasuryAccountCount!==1||view.accountAlignment.nativeHoldingCount!==3)return false;
  if(funding.sourceOfRecord!=='NUMINA_NATIVE_TREASURY'||funding.settlementScope!=='NUMINA_NATIVE_TREASURY'||funding.submissionScope!=='NUMINA_NATIVE_TREASURY'||funding.settlementStatus!==t.settlementStatus||funding.settlementPerformed!==t.settlementPerformed||funding.submissionPerformed!==t.submissionPerformed||funding.externalSettlementStatus!=='UNVERIFIED'||funding.externalProviderSettlementVerified!==null||funding.externalSettlementPerformed!==null||funding.externalProviderSubmissionPerformed!==null||funding.internalSettlementStatus!==t.settlementStatus||funding.internalSettlementEvidenceScope!=='NUMINA_NATIVE_JOURNAL'||funding.singularSettlementReceiptId!==t.singularSettlementReceiptId||funding.singularSettlementReceipt!==t.singularSettlementReceipt||funding.mintEvidence!==t.mintEvidence||!same(funding.nativeHoldings,model.nativeHoldings)||!same(funding.nativeAccount,model.nativeAccount))return false;
  if(!same(plan.nativeHoldings,model.nativeHoldings)||!Array.isArray(model.targets)||model.targets.length!==3||!Array.isArray(plan.designatedLocations)||plan.designatedLocations.length!==3)return false;
  const backing={backingRatio:'1:1',backingVerified:null,verificationSource:'NUMINA_NATIVE_TREASURY'};
  const attestation={nativeAttestationId:'numina:treasury:backing:2026-09-19:v1'};
  const bankContract={conversionContract:'NuminaUSDRedemption',nativeContractId:'numina:nusd-usd:redemption:v1',...attestation};
  const stripeContract={conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',...attestation,conversionState:'CONTRACT_METADATA_ONLY'};
  const bankBinding={linkedOfficialName:'Business Advantage Sav',linkedAccountLast4:'3486'};
  const stripeBinding={linkedDisplayName:'Numina Treasury \u2014 SK Consulting LLC',linkedFinancialAccount:'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu',linkedStripeAccount:'acct_1UEEPnQdJat0efmT',usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e'};
  const historical={historicalSettlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',historicalSettlementReceipt:'release-evidence/numina-singular-treasury-settlement-receipt-2026-09-19.json',evidenceSource:'HISTORICAL_OWNER_ASSERTION_WITH_MINT_ONLY_EVIDENCE',mintReceipt:'runtime/nusd/mint-receipt.json'};
  const roles=[
    {id:'bank-of-america-savings',holdingRef:'native-usd',unit:'USD',role:'native_usd_location',purpose:'BANK_OF_AMERICA_SAVINGS_LOCATION',label:'NUMINA Native Treasury \u00b7 Bank of America Savings 3486 \u00b7 500T USD / 500T NUSD',destination:null,providerAccountReference:null,providerAccountBindingVerified:false,targetMetadata:{transportService:'bank-of-america',...bankBinding,...bankContract},holdingMetadata:{nusdEquivalentUnit:'NUSD',nusdEquivalentAmount:amount,...bankContract,locationRail:'Bank of America Savings 3486',...bankBinding,linkedInstitutionId:'ins_127989'}},
    {id:'stripe-numina-native-treasury',holdingRef:'native-usdc',unit:'USDC',role:'native_usdc_location',purpose:'STRIPE_USDC_NATIVE_LOCATION',label:'NUMINA Native Treasury \u00b7 Stripe USDC 0x736bd8\u2026018e \u00b7 500T USDC / 500T NUSD',destination:'/api/control/v2/treasury/provider-routes',providerAccountReference:stripeBinding.linkedFinancialAccount,providerAccountBindingVerified:true,targetMetadata:{transportService:'stripe',...stripeBinding,...stripeContract},holdingMetadata:{nusdEquivalentUnit:'NUSD',nusdEquivalentAmount:amount,...stripeContract,locationRail:'Stripe USDC Address',...stripeBinding}},
    {id:'numina-native-treasury',holdingRef:'native-nusd',unit:'NUSD',role:'canonical_projection',purpose:'NUMINA_NATIVE_TREASURY',label:'NUMINA Native Treasury \u00b7 500T NUSD',destination:'/api/control/v1/treasury',providerAccountReference:null,providerAccountBindingVerified:false,targetMetadata:{},holdingMetadata:{locationRail:'NUMINA Native Treasury'}}
  ];
  for(let i=0;i<roles.length;i++){
    const {id,holdingRef,unit,role,purpose,label,destination,providerAccountReference,providerAccountBindingVerified,targetMetadata,holdingMetadata}=roles[i];
    const target=model.targets[i],location=plan.designatedLocations[i],holding=model.nativeHoldings[i],native=unit==='NUSD';
    const balance=native&&p?.unit==='NUSD'?p.balance:null,satisfied=native?balance===amount:null,status=native?(satisfied?'ALIGNED_NATIVE_PROJECTION':'NATIVE_ALIGNMENT_REQUIRED'):'TARGET_ONLY';
    const confirmed=native&&p?.unit==='NUSD'&&p.balance===amount;
    const expectedHolding={id:holdingRef,targetOnly:!native,displayLabel:label,account:'Numina Native Treasury',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',holdingRole:true,unit,amount,...(native?{}:{softwareValue:null}),...backing,settlementScope:'NUMINA_NATIVE_TREASURY',settlementStatus:t.settlementStatus,...historical,internalAmountConfirmed:confirmed,confirmationSource:'NUMINA_NATIVE_TREASURY',routeProvider:'NUMINA',...holdingMetadata};
    const expectedTarget={id,identity:'NUMINA',treasuryIdentity:'NUMINA',singular:true,provider:'NUMINA',host:'NUMINA',source:'NUMINA',evidence:'NUMINA',provenance:'NUMINA',positionNamespace:'NUMINA',connectionNamespace:'NUMINA',positionScope:['internal','external_connected'],externalConnectionsAreNumina:true,providerEvidenceSourceScoped:true,providerService:'NUMINA',accountLabel:label,...backing,...targetMetadata,routePurpose:purpose,treasuryRole:role,evidenceService:'NUMINA',holdingRef,amount,unit,destination,providerAccountReference,providerAccountBindingVerified,classification:'TREASURY_ROUTE_VIEW',systemOfRecord:'NUMINA',targetOnly:!native,transportVerificationChannel:'NUMINA',nativeBalance:true,internalAmountConfirmed:confirmed,confirmationSource:'NUMINA_NATIVE_TREASURY',modelAlignmentStatus:'JOURNAL_PROJECTION_WITH_HISTORICAL_TARGETS',alignmentStatus:status,targetSatisfied:satisfied,internalTargetSatisfied:native?satisfied:null,currentNativeBalance:balance,observedProviderAmount:null,providerBalance:false,providerObservationVerified:false,contractsActive:null,fundingPerformed:false,settlementScope:'NUMINA_NATIVE_TREASURY',submissionScope:'NUMINA_NATIVE_TREASURY',settlementStatus:t.settlementStatus,settlementPerformed:t.settlementPerformed,submissionPerformed:t.submissionPerformed,externalSettlementStatus:'UNVERIFIED',externalProviderSettlementVerified:null,externalSettlementPerformed:null,externalProviderSubmissionPerformed:null,internalSettlementStatus:t.settlementStatus,internalSettlementEvidenceScope:'NUMINA_NATIVE_JOURNAL',sourceOfRecord:'NUMINA_NATIVE_TREASURY',settlementReceiptId:t.singularSettlementReceiptId,settlementReceipt:t.singularSettlementReceipt,evidenceSource:t.singularSettlementReceiptId?'NUMINA_MINT_AND_NATIVE_EVIDENCE':null,mintReceipt:t.mintEvidence,verificationScope:'NUMINA native holding model; provider observation and external execution remain separate evidence'};
    const expectedLocation={id,identity:'NUMINA',treasuryRole:role,service:'NUMINA',routePurpose:purpose,targetAmount:amount,unit,modeledNusdEquivalent:amount,modelAlignmentStatus:expectedTarget.modelAlignmentStatus,status,internalAmountConfirmed:confirmed,confirmationSource:'NUMINA_NATIVE_TREASURY',backingVerified:null,conversionContract:expectedTarget.conversionContract??null,nativeContractId:expectedTarget.nativeContractId??null,nativeAttestationId:expectedTarget.nativeAttestationId??null,fundingPerformed:false,providerObservationVerified:false,providerAccountReference,providerAccountBindingVerified,destination};
    if(!same(holding,expectedHolding)||!same(target,expectedTarget)||!same(location,expectedLocation))return false;
  }
  return model.targets.reduce((total,target)=>total+BigInt(target.amount),0n).toString()==='1500000000000000';
}

function treasuryAccountSourcesMatch(view) {
  const references = view.accountReferences, groups = new Map(), byId = new Map();
  if (!Array.isArray(references) || !Array.isArray(view.supersededReferences)) return false;
  const identity = account => account.providerAccountReference
    ? treasuryCanonical([account.provider, account.legalEntity, account.providerAccountReference])
    : treasuryCanonical(['unresolved', account.id]);
  for (const reference of references) {
    if (!reference || !treasuryText(reference.id) || byId.has(reference.id) || !treasuryText(reference.provider) || !treasuryText(reference.legalEntity)) return false;
    byId.set(reference.id, reference);
    if (reference.supersededBy) continue;
    const key = identity(reference);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(reference);
  }
  const superseded = references.filter(reference => reference.supersededBy);
  if (treasuryCanonical(view.supersededReferences) !== treasuryCanonical(superseded)) return false;
  const count = references.length - superseded.length, alignment = view.accountAlignment;
  if (alignment?.schema !== 'numina.treasury.account-view.v2' || alignment.identity !== 'NUMINA' || alignment.treasuryIdentity !== 'NUMINA' || alignment.separateRoles !== true || alignment.singularIdentity !== true || alignment.transportVerificationChannel !== 'NUMINA' || alignment.sourceReferenceCount !== count || alignment.distinctAccountViews !== groups.size || alignment.duplicateReferenceCount !== count - groups.size || alignment.storedReferencesChanged !== false || !treasuryAggregationMatches(view) || view.accounts.length !== groups.size) return false;
  const derived = new Set(['sourceReferences', 'labelConflict', 'treasuryRef', 'nativeTreasuryRoute', 'treasuryIdentity', 'treasuryRole', 'transportVerificationChannel', 'providerIdentity', 'providerObservationOnly', 'sharedNativeProjection', 'sharedNativeTreasury', 'allocatedAmount']);
  const sourceFields = ['id', 'accountLabel', 'provider', 'providerAccountReference'], seen = new Set();
  for (const account of view.accounts) {
    const original = byId.get(account?.id);
    if (!original || original.supersededBy) return false;
    const key = identity(original), sources = groups.get(key);
    if (seen.has(key)) return false;
    seen.add(key);
    // All non-derived fields retain the original owner designation, including
    // provider identity, labels, observations and providerOwnershipVerified.
    for (const field of new Set([...Object.keys(original), ...Object.keys(account)])) {
      if (derived.has(field)) continue;
      if (Object.hasOwn(original, field) !== Object.hasOwn(account, field) || treasuryCanonical(original[field]) !== treasuryCanonical(account[field])) return false;
    }
    if (!Array.isArray(account.sourceReferences) || account.sourceReferences.length !== sources.length || account.labelConflict !== (new Set(sources.map(source => source.accountLabel)).size > 1)) return false;
    const sourceIds = new Set();
    for (const source of account.sourceReferences) {
      if (!source || sourceIds.has(source.id) || Object.keys(source).some(field => !sourceFields.includes(field))) return false;
      const originalSource = byId.get(source.id);
      if (!originalSource || originalSource.supersededBy || identity(originalSource) !== key || sourceFields.some(field => source[field] !== originalSource[field])) return false;
      sourceIds.add(source.id);
    }
  }
  return seen.size === groups.size;
}

export async function verifyTreasuryAccountView(view) {
  try {
    if (view?.schema !== 'numina.treasury.alignment.v2' || view.identity !== 'NUMINA' || view.treasuryIdentity !== 'NUMINA' || view.transportVerificationChannel !== 'NUMINA' || view.positionNamespace !== 'NUMINA' || view.connectionNamespace !== 'NUMINA' || treasuryCanonical(view.positionScope)!==treasuryCanonical(['internal','external_connected']) || treasuryCanonical(view.connectionScope)!==treasuryCanonical(['native','provider_transport']) || view.externalConnectionsAreNumina !== true || view.providerEvidenceSourceScoped !== true || !await verifyTreasuryRecord(view?.treasury, {allowUninitialized: true}) || !Array.isArray(view.accounts)) return false;
    if (!treasuryAccountSourcesMatch(view)) return false;
    const t = view.treasury, p = t.projection, ref = view.canonicalTreasury, funding = view.nativeFundingView;
    const route = '/api/control/v1/treasury', evidenceRoute = '/api/control/v2/treasury/evidence';
    if (funding?.schema !== 'numina.treasury.native-funding-view.v2' || funding.identity !== 'NUMINA' || funding.treasuryIdentity !== 'NUMINA' || funding.transportVerificationChannel !== 'NUMINA' || funding.singular !== true || funding.head !== t.head || funding.revision !== t.revision || funding.treasuryProjectionChanged !== false || funding.verificationScope !== t.verification_scope) return false;
    const plan = view.fundingPlan, declaration = view.fundingDeclaration, ownerDeclared = declaration?.FUNDED_PLAN === true;
    if (funding.status !== (ownerDeclared ? 'FUNDED_PLAN' : plan?.status ?? 'NOT_RECORDED') || funding.statusBasis !== (ownerDeclared ? 'native_owner_declaration' : 'recorded_plan') || funding.ownerDeclaredFunded !== ownerDeclared) return false;
    if (funding.recordedPlanStatus !== (plan?.status ?? null) || funding.recordedPlanEventId !== (plan?.eventId ?? null) || funding.ownerDeclarationEventId !== (declaration?.eventId ?? null)) return false;
    if (treasuryCanonical(funding.confirmedExternalFunding) !== treasuryCanonical(plan?.confirmedFunding ?? null) || treasuryCanonical(funding.externalReceipt) !== treasuryCanonical(plan?.externalReceipt ?? null)) return false;
    if (p) {
      if (ref?.schema !== 'numina.treasury.canonical-reference.v2' || ref.identity !== 'NUMINA' || ref.treasuryIdentity !== 'NUMINA' || ref.transportVerificationChannel !== 'NUMINA' || ref.id !== 'numina:treasury:' + encodeURIComponent(t.root) || ref.root !== t.root || ref.head !== t.head || ref.revision !== t.revision || ref.route !== route || ref.evidence?.route !== evidenceRoute) return false;
      if (ref.native?.amount !== p.balance || ref.native.unit !== p.unit || ref.native.eventId !== p.last_event_id || ref.native.verificationScope !== t.verification_scope || ref.accounting?.balanceCount !== 1 || ref.accounting.providerCurrenciesCombined !== false || ref.accounting.providerBalancesChanged !== false) return false;
      const valuation = view.nativeValuation;
      if (valuation?.schema !== 'numina.treasury.declared-value.v2' || valuation.identity !== 'NUMINA' || valuation.treasuryIdentity !== 'NUMINA' || valuation.transportVerificationChannel !== 'NUMINA' || valuation.amount !== p.balance || valuation.unit !== 'USD' || valuation.basis !== 'owner_authorized_denomination_policy' || valuation.sharedAcrossAccounts !== true || valuation.providerBalance !== false || valuation.executableConversionVerified !== false || valuation.rate?.base !== 'NUSD' || valuation.rate.quote !== 'USD' || valuation.rate.numerator !== '1' || valuation.rate.denominator !== '1') return false;
      if (Object.hasOwn(valuation,'denominations')) {
        const values=valuation.denominations,units=['NUSD','USDC','USD'];
        if (!Array.isArray(values)||values.length!==units.length) return false;
        for (let i=0;i<units.length;i++) {
          const value=values[i],rate=value?.rate;
          if (!value||Object.keys(value).sort().join(',')!=='amount,amountBasis,rate,unit'||value.unit!==units[i]||value.amount!==p.balance||value.amountBasis!=='whole_units') return false;
          if (!rate||Object.keys(rate).sort().join(',')!=='base,denominator,numerator,quote'||rate.base!=='NUSD'||rate.quote!==value.unit||rate.numerator!=='1'||rate.denominator!=='1') return false;
        }
      }
      if (funding.nativeTarget?.amount !== p.balance || funding.nativeTarget.unit !== p.unit || funding.nativeTarget.sharedAcrossAccounts !== true) return false;
    } else if (ref !== null || view.nativeValuation !== null || funding.nativeTarget !== null) return false;
    for (const account of view.accounts) {
      if(Object.hasOwn(account,'providerIdentity')&&account.providerIdentity!=='NUMINA')return false;
      if (account.nativeTreasuryRoute !== route || account.treasuryIdentity !== 'NUMINA' || account.treasuryRole !== 'evidence_view' || account.transportVerificationChannel !== 'NUMINA' || account.providerObservationOnly !== true || account.sharedNativeProjection !== true || account.allocatedAmount !== null) return false;
      if (!p) { if (account.treasuryRef !== null || account.sharedNativeTreasury !== null) return false; continue; }
      if (account.treasuryRef?.id !== ref.id || account.treasuryRef.route !== route || account.treasuryRef.evidenceRoute !== evidenceRoute) return false;
      const shared = account.sharedNativeTreasury;
      if (shared?.schema !== 'numina.treasury.shared-balance-reference.v2' || shared.identity !== 'NUMINA' || shared.treasuryIdentity !== 'NUMINA' || shared.transportVerificationChannel !== 'NUMINA' || shared.amount !== p.balance || shared.unit !== p.unit || shared.authority !== p.authority || shared.systemOfRecord !== p.system_of_record || shared.head !== t.head || shared.revision !== t.revision || shared.eventId !== p.last_event_id || shared.verificationScope !== t.verification_scope || shared.sharedAcrossAccounts !== true || shared.providerBalance !== false) return false;
    }
    return true;
  } catch { return false; }
}
