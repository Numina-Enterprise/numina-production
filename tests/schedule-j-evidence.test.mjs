import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEDULE_J_PROPOSAL, SCHEDULE_J_CATEGORIES, EVIDENCE_DIMENSIONS,
  buildScheduleJRegistry, stageScheduleJMapping, recordTreasuryAssertion,
} from '../src/schedule-j-evidence.js';

test('26 internal placeholders have 8/9/5/4 distribution and no NCUA code', () => {
  const rows = buildScheduleJRegistry();
  assert.equal(rows.length, 26);
  assert.deepEqual(SCHEDULE_J_CATEGORIES.map(x => x.count), [8, 9, 5, 4]);
  for (const prefix of ['RC','KC','IE','BS']) {
    const group = rows.filter(row => row.internalId.startsWith('SJ-' + prefix + '-'));
    assert.equal(group.length, SCHEDULE_J_CATEGORIES.find(c => c.prefix === prefix).count);
    assert.equal(new Set(group.map(row => row.internalId)).size, group.length);
  }
  for (const row of rows) {
    assert.equal(row.officialAccountCode, null);
    assert.equal(row.officialDefinition, null);
    assert.equal(row.accountDefinitionStatus, 'UNVERIFIED');
    assert.deepEqual(Object.keys(row.evidence), EVIDENCE_DIMENSIONS);
    assert.ok(Object.values(row.evidence).every(item => item.status === 'NOT_EVIDENCED'));
  }
});

test('proposed dates, scope and applicability are never promoted to final requirements', () => {
  assert.equal(SCHEDULE_J_PROPOSAL.status, 'PROPOSED_INFORMATION_COLLECTION');
  assert.equal(SCHEDULE_J_PROPOSAL.proposedFirstReportingDate, '2027-03-31');
  assert.equal(SCHEDULE_J_PROPOSAL.commentDeadline, '2026-12-08');
  assert.equal(SCHEDULE_J_PROPOSAL.ombControlNumber, '3133-0004');
  assert.equal(SCHEDULE_J_PROPOSAL.numinaApplicability, 'NOT_ESTABLISHED');
});

test('no source verifier, spoofed verified flag or incomplete official definition can promote mapping', async () => {
  const [row] = buildScheduleJRegistry(), candidate = {
    accountCode: 'NOT-A-REAL-CODE',
    definition: 'unverified sample only',
    sourceUrl: 'https://ncua.gov/imaginary', sourceRevision: '2026-10-09',
    sourceSha256: 'a'.repeat(64),
    verified: true,
  };
  await assert.rejects(stageScheduleJMapping(row, candidate), /OFFICIAL_ACCOUNT_EVIDENCE_REQUIRED/);
  await assert.rejects(stageScheduleJMapping(row, {...candidate, sourceSha256: null},
    {verifyOfficialSource: async () => ({exactMatch: true})}), /OFFICIAL_ACCOUNT_EVIDENCE_REQUIRED/);
  await assert.rejects(stageScheduleJMapping(row, candidate,
    {verifyOfficialSource: async () => ({authority: 'NCUA', exactMatch: true,
      independentlyRetrieved: false, sourceSha256: candidate.sourceSha256})}),
    /OFFICIAL_ACCOUNT_SOURCE_NOT_VERIFIED/);
  assert.equal(row.officialAccountCode, null);
});

test('independent source match only stages mapping; does not attest compliance or deployment', async () => {
  const [row] = buildScheduleJRegistry();
  const candidate = {accountCode: 'EXAMPLE-NOT-A-REAL-CODE', definition: 'example',
    sourceUrl: 'https://ncua.gov/example', sourceRevision: 'draft',
    sourceSha256: 'a'.repeat(64)};
  const staged = await stageScheduleJMapping(row, candidate, {
    verifyOfficialSource: async () => ({
      authority: 'NCUA', exactMatch: true, independentlyRetrieved: true,
      sourceSha256: candidate.sourceSha256,
    }),
  });
  assert.equal(staged.accountDefinitionStatus, 'SOURCE_MATCHED_PENDING_REVIEW');
  assert.equal(staged.regulatoryStatus, 'PROPOSED_INFORMATION_COLLECTION');
  assert.ok(Object.values(staged.evidence).every(item => item.status === 'NOT_EVIDENCED'));
  assert.equal(row.officialAccountCode, null);
});

test('internal receipts and provider observations never become independent settlement verification', () => {
  const time = '2026-10-11T00:00:00Z';
  for (const sourceClass of ['INTERNAL_SOFTWARE','PROVIDER_OBSERVATION']) {
    const e = recordTreasuryAssertion('PROVIDER_SETTLEMENT', {sourceClass, reference: 'example', recordedAt: time});
    assert.equal(e.independentlyVerified, false);
    assert.equal(e.reconciliationStatus, 'NOT_RECONCILED');
  }
  assert.throws(() => recordTreasuryAssertion('WRONG', {sourceClass:'INTERNAL_SOFTWARE', reference:'x', recordedAt:time}),/UNKNOWN_ASSERTION_TYPE/);
  assert.throws(() => recordTreasuryAssertion('ONCHAIN_FINALITY', {sourceClass:'CALLER_ASSERTION', reference:'x', recordedAt:time}),/EVIDENCE_PROVENANCE_REQUIRED/);
});
