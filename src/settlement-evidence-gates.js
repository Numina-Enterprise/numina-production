// SATP-inspired failure containment and draft-morrison-consent-settlement-06
// Sections 6.2/7: committed subject share cannot be cancelled or reduced.
// Offline evidence model ONLY: never sends payments or claims external finality.
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const yes = (condition,reason) => {if(!condition)throw new Error(reason);};
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 1024;
const positive = x => typeof x === 'string' && /^[1-9]\d*$/.test(x);
const validTime = x => typeof x === 'string' && Number.isFinite(Date.parse(x));

function addEvent(state,type,detail,at) {
  yes(validTime(at),'EVENT_TIME_REQUIRED');
  const record={type,detail,at,sequence:state.events.length,
    previousHash:state.journalHead};
  const event={...record,hash:hash(record)};
  return {...state,events:[...state.events,event],journalHead:event.hash};
}
export function createCommittedSubjectShare({id,disclosureId,subjectHandle,asset,
  subjectAmountMinor,totalAmountMinor,at}) {
  yes([id,disclosureId,subjectHandle,asset].every(text) &&
    positive(subjectAmountMinor) && positive(totalAmountMinor) && validTime(at),
    'COMMITMENT_INVALID');
  yes(BigInt(subjectAmountMinor)*2n>BigInt(totalAmountMinor) &&
    BigInt(subjectAmountMinor)<=BigInt(totalAmountMinor),'SUBJECT_MAJORITY_REQUIRED');
  const obligation=Object.freeze({id,disclosureId,subjectHandle,asset,
    subjectAmountMinor,totalAmountMinor,committedAt:at});
  const base={obligation,phase:'COMMITTED_UNSETTLED',
    destination:null,destinationVersion:0,held:false,agingReviewRequired:false,
    attempts:[],finality:null,reconciliation:null,events:[],journalHead:null};
  return addEvent(base,'COMMIT',{obligation},at);
}
// Every transition requires an event and explicit actor. Verification callbacks
// are integration boundaries; their mere presence is not proof of independent
// provider / blockchain confirmation.
export async function transitionCommittedShare(state, action, {
  verifyDestinationAuthorization,verifyIndependentFinality,verifyReconciliation,
}={}) {
  yes(state?.obligation && Array.isArray(state.events) && action &&
    validTime(action.at) && text(action.actor),'INVALID_TRANSITION');
  yes(!['CANCEL','EXPIRE','REDUCE','RELEASE_OBLIGATION'].includes(action.type),
    'IRREVOCABLE_COMMITMENT_CANNOT_CANCEL_OR_REDUCE');
  switch(action.type) {
    case 'DESTINATION': {
      yes(state.phase==='COMMITTED_UNSETTLED' && !state.attempts.length &&
        text(action.destination) && text(action.authorizationRef) &&
        typeof verifyDestinationAuthorization === 'function',
        'DESTINATION_AUTHORIZATION_REQUIRED');
      yes((await verifyDestinationAuthorization({
        obligation:state.obligation,destination:action.destination,
        authorizationRef:action.authorizationRef,actor:action.actor,
        previousDestination:state.destination,
      }))===true,'DESTINATION_AUTHORIZATION_FAILED');
      const next={...state,destination:action.destination,
        destinationVersion:state.destinationVersion+1};
      return addEvent(next,state.destination?'DESTINATION_ROTATED':'DESTINATION_REGISTERED',
        {destination:action.destination,authorizationRef:action.authorizationRef,
          actor:action.actor,version:next.destinationVersion},action.at);
    }
    case 'HOLD':
    case 'RELEASE_HOLD': {
      yes(state.phase==='COMMITTED_UNSETTLED' && text(action.reason),
        'HOLD_INVALID');
      return addEvent({...state,held:action.type==='HOLD'},action.type,
        {reason:action.reason,actor:action.actor},action.at);
    }
    case 'AGING_REVIEW': {
      yes(state.phase==='COMMITTED_UNSETTLED','AGING_REVIEW_INVALID');
      // Time and compliance review never extinguish the beneficiary obligation.
      return addEvent({...state,agingReviewRequired:true},'AGING_REVIEW',
        {reason:action.reason??'AGING',actor:action.actor},action.at);
    }
    case 'SUBMISSION_RECORDED': {
      yes(text(action.idempotencyKey) && /^[a-f0-9]{64}$/.test(action.requestHash),
        'IDEMPOTENCY_EVIDENCE_REQUIRED');
      const previous=state.attempts.find(x=>x.idempotencyKey===action.idempotencyKey);
      if(previous) {
        yes(previous.requestHash===action.requestHash,'DUPLICATE_POST_CONFLICT');
        return state; // Exactly-once journal effect, NOT exactly-once network delivery.
      }
      yes(state.phase==='COMMITTED_UNSETTLED' && !state.held &&
        state.destination && state.attempts.length===0,
        'UNRESOLVED_OUTCOME_OR_HOLD');
      const attempts=[...state.attempts,{idempotencyKey:action.idempotencyKey,
        requestHash:action.requestHash,status:'OUTCOME_UNKNOWN'}];
      return addEvent({...state,attempts},'SUBMISSION_RECORDED',
        {idempotencyKey:action.idempotencyKey,requestHash:action.requestHash,
          actor:action.actor,outcome:'UNKNOWN'},action.at);
    }
    case 'FINALITY_VERIFIED': {
      yes(state.phase==='COMMITTED_UNSETTLED' &&
        state.attempts.length===1 && text(action.receiptRef) &&
        typeof verifyIndependentFinality==='function',
        'INDEPENDENT_FINALITY_REQUIRED');
      const verified=await verifyIndependentFinality(action.receiptRef);
      yes(verified?.independentlyRetrieved===true &&
        verified?.verified===true &&
        verified?.sourceClass==='EXTERNAL_RAIL' &&
        verified?.asset===state.obligation.asset &&
        verified?.amountMinor===state.obligation.subjectAmountMinor &&
        verified?.destination===state.destination &&
        text(verified.transactionRef) && text(verified.sourceDigest),
        'FINALITY_EVIDENCE_NOT_VERIFIED');
      const finality={receiptRef:action.receiptRef,transactionRef:verified.transactionRef,
        sourceDigest:verified.sourceDigest,verifiedAt:action.at};
      return addEvent({...state,phase:'SETTLED_UNRECONCILED',finality},
        'subject_share_settled',{...finality,actor:action.actor},action.at);
    }
    case 'RECONCILED': {
      yes(state.phase==='SETTLED_UNRECONCILED' && state.finality &&
        typeof verifyReconciliation==='function' && text(action.reconciliationRef),
        'RECONCILIATION_EVIDENCE_REQUIRED');
      const result=await verifyReconciliation({
        obligation:state.obligation,finality:state.finality,
        reconciliationRef:action.reconciliationRef,
      });
      yes(result?.independentlyVerified===true &&
        text(result.evidenceDigest),'RECONCILIATION_NOT_VERIFIED');
      const reconciliation={reference:action.reconciliationRef,
        evidenceDigest:result.evidenceDigest,verifiedAt:action.at};
      return addEvent({...state,phase:'SETTLED_RECONCILED',reconciliation},
        'RECONCILED',{...reconciliation,actor:action.actor},action.at);
    }
    default: throw new Error('UNSUPPORTED_TRANSITION');
  }
}
export function verifySettlementJournal(state, externallyAnchoredHead=null) {
  yes(Array.isArray(state?.events) && state.events.length>0,'JOURNAL_REQUIRED');
  let previous=null;
  for(const [sequence,event] of state.events.entries()){
    const {hash:eventHash,...data}=event;
    yes(event.sequence===sequence && event.previousHash===previous &&
      hash(data)===eventHash,'JOURNAL_CHAIN_BROKEN');
    previous=eventHash;
  }
  yes(previous===state.journalHead,'JOURNAL_HEAD_MISMATCH');
  if(externallyAnchoredHead!==null)
    yes(previous===externallyAnchoredHead,'EXTERNAL_JOURNAL_ANCHOR_MISMATCH');
  // A self-contained hash chain alone is NOT an independently trusted anchor.
  return {valid:true,externallyAnchored:externallyAnchoredHead!==null,
    events:state.events.length,head:previous};
}
