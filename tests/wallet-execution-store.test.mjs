import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl, readControl} from '../src/control-store.js';
import {controlHash, stable} from '../src/control.js';
import {controlHttp} from '../src/control-http.js';
import {WALLET_EXECUTION_POLICY, walletExecutionAuthorized} from '../public/wallet-execution-policy.js';
import {WALLET_EXECUTION_SCHEMA, readWalletDeploymentIntent, writeWalletDeploymentIntent} from '../src/wallet-execution-store.js';

const owner = 'email:owner@example.test';
const otherOwner = 'email:reviewer@example.test';
const apiKey = 'isolated-wallet-intent-test-key';
const endpoint = 'https://numina.test/api/control/v1/nusd-deployment';
const hashA = '0x' + 'a1'.repeat(32);
const hashB = '0x' + 'b2'.repeat(32);
// Synthetic evidence exists only inside this offline fixture. It never changes
// the frozen source policy, which remains BLOCKED in every HTTP test below.
const approvedPolicy = () => ({...WALLET_EXECUTION_POLICY,
  status: 'APPROVED_FOR_OWNER_WALLET', submissionAllowed: true,
  issuerPolicySigned: true, ownerApproved: true, reviewEvidenceVerified: true,
  reviews: WALLET_EXECUTION_POLICY.reviews.map((review, i) => ({...review,
    verified: true, evidenceSha256: String(i + 1).repeat(64)})), blockers: []});
const transaction = () => ({chainId: WALLET_EXECUTION_POLICY.chainId,
  genesisHash: WALLET_EXECUTION_POLICY.genesisHash, from: WALLET_EXECUTION_POLICY.sender,
  nonce: '7', gasLimit: '2117026', gasPrice: '2', maximumFeeBaseUnits: '4234052',
  creationSha256: WALLET_EXECUTION_POLICY.creationSha256});
const claim = (attemptId = 'offline-attempt-1') => ({action: 'claim', attemptId, transaction: transaction()});
const report = (transactionHash = hashA, attemptId = 'offline-attempt-1') => ({action: 'report_hash', attemptId, transactionHash});
const options = () => ({policy: approvedPolicy(), now: 1700000000});
async function fixture(t) {
  const db = database(); t.after(() => db.close());
  // Also makes the tests runnable while another bounded task integrates this
  // table into the common SQLite fixture and production migration.
  await db.prepare(WALLET_EXECUTION_SCHEMA).run();
  await bootstrapControl(db, owner, 1700000000);
  const env = {DB: db, NUMINA_CONTROL_OWNER: owner, NUMINA_CONTROL_API_KEY_SHA256: await controlHash(apiKey)};
  return {db, env};
}
const count = db => db.prepare('SELECT count(*) AS n FROM numina_wallet_deployment_intents').first();
const errorIs = (code, status) => error => error.code === code && error.status === status;

test('published policy rejects a claim without inserting or changing the native journal', async t => {
  const {db} = await fixture(t), before = await readControl(db);
  assert.equal(walletExecutionAuthorized(), false);
  await assert.rejects(writeWalletDeploymentIntent(db, owner, claim()), errorIs('DEPLOYMENT_REVIEWS_REQUIRED', 409));
  assert.equal((await count(db)).n, 0);
  assert.equal(await readWalletDeploymentIntent(db, owner), null);
  assert.deepEqual(await readControl(db), before);
});

