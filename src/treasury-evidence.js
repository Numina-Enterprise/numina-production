import {controlHash,controlError} from './control.js';
import {readControl} from './control-store.js';
import {createNuminaTreasury} from './native-treasury.js';
import {readStripeTreasury,STRIPE_TREASURY_FINANCIAL_ACCOUNT,TREASURY_PROVIDER_ROUTES} from './stripe-treasury.js';
import {treasuryDocumentHttp} from './treasury-documents.js';
import {frontierState,frontierSign} from './frontier.js';
import {canonicalTreasuryReference} from './treasury-alignment.js';
import {NUMINA_TREASURY_CONNECTION} from '../public/treasury-connection-model.js';
import {isTreasuryMinorInteger} from '../public/treasury-amount.js';

export const TREASURY_EVIDENCE_ROUTE='/api/control/v2/treasury/evidence';

function treasuryProviderRecords(observation){
  const record=observation?.record,base='/source/providerObservation/record';
  const authenticated=observation?.status==='OBSERVED'&&observation.authentication==='server_held_stripe_read_credential'
    &&record?.schema==='numina.stripe.treasury.v1'&&record.provider==='Stripe'&&record.connection==='read_only'
    &&record.account?.id===STRIPE_TREASURY_FINANCIAL_ACCOUNT&&record.account.livemode===true
    &&['open','closed'].includes(record.account.status)&&Array.isArray(record.reported_currencies);
  const currencies={};
  for(const currency of ['usd','usdc','nusd']){
    const native=currency==='nusd',reported=authenticated&&record.reported_currencies?.includes(currency)===true;
    const status=!authenticated?'UNAVAILABLE':!reported?'NOT_REPORTED':native?'ASSET_NOT_VERIFIED':'AUTHENTICATED_OBSERVATION';
    const balances={};
    for(const bucket of ['available','inbound_pending','outbound_pending']){
      const amount=native?record?.provider_nusd_balance?.buckets?.[bucket]:record?.balances?.[bucket]?.[currency];
      const present=amount!==null&&amount!==undefined;
      const valid=present&&amount.currency===currency&&isTreasuryMinorInteger(amount.value);
      balances[bucket]={source:authenticated&&(native?present:true)?`${base}/${native?'provider_nusd_balance/buckets/'+bucket:'balances/'+bucket+'/'+currency}`:null,
        verification:{status:!authenticated?'UNAVAILABLE':!present?'NOT_REPORTED':!valid||!reported?'NOT_VERIFIED':native?'ASSET_NOT_VERIFIED':'AUTHENTICATED_OBSERVATION',
          scope:native?'Provider-reported units; token identity and precision are not verified':'Provider-reported amount in its original currency and balance bucket'}};
    }
    currencies[currency]={source:authenticated?`${base}/${native?'provider_nusd_balance':'reported_currencies'}`:null,precision:native?null:currency==='usd'?2:6,
      verification:{status,scope:native?'Provider currency label; no verified link to the Numina-native asset':'Provider-reported currency code'},balances};
  }
  // References only: amounts remain in the captured provider source, with no aggregation.
  return {source:'/source/providerObservation',issuer:'Stripe',verification:{status:authenticated?'AUTHENTICATED_OBSERVATION':'UNAVAILABLE',scope:'Provider-reported amounts in their original currencies; no cross-currency aggregation'},currencies};
}

