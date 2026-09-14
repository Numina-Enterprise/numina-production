import {observeHttp} from '../lib/http-telemetry.mjs';
// Public, read-only provider observations. No request input selects an RPC method,
// endpoint, account or credential. Use this only in the Node.js server runtime.
const PINNED_RPC_URL = 'https://u0yth28mgh-u0vtj8pzdz-rpc.us0-aws.kaleido.io/';
const EXPECTED_CHAIN_ID = '962421430';
const CONFIGURED_SIGNER = '0x1a45671ae2ee3e52264116151924faacb80fc02e';
const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 128 * 1024;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
const READ_METHODS = new Set(['eth_chainId', 'eth_accounts', 'eth_getBlockByNumber']);
const SAFE_CODES = new Set([
  'CONFIGURATION_INCOMPLETE', 'CONFIGURATION_MISMATCH', 'RPC_UNAVAILABLE',
  'RPC_AUTHENTICATION_REJECTED', 'RPC_TIMEOUT', 'RPC_RESPONSE_INVALID',
  'RPC_RESPONSE_TOO_LARGE', 'RPC_METHOD_FAILED', 'CHAIN_MISMATCH',
  'CONFIGURED_SIGNER_NOT_LISTED',
]);

class ConnectionError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function fail(code) { throw new ConnectionError(code); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function guard(signal) { if (signal.aborted) fail('RPC_TIMEOUT'); }

function configuration(env) {
  for (const name of ['NUMINA_RPC_URL', 'NUMINA_RPC_AUTHORIZATION', 'NUMINA_EXPECTED_CHAIN_ID', 'NUMINA_DEPLOYER_ADDRESS']) {
    if (typeof env[name] !== 'string' || env[name].length === 0) fail('CONFIGURATION_INCOMPLETE');
  }
  // Pinning prevents a mistaken environment change from forwarding credentials
  // to a different server. URL userinfo, query strings and redirects are forbidden.
  if (env.NUMINA_RPC_URL !== PINNED_RPC_URL ||
      env.NUMINA_EXPECTED_CHAIN_ID !== EXPECTED_CHAIN_ID ||
      env.NUMINA_DEPLOYER_ADDRESS.toLowerCase() !== CONFIGURED_SIGNER) {
    fail('CONFIGURATION_MISMATCH');
  }
  const authorization = env.NUMINA_RPC_AUTHORIZATION;
  if (authorization.length > 8192 || !/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(authorization)) {
    fail('CONFIGURATION_MISMATCH');
  }
  return { authorization };
}

function decimalQuantity(value) {
  if (typeof value !== 'string' || !QUANTITY.test(value)) fail('RPC_RESPONSE_INVALID');
  return BigInt(value).toString(10);
}

function publicBlock(value, genesis) {
  if (!object(value) || typeof value.hash !== 'string' || !HASH.test(value.hash) ||
      /^0x0{64}$/i.test(value.hash)) fail('RPC_RESPONSE_INVALID');
  const number = decimalQuantity(value.number);
  const timestamp = decimalQuantity(value.timestamp);
  if (genesis && number !== '0') fail('RPC_RESPONSE_INVALID');
  return { number, hash: value.hash.toLowerCase(), timestampUnixSeconds: timestamp };
}

async function limitedJson(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || BigInt(length) > BigInt(MAX_BODY_BYTES))) {
    fail('RPC_RESPONSE_TOO_LARGE');
  }
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(type) || !response.body?.getReader) {
    fail('RPC_RESPONSE_INVALID');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      guard(signal);
      const { done, value } = await reader.read();
      guard(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('RPC_RESPONSE_INVALID');
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) fail('RPC_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes);
    let position = 0;
    for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
    catch { fail('RPC_RESPONSE_INVALID'); }
  } finally {
    // Do not await an upstream stream's potentially stalled cancel operation.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function initialObservation() {
  return {
    schema: 'numina.node-connection.v1',
    status: 'unavailable',
    observedAt: null,
    provider: 'Kaleido',
    expectedChainId: EXPECTED_CHAIN_ID,
    configuredSigner: CONFIGURED_SIGNER,
    rpcResponding: false,
    authorizationHeaderIncluded: false,
    chainMatched: false,
    configuredSignerListed: false,
    genesisObserved: false,
    latestBlockObserved: false,
    observationComplete: false,
    chainId: null,
    genesis: null,
    latestBlock: null,
    scope: {
      evidence: 'single_provider_read_only_observation',
      independentNetworkVerification: false,
      expectedGenesisPinned: false,
      signerExecutionVerified: false,
      contractDeploymentVerified: false,
      nusdActivationPerformed: false,
      reservesVerified: false,
      settlementVerified: false,
      fundsMovedByThisEndpoint: false,
    },
  };
}

// Dependency injection supports later offline review without allowing HTTP
// callers to replace server configuration or the built-in fetch implementation.
export async function observeNode({ env = process.env, fetcher = globalThis.fetch } = {}) {
  const observation = initialObservation();
  const controller = new AbortController();
  let timer;
  let sequence = 0;
  try {
    const { authorization } = configuration(env);
    if (typeof fetcher !== 'function') fail('RPC_UNAVAILABLE');
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ConnectionError('RPC_TIMEOUT'));
      }, TIMEOUT_MS);
    });

    async function rpc(method, params) {
      guard(controller.signal);
      if (!READ_METHODS.has(method)) fail('RPC_METHOD_FAILED');
      const id = ++sequence;
      observation.authorizationHeaderIncluded = true;
      const response = await fetcher(PINNED_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authorization },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      guard(controller.signal);
      if (response.status === 401 || response.status === 403) fail('RPC_AUTHENTICATION_REJECTED');
      if (response.status !== 200 || response.redirected || response.url !== PINNED_RPC_URL) fail('RPC_UNAVAILABLE');
      const envelope = await limitedJson(response, controller.signal);
      guard(controller.signal);
      if (!object(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== id) fail('RPC_RESPONSE_INVALID');
      if (Object.hasOwn(envelope, 'error')) fail('RPC_METHOD_FAILED');
      if (Object.keys(envelope).length !== 3 || !Object.hasOwn(envelope, 'result')) fail('RPC_RESPONSE_INVALID');
      observation.rpcResponding = true;
      return envelope.result;
    }

    const work = (async () => {
      observation.chainId = decimalQuantity(await rpc('eth_chainId', []));
      if (observation.chainId !== EXPECTED_CHAIN_ID) fail('CHAIN_MISMATCH');
      observation.chainMatched = true;
      const accounts = await rpc('eth_accounts', []);
      if (!Array.isArray(accounts) || accounts.length > 256 ||
          accounts.some(account => typeof account !== 'string' || !ADDRESS.test(account))) fail('RPC_RESPONSE_INVALID');
      if (!accounts.some(account => account.toLowerCase() === CONFIGURED_SIGNER)) fail('CONFIGURED_SIGNER_NOT_LISTED');
      observation.configuredSignerListed = true;
      observation.genesis = publicBlock(await rpc('eth_getBlockByNumber', ['0x0', false]), true);
      observation.genesisObserved = true;
      observation.latestBlock = publicBlock(await rpc('eth_getBlockByNumber', ['latest', false]), false);
      if (observation.latestBlock.number === '0' && observation.latestBlock.hash !== observation.genesis.hash) {
        fail('RPC_RESPONSE_INVALID');
      }
      observation.latestBlockObserved = true;
      observation.observationComplete = true;
      observation.status = 'connected';
    })();
    await Promise.race([work, deadline]);
    observation.observedAt = new Date().toISOString();
    return { httpStatus: 200, body: observation };
  } catch (error) {
    const code = error instanceof ConnectionError && SAFE_CODES.has(error.code)
      ? error.code : controller.signal.aborted ? 'RPC_TIMEOUT' : 'RPC_UNAVAILABLE';
    observation.observedAt = new Date().toISOString();
    observation.error = { code };
    observation.status = 'unavailable';
    observation.observationComplete = false;
    const httpStatus = code === 'RPC_TIMEOUT' ? 504 : code.startsWith('CONFIGURATION_') ? 503 : 502;
    // Provider response bodies, exception text, URLs and headers never leave here.
    return { httpStatus, body: observation };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export default async function handler(request, response) {
  observeHttp(request, response);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('CDN-Cache-Control', 'no-store');
  response.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.statusCode = 405;
    response.end(JSON.stringify({ schema: 'numina.node-connection.v1', error: { code: 'METHOD_NOT_ALLOWED' } }));
    return;
  }
  const result = await observeNode();
  response.statusCode = result.httpStatus;
  response.end(JSON.stringify(result.body));
}
