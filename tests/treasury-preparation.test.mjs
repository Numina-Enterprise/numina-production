import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl, readControl} from '../src/control-store.js';
import {controlHash, stable} from '../src/control.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {verifyTreasuryRecord} from '../public/treasury-proof.js';
import {createTreasuryPreparation} from '../public/treasury-preparation.js';

const owner = 'email:owner@example.test';
const mint = () => ({operation: 'PREPARE_MINT', amount: '1500000000000000', networkReference: 'eip155:962421430', destinationReference: 'test-treasury', reason: 'Isolated preparation test'});
const bank = () => ({operation: 'PREPARE_BANK_TRANSACTION', amountMinor: '50000000000000000', currency: 'USD', destinationReference: 'test-bank-designation', reason: 'Isolated preparation test'});
async function fixture(t) {
  const db = database(); t.after(() => db.close());
  await bootstrapControl(db, owner, Math.floor(Date.now() / 1000));
  const api = createNuminaTreasury({db, root: owner, principal: owner});
  for (const [id, Objective, Intent] of [
    ['initialize', 'treasury.initialize', {operation: 'INITIALIZE', reason: 'Isolated test'}],
    ['adjust', 'treasury.project', {operation: 'ADJUST_PROJECTION', delta: '1000000000000000', reason: 'Isolated test'}]
  ]) {
    const row = await readControl(db);
    await api.writeTreasury({id, expectedRevision: row.revision, expectedHead: row.head_hash, Principal: owner, Authority: 'NUMINA', Objective, Intent});
  }
  const bodies = []; let id = 0;
  const options = {read: () => api.readTreasury(), makeId: () => 'prepare-' + ++id,
    write: body => { bodies.push(body); return api.writeTreasury(JSON.parse(body)); }};
  return {db, api, bodies, options, client: createTreasuryPreparation(options)};
}

test('mint then bank use fresh heads, preserve balance, append exact requests and confirm real journal proofs', async t => {
  const {api, client, bodies} = await fixture(t);
  const before = await api.readTreasury();
  const first = await client.prepare(mint());
  assert.equal(first.canonicalBody, stable(first.event));
  assert.equal(first.beforeBalance, '1500000000000000');
  for (const item of [first, first.event, first.event.Intent, first.transactionRequest]) assert.ok(Object.isFrozen(item));
  const a = await client.submit(first);
  const second = await client.prepare(bank());
  assert.equal(second.event.expectedHead, a.head_advancement.head);
  assert.equal(second.event.expectedRevision, before.revision + 1);
  const b = await client.submit(second);
  assert.equal(b.head_advancement.revision, before.revision + 2);
  assert.equal(b.projection.balance, before.projection.balance);
  assert.deepEqual(b.projection.transaction_requests, [first.transactionRequest, second.transactionRequest]);
  assert.equal(a.transaction_request.amount, '1500000000000000');
  assert.equal(b.transaction_request.amount_minor, '50000000000000000');
  for (const result of [a, b]) {
    assert.equal(result.status, 'FINAL');
    assert.equal(result.settlementStatus, 'UNVERIFIED');
    assert.equal(result.transaction_request.status, 'PREPARED');
    assert.equal(result.transaction_request.submission_performed, false);
    assert.equal(result.transaction_request.receipt, null);
    assert.equal(result.mint_event, null); assert.equal(result.bank_transaction, null);
  }
  assert.deepEqual(bodies, [first.canonicalBody, second.canonicalBody]);
  assert.ok(await verifyTreasuryRecord(await api.readTreasury()));
});

test('invalid amounts, references, currency, fields and reasons fail before any read', async () => {
  let reads = 0;
  const client = createTreasuryPreparation({read: () => { reads++; throw Error('unexpected read'); }});
  for (const amount of ['0', '-1', '+1', '01', '1.0', '1e3', ' 1', '9'.repeat(79), 1, null]) {
    await assert.rejects(client.prepare({...mint(), amount}), {code: 'INVALID_TRANSACTION_AMOUNT'});
    await assert.rejects(client.prepare({...bank(), amountMinor: amount}), {code: 'INVALID_TRANSACTION_AMOUNT'});
  }
  for (const extra of [{Mandate: 'yes'}, {Authority: 'OTHER'}, {balance: '1'}, {extra: true}])
    await assert.rejects(client.prepare({...mint(), ...extra}), {code: 'INVALID_TREASURY_FIELDS'});
  for (const bad of [{...mint(), destinationReference: 'bank account'}, {...mint(), networkReference: ''}, {...mint(), networkReference: 42}, {...bank(), currency: 'USDC'}])
    await assert.rejects(client.prepare(bad), {code: 'INVALID_TRANSACTION_REFERENCE'});
  for (const reason of ['', ' ', '\n', 'x'.repeat(1001), null])
    await assert.rejects(client.prepare({...mint(), reason}), {code: 'TREASURY_REASON_REQUIRED'});
  await assert.rejects(client.prepare({...mint(), operation: 'MINT'}), {code: 'INVALID_TREASURY_FIELDS'});
  assert.equal(reads, 0);
});

