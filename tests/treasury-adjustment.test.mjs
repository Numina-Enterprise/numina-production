import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/sqlite.mjs';
import {bootstrapControl, readControl, commitControl} from '../src/control-store.js';
import {controlHash, stable} from '../src/control.js';
import {createNuminaTreasury} from '../src/native-treasury.js';
import {verifyTreasuryRecord} from '../public/treasury-proof.js';
import {canonicalTreasuryJson, createTreasuryAdjustment} from '../public/treasury-adjustment.js';

const owner = 'email:owner@example.test';
const now = () => Math.floor(Date.now() / 1000);
const input = () => ({delta: '1000000000000000', reason: 'Owner-authorized native projection adjustment'});

async function fixture(t, {preparedRequest = false} = {}) {
  const db = database();
  t.after(() => db.close());
  await bootstrapControl(db, owner, now());
  const api = createNuminaTreasury({db, root: owner, principal: owner});
  async function command(id, Objective, Intent) {
    const row = await readControl(db);
    return {id, expectedRevision: row.revision, expectedHead: row.head_hash,
      Principal: owner, Authority: 'NUMINA', Objective, Intent};
  }
  await api.writeTreasury(await command('initialize', 'treasury.initialize', {operation: 'INITIALIZE', reason: 'Isolated test'}));
  if (preparedRequest) await api.writeTreasury(await command('existing-request', 'treasury.mint.prepare', {
    operation: 'PREPARE_MINT', amount: '1', networkReference: 'test-network', destinationReference: 'test-destination', reason: 'Isolated retained request'}));
  const bodies = [];
  const client = createTreasuryAdjustment({read: () => api.readTreasury(), makeId: () => 'reviewed-adjustment',
    write: body => { bodies.push(body); return api.writeTreasury(JSON.parse(body)); }});
  return {db, api, client, bodies};
}

test('canonical JSON matches journal bytes and rejects lossy or non-JSON inputs', () => {
  const value = {z: '9007199254740993', a: [null, true, {c: 2, b: 'text'}]};
  assert.equal(canonicalTreasuryJson(value), stable(value));
  const cycle = {}; cycle.self = cycle;
  for (const bad of [undefined, 1.5, -0, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, 1n, new Date(),
    {a: undefined}, [undefined], Array(1), cycle]) assert.throws(() => canonicalTreasuryJson(bad), /Invalid canonical JSON/);
});

test('500T to 1500T commits the reviewed native adjustment with preserved requests and verified proof', async t => {
  const {api, client, bodies} = await fixture(t, {preparedRequest: true});
  const before = await api.readTreasury();
  const draft = await client.prepare(input());
  assert.equal(draft.beforeBalance, '500000000000000');
  assert.equal(draft.afterBalance, '1500000000000000');
  assert.deepEqual(draft.event, {id: 'reviewed-adjustment', expectedRevision: before.revision, expectedHead: before.head,
    Principal: owner, Authority: 'NUMINA', Objective: 'treasury.project',
    Intent: {operation: 'ADJUST_PROJECTION', ...input()}});
  for (const value of [draft, draft.event, draft.event.Intent]) assert.ok(Object.isFrozen(value));
  assert.equal(draft.canonicalBody, stable(draft.event));
  const result = await client.submit(draft);
  assert.equal(result.status, 'FINAL');
  assert.equal(result.settlementStatus, 'UNVERIFIED');
  assert.equal(result.projection.balance, draft.afterBalance);
  assert.deepEqual(result.projection.transaction_requests, before.projection.transaction_requests);
  for (const field of ['transaction_request', 'mint_event', 'bank_transaction']) assert.equal(result[field], null);
  assert.equal(result.head_advancement.revision, before.revision + 1);
  assert.equal(result.head_advancement.previous, before.head);
  assert.deepEqual(bodies, [draft.canonicalBody]);
  assert.equal(await verifyTreasuryRecord(await api.readTreasury()), true);
  assert.ok(Object.isFrozen(result.canonical_proof.event.command.data.Intent));
});

