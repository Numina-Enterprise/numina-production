// Read-only check that the canonical Safe deployment contracts exist on a chain, and optionally that a
// deployed Safe has the expected owners and threshold (default 3-of-6).
// Usage: node verify-safe-factory.mjs [--chain numina|base] [--safe 0x...] [--threshold 3] [--owners 6]
//        [--expected-owners 0xA,0xB,...]
// RPC comes from NUMINA_RPC_URL (+ optional NUMINA_RPC_AUTHORIZATION) for --chain numina, or
// BASE_RPC_URL (+ optional BASE_RPC_AUTHORIZATION) for --chain base. Only eth_chainId, eth_getCode and
// eth_call are used. Exit codes: 0 ok, 1 mismatch, 2 rpc_unavailable, 3 configuration error.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, getAddress } from 'ethers';
import { createReadOnlyRpc, parseArgs, finish, ConfigurationError } from './read-only-rpc.mjs';

export const CHAINS = Object.freeze({
  numina: Object.freeze({ chainId: '962421430', urlEnv: 'NUMINA_RPC_URL', authEnv: 'NUMINA_RPC_AUTHORIZATION' }),
  base: Object.freeze({ chainId: '8453', urlEnv: 'BASE_RPC_URL', authEnv: 'BASE_RPC_AUTHORIZATION' })
});
// Safe v1.4.1 canonical addresses (safe-global/safe-deployments). Re-confirm against that registry before signing.
export const SAFE_CONTRACTS = Object.freeze({
  safeSingletonFactory: '0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7',
  safeL2Singleton: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  safeProxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  compatibilityFallbackHandler: '0xfd0732Dc9E303f09fCEF3a7388Ad10A83459Ec99',
  multiSendCallOnly: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'
});
export const SAFE_ABI = new Interface([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)'
]);

export async function verifySafeFactory({ rpc, chain = 'numina', safe = null, threshold = 3, owners = 6, expectedOwners = null }) {
  if (!Object.hasOwn(CHAINS, chain)) throw new ConfigurationError('unsupported_chain');
  const mismatches = [];
  const chainId = BigInt(await rpc('eth_chainId')).toString();
  if (chainId !== CHAINS[chain].chainId) mismatches.push({ field: 'chainId', expected: CHAINS[chain].chainId, observed: chainId });
  const code = {};
  for (const [name, address] of Object.entries(SAFE_CONTRACTS)) {
    const value = await rpc('eth_getCode', [address, 'latest']);
    const present = typeof value === 'string' && value.length > 2 && value !== '0x';
    code[name] = { address, present, codeBytes: present ? (value.length - 2) / 2 : 0 };
    if (!present) mismatches.push({ field: `code.${name}`, expected: 'present', observed: 'absent' });
  }
  let safeResult = null;
  if (safe) {
    let address;
    try { address = getAddress(safe); } catch { throw new ConfigurationError('safe_address_invalid'); }
    const safeCode = await rpc('eth_getCode', [address, 'latest']);
    const present = typeof safeCode === 'string' && safeCode.length > 2 && safeCode !== '0x';
    safeResult = { address, codePresent: present };
    if (!present) mismatches.push({ field: 'safe.code', expected: 'present', observed: 'absent' });
    else {
      const read = async name => SAFE_ABI.decodeFunctionResult(name,
        await rpc('eth_call', [{ to: address, data: SAFE_ABI.encodeFunctionData(name) }, 'latest']))[0];
      const ownerList = (await read('getOwners')).map(owner => getAddress(owner));
      const observedThreshold = Number(await read('getThreshold'));
      safeResult.owners = ownerList; safeResult.threshold = observedThreshold;
      if (observedThreshold !== threshold) mismatches.push({ field: 'safe.threshold', expected: threshold, observed: observedThreshold });
      if (ownerList.length !== owners) mismatches.push({ field: 'safe.ownerCount', expected: owners, observed: ownerList.length });
      if (new Set(ownerList).size !== ownerList.length) mismatches.push({ field: 'safe.ownersDistinct', expected: true, observed: false });
      if (expectedOwners) {
        const want = [...new Set(expectedOwners.map(owner => getAddress(owner)))].sort();
        const got = [...ownerList].sort();
        if (want.join() !== got.join()) mismatches.push({ field: 'safe.owners', expected: want, observed: got });
      }
    }
  }
  return { schema: 'numina.nusd.safe-factory-verification.v1', ok: mismatches.length === 0, readOnly: true,
    chain, chainId, contracts: code, safe: safeResult, mismatches };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = { schema: 'numina.nusd.safe-factory-verification.v1', readOnly: true };
  try {
    const options = parseArgs(process.argv.slice(2), { chain: 'value', safe: 'value', threshold: 'value', owners: 'value', 'expected-owners': 'value' });
    const chain = options.chain || 'numina';
    if (!Object.hasOwn(CHAINS, chain)) throw new ConfigurationError('unsupported_chain');
    const integer = (value, fallback) => {
      if (value === undefined) return fallback;
      if (!/^[1-9][0-9]{0,2}$/.test(value)) throw new ConfigurationError('integer_argument_invalid');
      return Number(value);
    };
    let expectedOwners = null;
    if (options['expected-owners']) {
      try { expectedOwners = options['expected-owners'].split(',').map(value => getAddress(value.trim())); }
      catch { throw new ConfigurationError('expected_owners_invalid'); }
    }
    const rpc = createReadOnlyRpc({ endpoint: process.env[CHAINS[chain].urlEnv], authorization: process.env[CHAINS[chain].authEnv] });
    finish(await verifySafeFactory({ rpc, chain, safe: options.safe || null,
      threshold: integer(options.threshold, 3), owners: integer(options.owners, 6), expectedOwners }));
  } catch (error) { finish(base, error); }
}