test('approval requires every pinned field and all eight distinct evidence reviews', async t => {
  const {db} = await fixture(t);
  const policies = [];
  for (const key of ['submissionAllowed', 'issuerPolicySigned', 'ownerApproved', 'reviewEvidenceVerified'])
    policies.push({...approvedPolicy(), [key]: false});
  for (const key of ['requestSha256', 'artifactSha256', 'issuerPolicySha256', 'creationSha256', 'chainId', 'genesisHash', 'sender', 'initialSupplyBaseUnits'])
    policies.push({...approvedPolicy(), [key]: 'changed'});
  const missing = approvedPolicy(); missing.reviews.pop(); policies.push(missing);
  const duplicate = approvedPolicy(); duplicate.reviews[7] = duplicate.reviews[0]; policies.push(duplicate);
  const emptyEvidence = approvedPolicy(); emptyEvidence.reviews[0].evidenceSha256 = null; policies.push(emptyEvidence);
  const unresolved = approvedPolicy(); unresolved.reviews[0].verified = false; policies.push(unresolved);
  policies.push({...approvedPolicy(), minimumConfirmations: 11}, {...approvedPolicy(), minimumConfirmations: 12.5});
  for (const policy of policies) {
    await assert.rejects(writeWalletDeploymentIntent(db, owner, claim(), {policy}), errorIs('DEPLOYMENT_REVIEWS_REQUIRED', 409));
    assert.equal((await count(db)).n, 0);
  }
  assert.ok(Object.isFrozen(WALLET_EXECUTION_POLICY));
  assert.ok(WALLET_EXECUTION_POLICY.reviews.every(Object.isFrozen));
  assert.equal(WALLET_EXECUTION_POLICY.submissionAllowed, false);
});

test('a synthetic approved claim retains an exact commitment and is idempotent without minting', async t => {
  const {db} = await fixture(t), body = claim(), before = await readControl(db);
  const first = await writeWalletDeploymentIntent(db, owner, body, options());
  assert.equal(first.fresh, true);
  assert.equal(first.transactionCommitment, await controlHash(body.transaction));
  assert.deepEqual(first.record.transaction, body.transaction);
  assert.equal(first.record.attemptId, body.attemptId);
  assert.equal(first.record.createdAt, 1700000000);
  assert.equal(first.record.status, 'CLAIMED');
  assert.equal(first.record.reportedTransactionHash, null);
  assert.equal(first.record.minted, false);
  assert.equal(first.record.deposited, false);
  const retry = await writeWalletDeploymentIntent(db, owner, body, {...options(), now: 1700000300});
  assert.equal(retry.fresh, false);
  assert.deepEqual(retry.record, first.record);
  assert.equal(retry.transactionCommitment, first.transactionCommitment);
  assert.equal((await count(db)).n, 1);
  assert.deepEqual(await readControl(db), before);
});

test('different attempts and changed transactions cannot replace the durable deployment claim', async t => {
  const {db} = await fixture(t), first = await writeWalletDeploymentIntent(db, owner, claim(), options());
  await assert.rejects(writeWalletDeploymentIntent(db, owner, claim('second-tab'), options()), errorIs('DEPLOYMENT_INTENT_EXISTS', 409));
  const altered = claim(); altered.transaction.nonce = '8';
  await assert.rejects(writeWalletDeploymentIntent(db, owner, altered, options()), errorIs('DEPLOYMENT_INTENT_EXISTS', 409));
  assert.deepEqual(await readWalletDeploymentIntent(db, owner), first.record);
  assert.equal((await count(db)).n, 1);
});

