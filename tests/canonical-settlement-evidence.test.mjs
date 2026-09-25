import test from 'node:test';
import assert from 'node:assert/strict';
import {treasuryEvidencePayload} from '../src/treasury-evidence.js';
import {controlHash} from '../src/control.js';

test('current journal status and historical settlement file are hash-bound separately',async()=>{
  const input={
    treasury:{root:'NUMINA',revision:0,head:'a'.repeat(64),status:'NOT_INITIALIZED',projection:null},
    frontier:{fundingDeclaration:null,fundingPlan:null,accounts:[]},
    providerObservation:{status:'UNAVAILABLE',record:null},
    supportingDocuments:{status:'UNAVAILABLE',record:null,complete:false},
    capturedAt:'2026-09-24T00:00:00Z'
  };
  const before=structuredClone(input),payload=await treasuryEvidencePayload(input);
  assert.deepEqual(input,before);
  const native=payload.nativeSettlement;
  assert.equal(native.status,'UNVERIFIED');
  assert.equal(native.submissionPerformed,false);
  assert.equal(native.settlementPerformed,false);
  assert.equal(native.receipt,null);
  assert.equal(native.currentJournalProjection.balance,null);
  assert.equal(native.historicalReceipt.id,'numina:treasury:settlement:2026-09-19:v1');
  assert.equal(native.historicalReceipt.status,'SETTLED');
  assert.equal(native.historicalReceipt.currentJournalConfirmed,false);
  assert.equal(native.canonicalTreasuryValues.aggregate.current,'500000000000000');
  assert.equal(native.canonicalTreasuryValues.componentCount,3);
  assert.equal(native.canonicalTreasuryValues.mintedNusd,null);
  assert.equal(native.canonicalTreasuryValues.burnedNusd,null);
  assert.deepEqual(native,payload.source.nativeSettlement);
  assert.equal(payload.evidenceHash,await controlHash(payload.source));
  const changed=structuredClone(payload.source);changed.nativeSettlement.historicalReceipt.id='stale';
  assert.notEqual(await controlHash(changed),payload.evidenceHash);
  assert.equal(payload.reconciliation.scope,'EXTERNAL_PROVIDER_OBSERVATIONS');
  assert.equal(payload.reconciliation.status,'NOT_RECONCILED');
  assert.equal(payload.fundingVerification.scope,'EXTERNAL_PROVIDER_FUNDING');
  assert.equal(payload.fundingVerification.actual_funding,false);
  assert.equal(payload.fundingVerification.settlementPerformed,false);
  assert.equal(payload.records.providerBalances.verification.status,'UNAVAILABLE');
  assert.equal(payload.reconciliation.depositReadiness.scope,'EXTERNAL_PROVIDER_SUBMISSION');
  assert.equal(payload.reconciliation.depositReadiness.submissionPerformed,false);
  assert.equal(payload.effects.journalChanged,false);
  assert.equal(payload.effects.providerBalancesChanged,false);
});
