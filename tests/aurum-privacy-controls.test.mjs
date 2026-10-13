import test from 'node:test';
import assert from 'node:assert/strict';

import {database} from '../scripts/sqlite.mjs';
import {
  bootstrapControl,
  commitControl,
  controlManifestView,
  readControl
} from '../src/control-store.js';

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