test('prepare rejects noncanonical deltas and invalid reasons before reading', async () => {
  let reads = 0;
  const client = createTreasuryAdjustment({read: () => { reads++; throw Error('should not read'); }});
  for (const delta of ['0', '-0', '+1', '01', '-01', '1.0', '1e3', '', ' 1', '1 ', '9'.repeat(79), 1, 1n, null]) {
    await assert.rejects(client.prepare({...input(), delta}), {code: 'INVALID_TREASURY_DELTA'});
  }
  for (const reason of ['', '  ', '\nreason', 'a\u0000b', 'x'.repeat(1001), 1, null]) {
    await assert.rejects(client.prepare({...input(), reason}), {code: 'TREASURY_REASON_REQUIRED'});
  }
  assert.equal(reads, 0);
});

test('prepare rejects negative and oversized balances but supports exact withdrawal to zero', async t => {
  const {client} = await fixture(t);
  await assert.rejects(client.prepare({...input(), delta: '-500000000000001'}), {code: 'TREASURY_BALANCE_OUT_OF_RANGE'});
  await assert.rejects(client.prepare({...input(), delta: '9'.repeat(78)}), {code: 'TREASURY_BALANCE_OUT_OF_RANGE'});
  const zero = await client.prepare({...input(), delta: '-500000000000000'});
  assert.equal(zero.afterBalance, '0');
  assert.equal((await client.submit(zero)).projection.balance, '0');
});

test('prepare refuses an uninitialized record or tampered read proof', async t => {
  const {api} = await fixture(t);
  const ready = await api.readTreasury();
  let writes = 0;
  const variants = [
    {...ready, status: 'NOT_INITIALIZED', projection: null, canonical_proof: null},
    {...ready, head: 'f'.repeat(64)},
    {...ready, projection: {...ready.projection, balance: '1'}}
  ];
  for (const record of variants) {
    const client = createTreasuryAdjustment({read: () => record, write: () => writes++});
    await assert.rejects(client.prepare(input()), {code: 'TREASURY_ADJUSTMENT_READ_INVALID'});
  }
  assert.equal(writes, 0);
});

test('prepare captures inputs and read record before asynchronous proof verification', async t => {
  const {api} = await fixture(t);
  const record = await api.readTreasury(), request = input();
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  let changed = false;
  t.mock.method(crypto.subtle, 'digest', (...args) => {
    if (!changed) {
      changed = true;
      record.projection.balance = '1';
      record.root = 'email:changed@example.test';
      request.delta = '1'; request.reason = 'Changed after verification began';
    }
    return originalDigest(...args);
  });
  const client = createTreasuryAdjustment({read: () => record, makeId: () => 'immutable-prepare'});
  const draft = await client.prepare(request);
  assert.equal(draft.beforeBalance, '500000000000000');
  assert.equal(draft.afterBalance, '1500000000000000');
  assert.equal(draft.event.Principal, owner);
  assert.equal(draft.event.Intent.delta, input().delta);
  assert.equal(draft.event.Intent.reason, input().reason);
});

test('only originating-client draft identity can submit and frozen drafts cannot change', async t => {
  const {client, bodies} = await fixture(t);
  const draft = await client.prepare(input());
  for (const fake of [{...draft}, JSON.parse(JSON.stringify(draft)), draft.event, null, undefined]) {
    await assert.rejects(client.submit(fake), {code: 'INVALID_TREASURY_DRAFT'});
  }
  await assert.rejects(createTreasuryAdjustment().submit(draft), {code: 'INVALID_TREASURY_DRAFT'});
  assert.throws(() => { draft.event.Intent.delta = '1'; }, TypeError);
  assert.throws(() => { draft.canonicalBody = '{}'; }, TypeError);
  assert.equal(bodies.length, 0);
});

