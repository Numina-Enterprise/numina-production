import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommittedSubjectShare,transitionCommittedShare,verifySettlementJournal,
} from '../src/settlement-evidence-gates.js';

const at='2026-10-11T14:00:00.000Z';
const newShare=()=>createCommittedSubjectShare({
  id:'share-synthetic',disclosureId:'read-123',subjectHandle:'subject-pseudonym',
  asset:'USDC',subjectAmountMinor:'600',totalAmountMinor:'1000',at,
});
const act=(type,other={})=>({type,at,actor:'approved-operator-test',...other});
const destAuth={verifyDestinationAuthorization:async()=>true};
async function ready() {
  return transitionCommittedShare(newShare(),act('DESTINATION',
    {destination:'destination-test',authorizationRef:'signed-proof-test'}),destAuth);
}
async function submitted() {
  return transitionCommittedShare(await ready(),act('SUBMISSION_RECORDED',
    {idempotencyKey:'req-1',requestHash:'a'.repeat(64)}));
}
const independent=(value={})=>({verifyIndependentFinality:async({receiptRef})=>({
  verified:true,independentlyRetrieved:true,sourceClass:'EXTERNAL_RAIL',
  obligationId:'share-synthetic',disclosureId:'read-123',
  idempotencyKey:'req-1',requestHash:'a'.repeat(64),receiptRef,
  asset:'USDC',amountMinor:'600',destination:'destination-test',
  transferNamespace:'synthetic-chain:test-network:usdc',transferId:'transfer-test',
  transactionRef:'chain-receipt-test',sourceDigest:'a'.repeat(64),...value,
}),allocateReceipt:{durability:'PERSISTENT_ATOMIC',commit:async()=>true}});

test('commit fixes subject majority and refuses cancellable shares',()=>{
  const c=newShare();
  assert.equal(c.phase,'COMMITTED_UNSETTLED');
  assert.equal(c.obligation.subjectAmountMinor,'600');
  assert.equal(c.destination,null);
  assert.equal(verifySettlementJournal(c).valid,true);
  assert.throws(()=>createCommittedSubjectShare({
    id:'x',disclosureId:'r',subjectHandle:'s',asset:'USD',
    subjectAmountMinor:'500',totalAmountMinor:'1000',at}),
  /SUBJECT_MAJORITY_REQUIRED/);
});

test('cancellation, expiration and reductions fail closed even after aging',async()=>{
  let state=newShare();
  for(const type of ['CANCEL','EXPIRE','REDUCE','RELEASE_OBLIGATION'])
    await assert.rejects(transitionCommittedShare(state,act(type)),
      /IRREVOCABLE_COMMITMENT_CANNOT_CANCEL_OR_REDUCE/);
  state=await transitionCommittedShare(state,act('AGING_REVIEW',{reason:'overdue'}));
  assert.equal(state.phase,'COMMITTED_UNSETTLED');
  assert.equal(state.agingReviewRequired,true);
  assert.equal(state.obligation.subjectAmountMinor,'600');
});

test('initial destination and rotation require authenticating the beneficiary authority',async()=>{
  await assert.rejects(transitionCommittedShare(newShare(),act('DESTINATION',
    {destination:'destination-test',authorizationRef:'proof'})),
    /DESTINATION_AUTHORIZATION_REQUIRED/);
  await assert.rejects(transitionCommittedShare(newShare(),act('DESTINATION',
    {destination:'destination-test',authorizationRef:'proof'}),
    {verifyDestinationAuthorization:async()=>false}),/DESTINATION_AUTHORIZATION_FAILED/);
  let s=await ready();
  s=await transitionCommittedShare(s,act('DESTINATION',
    {destination:'destination-rotated',authorizationRef:'new-signed-proof'}),destAuth);
  assert.equal(s.destinationVersion,2);
  assert.equal(s.obligation.subjectAmountMinor,'600');
  assert.equal(s.events.at(-1).type,'DESTINATION_ROTATED');
  assert.equal(verifySettlementJournal(s).events,3);
});

