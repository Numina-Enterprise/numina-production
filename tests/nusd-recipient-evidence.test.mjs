import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getAddress, keccak256, TypedDataEncoder, verifyTypedData, Wallet } from '../runtime/nusd/node_modules/ethers/lib.esm/index.js';
import {
  verifyMintRecipient, observeMintRecipient, recipientControlTypedData,
  RECIPIENT_REQUEST_SCHEMA, RECIPIENT_EVIDENCE_SCHEMA, NUMINA_CHAIN_ID, RECIPIENT_CONTROL_PURPOSE
} from '../runtime/nusd/scripts/verify-mint-recipient.mjs';

const RECIPIENT = getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72');
const BLOCK_HASH = '0x' + 'ab'.repeat(32);
const OTHER_HASH = '0x' + 'cd'.repeat(32);
const NOW = new Date('2026-09-15T12:00:00Z');
const EPOCH = BigInt(Math.floor(NOW.getTime() / 1000));
const CHAIN_HEX = '0x' + BigInt(NUMINA_CHAIN_ID).toString(16);
const BLOCK = { number: '0x2a', hash: BLOCK_HASH, timestamp: '0x12345' };
const now = () => new Date(NOW);
function request(extra = {}) {
  return { schema: RECIPIENT_REQUEST_SCHEMA, expectedChainId: NUMINA_CHAIN_ID,
    recipient: RECIPIENT, block: { tag: 'finalized' }, ...extra };
}
function fixture(override = () => undefined) {
  const calls = [];
  return { calls, rpc: async (method, params) => {
    calls.push({ method, params });
    const custom = override(method, params, calls.length);
    if (custom !== undefined) return custom;
    if (method === 'eth_chainId') return CHAIN_HEX;
    if (method === 'eth_getBlockByNumber') return { ...BLOCK };
    if (method === 'eth_getCode') return '0x';
    assert.fail('Unexpected RPC method: ' + method);
  } };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
// A fixed arbitrary recovery vector, not a wallet credential or generated signature.
// It recovers an unrelated key and must never be accepted as recipient evidence.
const WRONG_SIGNATURE = '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' + '0'.repeat(63) + '1' + '1b';
function proof(extra = {}) {
  return { purpose: RECIPIENT_CONTROL_PURPOSE, issuedAt: (EPOCH - 60n).toString(),
    expiresAt: (EPOCH + 60n).toString(), nonce: OTHER_HASH, signature: WRONG_SIGNATURE, ...extra };
}
async function signedTestRequest() {
  // Disposable, publicly visible test key only. Signs an in-memory EIP-712 test
  // challenge; no real wallet/key file, RPC provider or transaction is involved.
  const disposable = new Wallet('0x' + '42'.repeat(32));
  const config = request({ recipient: disposable.address, controlProof: proof() });
  delete config.controlProof.signature;
  const { domain, types, value } = recipientControlTypedData(config);
  config.controlProof.signature = await disposable.signTypedData(domain, types, value);
  return config;
}

test('empty code is a pinned provider observation with key control, asset receipt and mint unverified', async () => {
  const f = fixture();
  const result = await verifyMintRecipient(request(), { rpc: f.rpc, now });
  assert.equal(result.schema, RECIPIENT_EVIDENCE_SCHEMA);
  assert.equal(result.status, 'recipient_observed');
  assert.equal(result.observedAt, NOW.toISOString());
  assert.deepEqual(result.chain, { expectedChainId: NUMINA_CHAIN_ID, observedChainId: NUMINA_CHAIN_ID });
  assert.equal(result.recipient, RECIPIENT);
  assert.equal(result.observedBlock.number, '42');
  assert.equal(result.observedBlock.hash, BLOCK_HASH);
  assert.equal(result.observedBlock.finalizedTagReportedByProvider, true);
  assert.equal(result.observedBlock.canonicalAtFinalReadReportedByProvider, true);
  assert.equal(result.recipientCode.status, 'empty');
  assert.equal(result.recipientCode.bytes, 0);
  assert.equal(result.recipientCode.hash, keccak256('0x'));
  assert.deepEqual(result.controlProof, { status: 'not_provided', signatureMatchesRecipientKey: false });
  for (const key of ['independentlyVerified', 'walletControlVerified', 'keyCustodyVerified',
    'assetReceiptCapabilityVerified', 'reservesVerified', 'reserveAllocationVerified', 'mintCompleted', 'fundsMoved', 'broadcast']) assert.equal(result[key], false, key);
  assert.equal(result.receipt, null);
  assert.equal(result.transactionHash, null);
  assert.equal(result.rpcReadCalls, 5);
  assert.deepEqual(f.calls, [
    { method: 'eth_chainId', params: [] },
    { method: 'eth_getBlockByNumber', params: ['finalized', false] },
    { method: 'eth_getCode', params: [RECIPIENT, { blockHash: BLOCK_HASH, requireCanonical: true }] },
    { method: 'eth_getBlockByNumber', params: ['0x2a', false] },
    { method: 'eth_chainId', params: [] }
  ]);
});

test('latest and explicit block selection retain their scope without claiming finality', async () => {
  for (const selection of [{ tag: 'latest' }, { number: '42', hash: BLOCK_HASH }]) {
    const f = fixture(method => method === 'eth_getCode' ? '0x60016000' : undefined);
    const result = await verifyMintRecipient(request({ block: selection }), { rpc: f.rpc, now });
    assert.deepEqual(result.observedBlock.requestedSelection, selection);
    assert.equal(result.observedBlock.finalizedTagReportedByProvider, false);
    assert.equal(result.recipientCode.status, 'nonempty');
    assert.equal(result.recipientCode.hash, keccak256('0x60016000'));
    assert.equal(result.recipientCode.bytes, 4);
    assert.equal(result.assetReceiptCapabilityVerified, false);
    assert.equal(result.walletControlVerified, false);
  }
});

test('configuration, zero, templates, role aliases and non-checksummed addresses fail before RPC', async () => {
  const cases = [
    [request({ expectedChainId: '1' }), 'INVALID_REQUEST'],
    [request({ expectedChainId: 962421430 }), 'INVALID_REQUEST'],
    [request({ recipient: '0x' + '0'.repeat(40) }), 'INVALID_RECIPIENT'],
    [request({ recipient: '0xTreasuryRecipient' }), 'INVALID_RECIPIENT'],
    [request({ recipient: 'roles.admin' }), 'INVALID_RECIPIENT'],
    [request({ recipient: RECIPIENT.toLowerCase() }), 'INVALID_RECIPIENT'],
    [request({ recipient: RECIPIENT + ' ' }), 'INVALID_RECIPIENT'],
    [request({ block: { tag: 'pending' } }), 'INVALID_REQUEST'],
    [request({ block: { number: '042', hash: BLOCK_HASH } }), 'INVALID_REQUEST'],
    [request({ block: { number: '42' } }), 'INVALID_REQUEST'],
    [request({ block: { number: '42', hash: '0x' + '0'.repeat(64) } }), 'INVALID_REQUEST']
  ];
  for (const [config, code] of cases) {
    const f = fixture();
    await rejectsCode(verifyMintRecipient(config, { rpc: f.rpc, now }), code);
    assert.equal(f.calls.length, 0);
  }
});

test('unknown request, block and signature fields are rejected rather than trusted or echoed', async () => {
  for (const config of [
    request({ balance: '999999', verified: true }),
    request({ privateKey: 'DO_NOT_ECHO_PRIVATE_INPUT' }),
    request({ rpcUrl: 'https://provider.invalid/DO_NOT_ECHO_AUTH' }),
    request({ block: { tag: 'finalized', hash: BLOCK_HASH } }),
    request({ controlProof: proof({ signer: RECIPIENT }) }),
    request({ controlProof: proof({ chainId: NUMINA_CHAIN_ID }) })
  ]) {
    const f = fixture();
    await assert.rejects(verifyMintRecipient(config, { rpc: f.rpc, now }), error => {
      assert.ok(['INVALID_REQUEST', 'INVALID_CONTROL_PROOF'].includes(error.code));
      assert.doesNotMatch(error.message, /DO_NOT_ECHO/);
      return true;
    });
    assert.equal(f.calls.length, 0);
  }
});

test('wrong chain and unavailable blocks produce no recipient observation', async () => {
  let f = fixture(method => method === 'eth_chainId' ? '0x1' : undefined);
  await rejectsCode(verifyMintRecipient(request(), { rpc: f.rpc, now }), 'CHAIN_MISMATCH');
  assert.equal(f.calls.length, 1);
  f = fixture(method => method === 'eth_getBlockByNumber' ? null : undefined);
  await rejectsCode(verifyMintRecipient(request(), { rpc: f.rpc, now }), 'BLOCK_NOT_FOUND');
  assert.equal(f.calls.length, 2);
  f = fixture();
  await rejectsCode(verifyMintRecipient(request({ block: { number: '42', hash: OTHER_HASH } }), { rpc: f.rpc, now }), 'BLOCK_MISMATCH');
  assert.equal(f.calls.length, 2);
});

test('changed block hash, number, timestamp or chain fails the consistency check', async () => {
  for (const changes of [{ hash: OTHER_HASH }, { number: '0x2b' }, { timestamp: '0x12346' }]) {
    const f = fixture((method, params, count) => count === 4 ? { ...BLOCK, ...changes } : undefined);
    await rejectsCode(verifyMintRecipient(request(), { rpc: f.rpc, now }), 'SNAPSHOT_CHANGED');
  }
  const f = fixture((method, params, count) => count === 5 ? '0x1' : undefined);
  await rejectsCode(verifyMintRecipient(request(), { rpc: f.rpc, now }), 'CHAIN_MISMATCH');
});

test('malformed provider quantities, block identities and code fail closed', async () => {
  for (const [method, value] of [
    ['eth_chainId', '0x01'], ['eth_chainId', NUMINA_CHAIN_ID],
    ['eth_getBlockByNumber', {}], ['eth_getBlockByNumber', { ...BLOCK, hash: '0x' + '0'.repeat(64) }],
    ['eth_getBlockByNumber', { ...BLOCK, timestamp: null }],
    ['eth_getCode', null], ['eth_getCode', '0x1'], ['eth_getCode', '0xzz'],
    ['eth_getCode', '0x' + 'ab'.repeat(524288)]
  ]) {
    const f = fixture(name => name === method ? value : undefined);
    await rejectsCode(verifyMintRecipient(request(), { rpc: f.rpc, now }), 'RPC_INVALID_RESPONSE');
  }
});

test('optional proof is bound to fixed chain, exact recipient, purpose, expiry and nonce', () => {
  const config = request({ controlProof: proof() });
  const data = recipientControlTypedData(config);
  assert.deepEqual(data.domain, { name: 'Numina mint recipient evidence', version: '1', chainId: NUMINA_CHAIN_ID });
  assert.equal(data.value.recipient, RECIPIENT);
  assert.equal(data.value.purpose, RECIPIENT_CONTROL_PURPOSE);
  assert.equal(data.value.expiresAt, proof().expiresAt);
  assert.equal(data.value.nonce, OTHER_HASH);
  const digest = TypedDataEncoder.hash(data.domain, data.types, data.value);
  for (const [domain, value] of [
    [{ ...data.domain, chainId: '1' }, data.value],
    [data.domain, { ...data.value, recipient: getAddress('0x' + '12'.repeat(20)) }],
    [data.domain, { ...data.value, purpose: 'authorize mint' }],
    [data.domain, { ...data.value, expiresAt: (EPOCH + 59n).toString() }],
    [data.domain, { ...data.value, nonce: BLOCK_HASH }]
  ]) assert.notEqual(TypedDataEncoder.hash(domain, data.types, value), digest);
  assert.notEqual(verifyTypedData(data.domain, data.types, data.value, WRONG_SIGNATURE), RECIPIENT);
  const unsigned = structuredClone(config);
  delete unsigned.controlProof.signature;
  assert.deepEqual(recipientControlTypedData(unsigned), data);
});

test('wrong, malformed, expired, future and overly broad signatures never authorize evidence', async () => {
  const unsignedProof = proof();
  delete unsignedProof.signature;
  for (const [controlProof, code] of [
    [proof(), 'CONTROL_PROOF_SIGNER_MISMATCH'],
    [proof({ signature: '0x' + '00'.repeat(65) }), 'INVALID_CONTROL_PROOF'],
    [proof({ expiresAt: EPOCH.toString() }), 'CONTROL_PROOF_EXPIRED'],
    [proof({ issuedAt: (EPOCH + 1n).toString() }), 'CONTROL_PROOF_NOT_YET_VALID'],
    [proof({ expiresAt: (EPOCH + 7200n).toString() }), 'INVALID_CONTROL_PROOF'],
    [proof({ purpose: 'authorize mint' }), 'INVALID_CONTROL_PROOF'],
    [proof({ nonce: '0x' + '00'.repeat(32) }), 'INVALID_CONTROL_PROOF'],
    [proof({ signature: '0xabc' }), 'INVALID_CONTROL_PROOF'],
    [unsignedProof, 'INVALID_CONTROL_PROOF'],
    [null, 'INVALID_CONTROL_PROOF']
  ]) {
    const f = fixture();
    await rejectsCode(verifyMintRecipient(request({ controlProof }), { rpc: f.rpc, now }), code);
    assert.equal(f.calls.length, 0);
  }
});

test('a valid scoped test challenge verifies only the recipient-key signature', async () => {
  const config = await signedTestRequest();
  const f = fixture();
  const result = await verifyMintRecipient(config, { rpc: f.rpc, now });
  assert.equal(result.controlProof.status, 'signature_matches_recipient_key');
  assert.equal(result.controlProof.signatureMatchesRecipientKey, true);
  assert.equal(result.controlProof.signer, config.recipient);
  assert.equal(result.controlProof.chainId, NUMINA_CHAIN_ID);
  assert.equal(result.controlProof.purpose, RECIPIENT_CONTROL_PURPOSE);
  assert.equal(result.controlProof.signature, config.controlProof.signature);
  assert.equal(result.controlProof.statementAuthorizesTransaction, false);
  assert.equal(result.controlProof.contractWalletSignatureVerified, false);
  assert.equal(result.controlProof.exclusiveCustodyVerified, false);
  assert.equal(result.walletControlVerified, false);
  assert.equal(result.assetReceiptCapabilityVerified, false);
  assert.equal(result.reserveAllocationVerified, false);
  assert.equal(result.mintCompleted, false);
  assert.equal(result.broadcast, false);
  const changedRecipient = structuredClone(config);
  changedRecipient.recipient = RECIPIENT;
  await rejectsCode(verifyMintRecipient(changedRecipient, { rpc: f.rpc, now }), 'CONTROL_PROOF_SIGNER_MISMATCH');
  const changedExpiry = structuredClone(config);
  changedExpiry.controlProof.expiresAt = (EPOCH + 59n).toString();
  await rejectsCode(verifyMintRecipient(changedExpiry, { rpc: f.rpc, now }), 'CONTROL_PROOF_SIGNER_MISMATCH');
});

test('a proof that expires during observation cannot produce successful evidence', async () => {
  const config = await signedTestRequest();
  const f = fixture();
  let clockCalls = 0;
  await rejectsCode(verifyMintRecipient(config, { rpc: f.rpc,
    now: () => new Date(NOW.getTime() + (clockCalls++ === 0 ? 0 : 60000)) }), 'CONTROL_PROOF_EXPIRED');
  assert.equal(f.calls.length, 5);
});

test('caller mutations cannot retarget an in-flight observation', async () => {
  const config = request();
  const f = fixture((method, params, count) => {
    if (count === 1) { config.recipient = getAddress('0x' + '12'.repeat(20)); config.block.tag = 'latest'; }
  });
  const result = await verifyMintRecipient(config, { rpc: f.rpc, now });
  assert.equal(result.recipient, RECIPIENT);
  assert.deepEqual(result.observedBlock.requestedSelection, { tag: 'finalized' });
});

test('caller cannot attach a different recipient signature during observation', async () => {
  const signed = await signedTestRequest();
  const config = request();
  const f = fixture((method, params, count) => {
    if (count === 1) { config.recipient = signed.recipient; config.controlProof = signed.controlProof; }
  });
  const result = await verifyMintRecipient(config, { rpc: f.rpc, now });
  assert.equal(result.recipient, RECIPIENT);
  assert.equal(result.controlProof.signatureMatchesRecipientKey, false);
  assert.equal(result.controlProof.status, 'not_provided');
});

test('HTTPS wrapper sends only allowlisted reads, disables redirects and omits endpoint/auth from evidence', async () => {
  const f = fixture();
  const endpoint = 'https://provider.invalid/private-secret?auth=DO_NOT_ECHO_AUTH';
  const fetcher = async (url, options) => {
    assert.equal(url, endpoint);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, 'Bearer DO_NOT_ECHO_HEADER');
    const call = JSON.parse(options.body);
    assert.equal(call.jsonrpc, '2.0');
    const result = await f.rpc(call.method, call.params);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }), { status: 200 });
  };
  const result = await observeMintRecipient(request(), { rpcUrl: endpoint, rpcAuthorization: 'Bearer DO_NOT_ECHO_HEADER', fetcher, now });
  assert.equal(result.rpcReadCalls, 5);
  assert.doesNotMatch(JSON.stringify(result), /provider\.invalid|DO_NOT_ECHO_AUTH|DO_NOT_ECHO_HEADER|private-secret/);
});

