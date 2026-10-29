import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ContractFactory, getAddress, getCreateAddress, keccak256 } from 'ethers';
import { validateDeployment } from './validate-deployment.mjs';
import { verifyNetwork } from './verify-network.mjs';
import { validateTokenArtifact } from './token-artifact.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUEST_SCHEMA = 'numina.managed-deployment.request.v2';
const MANIFEST_SCHEMA = 'numina.managed-deployment.manifest.v2';
const RESULT_SCHEMA = 'numina.managed-deployment.result.v2';
const JOURNAL_SCHEMA = 'numina.managed-deployment.journal.v1';
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_BODY = 1024 * 1024;
const METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_accounts',
  'eth_getTransactionCount', 'eth_estimateGas', 'eth_getBalance', 'eth_getCode', 'eth_sendTransaction']);
const MESSAGES = {
  INVALID_CONFIG: 'The deployment configuration is missing or invalid.',
  DEPLOYMENT_GATE_FAILED: 'The existing deployment validation gate has unresolved requirements.',
  REVIEW_MISMATCH: 'The reviewed configuration, artifact, manifest or initcode hash does not match.',
  INVALID_RPC_URL: 'A configured HTTPS RPC endpoint without URL userinfo is required.',
  INVALID_RPC_AUTH: 'The configured RPC authorization value is invalid.',
  RPC_UNAVAILABLE: 'The configured RPC provider could not be accessed.',
  RPC_TIMEOUT: 'The RPC operation deadline elapsed.',
  RPC_INVALID_RESPONSE: 'The RPC provider returned an invalid or oversized response.',
  RPC_REJECTED: 'The RPC provider rejected an operation.',
  CHAIN_MISMATCH: 'The observed chain does not match the reviewed chain.',
  GENESIS_MISMATCH: 'The observed genesis does not match the reviewed genesis.',
  SIGNER_UNAVAILABLE: 'The reviewed sender is not exposed by the managed signer.',
  NONCE_MISMATCH: 'The pending sender nonce does not match the reserved nonce.',
  FEE_LIMIT: 'The transaction exceeds a reviewed gas or native fee limit.',
  INSUFFICIENT_BALANCE: 'The sender balance does not cover the maximum transaction fee.',
  ADDRESS_OCCUPIED: 'The predicted creation address already has runtime code.',
  JOURNAL_EXISTS: 'A prior intent or sender nonce journal exists. Submission will not be repeated.',
  JOURNAL_UNAVAILABLE: 'The private deployment journal could not be durably recorded.',
  JOURNAL_DURABILITY_UNAVAILABLE: 'The runtime or filesystem cannot durably flush the journal directory. Submission was not attempted.',
  JOURNAL_INVALID: 'The deployment journal is missing, incomplete or inconsistent.',
  VERIFICATION_FAILED: 'The receipt and reviewed runtime have not passed network observation.'
};
const fail = code => Object.assign(new Error(MESSAGES[code]), { code });
const safeError = error => fail(Object.hasOwn(MESSAGES, error?.code) ? error.code : 'INVALID_CONFIG');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hex = number => `0x${number.toString(16)}`;
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw fail('INVALID_CONFIG');
}
function decimal(value, positive = false) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw fail('INVALID_CONFIG');
  const number = BigInt(value);
  if (number > MAX_UINT256 || (positive && number === 0n)) throw fail('INVALID_CONFIG');
  return number;
}
function hash(value, prefixed = true, code = 'INVALID_CONFIG') {
  const pattern = prefixed ? /^0x[0-9a-f]{64}$/ : /^[0-9a-f]{64}$/;
  if (typeof value !== 'string' || !pattern.test(value) || /^(?:0x)?0{64}$/.test(value)) throw fail(code);
  return value;
}
function address(value, code = 'INVALID_CONFIG') {
  try {
    const result = getAddress(value);
    if (/^0x0{40}$/.test(result)) throw new Error();
    return result;
  } catch { throw fail(code); }
}
function quantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) throw fail('RPC_INVALID_RESPONSE');
  return BigInt(value);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  throw fail('INVALID_CONFIG');
}
function readFile(file, limit = MAX_BODY, code = 'INVALID_CONFIG') {
  try {
    if (typeof file !== 'string' || !file) throw new Error();
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error();
    const bytes = fs.readFileSync(file);
    if (bytes.byteLength > limit) throw new Error();
    return bytes;
  } catch { throw fail(code); }
}
function parseFile(file, limit = MAX_BODY, code = 'INVALID_CONFIG') {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFile(file, limit, code))); }
  catch { throw fail(code); }
}
function executionConfig(value) {
  exact(value, ['schema', 'expectedChainId', 'expectedGenesisHash', 'from', 'nonce', 'gasLimit',
    'maximumGasLimit', 'gasPriceWei', 'maximumTotalFeeWei', 'minimumConfirmations',
    'reviewedArtifactSha256', 'reviewedInitcodeKeccak256', 'reviewedRuntimeCodeHash', 'journalDirectory']);
  if (value.schema !== REQUEST_SCHEMA) throw fail('INVALID_CONFIG');
  decimal(value.expectedChainId, true); decimal(value.nonce);
  const gas = decimal(value.gasLimit, true), maxGas = decimal(value.maximumGasLimit, true);
  const gasPrice = decimal(value.gasPriceWei), maximumFee = decimal(value.maximumTotalFeeWei);
  decimal(value.minimumConfirmations, true);
  if (gas > maxGas || gas * gasPrice > maximumFee || gas * gasPrice > MAX_UINT256) throw fail('FEE_LIMIT');
  hash(value.expectedGenesisHash); hash(value.reviewedArtifactSha256, false);
  hash(value.reviewedInitcodeKeccak256); hash(value.reviewedRuntimeCodeHash);
  if (address(value.from) !== value.from || typeof value.journalDirectory !== 'string' ||
      !path.isAbsolute(value.journalDirectory) || path.normalize(value.journalDirectory) !== value.journalDirectory) throw fail('INVALID_CONFIG');
  return structuredClone(value);
}
function transportSettings(options = {}) {
  const rpcUrl = options.rpcUrl ?? process.env.NUMINA_RPC_URL;
  let endpoint;
  try {
    if (typeof rpcUrl !== 'string' || rpcUrl.length > 8192 || rpcUrl.trim() !== rpcUrl) throw new Error();
    endpoint = new URL(rpcUrl);
    if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.hash) throw new Error();
  } catch { throw fail('INVALID_RPC_URL'); }
  const authorization = options.rpcAuthorization ?? process.env.NUMINA_RPC_AUTHORIZATION;
  if (authorization !== undefined && (typeof authorization !== 'string' || !authorization ||
      authorization.length > 8192 || /[^\x20-\x7e]/.test(authorization) || authorization.trim() !== authorization)) throw fail('INVALID_RPC_AUTH');
  const fetcher = options.fetcher ?? globalThis.fetch, timeoutMs = options.timeoutMs ?? 15000;
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw fail('INVALID_CONFIG');
  return { endpoint: endpoint.href, authorization, fetcher, timeoutMs };
}
async function responseJson(response, signal) {
  if (!response.body || typeof response.body.getReader !== 'function') throw fail('RPC_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error();
      size += value.byteLength;
      if (size > MAX_BODY) { cancel(); throw new Error(); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw fail('RPC_INVALID_RESPONSE'); }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
function rpcClient(settings) {
  const controller = new AbortController(); let nextId = 1; let timer;
  const deadlineAt = performance.now() + settings.timeoutMs;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { reject(fail('RPC_TIMEOUT')); controller.abort(); }, settings.timeoutMs);
  });
  // The shared deadline may elapse between calls; attaching a handler avoids an unhandled rejection.
  void deadline.catch(() => {});
  const check = () => {
    // Synchronous journal fsync can block timer callbacks. Elapsed monotonic time
    // still closes the deadline before any subsequent RPC can start.
    if (controller.signal.aborted || performance.now() >= deadlineAt) {
      controller.abort();
      throw fail('RPC_TIMEOUT');
    }
  };
  const rpc = async (method, params) => {
    check();
    if (!METHODS.has(method)) throw fail('INVALID_CONFIG');
    const id = nextId++;
    const operation = async () => {
      check(); let response;
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (settings.authorization !== undefined) headers.Authorization = settings.authorization;
      const request = { method: 'POST', headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal };
      check();
      try {
        response = await settings.fetcher(settings.endpoint, request);
      } catch { throw fail('RPC_UNAVAILABLE'); }
      check();
      if (response.status !== 200 || !response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw fail('RPC_UNAVAILABLE');
      }
      const envelope = await responseJson(response, controller.signal); check();
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
          envelope.jsonrpc !== '2.0' || envelope.id !== id) throw fail('RPC_INVALID_RESPONSE');
      if (Object.hasOwn(envelope, 'error')) throw fail('RPC_REJECTED');
      if (!Object.hasOwn(envelope, 'result')) throw fail('RPC_INVALID_RESPONSE');
      return envelope.result;
    };
    return Promise.race([deadline, operation()]);
  };
  return { rpc, check, close() { clearTimeout(timer); controller.abort(); } };
}