test('hold blocks submission, and releasing hold preserves irrevocable obligation',async()=>{
  let s=await ready();
  s=await transitionCommittedShare(s,act('HOLD',{reason:'screening-review'}));
  await assert.rejects(transitionCommittedShare(s,act('SUBMISSION_RECORDED',
    {idempotencyKey:'request',requestHash:'a'.repeat(64)})),/UNRESOLVED_OUTCOME_OR_HOLD/);
  s=await transitionCommittedShare(s,act('RELEASE_HOLD',{reason:'screening-cleared'}));
  assert.equal(s.obligation.subjectAmountMinor,'600');
  s=await transitionCommittedShare(s,act('SUBMISSION_RECORDED',
    {idempotencyKey:'request',requestHash:'a'.repeat(64)}));
  assert.equal(s.attempts[0].status,'OUTCOME_UNKNOWN');
});

test('duplicate POST idempotency key has one journal effect; collisions and ambiguous retry fail',async()=>{
  const s=await submitted();
  const retry=await transitionCommittedShare(s,act('SUBMISSION_RECORDED',
    {idempotencyKey:'req-1',requestHash:'a'.repeat(64)}));
  assert.strictEqual(retry,s);
  await assert.rejects(transitionCommittedShare(s,act('SUBMISSION_RECORDED',
    {idempotencyKey:'req-1',requestHash:'b'.repeat(64)})),/DUPLICATE_POST_CONFLICT/);
  await assert.rejects(transitionCommittedShare(s,act('SUBMISSION_RECORDED',
    {idempotencyKey:'req-2',requestHash:'b'.repeat(64)})),/UNRESOLVED_OUTCOME_OR_HOLD/);
});

test('missing/forged finality evidence cannot mark payment as settled',async()=>{
  const s=await submitted();
  const action=act('FINALITY_VERIFIED',{receiptRef:'untrusted-caller-record'});
  await assert.rejects(transitionCommittedShare(s,action),/INDEPENDENT_FINALITY_REQUIRED/);
  await assert.rejects(transitionCommittedShare(s,action,
    independent({sourceClass:'INTERNAL_SOFTWARE'})),/FINALITY_EVIDENCE_NOT_VERIFIED/);
  await assert.rejects(transitionCommittedShare(s,action,
    independent({amountMinor:'601'})),/FINALITY_EVIDENCE_NOT_VERIFIED/);
  assert.equal(s.phase,'COMMITTED_UNSETTLED');
});

test('verified finality and separate reconciliation produce distinct receipts',async()=>{
  const s=await submitted();
  const paid=await transitionCommittedShare(s,
    act('FINALITY_VERIFIED',{receiptRef:'external-receipt-test'}),independent());
  assert.equal(paid.phase,'SETTLED_UNRECONCILED');
  assert.equal(paid.reconciliation,null);
  assert.equal(paid.events.at(-1).type,'subject_share_settled');
  await assert.rejects(transitionCommittedShare(paid,act('RECONCILED',
    {reconciliationRef:'reconcile'})),/RECONCILIATION_EVIDENCE_REQUIRED/);
  await assert.rejects(transitionCommittedShare(paid,act('RECONCILED',
    {reconciliationRef:'reconcile'}),
    {verifyReconciliation:async()=>({independentlyVerified:false})}),
    /RECONCILIATION_NOT_VERIFIED/);
  const reconciled=await transitionCommittedShare(paid,
    act('RECONCILED',{reconciliationRef:'reconcile'}),
    {verifyReconciliation:async()=>({independentlyVerified:true,evidenceDigest:'b'.repeat(64)})});
  assert.equal(reconciled.phase,'SETTLED_RECONCILED');
  assert.equal(reconciled.reconciliation.reference,'reconcile');
  assert.notEqual(reconciled.finality.sourceDigest,reconciled.reconciliation.evidenceDigest);
  await assert.rejects(transitionCommittedShare(reconciled,
    act('SUBMISSION_RECORDED',{idempotencyKey:'req-2',requestHash:'a'.repeat(64)})),
    /UNRESOLVED_OUTCOME_OR_HOLD/);
});

test('third-party reconstruction detects tampering and distinguishes internal hashes from external anchors',async()=>{
  const s=await submitted();
  assert.equal(verifySettlementJournal(s).externallyAnchored,false);
  assert.equal(verifySettlementJournal(s,s.journalHead).externallyAnchored,true);
  assert.throws(()=>verifySettlementJournal(s,'0'.repeat(64)),/EXTERNAL_JOURNAL_ANCHOR_MISMATCH/);
  const tampered=structuredClone(s);
  tampered.events[1].detail.destination='attacker';
  assert.throws(()=>verifySettlementJournal(tampered),/JOURNAL_CHAIN_BROKEN/);
});