test('concurrent different claims allow exactly one fresh attempt', async t => {
  const {db} = await fixture(t);
  const results = await Promise.allSettled(['tab-a', 'tab-b', 'tab-c'].map(id => writeWalletDeploymentIntent(db, owner, claim(id), options())));
  const successes = results.filter(result => result.status === 'fulfilled');
  const failures = results.filter(result => result.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(successes[0].value.fresh, true);
  assert.equal(failures.length, 2);
  for (const failure of failures) assert.equal(failure.reason.code, 'DEPLOYMENT_INTENT_EXISTS');
  assert.equal((await readWalletDeploymentIntent(db, owner)).attemptId, successes[0].value.record.attemptId);
  assert.equal((await count(db)).n, 1);
});

test('concurrent identical claims produce one fresh authorization and one retained record', async t => {
  const {db} = await fixture(t);
  const results = await Promise.all([1, 2, 3].map(() => writeWalletDeploymentIntent(db, owner, claim(), options())));
  assert.equal(results.filter(result => result.fresh).length, 1);
  assert.equal(new Set(results.map(result => result.transactionCommitment)).size, 1);
  for (const result of results) assert.deepEqual(result.record, results[0].record);
  assert.equal((await count(db)).n, 1);
});

test('an existing intent survives a database restart and cannot be claimed again as fresh', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'numina-wallet-intent-test-'));
  let db = database(join(directory, 'intent.sqlite'));
  try {
    await db.prepare(WALLET_EXECUTION_SCHEMA).run();
    const first = await writeWalletDeploymentIntent(db, owner, claim(), options());
    db.close(); db = database(join(directory, 'intent.sqlite'));
    const retry = await writeWalletDeploymentIntent(db, owner, claim(), options());
    assert.equal(retry.fresh, false);
    assert.deepEqual(retry.record, first.record);
    await assert.rejects(writeWalletDeploymentIntent(db, owner, claim('another-device'), options()), errorIs('DEPLOYMENT_INTENT_EXISTS', 409));
  } finally { db.close(); rmSync(join(directory, 'intent.sqlite')); rmdirSync(directory); }
});

test('a reported hash remains an unverified report and can be reconciled after policy withdrawal', async t => {
  const {db} = await fixture(t), before = await readControl(db);
  await writeWalletDeploymentIntent(db, owner, claim(), options());
  const result = await writeWalletDeploymentIntent(db, owner, report('0x' + 'A1'.repeat(32)));
  assert.equal(result.fresh, false);
  assert.equal(result.record.status, 'HASH_REPORTED');
  assert.equal(result.record.reportedTransactionHash, hashA);
  assert.equal(result.record.minted, false);
  assert.equal(result.record.deposited, false);
  assert.match(result.record.scope, /not a verified receipt/);
  assert.deepEqual((await writeWalletDeploymentIntent(db, owner, report())).record, result.record);
  await assert.rejects(writeWalletDeploymentIntent(db, owner, report(hashB)), errorIs('DEPLOYMENT_HASH_CONFLICT', 409));
  assert.equal((await readWalletDeploymentIntent(db, owner)).reportedTransactionHash, hashA);
  assert.deepEqual(await readControl(db), before);
});

