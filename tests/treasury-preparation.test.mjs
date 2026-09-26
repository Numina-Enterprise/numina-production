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
const usdc = () => ({operation: 'PREPARE_USDC_DEPOSIT', amount: '500000000000000', destinationReference: '0x736bd8f274dce00a8bb374edd85df0d2e631018e', reason: 'Prepare the owner-authorized Stripe USDC destination on Base'});
const aggregate = () => ({operation: 'PREPARE_AGGREGATE_MODEL', aggregateAmount: '1500000000000000', bankAmount: '500000000000000', stripeAmount: '500000000000000', nativeAmount: '500000000000000', reason: 'Prepare the three-role aggregate model without asserting external execution'});
async function fixture(t, {adjust = true} = {}) {
  const db = database(); t.after(() => db.close());
  await bootstrapControl(db, owner, Math.floor(Date.now() / 1000));
  const api = createNuminaTreasury({db, root: owner, principal: owner});
  for (const [id, Objective, Intent] of [
    ['initialize', 'treasury.initialize', {operation: 'INITIALIZE', reason: 'Isolated test'}],
    ...(adjust ? [['adjust', 'treasury.project', {operation: 'ADJUST_PROJECTION', delta: '1000000000000000', reason: 'Isolated test'}]] : [])
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
    assert.equal(result.transaction_request.status, 'PREPARED');
    assert.equal(result.transaction_request.submission_performed, false);
    assert.equal(result.transaction_request.receipt, null);
    assert.equal(result.mint_event, null); assert.equal(result.bank_transaction, null);
  }
  assert.deepEqual(bodies, [first.canonicalBody, second.canonicalBody]);
  assert.ok(await verifyTreasuryRecord(await api.readTreasury()));
});

test('Base USDC preparation binds the canonical asset and destination without claiming wallet execution', async t => {
  const {api, client, bodies} = await fixture(t);
  const before = await api.readTreasury();
  const draft = await client.prepare(usdc());
  assert.equal(draft.event.Objective, 'treasury.usdc.prepare');
  assert.equal(draft.event.expectedRevision, before.revision);
  assert.equal(draft.event.expectedHead, before.head);
  assert.deepEqual(draft.transactionRequest, {
    id: 'prepare-1', kind: 'usdc_transfer_request', status: 'PREPARED',
    destination_reference: '0x736bd8f274dce00a8bb374edd85df0d2e631018e',
    destination_financial_account: 'fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu', destination_financial_address: 'finaddr_61VNd8JyhbqklVBhF16VNcN9EZSQiQliazWdBc8FkRw8', destination_binding_verified: true,
    journal_idempotency_key: 'prepare-1', journal_replay_preconditions: ['expectedRevision', 'expectedHead'],
    amount: '500000000000000', amount_base_units: '500000000000000000000',
    network: 'Base', chain_id: 8453, network_reference: 'eip155:8453',
    token_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', unit: 'USDC', decimals: 6,
    source_wallet: null, signer_control_verified: false, source_usdc_balance: null, source_base_eth_gas_balance: null,
    execution_performed: false, broadcast_performed: false, submission_performed: false, transaction_hash: null, receipt: null,
    prerequisite_blockers: ['SOURCE_WALLET_NOT_RECORDED', 'BASE_SIGNER_CONTROL_NOT_VERIFIED', 'SOURCE_USDC_BALANCE_NOT_VERIFIED', 'BASE_ETH_GAS_BALANCE_NOT_VERIFIED']
  });
  const result = await client.submit(draft);
  assert.equal(result.status, 'FINAL');
  assert.equal(result.projection.balance, before.projection.balance);
  assert.deepEqual(result.transaction_request, draft.transactionRequest);
  assert.equal(result.transaction_request.execution_performed, false);
  assert.equal(result.transaction_request.broadcast_performed, false);
  assert.equal(result.transaction_request.source_wallet, null);
  assert.equal(result.transaction_request.transaction_hash, null);
  assert.equal(bodies[0], draft.canonicalBody);
  assert.ok(await verifyTreasuryRecord(await api.readTreasury()));
});

