// Read-only verification of NUSD admin and role state on the Numina chain.
// Usage: NUMINA_RPC_URL=... [NUMINA_RPC_AUTHORIZATION=...] node verify-admin-handoff.mjs [--expected file.json]
// Without --expected, the recorded baseline (before any handoff step) is checked.
// No transaction is built or sent; only eth_chainId and eth_call are used. Prints JSON.
// Exit codes: 0 match, 1 mismatch, 2 rpc_unavailable, 3 configuration error.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, getAddress, id, ZeroAddress, ZeroHash } from 'ethers';
import { createReadOnlyRpc, parseArgs, finish, ConfigurationError } from './read-only-rpc.mjs';

export const NUMINA_CHAIN_ID = '962421430';
export const NUSD_TOKEN_ADDRESS = '0x491c1DF1b5CA77AF797f052c2310ca17039C931b';
export const ROLE_IDS = Object.freeze({
  DEFAULT_ADMIN_ROLE: ZeroHash, ISSUER_ROLE: id('ISSUER_ROLE'), MINTER_ROLE: id('MINTER_ROLE'), PAUSER_ROLE: id('PAUSER_ROLE')
});
const SUPPLY = '1500000000000000000000000000000000';
/** Recorded state from runtime/nusd/deployment.production.json and deployment-receipt.json (2026-09-18). */
export const BASELINE_EXPECTED = Object.freeze({
  chainId: NUMINA_CHAIN_ID,
  tokenAddress: NUSD_TOKEN_ADDRESS,
  decimals: 18,
  totalSupply: SUPPLY,
  cap: SUPPLY,
  defaultAdmin: '0xa7e9FB02495700ccE0d209392C0A30FbE077498e',
  pendingDefaultAdmin: ZeroAddress,
  defaultAdminDelay: '86400',
  paused: null,
  roles: {
    DEFAULT_ADMIN_ROLE: { '0xa7e9FB02495700ccE0d209392C0A30FbE077498e': true },
    ISSUER_ROLE: { '0xdfEb99a8CbB9d2536EB9CA3D4D38DC5f4D1dE1a0': true },
    MINTER_ROLE: { '0x62dC06f05aF1b9aBA65d7ee4DBaB067249FC5DA6': true },
    PAUSER_ROLE: { '0x434AB24E613055Fd2598Fd9f0558A06a94D39c81': true }
  }
});
export const TOKEN_ABI = new Interface([
  'function defaultAdmin() view returns (address)',
  'function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)',
  'function defaultAdminDelay() view returns (uint48)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function paused() view returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function cap() view returns (uint256)',
  'function decimals() view returns (uint8)'
]);

/** Normalize an expected-state object (or a record carrying one under `expected`). Null fields are not checked. */
export function normalizeExpected(input) {
  const source = input && typeof input === 'object' && input.expected && typeof input.expected === 'object' ? input.expected : input;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new ConfigurationError('expected_not_object');
  const merged = { ...BASELINE_EXPECTED, ...source };
  const address = (value, label) => {
    if (value === null) return null;
    try { return getAddress(value); } catch { throw new ConfigurationError('expected_' + label + '_invalid'); }
  };
  const roles = {};
  for (const [role, holders] of Object.entries(merged.roles || {})) {
    if (!Object.hasOwn(ROLE_IDS, role) || !holders || typeof holders !== 'object') throw new ConfigurationError('expected_roles_invalid');
    roles[role] = {};
    for (const [holder, held] of Object.entries(holders)) {
      if (typeof held !== 'boolean') throw new ConfigurationError('expected_roles_invalid');
      roles[role][address(holder, 'role_holder')] = held;
    }
  }
  const text = (value, label) => {
    if (value === null) return null;
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new ConfigurationError('expected_' + label + '_invalid');
    return value;
  };
  if (merged.paused !== null && typeof merged.paused !== 'boolean') throw new ConfigurationError('expected_paused_invalid');
  if (merged.decimals !== null && !Number.isSafeInteger(merged.decimals)) throw new ConfigurationError('expected_decimals_invalid');
  return {
    chainId: text(merged.chainId, 'chainId'), tokenAddress: address(merged.tokenAddress, 'tokenAddress'),
    decimals: merged.decimals, totalSupply: text(merged.totalSupply, 'totalSupply'), cap: text(merged.cap, 'cap'),
    defaultAdmin: address(merged.defaultAdmin, 'defaultAdmin'), pendingDefaultAdmin: address(merged.pendingDefaultAdmin, 'pendingDefaultAdmin'),
    defaultAdminDelay: text(merged.defaultAdminDelay, 'defaultAdminDelay'), paused: merged.paused, roles
  };
}