test('concurrent conflicting hash reports cannot both succeed or overwrite the winner', async t => {
  const {db} = await fixture(t);
  await writeWalletDeploymentIntent(db, owner, claim(), options());
  const results = await Promise.allSettled([hashA, hashB].map(hash => writeWalletDeploymentIntent(db, owner, report(hash))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winner = results.find(result => result.status === 'fulfilled').value.record.reportedTransactionHash;
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DEPLOYMENT_HASH_CONFLICT');
  assert.equal((await readWalletDeploymentIntent(db, owner)).reportedTransactionHash, winner);
});

test('owner mismatches cannot read, replace or report against an existing deployment intent', async t => {
  const {db} = await fixture(t), saved = await writeWalletDeploymentIntent(db, owner, claim(), options());
  await assert.rejects(readWalletDeploymentIntent(db, otherOwner), errorIs('DEPLOYMENT_OWNER_MISMATCH', 403));
  await assert.rejects(writeWalletDeploymentIntent(db, otherOwner, claim(), options()), errorIs('DEPLOYMENT_OWNER_MISMATCH', 403));
  await assert.rejects(writeWalletDeploymentIntent(db, otherOwner, report()), errorIs('DEPLOYMENT_OWNER_MISMATCH', 403));
  assert.deepEqual(await readWalletDeploymentIntent(db, owner), saved.record);
});

test('invalid fields, pinned identities, quantities, nonce and fee budgets leave no claim', async t => {
  const {db} = await fixture(t);
  const rejected = async (body, code) => {
    await assert.rejects(writeWalletDeploymentIntent(db, owner, body, options()), errorIs(code, 400));
    assert.equal((await count(db)).n, 0);
  };
  for (const attemptId of ['', '../other', ' '.repeat(2), 'a'.repeat(101), null, 1])
    await rejected({...claim(), attemptId}, 'INVALID_DEPLOYMENT_INTENT');
  await rejected({...claim(), signed: true}, 'INVALID_DEPLOYMENT_INTENT');
  for (const key of Object.keys(transaction())) {
    const missing = claim(); delete missing.transaction[key];
    await rejected(missing, 'INVALID_DEPLOYMENT_TRANSACTION');
  }
  await rejected({...claim(), transaction: {...transaction(), data: '0x01'}}, 'INVALID_DEPLOYMENT_TRANSACTION');
  for (const key of ['chainId', 'genesisHash', 'from', 'creationSha256'])
    await rejected({...claim(), transaction: {...transaction(), [key]: 'other'}}, 'DEPLOYMENT_PIN_MISMATCH');
  for (const key of ['nonce', 'gasLimit', 'gasPrice', 'maximumFeeBaseUnits']) {
    for (const value of [-1, 0, null, '', '-1', '+1', '01', '1.0', '1e3', ' 1', '0x01', (1n << 256n).toString(), '9'.repeat(79)])
      await rejected({...claim(), transaction: {...transaction(), [key]: value}}, 'INVALID_DEPLOYMENT_QUANTITY');
  }
  await rejected({...claim(), transaction: {...transaction(), nonce: ((1n << 64n) - 1n).toString()}}, 'INVALID_DEPLOYMENT_QUANTITY');
  await rejected({...claim(), transaction: {...transaction(), gasLimit: '0'}}, 'DEPLOYMENT_FEE_BUDGET');
  await rejected({...claim(), transaction: {...transaction(), maximumFeeBaseUnits: '4234051'}}, 'DEPLOYMENT_FEE_BUDGET');
  await rejected({...claim(), transaction: {...transaction(), gasLimit: ((1n << 256n) - 1n).toString()}}, 'DEPLOYMENT_FEE_BUDGET');
  const zeroFee = {...claim(), transaction: {...transaction(), nonce: ((1n << 64n) - 2n).toString(), gasPrice: '0', maximumFeeBaseUnits: '0'}};
  assert.equal((await writeWalletDeploymentIntent(db, owner, zeroFee, options())).fresh, true);
});

test('invalid hash reports and unknown actions cannot fabricate or clear deployment records', async t => {
  const {db} = await fixture(t);
  await assert.rejects(writeWalletDeploymentIntent(db, owner, report()), errorIs('DEPLOYMENT_INTENT_MISMATCH', 409));
  for (const body of [null, {}, {action: 'clear'}, {action: 'complete', minted: true}])
    await assert.rejects(writeWalletDeploymentIntent(db, owner, body), errorIs('INVALID_DEPLOYMENT_ACTION', 400));
  await writeWalletDeploymentIntent(db, owner, claim(), options());
  for (const transactionHash of ['', '0x1', 'f'.repeat(64), '0x' + 'g'.repeat(64), null, 1])
    await assert.rejects(writeWalletDeploymentIntent(db, owner, report(transactionHash)), errorIs('INVALID_DEPLOYMENT_HASH', 400));
  await assert.rejects(writeWalletDeploymentIntent(db, owner, {...report(), minted: true}), errorIs('INVALID_DEPLOYMENT_HASH', 400));
  await assert.rejects(writeWalletDeploymentIntent(db, owner, report(hashA, 'different-attempt')), errorIs('DEPLOYMENT_INTENT_MISMATCH', 409));
  assert.equal((await readWalletDeploymentIntent(db, owner)).reportedTransactionHash, null);
});

test('HTTP requires owner authentication and same-origin cookie writes, preserving the published gate', async t => {
  const {db, env} = await fixture(t), before = await readControl(db);
  const identity = {'oai-authenticated-user-id': 'owner-fixture-id', 'oai-authenticated-user-email': 'owner@example.test'};
  const bearer = {Authorization: 'Bearer ' + apiKey};
  const invoke = async ({method = 'GET', headers = {}, body, suffix = ''} = {}) => {
    const response = await controlHttp(new Request(endpoint + suffix, {method,
      headers: {...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...headers},
      body: body === undefined ? undefined : stable(body)}), env);
    return {response, value: await response.json()};
  };
  for (const headers of [{}, {Authorization: 'Bearer wrong'}, {'oai-authenticated-user-id': 'id-only'}]) {
    const {response, value} = await invoke({headers});
    assert.equal(response.status, 401); assert.equal(value.error, 'UNAUTHENTICATED');
  }
  for (const method of ['GET', 'POST']) {
    const {response, value} = await invoke({method, headers: {'oai-authenticated-user-id': 'reviewer-fixture-id', 'oai-authenticated-user-email': 'reviewer@example.test', Origin: 'https://numina.test'}, body: method === 'POST' ? claim() : undefined});
    assert.equal(response.status, 403); assert.equal(value.error, 'OWNER_VIEW_REQUIRED');
  }
  for (const origin of [undefined, 'https://elsewhere.test', 'null']) {
    const {response, value} = await invoke({method: 'POST', headers: {...identity, ...(origin === undefined ? {} : {Origin: origin})}, body: claim()});
    assert.equal(response.status, 403); assert.equal(value.error, 'ORIGIN_REQUIRED');
  }
  for (const headers of [bearer, identity]) {
    const {response, value} = await invoke({headers});
    assert.equal(response.status, 200); assert.equal(value.submissionAllowed, false);
    assert.equal(value.policy.status, 'BLOCKED'); assert.equal(value.record, null);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(response.headers.get('Vary'), 'Cookie, Authorization');
  }
  for (const headers of [bearer, {...identity, Origin: 'https://numina.test'}]) {
    const {response, value} = await invoke({method: 'POST', headers, body: claim()});
    assert.equal(response.status, 409); assert.equal(value.error, 'DEPLOYMENT_REVIEWS_REQUIRED');
  }
  const query = await invoke({headers: bearer, suffix: '?policy=approved'});
  assert.equal(query.response.status, 400); assert.equal(query.value.error, 'DEPLOYMENT_QUERY_NOT_ALLOWED');
  const method = await invoke({method: 'DELETE', headers: bearer});
  assert.equal(method.response.status, 405);
  assert.equal((await count(db)).n, 0);
  assert.deepEqual(await readControl(db), before);
});

test('HTTP cannot accept a form-supplied policy, but lets the owner retain a pending attempt hash', async t => {
  const {db, env} = await fixture(t), before = await readControl(db);
  const invoke = async body => controlHttp(new Request(endpoint, {method: 'POST',
    headers: {Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json'}, body: stable(body)}), env);
  const forged = await invoke({...claim(), policy: approvedPolicy()});
  assert.equal(forged.status, 409); assert.equal((await forged.json()).error, 'DEPLOYMENT_REVIEWS_REQUIRED');
  await writeWalletDeploymentIntent(db, owner, claim(), options());
  const retained = await invoke(report());
  assert.equal(retained.status, 200);
  const value = await retained.json();
  assert.equal(value.record.status, 'HASH_REPORTED'); assert.equal(value.record.minted, false); assert.equal(value.record.deposited, false);
  const notCanonical = await controlHttp(new Request(endpoint, {method: 'POST', headers: {Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json'}, body: JSON.stringify(report(), null, 2)}), env);
  assert.equal(notCanonical.status, 400); assert.equal((await notCanonical.json()).error, 'CANONICAL_JSON_REQUIRED');
  assert.deepEqual(await readControl(db), before);
});
