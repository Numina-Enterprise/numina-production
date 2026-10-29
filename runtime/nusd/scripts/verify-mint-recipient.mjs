import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, keccak256, TypedDataEncoder, verifyTypedData } from 'ethers';

export const RECIPIENT_REQUEST_SCHEMA = 'numina.nusd.recipient-evidence-request.v1';
export const RECIPIENT_EVIDENCE_SCHEMA = 'numina.nusd.recipient-evidence.v1';
export const NUMINA_CHAIN_ID = '962421430';
export const RECIPIENT_CONTROL_PURPOSE = 'numina.nusd.mint-recipient-evidence';
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_BODY_BYTES = 1024 * 1024;
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode']);
const MESSAGES = {
  INVALID_REQUEST: 'An explicit recipient evidence request with valid, recognized fields is required.',
  INVALID_RECIPIENT: 'An explicit nonzero checksummed hexadecimal recipient address is required.',
  INVALID_RPC_URL: 'A configured HTTPS RPC endpoint is required.',
  INVALID_OPTIONS: 'Valid read-only RPC and observation options are required.',
  RPC_UNAVAILABLE: 'The configured RPC provider could not be read.',
  RPC_TIMEOUT: 'The recipient observation deadline elapsed.',
  RPC_INVALID_RESPONSE: 'The RPC provider returned an invalid or oversized response.',
  RPC_REJECTED: 'The RPC provider rejected a required read operation.',
  CHAIN_MISMATCH: 'The observed chain does not match the required Numina chain.',
  BLOCK_NOT_FOUND: 'The requested observation block was not found.',
  BLOCK_MISMATCH: 'The observed block does not match the explicit block identity.',
  SNAPSHOT_CHANGED: 'The observed block identity changed during verification.',
  INVALID_CONTROL_PROOF: 'The optional recipient-key signature proof is invalid or outside its permitted scope.',
  CONTROL_PROOF_EXPIRED: 'The optional recipient-key signature proof has expired.',
  CONTROL_PROOF_NOT_YET_VALID: 'The optional recipient-key signature proof is not yet valid.',
  CONTROL_PROOF_SIGNER_MISMATCH: 'The optional signature does not recover the requested recipient key.'
};
const UNVERIFIED = Object.freeze({
  independentlyVerified: false, walletControlVerified: false, keyCustodyVerified: false,
  assetReceiptCapabilityVerified: false, reservesVerified: false, reserveAllocationVerified: false,
  mintCompleted: false, fundsMoved: false, broadcast: false, transactionHash: null, receipt: null
});
function failure(code) { return Object.assign(new Error(MESSAGES[code]), { code }); }
function safeError(error) { return failure(Object.hasOwn(MESSAGES, error?.code) ? error.code : 'RPC_UNAVAILABLE'); }
function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure(code);
  return value;
}
function strictObject(value, required, optional = [], code = 'INVALID_REQUEST') {
  object(value, code);
  if (required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw failure(code);
  return value;
}
function decimal(value, code = 'INVALID_REQUEST') {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX_UINT256) throw failure(code);
  return BigInt(value);
}
function hash(value, code = 'RPC_INVALID_RESPONSE') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) throw failure(code);
  return value.toLowerCase();
}
function recipientAddress(value) {
  try {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/.test(value) || getAddress(value) !== value) throw new Error();
    return value;
  } catch { throw failure('INVALID_RECIPIENT'); }
}
function quantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) throw failure('RPC_INVALID_RESPONSE');
  return BigInt(value);
}
function block(value) {
  if (value === null) throw failure('BLOCK_NOT_FOUND');
  object(value, 'RPC_INVALID_RESPONSE');
  return { number: quantity(value.number), hash: hash(value.hash), timestamp: quantity(value.timestamp) };
}
function validate(request, { requireSignature = true } = {}) {
  strictObject(request, ['schema', 'expectedChainId', 'recipient', 'block'], ['controlProof']);
  if (request.schema !== RECIPIENT_REQUEST_SCHEMA || request.expectedChainId !== NUMINA_CHAIN_ID) throw failure('INVALID_REQUEST');
  const recipient = recipientAddress(request.recipient);
  object(request.block, 'INVALID_REQUEST');
  let selection;
  if (Object.hasOwn(request.block, 'tag')) {
    strictObject(request.block, ['tag']);
    if (!['latest', 'finalized'].includes(request.block.tag)) throw failure('INVALID_REQUEST');
    selection = { tag: request.block.tag };
  } else {
    strictObject(request.block, ['number', 'hash']);
    selection = { number: decimal(request.block.number).toString(), hash: hash(request.block.hash, 'INVALID_REQUEST') };
  }
  if (Object.hasOwn(request, 'controlProof')) validateProofFields(request.controlProof, requireSignature);
  return { recipient, selection, controlProof: request.controlProof };
}
function validateProofFields(proof, requireSignature = true) {
  strictObject(proof, ['purpose', 'issuedAt', 'expiresAt', 'nonce', ...(requireSignature ? ['signature'] : [])],
    requireSignature ? [] : ['signature'], 'INVALID_CONTROL_PROOF');
  const issuedAt = decimal(proof.issuedAt, 'INVALID_CONTROL_PROOF');
  const expiresAt = decimal(proof.expiresAt, 'INVALID_CONTROL_PROOF');
  if (proof.purpose !== RECIPIENT_CONTROL_PURPOSE || issuedAt === 0n || expiresAt <= issuedAt || expiresAt - issuedAt > 3600n) throw failure('INVALID_CONTROL_PROOF');
  hash(proof.nonce, 'INVALID_CONTROL_PROOF');
  if ((requireSignature || Object.hasOwn(proof, 'signature')) &&
      (typeof proof.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(proof.signature))) throw failure('INVALID_CONTROL_PROOF');
}