export async function treasuryEvidencePayload({treasury,frontier,providerObservation,supportingDocuments,capturedAt}){
  const source=structuredClone({nativeTreasury:treasury,canonicalTreasury:canonicalTreasuryReference(treasury),ownerDeclaration:frontier.fundingDeclaration??null,
    fundingPlan:frontier.fundingPlan??null,accountReferences:frontier.accounts??[],providerObservation,supportingDocuments});
  const records={schema:'numina.treasury.record-sources.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',singular:true,treasuryCount:1,componentCount:3,componentsAreSeparateTreasuries:false,
      nativeTreasury:{source:'/source/nativeTreasury',issuer:'NUMINA',verification:{status:source.nativeTreasury.status==='READY'&&source.nativeTreasury.projection?.verification==='VERIFIED'?'VERIFIED':'NOT_VERIFIED',scope:'Numina-native model and journal integrity'}},
      providerBalances:treasuryProviderRecords(source.providerObservation),
      bankFunding:{source:'/fundingVerification/bankConfirmation',issuer:null,verification:{status:'BANK_PROVIDER_NOT_CONNECTED',scope:'Bank-issued funding confirmation'}},
      reserveAllocation:{source:null,issuer:null,verification:{status:'NOT_VERIFIED',scope:'Reserve ownership and allocation to this treasury'}},
      redemption:{source:null,issuer:null,verification:{status:'NOT_VERIFIED',scope:'Executable redemption rights and confirmed redemption evidence'}},
      supportingDocuments:{source:'/source/supportingDocuments',issuer:null,verification:{status:source.supportingDocuments?.status==='OBSERVED'?'OWNER_UPLOADED_UNVERIFIED':'UNAVAILABLE',scope:'Stored document metadata; issuer and contents are not verified'}}};
  const canonical=source.canonicalTreasury,native=source.nativeTreasury;
  const canonicalReady=records.nativeTreasury.verification.status==='VERIFIED'&&canonical!==null
    &&Number.isSafeInteger(canonical.revision)&&canonical.revision>=0&&typeof canonical.head==='string'&&/^[a-f0-9]{64}$/.test(canonical.head);
  const treasuryRef=canonicalReady?{id:canonical.id,source:'/source/canonicalTreasury',nativeUnit:canonical.native.unit,amountSource:'/source/canonicalTreasury/native/amount'}:null;
  // Reconciliation references this captured snapshot; it cannot create an allocation or submit funds.
  const reconciliation={schema:'numina.treasury.reconciliation.v1',status:'NOT_RECONCILED',capturedAt,
    canonicalTreasury:{source:'/source/canonicalTreasury',id:canonicalReady?canonical.id:null,route:'/api/control/v1/treasury',
      revision:native.revision??null,head:native.head??null,status:native.status==='NOT_INITIALIZED'?'NOT_INITIALIZED':canonicalReady?'VERIFIED':'NOT_VERIFIED'},
    records:{nativeTreasury:{source:'/records/nativeTreasury',status:records.nativeTreasury.verification.status,treasuryRef:structuredClone(treasuryRef)},
      stripe:{source:'/records/providerBalances',status:records.providerBalances.verification.status,currencies:structuredClone(records.providerBalances.currencies),treasuryRef:structuredClone(treasuryRef)},
      bank:{source:'/records/bankFunding',status:records.bankFunding.verification.status,treasuryRef:structuredClone(treasuryRef)},
      supportingDocuments:{source:'/records/supportingDocuments',status:records.supportingDocuments.verification.status,complete:source.supportingDocuments?.complete===true,treasuryRef:structuredClone(treasuryRef)}},
    depositReadiness:{status:'NOT_READY',submissionPerformed:false,receipt:null,externalSubmissionImplemented:false,
      requiredEvidence:[
        {id:'funding_source',status:'NOT_VERIFIED',description:'Authenticated available source funds identifying the account, asset and exact amount'},
        {id:'reserve_allocation',status:records.reserveAllocation.verification.status,source:'/records/reserveAllocation',description:'Verified ownership, eligibility and exclusive allocation to this treasury'},
        {id:'provider_acceptance',status:'NOT_VERIFIED',observationRoute:TREASURY_PROVIDER_ROUTES,description:'Provider acceptance of the source asset, network and destination; read current provider routes separately'}],
      settlementEvidence:{status:'NOT_VERIFIED',requiredAfter:'submission',description:'Provider-issued settlement evidence is required to confirm completion after submission'}}};
  return {schema:'numina.treasury.evidence-snapshot.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',singular:true,treasuryCount:1,componentCount:3,balanceCount:1,componentsAreSeparateTreasuries:false,aggregateModeledValue:NUMINA_TREASURY_CONNECTION.aggregateModeledValue,aggregateModeledUnit:NUMINA_TREASURY_CONNECTION.aggregateModeledUnit,scope:'One singular NUMINA treasury: native journal integrity plus role-scoped supporting observations',
    issuer:'NUMINA',root:native.root,revision:native.revision,head:native.head,capturedAt,
    evidenceHash:await controlHash(source),source,records,reconciliation,
    fundingVerification:{actual_funding:false,status:'NOT_VERIFIED',
      bankConfirmation:{status:'BANK_PROVIDER_NOT_CONNECTED',verified:false,bankIssuedReceipt:null},
      ownerDeclaredFunded:source.ownerDeclaration?.FUNDED_PLAN===true,
      allocatedReservesVerified:false,redemptionVerified:false,settlementVerified:false,
      requiredEvidence:'Authenticated settled funding evidence identifying the account, asset, amount and allocation to this treasury'},
    receiptScope:'Numina signs its observation snapshot. The signature does not authenticate a bank issuer or establish funding.',
    effects:{journalChanged:false,providerBalancesChanged:false,fundsCreated:false,recordsRevoked:false}};
}

export async function readTreasuryEvidence(env,actor){
  const before=await readControl(env.DB);
  if(before.manifest.root!==env.NUMINA_CONTROL_OWNER)controlError('ROOT_CONFIGURATION_MISMATCH',503);
  if(actor!==before.manifest.root)controlError('OWNER_REQUIRED',403);
  const treasury=await createNuminaTreasury({db:env.DB,principal:actor,root:before.manifest.root}).readTreasury();
  if(treasury.revision!==before.revision||treasury.head!==before.head_hash)controlError('TREASURY_SNAPSHOT_CHANGED',409);
  // Check signing configuration before requesting any external observation.
  await frontierSign({scope:'configuration-check'},env);
  const [provider,documents]=await Promise.allSettled([
    readStripeTreasury(env),
    treasuryDocumentHttp(new Request('https://numinalabs.xyz/api/control/v1/treasury-documents'),env,actor).then(async response=>{
      if(!response.ok)controlError('DOCUMENT_RECORD_UNAVAILABLE',503);
      return response.json();
    })
  ]);
  const after=await readControl(env.DB);
  if(after.revision!==before.revision||after.head_hash!==before.head_hash)controlError('TREASURY_SNAPSHOT_CHANGED',409);
  const providerObservation=provider.status==='fulfilled'?{status:'OBSERVED',authentication:'server_held_stripe_read_credential',record:provider.value}:{status:'UNAVAILABLE',record:null};
  const supportingDocuments=documents.status==='fulfilled'?{status:'OBSERVED',record:documents.value,complete:documents.value.next_cursor===null}:{status:'UNAVAILABLE',record:null,complete:false};
  const payload=await treasuryEvidencePayload({treasury,frontier:frontierState(before.manifest),providerObservation,supportingDocuments,capturedAt:new Date().toISOString()});
  return frontierSign(payload,env);
}
