import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Interface, keccak256 } from '../runtime/nusd/node_modules/ethers/lib.esm/index.js';
import { prepareMint } from '../runtime/nusd/scripts/prepare-mint.mjs';
import { loadTokenArtifact } from '../runtime/nusd/scripts/token-artifact.mjs';
import { submitManagedDeploymentOnce } from '../runtime/nusd/scripts/managed-deployment.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'runtime/nusd/scripts/prepare-mint.mjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  fs.mkdirSync(path.join(root, 'work'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'work/nusd-mint-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(root, 'work'));
    assert.ok(path.basename(dir).startsWith('nusd-mint-test-'));
    fs.rmSync(dir, { recursive: true });
  });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const config = { schema: 'numina.nusd.mint.request.v1', network: { chainId: 962421430 },
    tokenAddress: '0x0000000000000000000000000000000000000001',
    issuer: '0x0000000000000000000000000000000000000002',
    minter: '0x0000000000000000000000000000000000000003',
    recipient: '0x0000000000000000000000000000000000000004',
    amountNusd: '500000000000000', reserveReference: '0x' + 'a'.repeat(64), expiresAt: nowSeconds + 3600 };
  const file = path.join(dir, 'request.json'), output = path.join(dir, 'unsigned.json');
  const save = () => fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  save(); return { dir, nowSeconds, config, file, output, save };
}

test('offline mint draft encodes exact 500T authorization and dependent distinct-minter call', async t => {
  const f = fixture(t), draft = prepareMint(f.file, f), abi = new Interface(loadTokenArtifact().abi);
  const [authorize, mint] = draft.transactions;
  assert.equal(draft.status, 'UNSIGNED_MINT_REVIEW_DRAFT_NOT_APPROVED');
  assert.equal(draft.request.amountBaseUnits, '500000000000000000000');
  assert.equal(draft.integrity.requestSha256, hash(fs.readFileSync(f.file)));
  assert.deepEqual(Array.from(abi.decodeFunctionData('authorizeIssuance', authorize.transaction.data)),
    [f.config.reserveReference, f.config.recipient, 500000000000000000000n, BigInt(f.config.expiresAt)]);
  assert.deepEqual(Array.from(abi.decodeFunctionData('mintAuthorized', mint.transaction.data)), [f.config.reserveReference]);
  assert.equal(authorize.transaction.from, f.config.issuer); assert.equal(mint.transaction.from, f.config.minter);
  assert.equal(mint.dependsOnStep, 1);
  for (const call of draft.transactions) {
    assert.equal(call.transaction.chainId, 962421430); assert.equal(call.transaction.to, f.config.tokenAddress);
    assert.equal(call.transaction.nonce, null); assert.equal(call.transaction.value, '0');
    assert.equal(call.dataKeccak256, keccak256(call.transaction.data));
    assert.equal(call.dataSha256, hash(Buffer.from(call.transaction.data.slice(2), 'hex')));
    assert.equal(call.signature, null); assert.equal(call.broadcast, false); assert.equal(call.receipt, null);
  }
  assert.equal(draft.submissionApproved, false); assert.equal(draft.signature, null); assert.equal(draft.receipt, null);
  assert.ok(Object.values(draft.effects).every(value => value === false));
  assert.ok(Object.values(draft.verification).every(value => value === false));
  assert.equal(draft.execution.managedManifest, null);
  let rpcCalls = 0;
  await assert.rejects(submitManagedDeploymentOnce(draft, hash(JSON.stringify(draft)), {
    rpcUrl: 'https://fixture.invalid', fetcher: async () => { rpcCalls++; throw new Error('Unexpected network call'); }
  }), error => error.code === 'INVALID_CONFIG');
  assert.equal(rpcCalls, 0);
});