/** Exact EIP-712 statement; this helper accepts an unsigned proof and never signs it. */
export function recipientControlTypedData(request) {
  const settings = validate(request, { requireSignature: false });
  if (!settings.controlProof) throw failure('INVALID_CONTROL_PROOF');
  const proof = settings.controlProof;
  return {
    domain: { name: 'Numina mint recipient evidence', version: '1', chainId: NUMINA_CHAIN_ID },
    types: { RecipientControl: [
      { name: 'recipient', type: 'address' }, { name: 'purpose', type: 'string' },
      { name: 'issuedAt', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ] },
    value: { recipient: settings.recipient, purpose: proof.purpose, issuedAt: proof.issuedAt,
      expiresAt: proof.expiresAt, nonce: proof.nonce.toLowerCase() }
  };
}
function verifyProof(request, observedAt) {
  const proof = request.controlProof;
  if (!proof) return { status: 'not_provided', signatureMatchesRecipientKey: false };
  const epoch = BigInt(Math.floor(observedAt.getTime() / 1000));
  if (epoch >= BigInt(proof.expiresAt)) throw failure('CONTROL_PROOF_EXPIRED');
  if (epoch < BigInt(proof.issuedAt)) throw failure('CONTROL_PROOF_NOT_YET_VALID');
  const { domain, types, value } = recipientControlTypedData(request);
  let recovered;
  try { recovered = verifyTypedData(domain, types, value, proof.signature); }
  catch { throw failure('INVALID_CONTROL_PROOF'); }
  if (recovered !== request.recipient) throw failure('CONTROL_PROOF_SIGNER_MISMATCH');
  return { status: 'signature_matches_recipient_key', signatureMatchesRecipientKey: true,
    scheme: 'EIP-712', scope: 'recipient_key_signature_only', signer: recovered,
    purpose: proof.purpose, chainId: NUMINA_CHAIN_ID, issuedAt: proof.issuedAt, expiresAt: proof.expiresAt,
    nonce: value.nonce, statementHash: TypedDataEncoder.hash(domain, types, value),
    signature: proof.signature, contractWalletSignatureVerified: false,
    statementAuthorizesTransaction: false, exclusiveCustodyVerified: false };
}
function observationTime(now) {
  const time = now();
  if (!(time instanceof Date) || !Number.isFinite(time.getTime()) || time.getTime() < 0) throw failure('INVALID_OPTIONS');
  return time;
}

/**
 * Observe one recipient using an injected read-only RPC function. No environment,
 * filesystem, keys, transaction sender, balance lookup or financial writes are used.
 * Code state and chain identity are provider reports, not independent consensus proof.
 */
export async function verifyMintRecipient(request, { rpc, now = () => new Date() } = {}) {
  try {
    const settings = validate(request);
    // Capture only recognized values so the caller cannot retarget an in-flight observation.
    request = { schema: RECIPIENT_REQUEST_SCHEMA, expectedChainId: NUMINA_CHAIN_ID,
      recipient: settings.recipient, block: { ...settings.selection },
      ...(settings.controlProof ? { controlProof: { ...settings.controlProof } } : {}) };
    if (typeof rpc !== 'function' || typeof now !== 'function') throw failure('INVALID_OPTIONS');
    // Reject an invalid/expired signature before spending any provider reads.
    verifyProof(request, observationTime(now));
    let rpcReadCalls = 0;
    const read = async (method, params) => {
      if (!READ_METHODS.has(method)) throw failure('INVALID_OPTIONS');
      rpcReadCalls++;
      return rpc(method, params);
    };
    const chainId = quantity(await read('eth_chainId', []));
    if (chainId.toString() !== NUMINA_CHAIN_ID) throw failure('CHAIN_MISMATCH');
    const selector = settings.selection.tag ?? `0x${BigInt(settings.selection.number).toString(16)}`;
    const snapshot = block(await read('eth_getBlockByNumber', [selector, false]));
    if (!settings.selection.tag && (snapshot.number.toString() !== settings.selection.number || snapshot.hash !== settings.selection.hash)) throw failure('BLOCK_MISMATCH');
    const code = await read('eth_getCode', [settings.recipient, { blockHash: snapshot.hash, requireCanonical: true }]);
    if (typeof code !== 'string' || code.length > MAX_BODY_BYTES || !/^0x(?:[0-9a-fA-F]{2})*$/.test(code)) throw failure('RPC_INVALID_RESPONSE');
    const finalBlock = block(await read('eth_getBlockByNumber', [`0x${snapshot.number.toString(16)}`, false]));
    if (finalBlock.number !== snapshot.number || finalBlock.hash !== snapshot.hash || finalBlock.timestamp !== snapshot.timestamp) throw failure('SNAPSHOT_CHANGED');
    if (quantity(await read('eth_chainId', [])) !== chainId) throw failure('CHAIN_MISMATCH');
    const observedAt = observationTime(now);
    // Expiry is evaluated again after the provider reads, not only at their start.
    const controlProof = verifyProof(request, observedAt);
    return {
      schema: RECIPIENT_EVIDENCE_SCHEMA, status: 'recipient_observed', observedAt: observedAt.toISOString(),
      evidenceSource: 'single_configured_rpc_provider', verificationScope: 'provider_reported_observation',
      chain: { expectedChainId: NUMINA_CHAIN_ID, observedChainId: chainId.toString() },
      recipient: settings.recipient,
      observedBlock: { requestedSelection: settings.selection, number: snapshot.number.toString(),
        hash: snapshot.hash, timestamp: snapshot.timestamp.toString(),
        finalizedTagReportedByProvider: settings.selection.tag === 'finalized',
        canonicalAtFinalReadReportedByProvider: true },
      recipientCode: { status: code === '0x' ? 'empty' : 'nonempty', bytes: (code.length - 2) / 2,
        algorithm: 'keccak256', hash: keccak256(code), atBlockHash: snapshot.hash },
      controlProof, rpcReadCalls, ...UNVERIFIED
    };
  } catch (error) { throw safeError(error); }
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

/** HTTPS transport follows verify-network.mjs; endpoints/auth never enter evidence/errors. */
export async function observeMintRecipient(request, {
  rpcUrl = process.env.NUMINA_RPC_URL, rpcAuthorization = process.env.NUMINA_RPC_AUTHORIZATION,
  fetcher = globalThis.fetch, timeoutMs = 15000, now = () => new Date()
} = {}) {
  let timer;
  const controller = new AbortController();
  try {
    validate(request);
    let endpoint;
    try {
      if (typeof rpcUrl !== 'string' || rpcUrl.length > 8192 || rpcUrl !== rpcUrl.trim()) throw new Error();
      endpoint = new URL(rpcUrl);
      if (endpoint.protocol !== 'https:' || !endpoint.hostname || endpoint.username || endpoint.password || endpoint.hash) throw new Error();
    } catch { throw failure('INVALID_RPC_URL'); }
    if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw failure('INVALID_OPTIONS');
    if (rpcAuthorization !== undefined && (typeof rpcAuthorization !== 'string' ||
        !/^[\x20-\x7e]{1,8192}$/.test(rpcAuthorization) || rpcAuthorization !== rpcAuthorization.trim())) throw failure('INVALID_OPTIONS');
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json',
      ...(rpcAuthorization === undefined ? {} : { Authorization: rpcAuthorization }) };
    let nextId = 1;
    const rpc = async (method, params) => {
      if (controller.signal.aborted) throw failure('RPC_TIMEOUT');
      if (!READ_METHODS.has(method)) throw failure('INVALID_OPTIONS');
      const id = nextId++;
      let response;
      try {
        response = await fetcher(endpoint.href, {
          method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers,
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
        });
      } catch { throw failure('RPC_UNAVAILABLE'); }
      if (response.status !== 200 || !response.ok || response.redirected) {
        void response.body?.cancel().catch(() => {});
        throw failure('RPC_UNAVAILABLE');
      }
      const envelope = object(await readJson(response, controller.signal), 'RPC_INVALID_RESPONSE');
      if (envelope.jsonrpc !== '2.0' || envelope.id !== id) throw failure('RPC_INVALID_RESPONSE');
      if (Object.hasOwn(envelope, 'error')) throw failure('RPC_REJECTED');
      if (!Object.hasOwn(envelope, 'result')) throw failure('RPC_INVALID_RESPONSE');
      return envelope.result;
    };
    return await Promise.race([
      new Promise((_, reject) => { timer = setTimeout(() => { reject(failure('RPC_TIMEOUT')); controller.abort(); }, timeoutMs); }),
      verifyMintRecipient(request, { rpc, now })
    ]);
  } catch (error) { throw safeError(error); }
  finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw failure('INVALID_REQUEST');
    let request;
    try {
      const stat = fs.statSync(process.argv[2]);
      if (!stat.isFile() || stat.size > 65536) throw new Error();
      request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(process.argv[2])));
    } catch { throw failure('INVALID_REQUEST'); }
    console.log(JSON.stringify(await observeMintRecipient(request), null, 2));
  } catch (error) {
    const safe = safeError(error);
    console.log(JSON.stringify({ schema: RECIPIENT_EVIDENCE_SCHEMA, status: 'failed',
      error: { code: safe.code, message: safe.message }, ...UNVERIFIED }, null, 2));
    process.exitCode = 1;
  }
}