/** Read live state and compare it with the expected state. Read-only. */
export async function verifyAdminHandoff({ rpc, expected = BASELINE_EXPECTED }) {
  const want = normalizeExpected(expected);
  const tokenAddress = want.tokenAddress || NUSD_TOKEN_ADDRESS;
  const call = async (name, args = []) => {
    const raw = await rpc('eth_call', [{ to: tokenAddress, data: TOKEN_ABI.encodeFunctionData(name, args) }, 'latest']);
    return TOKEN_ABI.decodeFunctionResult(name, raw);
  };
  const chainId = BigInt(await rpc('eth_chainId')).toString();
  const code = await rpc('eth_getCode', [tokenAddress, 'latest']);
  const observed = { chainId, tokenAddress, tokenCodePresent: typeof code === 'string' && code !== '0x' && code.length > 2 };
  const mismatches = [];
  const compare = (field, expectedValue, observedValue) => {
    if (expectedValue !== null && expectedValue !== undefined && expectedValue !== observedValue) {
      mismatches.push({ field, expected: expectedValue, observed: observedValue });
    }
  };
  compare('chainId', want.chainId, chainId);
  if (!observed.tokenCodePresent) {
    mismatches.push({ field: 'tokenCode', expected: 'present', observed: 'absent' });
    return { schema: 'numina.nusd.admin-handoff-verification.v1', ok: false, readOnly: true, observed, mismatches };
  }
  observed.decimals = Number((await call('decimals'))[0]);
  observed.totalSupply = (await call('totalSupply'))[0].toString();
  observed.cap = (await call('cap'))[0].toString();
  observed.paused = (await call('paused'))[0];
  observed.defaultAdmin = getAddress((await call('defaultAdmin'))[0]);
  const [pendingAdmin, schedule] = await call('pendingDefaultAdmin');
  observed.pendingDefaultAdmin = getAddress(pendingAdmin);
  observed.pendingDefaultAdminSchedule = schedule.toString();
  observed.defaultAdminDelay = (await call('defaultAdminDelay'))[0].toString();
  compare('decimals', want.decimals, observed.decimals);
  compare('totalSupply', want.totalSupply, observed.totalSupply);
  compare('cap', want.cap, observed.cap);
  compare('paused', want.paused, observed.paused);
  compare('defaultAdmin', want.defaultAdmin, observed.defaultAdmin);
  compare('pendingDefaultAdmin', want.pendingDefaultAdmin, observed.pendingDefaultAdmin);
  compare('defaultAdminDelay', want.defaultAdminDelay, observed.defaultAdminDelay);
  // Check every expected holder for every role, plus every known holder for every role (separation check).
  const holders = new Set(Object.values(want.roles).flatMap(entry => Object.keys(entry)));
  for (const value of [want.defaultAdmin, observed.defaultAdmin, want.pendingDefaultAdmin, observed.pendingDefaultAdmin]) {
    if (value && value !== ZeroAddress) holders.add(value);
  }
  observed.roles = {};
  for (const [role, roleId] of Object.entries(ROLE_IDS)) {
    observed.roles[role] = {};
    for (const holder of holders) {
      const held = (await call('hasRole', [roleId, holder]))[0];
      observed.roles[role][holder] = held;
      const expectedHeld = want.roles[role]?.[holder];
      if (expectedHeld !== undefined) compare(`roles.${role}.${holder}`, expectedHeld, held);
    }
  }
  return { schema: 'numina.nusd.admin-handoff-verification.v1', ok: mismatches.length === 0, readOnly: true, observed, mismatches };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = { schema: 'numina.nusd.admin-handoff-verification.v1', readOnly: true };
  try {
    const options = parseArgs(process.argv.slice(2), { expected: 'value' });
    let expected = BASELINE_EXPECTED;
    if (options.expected) {
      try { expected = JSON.parse(fs.readFileSync(path.resolve(options.expected), 'utf8')); }
      catch { throw new ConfigurationError('expected_file_unreadable'); }
    }
    const rpc = createReadOnlyRpc({ endpoint: process.env.NUMINA_RPC_URL, authorization: process.env.NUMINA_RPC_AUTHORIZATION });
    finish(await verifyAdminHandoff({ rpc, expected }));
  } catch (error) { finish(base, error); }
}