test('a stale snapshot fails once and an explicit retry never refreshes revision or head', async t => {
  const {db, api} = await fixture(t);
  let reads = 0, ids = 0; const bodies = [];
  const client = createTreasuryAdjustment({read: () => { reads++; return api.readTreasury(); },
    makeId: () => { ids++; return 'stale-review'; }, write: body => { bodies.push(body); return api.writeTreasury(JSON.parse(body)); }});
  const draft = await client.prepare(input());
  await commitControl(db, {id: 'intervening-event', expectedRevision: draft.event.expectedRevision, type: 'reconcile', data: {}}, owner, now());
  await assert.rejects(client.submit(draft), /STALE_TREASURY_HEAD/);
  assert.equal(bodies.length, 1);
  await assert.rejects(client.submit(draft), /STALE_TREASURY_HEAD/);
  assert.deepEqual(bodies, [draft.canonicalBody, draft.canonicalBody]);
  assert.equal(reads, 1); assert.equal(ids, 1);
  assert.equal((await api.readTreasury()).projection.balance, draft.beforeBalance);
});

test('an uncertain committed write retries identical bytes and records only one adjustment', async t => {
  const {db, api} = await fixture(t);
  const before = await readControl(db), bodies = []; let reads = 0, ids = 0;
  const client = createTreasuryAdjustment({read: () => { reads++; return api.readTreasury(); },
    makeId: () => { ids++; return 'uncertain-commit'; }, write: async body => {
      bodies.push(body); const response = await api.writeTreasury(JSON.parse(body));
      if (bodies.length === 1) throw Object.assign(Error('Connection timed out after commit'), {code: 'REQUEST_TIMEOUT'});
      return response;
    }});
  const draft = await client.prepare(input());
  await assert.rejects(client.submit(draft), {code: 'REQUEST_TIMEOUT'});
  assert.equal(bodies.length, 1);
  const result = await client.submit(draft);
  assert.equal(result.replayed, true); assert.equal(result.head_advancement.advanced, false);
  assert.deepEqual(bodies, [draft.canonicalBody, draft.canonicalBody]);
  assert.equal(reads, 1); assert.equal(ids, 1);
  assert.equal((await readControl(db)).eventCount, before.eventCount + 1);
});