// Reconstruct the two immutables from reviewed constructor inputs. Initial supply,
// recipient and administrator delay affect storage/creation data, not immutable slots.
function expectedRuntimeHash(artifact, checked) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(artifact.deployedBytecode) ||
      !Array.isArray(artifact.runtimeImmutables) || artifact.runtimeImmutables.length !== 2) throw fail('REVIEW_MISMATCH');
  const runtime = Buffer.from(artifact.deployedBytecode.slice(2), 'hex');
  const bindings = new Map([
    ['@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol:ERC20Capped:_cap', checked.cap.toString(16).padStart(64, '0')],
    ['contracts/NuminaUSD.sol:NuminaUSD:issuerPolicyHash', checked.policyHash]
  ]);
  const usedOffsets = new Set();
  for (const immutable of artifact.runtimeImmutables) {
    exact(immutable, ['sourceName', 'contractName', 'variableName', 'references']);
    const key = `${immutable.sourceName}:${immutable.contractName}:${immutable.variableName}`;
    const value = bindings.get(key);
    if (!value || !Array.isArray(immutable.references) || !immutable.references.length) throw fail('REVIEW_MISMATCH');
    bindings.delete(key);
    for (const reference of immutable.references) {
      exact(reference, ['start', 'length']);
      if (!Number.isSafeInteger(reference.start) || reference.start < 0 || reference.length !== 32 ||
          reference.start + 32 > runtime.length) throw fail('REVIEW_MISMATCH');
      for (let offset = reference.start; offset < reference.start + 32; offset++) {
        if (usedOffsets.has(offset) || runtime[offset] !== 0) throw fail('REVIEW_MISMATCH');
        usedOffsets.add(offset);
      }
      Buffer.from(value, 'hex').copy(runtime, reference.start);
    }
  }
  if (bindings.size) throw fail('REVIEW_MISMATCH');
  return keccak256(runtime);
}
async function reviewedDeployment(deploymentConfigPath, execution) {
  if (typeof deploymentConfigPath !== 'string' || !deploymentConfigPath) throw fail('INVALID_CONFIG');
  const absolute = path.resolve(deploymentConfigPath);
  const configBytes = readFile(absolute, 65536);
  let checked;
  try { checked = validateDeployment(absolute); }
  catch { throw fail('DEPLOYMENT_GATE_FAILED'); }
  if (checked.errors.length) throw fail('DEPLOYMENT_GATE_FAILED');
  if (String(checked.config.network.chainId) !== execution.expectedChainId) throw fail('CHAIN_MISMATCH');
  // Pin the existing artifact; never silently compile a different build during execution.
  const artifactBytes = readFile(path.join(ROOT, 'artifacts', 'NuminaUSD.json'));
  if (sha256(artifactBytes) !== execution.reviewedArtifactSha256) throw fail('REVIEW_MISMATCH');
  let artifact;
  try { artifact = validateTokenArtifact(artifactBytes, readFile(path.join(ROOT, 'contracts', 'NuminaUSD.sol'))); }
  catch { throw fail('REVIEW_MISMATCH'); }
  const actualSourceHash = sha256(readFile(path.join(ROOT, 'contracts', 'NuminaUSD.sol')));
  if (artifact.schema !== 'numina.nusd.contract-candidate.v2' || artifact.contractName !== 'NuminaUSD' || artifact.sourceName !== 'contracts/NuminaUSD.sol' ||
      artifact.sourceSha256 !== actualSourceHash || typeof artifact.compiler !== 'string' ||
      !artifact.compiler.startsWith('0.8.37+commit.') || !/^0x(?:[0-9a-fA-F]{2})+$/.test(artifact.bytecode)) throw fail('REVIEW_MISMATCH');
  let data;
  try {
    data = (await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(checked.cap, checked.initialSupply, checked.initialRecipient,
      checked.roles.admin, checked.roles.issuer, checked.roles.minter, checked.roles.pauser,
      checked.config.adminDelaySeconds, `0x${checked.policyHash}`)).data.toLowerCase();
  } catch { throw fail('REVIEW_MISMATCH'); }
  if ((data.length - 2) / 2 > 49152 || keccak256(data) !== execution.reviewedInitcodeKeccak256) throw fail('REVIEW_MISMATCH');
  if (expectedRuntimeHash(artifact, checked) !== execution.reviewedRuntimeCodeHash) throw fail('REVIEW_MISMATCH');
  if (sha256(readFile(absolute, 65536)) !== sha256(configBytes)) throw fail('REVIEW_MISMATCH');
  return { deploymentConfigPath: absolute, deploymentConfigSha256: sha256(configBytes),
    sourceSha256: actualSourceHash, compiler: artifact.compiler,
    tokenCreation: { supplyCapBaseUnits: checked.cap.toString(), initialSupplyBaseUnits: checked.initialSupply.toString(),
      initialRecipient: checked.initialRecipient, adminDelaySeconds: checked.config.adminDelaySeconds, initiallyPaused: true },
    transaction: { chainId: hex(decimal(execution.expectedChainId, true)), from: execution.from,
      nonce: hex(decimal(execution.nonce)), gas: hex(decimal(execution.gasLimit, true)),
      gasPrice: hex(decimal(execution.gasPriceWei)), value: '0x0', data },
    predictedContractAddress: getCreateAddress({ from: execution.from, nonce: decimal(execution.nonce) }) };
}
async function preflight(client, manifest) {
  const e = manifest.execution, transaction = manifest.transaction;
  if (quantity(await client.rpc('eth_chainId', [])) !== decimal(e.expectedChainId, true)) throw fail('CHAIN_MISMATCH');
  const genesis = await client.rpc('eth_getBlockByNumber', ['0x0', false]);
  if (!genesis || quantity(genesis.number) !== 0n || hash(genesis.hash, true, 'RPC_INVALID_RESPONSE') !== e.expectedGenesisHash) throw fail('GENESIS_MISMATCH');
  const accounts = await client.rpc('eth_accounts', []);
  if (!Array.isArray(accounts) || accounts.length > 10000 || !accounts.map(a => address(a, 'RPC_INVALID_RESPONSE')).includes(e.from)) throw fail('SIGNER_UNAVAILABLE');
  if (quantity(await client.rpc('eth_getTransactionCount', [e.from, 'pending'])) !== decimal(e.nonce)) throw fail('NONCE_MISMATCH');
  const latest = await client.rpc('eth_getBlockByNumber', ['latest', false]);
  if (!latest) throw fail('RPC_INVALID_RESPONSE');
  const blockNumber = quantity(latest.number), blockHash = hash(latest.hash, true, 'RPC_INVALID_RESPONSE');
  if (quantity(latest.gasLimit) < decimal(e.gasLimit, true)) throw fail('FEE_LIMIT');
  const estimatedGas = quantity(await client.rpc('eth_estimateGas', [transaction]));
  if (estimatedGas === 0n || estimatedGas > decimal(e.gasLimit, true)) throw fail('FEE_LIMIT');
  const balance = quantity(await client.rpc('eth_getBalance', [e.from, 'pending']));
  if (balance < decimal(e.gasLimit, true) * decimal(e.gasPriceWei)) throw fail('INSUFFICIENT_BALANCE');
  const existingCode = await client.rpc('eth_getCode', [manifest.predictedContractAddress, 'latest']);
  if (existingCode !== '0x') {
    if (typeof existingCode !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(existingCode)) throw fail('RPC_INVALID_RESPONSE');
    throw fail('ADDRESS_OCCUPIED');
  }
  return { observedBlockNumber: blockNumber.toString(), observedBlockHash: blockHash, estimatedGas: estimatedGas.toString() };
}
function validateManifest(manifest, expectedSha256) {
  exact(manifest, ['schema', 'preparedAt', 'execution', 'deploymentConfigPath', 'deploymentConfigSha256',
    'sourceSha256', 'compiler', 'tokenCreation', 'transaction', 'predictedContractAddress', 'preflight']);
  hash(expectedSha256, false);
  if (sha256(canonical(manifest)) !== expectedSha256) throw fail('REVIEW_MISMATCH');
  if (manifest.schema !== MANIFEST_SCHEMA || typeof manifest.preparedAt !== 'string' ||
      !Number.isFinite(Date.parse(manifest.preparedAt)) || typeof manifest.deploymentConfigPath !== 'string' ||
      !path.isAbsolute(manifest.deploymentConfigPath) || typeof manifest.compiler !== 'string') throw fail('INVALID_CONFIG');
  const execution = executionConfig(manifest.execution);
  hash(manifest.deploymentConfigSha256, false); hash(manifest.sourceSha256, false);
  exact(manifest.tokenCreation, ['supplyCapBaseUnits', 'initialSupplyBaseUnits', 'initialRecipient', 'adminDelaySeconds', 'initiallyPaused']);
  const creation = manifest.tokenCreation;
  if (decimal(creation.initialSupplyBaseUnits) > decimal(creation.supplyCapBaseUnits, true) ||
      address(creation.initialRecipient) !== creation.initialRecipient || creation.initiallyPaused !== true ||
      !Number.isSafeInteger(creation.adminDelaySeconds) || creation.adminDelaySeconds < 0 ||
      creation.adminDelaySeconds >= 2 ** 48) throw fail('INVALID_CONFIG');
  exact(manifest.transaction, ['chainId', 'from', 'nonce', 'gas', 'gasPrice', 'value', 'data']);
  const tx = manifest.transaction;
  if (tx.chainId !== hex(decimal(execution.expectedChainId, true)) || tx.from !== execution.from ||
      tx.nonce !== hex(decimal(execution.nonce)) || tx.gas !== hex(decimal(execution.gasLimit, true)) ||
      tx.gasPrice !== hex(decimal(execution.gasPriceWei)) || tx.value !== '0x0' ||
      typeof tx.data !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(tx.data) ||
      (tx.data.length - 2) / 2 > 49152 || keccak256(tx.data) !== execution.reviewedInitcodeKeccak256 ||
      manifest.predictedContractAddress !== getCreateAddress({ from: execution.from, nonce: decimal(execution.nonce) })) throw fail('REVIEW_MISMATCH');
  exact(manifest.preflight, ['observedBlockNumber', 'observedBlockHash', 'estimatedGas']);
  decimal(manifest.preflight.observedBlockNumber); decimal(manifest.preflight.estimatedGas, true);
  hash(manifest.preflight.observedBlockHash);
  return structuredClone(manifest);
}
function journalPaths(manifest) {
  const e = manifest.execution;
  // The intent lock is independent of nonce and manifest timestamp, preventing a repeat
  // of the same creation data by merely preparing another manifest with a new nonce.
  const intent = sha256(`${e.expectedChainId}:${e.expectedGenesisHash}:${e.reviewedInitcodeKeccak256}`);
  const nonce = sha256(`${e.expectedChainId}:${e.expectedGenesisHash}:${e.from.toLowerCase()}:${e.nonce}`);
  return { intent: path.join(e.journalDirectory, `intent-${intent}.jsonl`),
    nonce: path.join(e.journalDirectory, `nonce-${nonce}.jsonl`) };
}
function writeRecord(fd, record) {
  fs.writeFileSync(fd, `${JSON.stringify(record)}\n`, { encoding: 'utf8' });
  fs.fsyncSync(fd);
}
function syncJournalDirectory(directory) {
  let directoryFd;
  try {
    // File fsync alone does not make a new directory entry durable. Require the
    // containing-directory barrier as well; never substitute another file fsync.
    // Node on Windows may reject directory open/fsync. That runtime is unsupported
    // for submission unless this actual operation succeeds; there is no bypass.
    directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0));
    if (!fs.fstatSync(directoryFd).isDirectory()) throw new Error();
    fs.fsyncSync(directoryFd);
  } catch { throw fail('JOURNAL_DURABILITY_UNAVAILABLE'); }
  finally { if (directoryFd !== undefined) { try { fs.closeSync(directoryFd); } catch {} } }
}
function requireJournalRuntime(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) ||
      path.normalize(directory) !== directory) throw fail('INVALID_CONFIG');
  let stat;
  try { stat = fs.lstatSync(directory); }
  catch { throw fail('JOURNAL_UNAVAILABLE'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw fail('JOURNAL_UNAVAILABLE');
  syncJournalDirectory(directory);
}

/** Local observation only: no file creation, credential access, RPC or submission. */
export function inspectJournalRuntime(directory) {
  requireJournalRuntime(directory);
  return { schema: 'numina.journal-runtime-observation.v1',
    status: 'directory_flush_observed_supported', observedAt: new Date().toISOString(),
    platform: process.platform, node: process.version, directorySyncObserved: true,
    journalFilesCreated: false, rpcContacted: false, transactionBroadcast: false,
    submissionReady: false, crashDurabilityVerified: false,
    scope: 'A successful directory fsync call on the inspected path; not deployment, storage crash-durability, custody or financial assurance.' };
}
function claimJournals(manifest, digest) {
  const files = journalPaths(manifest); let intentFd, nonceFd;
  try {
    // Reject unsupported local storage before creating either exclusive lock.
    // The second barrier below remains necessary for the newly created entries.
    requireJournalRuntime(manifest.execution.journalDirectory);
    intentFd = fs.openSync(files.intent, 'wx', 0o600);
    writeRecord(intentFd, { schema: JOURNAL_SCHEMA, state: 'locked', manifestSha256: digest,
      chainId: manifest.execution.expectedChainId, genesisHash: manifest.execution.expectedGenesisHash,
      from: manifest.execution.from, nonce: manifest.execution.nonce,
      initcodeKeccak256: manifest.execution.reviewedInitcodeKeccak256,
      predictedContractAddress: manifest.predictedContractAddress, at: new Date().toISOString() });
    nonceFd = fs.openSync(files.nonce, 'wx', 0o600);
    writeRecord(nonceFd, { schema: JOURNAL_SCHEMA, state: 'locked', manifestSha256: digest });
    fs.closeSync(nonceFd); nonceFd = undefined;
    // Both exclusive filenames must survive a host crash before submission can
    // become possible. The caller must retain this directory on persistent storage.
    syncJournalDirectory(manifest.execution.journalDirectory);
    return intentFd;
  } catch (error) {
    if (intentFd !== undefined) { try { fs.closeSync(intentFd); } catch {} }
    if (nonceFd !== undefined) { try { fs.closeSync(nonceFd); } catch {} }
    // Preserve every created record, including partial failures. Never unlock by deleting.
    throw fail(error?.code === 'EEXIST' ? 'JOURNAL_EXISTS' :
      error?.code === 'JOURNAL_DURABILITY_UNAVAILABLE' ? 'JOURNAL_DURABILITY_UNAVAILABLE' : 'JOURNAL_UNAVAILABLE');
  }
}
const result = (status, fields = {}) => ({ schema: RESULT_SCHEMA, status, ...fields,
  nativeValueWei: '0', nativeFeeStatus: 'not_observed', settlementConnected: false,
  reservesVerified: false, independentlyVerified: false, standaloneMintCallRequested: false, unpauseRequested: false });

/** Prepare performs only reads and preserves the current deployment validator gate. */
export async function prepareManagedDeployment(deploymentConfigPath, execution, options = {}) {
  let client;
  try {
    const e = executionConfig(execution), settings = transportSettings(options);
    const reviewed = await reviewedDeployment(deploymentConfigPath, e);
    const manifest = { schema: MANIFEST_SCHEMA, preparedAt: new Date().toISOString(), execution: e, ...reviewed };
    client = rpcClient(settings);
    manifest.preflight = await preflight(client, manifest);
    return { manifest, manifestSha256: sha256(canonical(manifest)) };
  } catch (error) { throw safeError(error); }
  finally { client?.close(); }
}

/** Exactly one managed-signing submission attempt. Any ambiguous outcome remains locked. */
export async function submitManagedDeploymentOnce(manifestValue, expectedManifestSha256, options = {}) {
  let client, fd;
  try {
    const manifest = validateManifest(manifestValue, expectedManifestSha256);
    const files = journalPaths(manifest);
    if (fs.existsSync(files.intent) || fs.existsSync(files.nonce)) throw fail('JOURNAL_EXISTS');
    const settings = transportSettings(options);
    const reviewed = await reviewedDeployment(manifest.deploymentConfigPath, manifest.execution);
    for (const key of Object.keys(reviewed)) {
      if (canonical(reviewed[key]) !== canonical(manifest[key])) throw fail('REVIEW_MISMATCH');
    }
    // A failed local runtime check must not create journals or contact the chain.
    // Recheck inside claimJournals too; this does not replace the post-create flush.
    requireJournalRuntime(manifest.execution.journalDirectory);
    client = rpcClient(settings);
    await preflight(client, manifest); client.check();
    fd = claimJournals(manifest, expectedManifestSha256);
    // Recheck nonce after acquiring local locks. The sender still requires exclusive
    // coordination with all other applications; local locks cannot control an external wallet.
    if (quantity(await client.rpc('eth_getTransactionCount', [manifest.execution.from, 'pending'])) !== decimal(manifest.execution.nonce)) throw fail('NONCE_MISMATCH');
    client.check();
    try {
      writeRecord(fd, { schema: JOURNAL_SCHEMA, state: 'submission_started',
        manifestSha256: expectedManifestSha256, at: new Date().toISOString(),
        gasLimit: manifest.execution.gasLimit, gasPriceWei: manifest.execution.gasPriceWei,
        maximumTotalFeeWei: manifest.execution.maximumTotalFeeWei, valueWei: '0' });
    } catch { throw fail('JOURNAL_UNAVAILABLE'); }
    // Recheck the monotonic deadline after the final synchronous journal flush.
    // On expiry, retain the journals and fail before entering the send attempt.
    client.check();
    // Once this point is reached, even a provider rejection is conservatively uncertain.
    // There is no retry loop, replacement transaction, unlock, standalone mint or unpause.
    // This exact creation call can issue the explicitly reviewed initial token supply.
    try {
      const transactionHash = hash(await client.rpc('eth_sendTransaction', [manifest.transaction]), true, 'RPC_INVALID_RESPONSE');
      writeRecord(fd, { schema: JOURNAL_SCHEMA, state: 'submitted', manifestSha256: expectedManifestSha256,
        transactionHash, at: new Date().toISOString() });
      return result('submitted_needs_verification', { transactionHash,
        tokenCreation: manifest.tokenCreation, initialSupplyVerified: false,
        predictedContractAddress: manifest.predictedContractAddress, manifestSha256: expectedManifestSha256,
        automaticResubmissionAllowed: false });
    } catch {
      try { writeRecord(fd, { schema: JOURNAL_SCHEMA, state: 'outcome_unknown', manifestSha256: expectedManifestSha256,
        at: new Date().toISOString() }); } catch {}
      return result('outcome_unknown', { manifestSha256: expectedManifestSha256,
        tokenCreation: manifest.tokenCreation, initialSupplyVerified: false,
        automaticResubmissionAllowed: false, reconciliationRequired: true });
    }
  } catch (error) { throw safeError(error); }
  finally { client?.close(); if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}

/** Observation uses the reviewed immutable-populated runtime hash, never the runtime template. */
export async function observeManagedDeployment(manifestValue, expectedManifestSha256, options = {}) {
  try {
    const manifest = validateManifest(manifestValue, expectedManifestSha256);
    let records;
    try {
      records = readFile(journalPaths(manifest).intent, MAX_BODY, 'JOURNAL_INVALID').toString('utf8')
        .trimEnd().split('\n').map(line => JSON.parse(line));
      if (records.length < 1 || records.some(record => !record || record.schema !== JOURNAL_SCHEMA ||
          record.manifestSha256 !== expectedManifestSha256) || records[0].state !== 'locked' ||
          records[0].chainId !== manifest.execution.expectedChainId ||
          records[0].genesisHash !== manifest.execution.expectedGenesisHash || records[0].from !== manifest.execution.from ||
          records[0].nonce !== manifest.execution.nonce || records[0].initcodeKeccak256 !== manifest.execution.reviewedInitcodeKeccak256 ||
          records[0].predictedContractAddress !== manifest.predictedContractAddress) throw new Error();
    } catch { throw fail('JOURNAL_INVALID'); }
    const submitted = records.find(record => record.state === 'submitted');
    if (!submitted) return result('outcome_unknown', { tokenCreation: manifest.tokenCreation, initialSupplyVerified: false,
      automaticResubmissionAllowed: false, reconciliationRequired: true });
    const transactionHash = hash(submitted.transactionHash, true, 'JOURNAL_INVALID');
    const settings = transportSettings(options), e = manifest.execution;
    let observation;
    try {
      observation = await verifyNetwork({ expectedChainId: e.expectedChainId, expectedGenesisHash: e.expectedGenesisHash,
        contractAddress: manifest.predictedContractAddress, deploymentTransactionHash: transactionHash,
        expectedRuntimeCodeHash: e.reviewedRuntimeCodeHash, minimumConfirmations: e.minimumConfirmations }, {
        rpcUrl: settings.endpoint, timeoutMs: settings.timeoutMs,
        fetcher: (url, request) => {
          const headers = new Headers(request.headers);
          if (settings.authorization !== undefined) headers.set('Authorization', settings.authorization);
          return settings.fetcher(url, { ...request, headers });
        }
      });
    } catch { throw fail('VERIFICATION_FAILED'); }
    return result('matched_reviewed_runtime_needs_state_verification', { transactionHash,
      tokenCreation: manifest.tokenCreation,
      contractAddress: observation.deployment.contractAddress, observation,
      roleStateVerified: false, initialSupplyVerified: false, pausedStateVerified: false,
      automaticResubmissionAllowed: false });
  } catch (error) { throw safeError(error); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, ...args] = process.argv.slice(2);
    if (operation === 'check-runtime' && args.length === 1) {
      try {
        console.log(JSON.stringify(inspectJournalRuntime(args[0]), null, 2));
      } catch (error) {
        const safe = safeError(error);
        console.log(JSON.stringify({ schema: 'numina.journal-runtime-observation.v1',
          status: 'directory_flush_not_established', observedAt: new Date().toISOString(),
          platform: process.platform, node: process.version,
          error: { code: safe.code, message: safe.message },
          directorySyncObserved: false, journalFilesCreated: false, rpcContacted: false,
          transactionBroadcast: false, submissionReady: false, crashDurabilityVerified: false }, null, 2));
        process.exitCode = 1;
      }
    } else if (operation === 'prepare' && args.length === 3) {
      const prepared = await prepareManagedDeployment(args[0], parseFile(args[1], 65536));
      let fd;
      try { fd = fs.openSync(args[2], 'wx', 0o600); writeRecord(fd, prepared.manifest); }
      catch { throw fail('JOURNAL_UNAVAILABLE'); }
      finally { if (fd !== undefined) fs.closeSync(fd); }
      console.log(JSON.stringify(result('prepared_not_submitted', { manifestSha256: prepared.manifestSha256,
        tokenCreation: prepared.manifest.tokenCreation }), null, 2));
    } else if ((operation === 'submit' || operation === 'observe') && args.length === 2) {
      const outcome = await (operation === 'submit' ? submitManagedDeploymentOnce : observeManagedDeployment)(parseFile(args[0]), args[1]);
      console.log(JSON.stringify(outcome, null, 2));
      if (outcome.status === 'outcome_unknown') process.exitCode = 2;
    } else throw fail('INVALID_CONFIG');
  } catch (error) {
    const safe = safeError(error);
    console.log(JSON.stringify(result('failed', { error: { code: safe.code, message: safe.message } }), null, 2));
    process.exitCode = 1;
  }
}
