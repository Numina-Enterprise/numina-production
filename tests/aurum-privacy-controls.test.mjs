import test from 'node:test';
import assert from 'node:assert/strict';

import {database} from '../scripts/sqlite.mjs';
import {
  bootstrapControl,
  commitControl,
  controlManifestView,
  readControl
} from '../src/control-store.js';
import {controlHash,initialControlManifest,reduceControl} from '../src/control.js';

// Project Aurum Phase 2-inspired *boundary* tests on Numina's existing control
// plane. Synthetic values only. No PETs, customer data, wallet keys, provider
// connections, external settlement or funds are used.
const OWNER = 'email:owner@example.test';
const REVIEWER = 'email:reviewer@example.test';
const OUTSIDER = 'email:outsider@example.test';
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_SUBJECT_7F2B_NOT_REAL';
let commandNumber = 0;

const now = () => Math.floor(Date.now() / 1000);
const request = (id, resource, payload, route = 'internal.record.v1') => ({
  id, route, wants: {resource, payload}, requiredEvidence: []
});
async function fixture(t) {
  const db = database();
  t.after(() => db.close());
  await bootstrapControl(db, OWNER, now());
  return db;
}
async function apply(db, type, data, actor = OWNER) {
  const state = await readControl(db);
  commandNumber += 1;
  return commitControl(db, {
    id: 'aurum_contract_' + commandNumber,
    expectedRevision: state.revision,
    type,
    data
  }, actor, now());
}
async function delegateReadScope(db) {
  await apply(db, 'delegate', {
    id: 'reviewer-grant',
    parent: 'root',
    subject: REVIEWER,
    scopes: ['request.create', 'record.write'],
    resourcePrefix: 'record:public/',
    expiresAt: now() + 3600
  });
}

test('AURUM-C01: unrelated synthetic identity never appears in the scoped reviewer view', async t => {
  const db = await fixture(t);
  await apply(db, 'request', request('confidential', 'record:private/subject', PRIVATE_MARKER));
  await delegateReadScope(db);
  await apply(db, 'request', request('public-example', 'record:public/example', 'Synthetic public review record'));

  const reviewerView = await controlManifestView(db, REVIEWER, now());
  assert.equal(reviewerView.scope, 'authority-scoped');
  assert.deepEqual(reviewerView.content.requests.map(r => r.id), ['public-example']);
  assert.equal(JSON.stringify(reviewerView).includes(PRIVATE_MARKER), false);
  assert.equal(reviewerView.content.records.length, 0);
  assert.equal(reviewerView.decisions.some(d => d.requestId === 'confidential'), false);

  // Owners can reconstruct the confidential record, but the storage layer
  // currently retains the cleartext payload. This is NOT PET-based privacy.
  const ownerView = await controlManifestView(db, OWNER, now());
  assert.equal(ownerView.scope, 'complete');
  assert.equal(ownerView.content.requests.find(r => r.id === 'confidential').wants.payload, PRIVATE_MARKER);
  const journal = (await readControl(db)).journalEvents;
  assert.equal(journal.some(e => JSON.stringify(e).includes(PRIVATE_MARKER)), true);
});

test('AURUM-C02: no delegated authority means no view; revoked grant loses all view', async t => {
  const db = await fixture(t);
  await assert.rejects(controlManifestView(db, OUTSIDER, now()), /AUTHORITY_DENIED/);
  await delegateReadScope(db);
  assert.equal((await controlManifestView(db, REVIEWER, now())).scope, 'authority-scoped');
  await apply(db, 'revoke', {grantId: 'reviewer-grant'});
  await assert.rejects(controlManifestView(db, REVIEWER, now()), /AUTHORITY_DENIED/);
});

test('AURUM-C03: Ethereum external execution request escalates without handoff', async t => {
  const db = await fixture(t);
  await apply(db, 'request', request(
    'synthetic-external', 'record:ops/ethereum', 'No real transaction',
    'external.ethereum.transfer.v1'
  ));
  const view = await controlManifestView(db, OWNER, now());
  const decision = view.decisions.find(d => d.requestId === 'synthetic-external');
  assert.equal(decision.outcome, 'ESCALATE');
  assert.equal(decision.reason, 'UNSUPPORTED_ADAPTER');
  assert.equal(decision.nextAction, null);
  await assert.rejects(
    apply(db, 'execute', {requestId: 'synthetic-external', actionId: 'forged-action'}),
    /NEXT_ACTION_NOT_VERIFIED/
  );
  assert.equal((await readControl(db)).manifest.records.length, 0);
});

test('AURUM-C04: changed journal bytes are detected before a reviewer reconstructs evidence', async t => {
  const db = await fixture(t);
  await apply(db, 'request', request('audit', 'record:ops/audit', 'Synthetic audit sample'));
  const state = await readControl(db);
  assert.equal(state.journalEvents.length, 2);
  const event = state.journalEvents[1];
  await db.prepare('UPDATE numina_control_events SET event_json=? WHERE id=?')
    .bind('{"tampered":true}', event.id).run();
  await assert.rejects(readControl(db), /JOURNAL_CORRUPT/);
});

// Deliberate non-claims:
// - The existing hash-linked journal is not a digitally signed audit receipt.
// - Selective disclosure, zero-knowledge proofs and BBS+ credentials are not
//   implemented or tested here.
// - External sanctions verification, regulatory reporting, wallet ownership,
//   payment completion and legal settlement finality remain out of scope.