test('aggregate preparation records the exact model-only request and preserves the native balance', async t => {
  const {api, client, bodies} = await fixture(t, {adjust: false});
  const before = await api.readTreasury(), input = aggregate();
  const draft = await client.prepare(input);
  assert.equal(draft.event.Objective, 'treasury.aggregate.prepare');
  assert.deepEqual(draft.event.Intent, input);
  assert.equal(draft.event.expectedRevision, before.revision);
  assert.equal(draft.event.expectedHead, before.head);
  assert.deepEqual(draft.transactionRequest, {
    id: 'prepare-1', kind: 'aggregate_model_request', status: 'PREPARED_MODEL_ONLY', authority: 'NUMINA',
    owner_approval: {status: 'OWNER_APPROVAL_RECORDED', reference: '/owner-approval.js'},
    aggregate_amount: '1500000000000000', aggregation: 'SUM_OF_SEPARATE_ROLE_AMOUNTS',
    components: [
      {id: 'native-nusd', role: 'NATIVE_VALUE', observation_scope: 'RECEIPT_BACKED_ISSUANCE', source: 'NUMINA_CONSTRUCTOR_MINT_RECEIPT', amount: '500000000000000', unit: 'NUSD', status: 'PREPARED_MODEL_ONLY', evidence_references: ['/downloads/nusd/mint-receipt.json', '/downloads/nusd/deployment-verification.json'], constructor_mint_block: '51725', constructor_mint_transaction: '0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b', denomination_policy_declaration: '1 NUSD = 1 USDC = 1 USD', issuer_policy_hash: '0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5', issuer_policy_approval_reference: '/owner-approval.js', policy_declaration_scope: 'ISSUER_POLICY_DECLARATION_NOT_EXTERNAL_BACKING', burn_observation: {block_number: '51749', scope: 'DATED_DEPLOYMENT_VERIFICATION_OBSERVATION', constructor_issuance_base_units: '1500000000000000000000000000000000', total_supply_base_units: '1500000000000000000000000000000000', recipient_balance_base_units: '1500000000000000000000000000000000', burned_nusd: '0', burned_base_units: '0', current_chain_burn_state_verified: false}, externally_backed_claim: false, external_settlement_usdc: false, reserves_verified: false, external_reserve_verified: false},
      {id: 'stripe-usdc', role: 'DIGITAL_DOLLAR_ROUTE', observation_scope: 'PROVIDER_SCOPED_OBSERVATION', source: 'STRIPE_DESTINATION_OBSERVATION', amount: '500000000000000', unit: 'USDC', status: 'PREPARED_MODEL_ONLY', evidence_references: ['/api/control/v2/treasury/provider-routes', '/metadata-alignment.json'], provider_balance_verified: false, provider_transaction_verified: false},
      {id: 'bank-usd', role: 'BANK_ROUTE', observation_scope: 'NUMINA_SCOPED_OBSERVATION', source: 'OWNER_PROVIDED_BANK_ALIGNMENT', amount: '500000000000000', unit: 'USD', status: 'PREPARED_MODEL_ONLY', evidence_references: ['/api/control/v2/treasury/accounts', '/downloads/Provider-Confirmation-Request-v4.md'], provider_balance_verified: false, provider_transaction_verified: false}
    ],
    external_balance_verified: false, external_provider_verification: false, external_backing_verified: false, external_funds_moved: false,
    execution_performed: false, broadcast_performed: false, submission_performed: false, settlement_performed: false,
    transaction_hash: null, receipt: null, reconciliation: {status: 'PENDING_EVIDENCE', evidence_required: true}
  });
  const result = await client.submit(draft);
  assert.equal(result.status, 'FINAL');
  assert.deepEqual(result.transaction_request, draft.transactionRequest);
  assert.equal(result.transaction_request.status, 'PREPARED_MODEL_ONLY');
  assert.equal(result.projection.balance, before.projection.balance);
  assert.equal(bodies[0], draft.canonicalBody);
  const after = await api.readTreasury();
  assert.equal(after.projection.balance, before.projection.balance);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.projection.transaction_requests, [...before.projection.transaction_requests, draft.transactionRequest]);
  assert.ok(await verifyTreasuryRecord(after));
});

test('invalid amounts, references, currency, fields and reasons fail before any read', async () => {
  let reads = 0;
  const client = createTreasuryPreparation({read: () => { reads++; throw Error('unexpected read'); }});
  for (const amount of ['0', '-1', '+1', '01', '1.0', '1e3', ' 1', '9'.repeat(79), 1, null]) {
    await assert.rejects(client.prepare({...mint(), amount}), {code: 'INVALID_TRANSACTION_AMOUNT'});
    await assert.rejects(client.prepare({...bank(), amountMinor: amount}), {code: 'INVALID_TRANSACTION_AMOUNT'});
    await assert.rejects(client.prepare({...usdc(), amount}), {code: 'INVALID_TRANSACTION_AMOUNT'});
  }
  for (const extra of [{Mandate: 'yes'}, {Authority: 'OTHER'}, {balance: '1'}, {extra: true}])
    await assert.rejects(client.prepare({...mint(), ...extra}), {code: 'INVALID_TREASURY_FIELDS'});
  for (const bad of [{...mint(), destinationReference: 'bank account'}, {...mint(), networkReference: ''}, {...mint(), networkReference: 42}, {...bank(), currency: 'USDC'}, {...usdc(), destinationReference: 'stripe-wallet'}, {...usdc(), destinationReference: '0x736bd8f274dce00a8bb374edd85df0d2e631018'}])
    await assert.rejects(client.prepare(bad), {code: 'INVALID_TRANSACTION_REFERENCE'});
  await assert.rejects(client.prepare({...usdc(), networkReference: 'eip155:1'}), {code: 'INVALID_TREASURY_FIELDS'});
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
    r => { r.execution_scope = 'provider'; }
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