test('transport failures and invalid envelopes never expose provider details', async () => {
  const failures = [
    [() => { throw new Error('DO_NOT_ECHO_AUTH'); }, 'RPC_UNAVAILABLE'],
    [() => new Response('DO_NOT_ECHO_AUTH', { status: 403 }), 'RPC_UNAVAILABLE'],
    [() => new Response('DO_NOT_ECHO_AUTH', { status: 200 }), 'RPC_INVALID_RESPONSE'],
    [() => new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: CHAIN_HEX })), 'RPC_INVALID_RESPONSE'],
    [() => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'DO_NOT_ECHO_AUTH' } })), 'RPC_REJECTED'],
    [() => new Response(' '.repeat(1024 * 1024 + 1)), 'RPC_INVALID_RESPONSE']
  ];
  for (const [fetcher, expected] of failures) {
    await assert.rejects(observeMintRecipient(request(), { rpcUrl: 'https://provider.invalid/DO_NOT_ECHO_AUTH', fetcher, now }), error => {
      assert.equal(error.code, expected);
      assert.doesNotMatch(error.message, /DO_NOT_ECHO_AUTH|provider\.invalid/);
      return true;
    });
  }
});

test('invalid transport options are rejected before reads and an unresponsive provider is bounded', async () => {
  const neverFetch = () => assert.fail('No network access is permitted in tests');
  for (const rpcUrl of ['', 'http://provider.invalid', 'https://user:secret@provider.invalid', 'https://provider.invalid/#secret', ' https://provider.invalid']) {
    await rejectsCode(observeMintRecipient(request(), { rpcUrl, fetcher: neverFetch, now }), 'INVALID_RPC_URL');
  }
  await rejectsCode(observeMintRecipient(request(), { rpcUrl: 'https://provider.invalid', fetcher: neverFetch, timeoutMs: 60001, now }), 'INVALID_OPTIONS');
  for (const rpcAuthorization of ['', 'Bearer secret\r\nInjected: yes', 7, ' secret', 'x'.repeat(8193)]) {
    await rejectsCode(observeMintRecipient(request(), { rpcUrl: 'https://provider.invalid', rpcAuthorization, fetcher: neverFetch, now }), 'INVALID_OPTIONS');
  }
  await rejectsCode(observeMintRecipient(request(), { rpcUrl: 'https://provider.invalid', fetcher: () => new Promise(() => {}), timeoutMs: 10, now }), 'RPC_TIMEOUT');
  const f = fixture();
  await rejectsCode(verifyMintRecipient(request(), { rpc: f.rpc, now: () => new Date('invalid') }), 'INVALID_OPTIONS');
  assert.equal(f.calls.length, 0);
});

test('CLI without an explicit request emits a sanitized failure and no transaction evidence', () => {
  const cli = fileURLToPath(new URL('../runtime/nusd/scripts/verify-mint-recipient.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, NUMINA_RPC_URL: 'https://provider.invalid/DO_NOT_ECHO_AUTH' } });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, RECIPIENT_EVIDENCE_SCHEMA);
  assert.equal(report.status, 'failed');
  assert.equal(report.error.code, 'INVALID_REQUEST');
  assert.equal(report.transactionHash, null);
  assert.equal(report.receipt, null);
  assert.equal(report.fundsMoved, false);
  assert.equal(report.broadcast, false);
  assert.doesNotMatch(result.stdout, /DO_NOT_ECHO_AUTH|provider\.invalid/);
});