test('intent is captured before asynchronous read and drafts belong to their issuing client', async t => {
  const {options, api, client} = await fixture(t);
  let resolve; const other = createTreasuryPreparation({...options, read: () => new Promise(r => { resolve = r; })});
  const input = mint(), pending = other.prepare(input); input.amount = '7'; input.destinationReference = 'changed';
  resolve(await api.readTreasury()); const draft = await pending;
  assert.equal(draft.event.Intent.amount, '1500000000000000');
  assert.equal(draft.event.Intent.destinationReference, 'test-treasury');
  await assert.rejects(client.submit(draft), {code: 'INVALID_TREASURY_DRAFT'});
  await assert.rejects(other.submit(structuredClone(draft)), {code: 'INVALID_TREASURY_DRAFT'});
  assert.equal((await other.submit(draft)).transaction_request.amount, '1500000000000000');
});

test('lost committed response retries identical bytes and appends only one request', async t => {
  const {api, options, bodies} = await fixture(t); let first = true;
  const client = createTreasuryPreparation({...options, write: async body => {
    const result = await options.write(body); if (first) { first = false; throw Error('response lost'); } return result;
  }});
  const before = await api.readTreasury(), draft = await client.prepare(bank());
  await assert.rejects(client.submit(draft), /response lost/);
  const result = await client.submit(draft);
  assert.equal(result.replayed, true); assert.equal(result.head_advancement.advanced, false);
  assert.deepEqual(bodies, [draft.canonicalBody, draft.canonicalBody]);
  const after = await api.readTreasury();
  assert.equal(after.revision, before.revision + 1); assert.equal(after.projection.transaction_requests.length, 1);
  const changed = JSON.parse(draft.canonicalBody); changed.Intent.amountMinor = '1';
  await assert.rejects(api.writeTreasury(changed));
});

test('competing head is rejected without rebasing or replacing the request ID', async t => {
  const {client, api, bodies} = await fixture(t);
  const draft = await client.prepare(mint()), concurrent = await client.prepare(bank());
  await client.submit(concurrent);
  await assert.rejects(client.submit(draft)); await assert.rejects(client.submit(draft));
  assert.equal(bodies[1], draft.canonicalBody); assert.equal(bodies[2], draft.canonicalBody);
  assert.equal((await api.readTreasury()).projection.transaction_requests.length, 1);
});

test('receipt tampering is rejected even when an altered event digest is recomputed', async t => {
  const {options} = await fixture(t);
  const savedBefore = await options.read();
  const client = createTreasuryPreparation(options), draft = await client.prepare(mint());
  const real = await client.submit(draft);
  const mutations = [
    r => { r.transaction_request.status = 'COMPLETED'; },
    r => { r.transaction_request.submission_performed = true; },
    r => { r.transaction_request.receipt = {id: 'invented'}; },
    r => { r.transaction_request.amount = '1'; },
    r => { r.projection.balance = '0'; r.canonical_proof.event.result.projection.balance = '0'; },
    r => { r.canonical_proof.event.result.transaction_request.destination_reference = 'other'; },
    r => { r.canonical_proof.event.command.data.Intent.networkReference = 'other'; },
    r => { r.mint_event = {status: 'MINTED'}; },
    r => { r.head_advancement.previous = 'a'.repeat(64); },
    r => { r.current_head.revision = -1; },
    r => { r.execution_scope = 'provider'; },
    r => { r.settlementStatus = 'SETTLED'; }
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(real); mutate(forged);
    forged.canonical_proof.event.commandHash = await controlHash(forged.canonical_proof.event.command);
    forged.canonical_proof.hash = await controlHash(forged.canonical_proof.event);
    forged.head_advancement.head = forged.canonical_proof.hash; forged.current_head.head = forged.canonical_proof.hash;
    const verifier = createTreasuryPreparation({...options, read: () => savedBefore, makeId: () => draft.event.id, write: () => forged});
    const d = await verifier.prepare(mint());
    await assert.rejects(verifier.submit(d), {code: 'TREASURY_PREPARATION_PROOF_INVALID'});
  }
});

test('uninitialized, corrupt and full projections cannot produce a draft', async t => {
  const {api, options} = await fixture(t), ready = await api.readTreasury();
  for (const record of [
    {...ready, status: 'NOT_INITIALIZED', projection: null, canonical_proof: null},
    {...ready, head: 'f'.repeat(64)},
    {...ready, projection: {...ready.projection, balance: '1'}}
  ]) {
    const client = createTreasuryPreparation({...options, read: () => record});
    await assert.rejects(client.prepare(mint()), {code: 'TREASURY_PREPARATION_READ_INVALID'});
  }
  // Populate through the real reducer so the capacity test uses a valid proof.
  const client = createTreasuryPreparation(options);
  for (let i = 0; i < 100; i++) await client.submit(await client.prepare({...mint(), amount: '1'}));
  const before = await api.readTreasury();
  await assert.rejects(client.prepare(bank()), {code: 'TREASURY_REQUEST_CAPACITY'});
  assert.deepEqual(await api.readTreasury(), before);
});

test('default transport uses only canonical GET/POST and owner cookie mode with exact retry bytes', async t => {
  const {api} = await fixture(t), calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({path, method: options.method, body: options.body});
    assert.equal(path, '/api/control/v1/treasury');
    assert.equal(options.credentials, 'same-origin');
    const value = options.method === 'GET' ? await api.readTreasury() : await api.writeTreasury(JSON.parse(options.body));
    return {ok: true, status: 200, redirected: false, json: async () => value};
  });
  const client = createTreasuryPreparation({makeId: () => 'canonical-prepare'});
  const draft = await client.prepare(bank());
  await client.submit(draft); await client.submit(draft);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'POST']);
  assert.equal(calls[1].body, draft.canonicalBody); assert.equal(calls[2].body, draft.canonicalBody);
});