const privateRequest = (commitment, overrides = {}) => ({
  id: '1'.repeat(32),
  route: 'internal.commitment.v1',
  wants: {
    resource: 'record:private/' + '2'.repeat(32),
    commitment
  },
  requiredEvidence: [],
  ...overrides
});
const privateCommand = (data, id = '3'.repeat(32)) => ({
  id,
  type: 'request',
  expectedRevision: 0,
  data
});
const privateCommitment = async () => 'sha256:' + await controlHash({
  salt: 'client_only_randomized_salt_' + '9'.repeat(64),
  subject: PRIVATE_MARKER
});

test('AURUM-C05: commitment-only mode persists no submitted private plaintext and can replay exactly', async t => {
  const db = await fixture(t);
  // The local client keeps both the sensitive data and the salt. Only its
  // previously computed commitment enters any control command.
  const commitment = await privateCommitment();
  const req = privateRequest(commitment);
  await commitControl(db, privateCommand(req), OWNER, now());
  const state = await controlManifestView(db, OWNER, now());
  const next = state.decisions.find(d => d.requestId === req.id).nextAction;
  assert.equal(next.adapter, 'internal.commitment.v1');
  assert.equal(next.kind, 'record.write');

  const commit = {id: '4'.repeat(32), type: 'execute', expectedRevision: 1,
    data: {requestId: req.id, actionId: next.actionId}};
  const outcome = await commitControl(db, commit, OWNER, now());
  assert.equal(outcome.event.result.recordId, req.id);
  assert.equal((await commitControl(db, commit, OWNER, now())).replayed, true);

  const persisted = await readControl(db);
  assert.equal(persisted.revision, 2);
  assert.deepEqual(Object.keys(persisted.manifest.records[0]).sort(),
    ['at','commitment','evidenceId','requestId','resource'].sort());
  assert.equal(persisted.manifest.records[0].commitment, commitment);
  assert.equal(persisted.manifest.requests[0].wants.payload, undefined);
  assert.equal(persisted.manifest.requests[0].verifiedOutcome.scope, 'internal.commitment.v1');
  assert.equal(persisted.manifest.evidence[0].adapter, 'internal.commitment.v1');
  assert.equal(JSON.stringify(persisted).includes(PRIVATE_MARKER), false);
  assert.equal(JSON.stringify(persisted).includes('client_only_randomized_salt'), false);

  // Deterministic replay must continue to bind manifest and decision hashes.
  const events = persisted.journalEvents;
  let replayed = initialControlManifest(events[0].actor, events[0].at);
  for (const event of events.slice(1)) {
    const step = await reduceControl(replayed,event.command,event.actor,event.revision-1,event.at);
    assert.equal(await controlHash(step.manifest), event.manifestHash);
    assert.equal(await controlHash(step.decisions), event.decisionsHash);
    replayed = step.manifest;
  }
  assert.equal(await controlHash(replayed), persisted.manifest_hash);
});

test('AURUM-C06: plaintext, metadata extras and low-entropy identifiers fail before any journal write', async t => {
  const db = await fixture(t);
  const commitment = await privateCommitment();
  const base = privateRequest(commitment);
  const negatives = [
    [privateCommand({...base,wants:{...base.wants,payload:PRIVATE_MARKER}}), /UNKNOWN_FIELDS/],
    [privateCommand({...base,wants:{...base.wants,note:PRIVATE_MARKER}}), /UNKNOWN_FIELDS/],
    [privateCommand({...base,wants:{resource:'record:private/email@example.test',commitment}}), /PRIVATE_OPAQUE_RESOURCE_REQUIRED/],
    [privateCommand({...base,id:'customer-alice'}), /PRIVATE_OPAQUE_ID_REQUIRED/],
    [privateCommand(base,'request-with-personal-identifier'), /PRIVATE_OPAQUE_ID_REQUIRED/],
    [privateCommand({...base,requiredEvidence:['private-note']}), /PRIVATE_EVIDENCE_NOT_SUPPORTED/],
    [privateCommand({...base,wants:{...base.wants,commitment:'sha256:'+'0'.repeat(5)}}), /PRIVATE_COMMITMENT_REQUIRED/]
  ];
  for (const [command, expected] of negatives) {
    await assert.rejects(commitControl(db,command,OWNER,now()), expected);
  }
  const persisted=await readControl(db);
  assert.equal(persisted.revision,0);
  assert.equal(persisted.eventCount,1);
  assert.equal(JSON.stringify(persisted).includes(PRIVATE_MARKER),false);
});

test('AURUM-C07: even an otherwise allowed private commit requires an opaque command ID', async t => {
  const db=await fixture(t);
  const req=privateRequest(await privateCommitment());
  await commitControl(db,privateCommand(req),OWNER,now());
  const decision=(await controlManifestView(db,OWNER,now())).decisions[0];
  assert.equal(decision.outcome,'ALLOW');
  await assert.rejects(commitControl(db,{
    id:'private-record-with-name',expectedRevision:1,type:'execute',
    data:{requestId:req.id,actionId:decision.nextAction.actionId}
  },OWNER,now()),/PRIVATE_OPAQUE_ID_REQUIRED/);
  const persisted=await readControl(db);
  assert.equal(persisted.revision,1);
  assert.equal(persisted.manifest.records.length,0);
});
