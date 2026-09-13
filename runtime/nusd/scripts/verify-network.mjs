import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, keccak256 } from 'ethers';

const SCHEMA = 'numina.network.verification.v1';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_UINT256 = (1n << 256n) - 1n;
const ALLOWED_METHODS = new Set([
  'eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionReceipt', 'eth_getCode'
]);
const messages = {
  INVALID_CONFIG: 'Required network verification configuration is missing or invalid.',
  INVALID_RPC_URL: 'A configured HTTPS RPC endpoint is required.',
  RPC_UNAVAILABLE: 'The configured RPC provider could not be read.',
  RPC_TIMEOUT: 'The network observation deadline elapsed.',
  RPC_INVALID_RESPONSE: 'The RPC provider returned an invalid or oversized response.',
  RPC_REJECTED: 'The RPC provider rejected a required read operation.',
  CHAIN_MISMATCH: 'The observed chain does not match the configured chain.',
  GENESIS_MISMATCH: 'The observed genesis does not match the configured genesis.',
  DEPLOYMENT_NOT_FOUND: 'The configured deployment receipt was not found.',
  DEPLOYMENT_MISMATCH: 'The deployment receipt does not match the configured transaction and contract.',
  DEPLOYMENT_REVERTED: 'The deployment receipt does not report successful execution.',
  NONCANONICAL_RECEIPT: 'The deployment receipt block is not canonical at observation.',
  INSUFFICIENT_CONFIRMATIONS: 'The deployment has insufficient confirmations at the observed block.',
  EMPTY_RUNTIME_CODE: 'No runtime code was returned for the contract at the observed block.',
  RUNTIME_CODE_MISMATCH: 'The observed runtime code does not match the configured hash.',
  SNAPSHOT_CHANGED: 'The observed snapshot changed during verification.'
};
function failure(code) {
  return Object.assign(new Error(messages[code]), { code });
}
function normalizedError(error) {
  return failure(Object.hasOwn(messages, error?.code) ? error.code : 'RPC_UNAVAILABLE');
}
function decimal(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,77}$/.test(value)) throw failure('INVALID_CONFIG');
  const number = BigInt(value);
  if (number > MAX_UINT256) throw failure('INVALID_CONFIG');
  return number;
}
function hash(value, code = 'RPC_INVALID_RESPONSE') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) throw failure(code);
  return value.toLowerCase();
}
function address(value, code = 'RPC_INVALID_RESPONSE') {
  try {
    if (typeof value !== 'string') throw new Error();
    const result = getAddress(value);
    if (/^0x0{40}$/.test(result)) throw new Error();
    return result;
  } catch { throw failure(code); }
}
function quantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) throw failure('RPC_INVALID_RESPONSE');
  return BigInt(value);
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('RPC_INVALID_RESPONSE');
  return value;
}
function block(value) {
  const result = object(value);
  return { number: quantity(result.number), hash: hash(result.hash) };
}
function validate(config, options) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw failure('INVALID_CONFIG');
  const expectedChainId = decimal(config.expectedChainId);
  const minimumConfirmations = decimal(config.minimumConfirmations);
  const expectedGenesisHash = hash(config.expectedGenesisHash, 'INVALID_CONFIG');
  const expectedRuntimeCodeHash = hash(config.expectedRuntimeCodeHash, 'INVALID_CONFIG');
  const contractAddress = address(config.contractAddress, 'INVALID_CONFIG');
  const deploymentTransactionHash = hash(config.deploymentTransactionHash, 'INVALID_CONFIG');
  const rpcUrl = options.rpcUrl ?? process.env.NUMINA_RPC_URL;
  let endpoint;
  try {
    if (typeof rpcUrl !== 'string' || rpcUrl.length > 8192 || rpcUrl !== rpcUrl.trim()) throw new Error();
    endpoint = new URL(rpcUrl);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.hash) throw new Error();
  } catch { throw failure('INVALID_RPC_URL'); }
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || typeof (options.fetcher ?? globalThis.fetch) !== 'function') throw failure('INVALID_CONFIG');
  return { expectedChainId, expectedGenesisHash, expectedRuntimeCodeHash, contractAddress,
    deploymentTransactionHash, minimumConfirmations, endpoint: endpoint.href, timeoutMs };
}
async function readJson(response, signal) {
  if (!response.body || typeof response.body.getReader !== 'function') throw failure('RPC_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw failure('RPC_INVALID_RESPONSE');
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { cancel(); throw failure('RPC_INVALID_RESPONSE'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw failure('RPC_INVALID_RESPONSE'); }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/**
 * Observe a configured contract deployment through one untrusted RPC provider.
 * Both quantity settings are positive decimal strings. No RPC URL is returned.
 * All blockchain calls are allowlisted reads; no signer or transaction sender exists here.
 * A successful result does not independently prove consensus, reserves or settlement.
 */
export async function verifyNetwork(config, { rpcUrl, fetcher = globalThis.fetch, timeoutMs = 15000 } = {}) {
  let settings;
  try { settings = validate(config, { rpcUrl, fetcher, timeoutMs }); }
  catch (error) { throw normalizedError(error); }
  const controller = new AbortController(); let timer; let nextId = 1;
  const rpc = async (method, params) => {
    if (controller.signal.aborted) throw failure('RPC_TIMEOUT');
    if (!ALLOWED_METHODS.has(method)) throw failure('INVALID_CONFIG');
    const id = nextId++;
    let response;
    try {
      response = await fetcher(settings.endpoint, {
        method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
      });
    } catch { throw failure('RPC_UNAVAILABLE'); }
    if (response.status !== 200 || !response.ok || response.redirected) {
      void response.body?.cancel().catch(() => {});
      throw failure('RPC_UNAVAILABLE');
    }
    const envelope = object(await readJson(response, controller.signal));
    if (envelope.jsonrpc !== '2.0' || envelope.id !== id) throw failure('RPC_INVALID_RESPONSE');
    if (Object.hasOwn(envelope, 'error')) throw failure('RPC_REJECTED');
    if (!Object.hasOwn(envelope, 'result')) throw failure('RPC_INVALID_RESPONSE');
    return envelope.result;
  };
  const observe = async () => {
    const chainId = quantity(await rpc('eth_chainId', []));
    if (chainId !== settings.expectedChainId) throw failure('CHAIN_MISMATCH');
    const genesis = block(await rpc('eth_getBlockByNumber', ['0x0', false]));
    if (genesis.number !== 0n || genesis.hash !== settings.expectedGenesisHash) throw failure('GENESIS_MISMATCH');
    const snapshot = block(await rpc('eth_getBlockByNumber', ['latest', false]));
    const receiptValue = await rpc('eth_getTransactionReceipt', [settings.deploymentTransactionHash]);
    if (receiptValue === null) throw failure('DEPLOYMENT_NOT_FOUND');
    const receipt = object(receiptValue);
    if (quantity(receipt.status) !== 1n) throw failure('DEPLOYMENT_REVERTED');
    const transactionHash = hash(receipt.transactionHash);
    const deployedAddress = address(receipt.contractAddress, 'DEPLOYMENT_MISMATCH');
    if (transactionHash !== settings.deploymentTransactionHash || deployedAddress !== settings.contractAddress || receipt.to !== null) throw failure('DEPLOYMENT_MISMATCH');
    const receiptBlockNumber = quantity(receipt.blockNumber);
    const receiptBlockHash = hash(receipt.blockHash);
    if (snapshot.number < receiptBlockNumber) throw failure('INSUFFICIENT_CONFIRMATIONS');
    const canonicalReceiptBlock = block(await rpc('eth_getBlockByNumber', [`0x${receiptBlockNumber.toString(16)}`, false]));
    if (canonicalReceiptBlock.number !== receiptBlockNumber || canonicalReceiptBlock.hash !== receiptBlockHash) throw failure('NONCANONICAL_RECEIPT');
    const confirmations = snapshot.number - receiptBlockNumber + 1n;
    if (confirmations < settings.minimumConfirmations) throw failure('INSUFFICIENT_CONFIRMATIONS');
    // EIP-1898 pins execution-state lookup to the actual observed block hash.
    const code = await rpc('eth_getCode', [settings.contractAddress, { blockHash: snapshot.hash, requireCanonical: true }]);
    if (code === '0x') throw failure('EMPTY_RUNTIME_CODE');
    if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw failure('RPC_INVALID_RESPONSE');
    const runtimeCodeHash = keccak256(code);
    if (runtimeCodeHash !== settings.expectedRuntimeCodeHash) throw failure('RUNTIME_CODE_MISMATCH');
    const finalSnapshot = block(await rpc('eth_getBlockByNumber', [`0x${snapshot.number.toString(16)}`, false]));
    if (finalSnapshot.number !== snapshot.number || finalSnapshot.hash !== snapshot.hash) throw failure('SNAPSHOT_CHANGED');
    return {
      schema: SCHEMA, status: 'matched_configured_deployment', observedAt: new Date().toISOString(),
      evidenceSource: 'single_configured_rpc_provider', verificationScope: 'provider_reported_observation',
      independentlyVerified: false,
      chain: { chainId: chainId.toString(), genesisHash: genesis.hash },
      observedBlock: { number: snapshot.number.toString(), hash: snapshot.hash },
      deployment: { transactionHash, contractAddress: deployedAddress, blockNumber: receiptBlockNumber.toString(),
        blockHash: receiptBlockHash, receiptStatus: '0x1', confirmations: confirmations.toString(),
        requiredConfirmations: settings.minimumConfirmations.toString() },
      runtimeCode: { algorithm: 'keccak256', hash: runtimeCodeHash, bytes: (code.length - 2) / 2,
        atBlockHash: snapshot.hash },
      snapshotCanonicalAtFinalRead: true, rpcReadCalls: nextId - 1,
      settlementConnected: false, reservesVerified: false, fundsMoved: false
    };
  };
  try {
    return await Promise.race([
      new Promise((_, reject) => { timer = setTimeout(() => { reject(failure('RPC_TIMEOUT')); controller.abort(); }, settings.timeoutMs); }),
      observe()
    ]);
  } catch (error) { throw normalizedError(error); }
  finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw failure('INVALID_CONFIG');
    let config;
    try {
      const file = process.argv[2], stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > 65536) throw failure('INVALID_CONFIG');
      config = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch { throw failure('INVALID_CONFIG'); }
    console.log(JSON.stringify(await verifyNetwork(config), null, 2));
  } catch (error) {
    const safe = normalizedError(error);
    console.log(JSON.stringify({ schema: SCHEMA, status: 'failed', error: { code: safe.code, message: safe.message },
      settlementConnected: false, reservesVerified: false, fundsMoved: false }, null, 2));
    process.exitCode = 1;
  }
}