test('fractional NUSD remains exact and amount validation rejects unsafe or out-of-range values', t => {
  const f = fixture(t);
  for (const [value, expected] of [['0.000001', '1'], ['500000000000000.000001', '500000000000000000001']]) {
    f.config.amountNusd = value; f.save(); assert.equal(prepareMint(f.file, f).request.amountBaseUnits, expected);
  }
  for (const value of [0, 500000000000000, '0', '-1', '1e6', '01', ' 1', '1.0000001', (2n ** 256n).toString(), '9'.repeat(1000)]) {
    f.config.amountNusd = value; f.save(); assert.throws(() => prepareMint(f.file, f), error => error.code === 'INVALID_MINT_REQUEST');
  }
});

test('expiry boundaries are bounded uint48 seconds and use no claimed chain observation', t => {
  const f = fixture(t);
  for (const expiresAt of [f.nowSeconds + 1, f.nowSeconds + 604800]) {
    f.config.expiresAt = expiresAt; f.save();
    assert.equal(prepareMint(f.file, f).expiry.currentChainTimeVerified, false);
  }
  for (const expiresAt of [f.nowSeconds, f.nowSeconds - 1, f.nowSeconds + 604801, 2 ** 48, Number.MAX_SAFE_INTEGER + 1, f.nowSeconds + 0.5, String(f.nowSeconds + 3600), null]) {
    f.config.expiresAt = expiresAt; f.save(); assert.throws(() => prepareMint(f.file, f), error => error.code === 'INVALID_MINT_REQUEST');
  }
});

test('unknown fields, wrong chain, invalid addresses, reused roles and invalid references are rejected', t => {
  const f = fixture(t), original = structuredClone(f.config);
  for (const mutate of [
    c => { c.network.chainId = 1; }, c => { c.network.chainId = '962421430'; }, c => { c.network.rpcUrl = 'https://fixture.invalid'; },
    c => { c.signature = 'unsupported'; }, c => { delete c.recipient; }, c => { c.schema = 'unsupported'; },
    c => { c.issuer = c.minter; }, c => { c.tokenAddress = '0x' + '0'.repeat(40); }, c => { c.recipient = 'treasury'; },
    c => { c.issuer = '0x' + '0'.repeat(40); }, c => { c.minter = null; }, c => { c.reserveReference = '0x' + '0'.repeat(64); },
    c => { c.reserveReference = 'a'.repeat(64); }, c => { c.reserveReference = '0x' + 'a'.repeat(63); }
  ]) {
    for (const key of Object.keys(f.config)) delete f.config[key]; Object.assign(f.config, structuredClone(original));
    mutate(f.config); f.save(); assert.throws(() => prepareMint(f.file, f), error => error.code === 'INVALID_MINT_REQUEST');
  }
  for (const bytes of ['null', '[]', '{', '{"schema":' + ' '.repeat(16384) + '}']) {
    fs.writeFileSync(f.file, bytes); assert.throws(() => prepareMint(f.file, f), error => error.code === 'INVALID_MINT_REQUEST');
  }
  assert.equal(fs.existsSync(f.output), false);
});

test('CLI preserves inputs and existing output, reuses exact retries and rejects malformed invocations', t => {
  const f = fixture(t), original = fs.readFileSync(f.file);
  const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
  let result = run([f.file, '--output', f.output]); assert.equal(result.status, 0, result.stderr);
  const bytes = fs.readFileSync(f.output);
  result = run([f.file, '--output', f.output]); assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).reused, true);
  assert.ok(fs.readFileSync(f.file).equals(original));
  f.config.amountNusd = '1'; f.save(); result = run([f.file, '--output', f.output]);
  assert.equal(result.status, 1); assert.ok(fs.readFileSync(f.output).equals(bytes));
  const changedInput = fs.readFileSync(f.file);
  result = run([f.file, '--output', f.file]); assert.equal(result.status, 1); assert.ok(fs.readFileSync(f.file).equals(changedInput));
  for (const args of [[], [f.file], [f.file, '--output', f.output, 'extra']]) {
    result = run(args); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stderr).broadcast, false);
  }
});
