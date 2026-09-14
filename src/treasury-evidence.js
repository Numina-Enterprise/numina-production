import {controlHash,controlError} from './control.js';
import {readControl} from './control-store.js';
import {createNuminaTreasury} from './native-treasury.js';
import {readStripeTreasury} from './stripe-treasury.js';
import {treasuryDocumentHttp} from './treasury-documents.js';
import {frontierState,frontierSign} from './frontier.js';
import {canonicalTreasuryReference} from './treasury-alignment.js';

export const TREASURY_EVIDENCE_ROUTE='/api/control/v2/treasury/evidence';

export async function treasuryEvidencePayload({treasury,frontier,providerObservation,supportingDocuments,capturedAt}){
  const source=structuredClone({nativeTreasury:treasury,canonicalTreasury:canonicalTreasuryReference(treasury),ownerDeclaration:frontier.fundingDeclaration??null,
    fundingPlan:frontier.fundingPlan??null,accountReferences:frontier.accounts??[],providerObservation,supportingDocuments});
  return {schema:'numina.treasury.evidence-snapshot.v1',scope:'Numina-native journal integrity and server-observed supporting records',
    issuer:'NUMINA',root:treasury.root,revision:treasury.revision,head:treasury.head,capturedAt,
    evidenceHash:await controlHash(source),source,
    records:{schema:'numina.treasury.record-sources.v1',
      nativeTreasury:{source:'/source/nativeTreasury',issuer:'NUMINA',verification:{status:treasury.status==='READY'&&treasury.projection?.verification==='VERIFIED'?'VERIFIED':'NOT_VERIFIED',scope:'Numina-native model and journal integrity'}},
      providerBalances:{source:'/source/providerObservation',issuer:'Stripe',verification:{status:providerObservation?.status==='OBSERVED'&&providerObservation.authentication==='server_held_stripe_read_credential'?'AUTHENTICATED_OBSERVATION':'UNAVAILABLE',scope:'Provider-reported amounts in their original currencies; no cross-currency aggregation'}},
      bankFunding:{source:'/fundingVerification/bankConfirmation',issuer:null,verification:{status:'BANK_PROVIDER_NOT_CONNECTED',scope:'Bank-issued funding confirmation'}},
      reserveAllocation:{source:null,issuer:null,verification:{status:'NOT_VERIFIED',scope:'Reserve ownership and allocation to this treasury'}},
      redemption:{source:null,issuer:null,verification:{status:'NOT_VERIFIED',scope:'Executable redemption rights and confirmed redemption evidence'}},
      supportingDocuments:{source:'/source/supportingDocuments',issuer:null,verification:{status:supportingDocuments?.status==='OBSERVED'?'OWNER_UPLOADED_UNVERIFIED':'UNAVAILABLE',scope:'Stored document metadata; issuer and contents are not verified'}}},
    fundingVerification:{actual_funding:false,status:'NOT_VERIFIED',
      bankConfirmation:{status:'BANK_PROVIDER_NOT_CONNECTED',verified:false,bankIssuedReceipt:null},
      ownerDeclaredFunded:frontier.fundingDeclaration?.FUNDED_PLAN===true,
      allocatedReservesVerified:false,redemptionVerified:false,settlementVerified:false,
      requiredEvidence:'Authenticated settled funding evidence identifying the account, asset, amount and allocation to this treasury'},
    receiptScope:'Numina signs its observation snapshot. The signature does not authenticate a bank issuer or establish funding.',
    effects:{journalChanged:false,providerBalancesChanged:false,fundsCreated:false,recordsRevoked:false}};
}

export async function readTreasuryEvidence(env,actor){
  const before=await readControl(env.DB);
  if(before.state.root!==env.NUMINA_CONTROL_OWNER)controlError('ROOT_CONFIGURATION_MISMATCH',503);
  if(actor!==before.state.root)controlError('OWNER_REQUIRED',403);
  const treasury=await createNuminaTreasury({db:env.DB,principal:actor,root:before.state.root}).readTreasury();
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
  const payload=await treasuryEvidencePayload({treasury,frontier:frontierState(before.state),providerObservation,supportingDocuments,capturedAt:new Date().toISOString()});
  return frontierSign(payload,env);
}
