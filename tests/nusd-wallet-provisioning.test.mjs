import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspect} from 'node:util';
import {Wallet, getAddress, ZeroAddress} from '../runtime/nusd/node_modules/ethers/lib.esm/index.js';
import {
  ROLE_NAMES,
  generateRoleKeystores,
  validateRoleKeystores,
  applyWalletAssignments
} from '../runtime/nusd/scripts/wallet-provisioning.mjs';

// These ephemeral test wallets are never saved, funded, or used for deployment.
const password = 'LOCAL-TEST-ONLY-never-use-this-password-for-wallet-custody';
const recipient = '0x736bd8f274dce00a8bb374edd85df0d2e631018e';
const template = JSON.parse(fs.readFileSync(new URL('../runtime/nusd/deployment.template.json', import.meta.url)));
let generated;
const privateTestMaterial = [];

before(async () => {
  generated = await generateRoleKeystores(password);
});

async function rejectsWithoutSecrets(operation, extraSensitive = []) {
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  assert.ok(failure instanceof Error, 'Invalid wallet input must reject with an error');
  const diagnostic = inspect(failure, {depth: 8});
  for (const secret of [password, ...privateTestMaterial, ...extraSensitive]) {
    assert.ok(!diagnostic.includes(secret), 'Wallet failures must not expose password or private wallet material');
  }
}

test('four fresh role keystores decrypt to their unique published addresses', async () => {
  assert.deepEqual(ROLE_NAMES, ['admin', 'issuer', 'minter', 'pauser']);
  assert.deepEqual(Object.keys(generated.roles).sort(), [...ROLE_NAMES].sort());
  assert.deepEqual(Object.keys(generated.keystores).sort(), [...ROLE_NAMES].sort());
  const addresses = [];
  for (const role of ROLE_NAMES) {
    const encoded = generated.keystores[role];
    assert.equal(typeof encoded, 'string');
    const keystore = JSON.parse(encoded);
    assert.equal(keystore.version, 3);
    assert.equal(getAddress(`0x${keystore.address.replace(/^0x/, '')}`), generated.roles[role]);
    assert.equal(keystore.crypto?.kdf ?? keystore.Crypto?.kdf, 'scrypt');
    const wallet = await Wallet.fromEncryptedJson(encoded, password);
    privateTestMaterial.push(wallet.privateKey, wallet.privateKey.slice(2));
    if (wallet.mnemonic?.phrase) privateTestMaterial.push(wallet.mnemonic.phrase);
    assert.equal(wallet.address, generated.roles[role]);
    assert.equal(wallet.address, getAddress(wallet.address));
    assert.notEqual(wallet.address, ZeroAddress);
    assert.ok(!encoded.includes(wallet.privateKey.slice(2)), 'Keystores must not contain unencrypted private keys');
    assert.ok(!encoded.includes(password), 'Keystores must not contain their password');
    addresses.push(wallet.address.toLowerCase());
  }
  assert.equal(new Set(addresses).size, 4);
  assert.deepEqual(await validateRoleKeystores(generated.keystores, password), generated.roles);
});

test('wrong passwords and ciphertext tampering fail without exposing private material', async () => {
  const wrongPassword = 'LOCAL-TEST-ONLY-wrong-password-marker';
  await rejectsWithoutSecrets(() => validateRoleKeystores(generated.keystores, wrongPassword), [wrongPassword]);
  const tampered = {...generated.keystores};
  const keystore = JSON.parse(tampered.admin);
  const crypto = keystore.crypto ?? keystore.Crypto;
  crypto.ciphertext = `${crypto.ciphertext[0] === '0' ? '1' : '0'}${crypto.ciphertext.slice(1)}`;
  tampered.admin = JSON.stringify(keystore);
  await rejectsWithoutSecrets(() => validateRoleKeystores(tampered, password));
});

test('missing and duplicate role keystores cannot be accepted as four wallets', async () => {
  const missing = {...generated.keystores};
  delete missing.pauser;
  await rejectsWithoutSecrets(() => validateRoleKeystores(missing, password));
  const duplicate = {...generated.keystores, issuer: generated.keystores.admin};
  await rejectsWithoutSecrets(() => validateRoleKeystores(duplicate, password));
});

test('assignment clones the request, changes only recipient and roles, and permits an identical retry', () => {
  const config = structuredClone(template);
  config.supplyCapNusd = '500000000000000';
  config.initialSupplyNusd = '123.000001';
  config.adminDelaySeconds = 3600;
  config.reviewRecords.incidentAndPauseRecovery = 'Existing review reference must be preserved';
  config.extraMetadata = {note: 'Caller-owned deployment metadata', nested: [1, {flag: true}]};
  const original = structuredClone(config);
  const assigned = applyWalletAssignments(config, generated.roles, recipient);
  const expected = structuredClone(original);
  expected.roles = structuredClone(generated.roles);
  expected.initialRecipient = getAddress(recipient);
  assert.deepEqual(assigned, expected);
  assert.deepEqual(config, original);
  assert.notEqual(assigned, config);
  assert.notEqual(assigned.roles, generated.roles);
  assert.notEqual(assigned.network, config.network);
  assert.notEqual(assigned.reviewRecords, config.reviewRecords);
  assert.equal(assigned.reviewRecords.independentRoleKeyCustody, null);
  const retry = applyWalletAssignments(assigned, generated.roles, recipient);
  assert.deepEqual(retry, assigned);
  assert.notEqual(retry, assigned);
  assigned.extraMetadata.nested[1].flag = false;
  assert.equal(config.extraMetadata.nested[1].flag, true);
});

test('assignment refuses changed existing recipients or role addresses', () => {
  const assigned = applyWalletAssignments(template, generated.roles, recipient);
  const otherAddress = '0x0000000000000000000000000000000000000099';
  const original = structuredClone(assigned);
  assert.throws(() => applyWalletAssignments(assigned, generated.roles, otherAddress));
  for (const role of ROLE_NAMES) {
    assert.throws(() => applyWalletAssignments(assigned, {...generated.roles, [role]: otherAddress}, recipient));
  }
  assert.deepEqual(assigned, original);
});

test('assignment rejects invalid, zero, missing, and duplicate role addresses and invalid recipients', () => {
  for (const role of ROLE_NAMES) {
    for (const invalid of ['not-an-address', ZeroAddress, null]) {
      assert.throws(() => applyWalletAssignments(template, {...generated.roles, [role]: invalid}, recipient));
    }
  }
  const missing = {...generated.roles};
  delete missing.pauser;
  assert.throws(() => applyWalletAssignments(template, missing, recipient));
  assert.throws(() => applyWalletAssignments(template, {...generated.roles, issuer: generated.roles.admin}, recipient));
  for (const invalid of ['not-an-address', ZeroAddress, null]) {
    assert.throws(() => applyWalletAssignments(template, generated.roles, invalid));
  }
});