test('submission binds response command, balance, requests, authority and head even when hashes are recomputed', async t => {
  const {api} = await fixture(t, {preparedRequest: true});
  const read = await api.readTreasury();
  let response;
  const client = createTreasuryAdjustment({read: () => read, makeId: () => 'bound-response', write: () => response});
  const draft = await client.prepare(input());
  const valid = await api.writeTreasury(draft.event);
  const mutations = [
    ['not FINAL', r => { r.status = 'READY'; }],
    ['wrong route', r => { r.route = 'other'; }],
    ['external execution scope', r => { r.execution_scope = 'provider'; }],
    ['fabricated provider settlement', r => { r.settlementStatus = 'SETTLED'; }],
    ['invalid replay flag', r => { r.replayed = 'false'; }],
    ['transaction request', r => { r.transaction_request = {}; }],
    ['mint event', r => { r.mint_event = {}; }],
    ['bank transaction', r => { r.bank_transaction = {}; }],
    ['proof result request', r => { r.canonical_proof.event.result.transaction_request = {}; }],
    ['wrong command id', r => { r.canonical_proof.event.command.id = 'other'; }],
    ['wrong event id', r => { r.canonical_proof.event.id = 'other'; }],
    ['wrong actor', r => { r.canonical_proof.event.actor = 'email:other@example.test'; }],
    ['wrong objective', r => { r.canonical_proof.event.command.data.Objective = 'treasury.mint.prepare'; }],
    ['wrong delta', r => { r.canonical_proof.event.command.data.Intent.delta = '1'; }],
    ['wrong reason', r => { r.canonical_proof.event.command.data.Intent.reason = 'Changed'; }],
    ['extra command field', r => { r.canonical_proof.event.command.extra = true; }],
    ['wrong balance', r => { r.projection.balance = r.canonical_proof.event.result.projection.balance = '1'; }],
    ['modified request', r => { r.projection.transaction_requests[0].amount = '2'; r.canonical_proof.event.result.projection.transaction_requests[0].amount = '2'; }],
    ['omitted requests', r => { r.projection.transaction_requests = r.canonical_proof.event.result.projection.transaction_requests = []; }],
    ['wrong event revision', r => { r.canonical_proof.event.revision++; }],
    ['wrong event previous', r => { r.canonical_proof.event.previous = 'a'.repeat(64); }],
    ['wrong advancement previous', r => { r.head_advancement.previous = 'a'.repeat(64); }],
    ['wrong advancement revision', r => { r.head_advancement.revision++; }],
    ['wrong advancement state', r => { r.head_advancement.advanced = false; }],
    ['current revision behind', r => { r.current_head.revision--; }]
  ];
  for (const [name, mutate] of mutations) {
    response = structuredClone(valid); mutate(response);
    response.canonical_proof.event.commandHash = await controlHash(response.canonical_proof.event.command);
    response.canonical_proof.hash = await controlHash(response.canonical_proof.event);
    response.head_advancement.head = response.current_head.head = response.canonical_proof.hash;
    await assert.rejects(client.submit(draft), {code: 'TREASURY_ADJUSTMENT_PROOF_INVALID'}, name);
  }
  for (const mutate of [r => { r.canonical_proof.hash = 'a'.repeat(64); },
    r => { r.canonical_proof.event.commandHash = 'a'.repeat(64); },
    r => { r.head_advancement.head = 'a'.repeat(64); }, r => { r.current_head.head = 'a'.repeat(64); }]) {
    response = structuredClone(valid); mutate(response);
    await assert.rejects(client.submit(draft), {code: 'TREASURY_ADJUSTMENT_PROOF_INVALID'});
  }
  response = valid;
  assert.equal((await client.submit(draft)).status, 'FINAL');
});

test('submission captures response before hashing yields and accepts exact replay after later activity', async t => {
  const {api, client, db} = await fixture(t);
  const draft = await client.prepare(input());
  const result = await client.submit(draft);
  await commitControl(db, {id: 'later-activity', expectedRevision: result.current_head.revision, type: 'reconcile', data: {}}, owner, now());
  const replay = await client.submit(draft);
  assert.equal(replay.replayed, true);
  assert.ok(replay.current_head.revision > replay.head_advancement.revision);
  assert.notEqual(replay.current_head.head, replay.head_advancement.head);

  const record = await api.readTreasury(); let response;
  const captured = createTreasuryAdjustment({read: () => record, makeId: () => 'captured-response', write: () => response});
  const next = await captured.prepare({...input(), delta: '1'});
  response = await api.writeTreasury(next.event);
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'digest', (...args) => {
    response.projection.balance = '1';
    response.canonical_proof.event.command.data.Intent.delta = '99';
    return originalDigest(...args);
  });
  const committed = await captured.submit(next);
  assert.equal(committed.projection.balance, '1500000000000001');
  assert.equal(committed.canonical_proof.event.command.data.Intent.delta, '1');
});

test('default transport calls only canonical treasury GET and POST, with exact retry bytes', async t => {
  const {api} = await fixture(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({path, method: options.method, body: options.body});
    assert.equal(path, '/api/control/v1/treasury');
    const value = options.method === 'GET' ? await api.readTreasury() : await api.writeTreasury(JSON.parse(options.body));
    return {ok: true, status: 200, redirected: false, json: async () => value};
  });
  const client = createTreasuryAdjustment({makeId: () => 'canonical-only'});
  const draft = await client.prepare(input());
  await client.submit(draft);
  await client.submit(draft);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'POST']);
  assert.ok(calls.every(call => call.path === '/api/control/v1/treasury'));
  assert.equal(calls[1].body, draft.canonicalBody);
  assert.equal(calls[2].body, draft.canonicalBody);
});
