import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Fixed server-side observation only. HTTP callers cannot supply any RPC input.
export const ESTIMATE_PINS = Object.freeze({
  rpcUrl: 'https://u0yth28mgh-u0vtj8pzdz-rpc.us0-aws.kaleido.io/',
  chainId: '962421430',
  genesisHash: '0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1',
  sender: '0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',
  review: 'ee2aaf226f9f6e843aac8f1d1ad222045db8bb3b83cd5fe23f7f2bc7c217dde8',
  creation: 'bdaf4313f68b97d504ef3796096814d41b3002bffcf9ed75b78a939de6049401',
  policy: '1d24f311a34a28d9560db1f32eb3efc4241701c5ae7233b97c2527006623b13d',
  request: '0af2b7e72cd18f9676f85356da95f8deee8788eac0dee3d587a1278342a401ca',
  artifact: 'a77132febebe10172a7fe3ee1814ed124ea5503b93f1e2e4ffdfb218889a262a',
  source: '87755643e690b82b11a9f5744f1dd9803965b0f38fa9ac4d18542e72b4bb80cc',
  initialSupplyBaseUnits: '1500000000000000000000',
});
export const ESTIMATE_TTL_MS = 60000;
const MAX_BODY_BYTES = 128 * 1024, MAX_REVIEW_BYTES = 65536;
const MAX_UINT256 = (1n << 256n) - 1n;
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_estimateGas', 'eth_gasPrice', 'eth_getBalance']);
const SAFE_CODES = new Set(['CONFIGURATION_INCOMPLETE', 'CONFIGURATION_MISMATCH', 'REVIEW_INVALID',
  'RPC_UNAVAILABLE', 'RPC_AUTHENTICATION_REJECTED', 'RPC_TIMEOUT', 'RPC_RESPONSE_INVALID',
  'RPC_RESPONSE_TOO_LARGE', 'RPC_METHOD_FAILED', 'CHAIN_MISMATCH', 'GENESIS_MISMATCH',
  'FEE_OVERFLOW', 'CLOCK_INVALID']);
class EstimateError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new EstimateError(code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const guard = signal => { if (signal.aborted) fail('RPC_TIMEOUT'); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function validateDeploymentReview(input) {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > MAX_REVIEW_BYTES) fail('REVIEW_INVALID');
  const bytes = Buffer.from(input);
  if (sha256(bytes) !== ESTIMATE_PINS.review) fail('REVIEW_INVALID');
  let review;
  try { review = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { fail('REVIEW_INVALID'); }
  const c = review?.constructor;
  if (review?.schema !== 'numina.nusd.unsigned-constructor-review.v1' || review.status !== 'UNSIGNED_CONSTRUCTOR_REVIEW' ||
      review.requestHashBasis !== 'raw_request_file_bytes' || review.requestSha256 !== ESTIMATE_PINS.request ||
      review.artifactSha256 !== ESTIMATE_PINS.artifact || review.sourceSha256 !== ESTIMATE_PINS.source ||
      review.issuerPolicySha256 !== ESTIMATE_PINS.policy || c?.initialSupplyBaseUnits !== ESTIMATE_PINS.initialSupplyBaseUnits ||
      c.initialRecipient !== ESTIMATE_PINS.sender || c.approvedIssuerPolicyHash !== '0x' + ESTIMATE_PINS.policy ||
      review.constructorDataSha256 !== ESTIMATE_PINS.creation || review.creationBytes !== 10746 ||
      typeof review.constructorData !== 'string' || !/^0x[0-9a-f]{21492}$/.test(review.constructorData) ||
      sha256(Buffer.from(review.constructorData.slice(2), 'hex')) !== ESTIMATE_PINS.creation ||
      review.productionReady !== false || review.reviewEvidenceVerified !== false || review.policyReviewVerified !== false ||
      review.signed !== false || review.broadcast !== false || review.minted !== false || review.deposited !== false ||
      review.receipt !== null || review.walletTransaction !== null || review.unresolvedReviews?.length !== 8) fail('REVIEW_INVALID');
  return freeze(review);
}

function configuration(env) {
  for (const name of ['NUMINA_RPC_URL', 'NUMINA_RPC_AUTHORIZATION', 'NUMINA_EXPECTED_CHAIN_ID', 'NUMINA_DEPLOYER_ADDRESS']) {
    if (typeof env?.[name] !== 'string' || env[name].length === 0) fail('CONFIGURATION_INCOMPLETE');
  }
  if (env.NUMINA_RPC_URL !== ESTIMATE_PINS.rpcUrl || env.NUMINA_EXPECTED_CHAIN_ID !== ESTIMATE_PINS.chainId ||
      env.NUMINA_DEPLOYER_ADDRESS.toLowerCase() !== ESTIMATE_PINS.sender.toLowerCase()) fail('CONFIGURATION_MISMATCH');
  const authorization = env.NUMINA_RPC_AUTHORIZATION;
  if (authorization.length > 8192 || !/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(authorization)) fail('CONFIGURATION_MISMATCH');
  return authorization;
}
function quantity(value) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)) fail('RPC_RESPONSE_INVALID');
  return BigInt(value);
}
function time(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000 - ESTIMATE_TTL_MS) fail('CLOCK_INVALID');
  return value;
}
async function limitedJson(response, signal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || BigInt(length) > BigInt(MAX_BODY_BYTES))) fail('RPC_RESPONSE_TOO_LARGE');
  if (!/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body?.getReader) fail('RPC_RESPONSE_INVALID');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  if (signal.aborted) cancel();
  try {
    while (true) {
      guard(signal);
      const {done, value} = await reader.read();
      guard(signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) fail('RPC_RESPONSE_INVALID');
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) fail('RPC_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks, bytes);
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer)); }
    catch { fail('RPC_RESPONSE_INVALID'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
function initialObservation() {
  return {
    schema: 'numina.deployment-estimate.v1', status: 'unavailable', observedAt: null, expiresAt: null,
    account: ESTIMATE_PINS.sender, chainId: ESTIMATE_PINS.chainId, genesisHash: ESTIMATE_PINS.genesisHash,
    reviewSha256: ESTIMATE_PINS.review, constructorDataSha256: ESTIMATE_PINS.creation,
    requestSha256: ESTIMATE_PINS.request, requestHashBasis: 'raw_request_file_bytes',
    issuerPolicySha256: ESTIMATE_PINS.policy, artifactSha256: ESTIMATE_PINS.artifact, sourceSha256: ESTIMATE_PINS.source,
    initialSupplyBaseUnits: ESTIMATE_PINS.initialSupplyBaseUnits,
    gasLimit: null, gasPrice: null, calculatedTotalBaseUnits: null, balanceBaseUnits: null, balanceSufficient: null,
    feeAsset: null, feeAssetVerified: false, estimateObserved: false, estimateVerified: false,
    observationSource: 'configured_numina_rpc', networkChecked: false, networkIdentityVerified: false,
    signingControlVerified: false, productionReady: false, reviewEvidenceVerified: false, policyReviewVerified: false,
    reservesVerified: false, settlementVerified: false, signed: false, broadcast: false, minted: false,
    deposited: false, feeDeducted: false, treasuryWritePerformed: false, receipt: null,
  };
}

// Dependency injection is for offline tests. The HTTP handler passes no caller data.
export async function observeDeploymentEstimate({env = process.env, fetcher = globalThis.fetch,
  reviewBytes, now = () => Date.now(), timeoutMs = 8000} = {}) {
  const controller = new AbortController(); let timer, sequence = 0;
  try {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000 || typeof now !== 'function') fail('CONFIGURATION_MISMATCH');
    const authorization = configuration(env);
    const review = validateDeploymentReview(reviewBytes ?? readFileSync(new URL('./numina-1500t-constructor-review.json', import.meta.url)));
    if (typeof fetcher !== 'function') fail('RPC_UNAVAILABLE');
    const observedTime = time(now);
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new EstimateError('RPC_TIMEOUT')); }, timeoutMs); });
    async function rpc(method, params) {
      guard(controller.signal);
      if (!READ_METHODS.has(method)) fail('RPC_METHOD_FAILED');
      const id = ++sequence;
      const response = await fetcher(ESTIMATE_PINS.rpcUrl, {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: authorization},
        body: JSON.stringify({jsonrpc: '2.0', id, method, params}), signal: controller.signal,
        redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      });
      guard(controller.signal);
      if (response.status === 401 || response.status === 403) fail('RPC_AUTHENTICATION_REJECTED');
      if (response.status !== 200 || response.redirected || response.url !== ESTIMATE_PINS.rpcUrl) fail('RPC_UNAVAILABLE');
      const envelope = await limitedJson(response, controller.signal);
      guard(controller.signal);
      if (!object(envelope) || envelope.jsonrpc !== '2.0' || envelope.id !== id) fail('RPC_RESPONSE_INVALID');
      if (Object.hasOwn(envelope, 'error')) fail('RPC_METHOD_FAILED');
      if (Object.keys(envelope).length !== 3 || !Object.hasOwn(envelope, 'result')) fail('RPC_RESPONSE_INVALID');
      return envelope.result;
    }
    async function identity() {
      if (quantity(await rpc('eth_chainId', [])).toString() !== ESTIMATE_PINS.chainId) fail('CHAIN_MISMATCH');
      const block = await rpc('eth_getBlockByNumber', ['0x0', false]);
      if (!object(block) || quantity(block.number) !== 0n || typeof block.hash !== 'string') fail('RPC_RESPONSE_INVALID');
      if (block.hash.toLowerCase() !== ESTIMATE_PINS.genesisHash) fail('GENESIS_MISMATCH');
    }
    const work = (async () => {
      await identity();
      const gasLimit = quantity(await rpc('eth_estimateGas', [{from: ESTIMATE_PINS.sender, value: '0x0', data: review.constructorData}, 'pending']));
      if (gasLimit === 0n) fail('RPC_RESPONSE_INVALID');
      const gasPrice = quantity(await rpc('eth_gasPrice', []));
      const balance = quantity(await rpc('eth_getBalance', [ESTIMATE_PINS.sender, 'pending']));
      const total = gasLimit * gasPrice;
      if (total > MAX_UINT256) fail('FEE_OVERFLOW');
      await identity();
      guard(controller.signal);
      const completedTime = time(now);
      if (completedTime < observedTime || completedTime - observedTime >= ESTIMATE_TTL_MS) fail('CLOCK_INVALID');
      return {...initialObservation(), status: 'observed', observedAt: new Date(observedTime).toISOString(),
        expiresAt: new Date(observedTime + ESTIMATE_TTL_MS).toISOString(), networkChecked: true, estimateObserved: true,
        gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString(), calculatedTotalBaseUnits: total.toString(),
        balanceBaseUnits: balance.toString(), balanceSufficient: balance >= total};
    })();
    const body = await Promise.race([work, deadline]);
    guard(controller.signal);
    return {httpStatus: 200, body: freeze(body)};
  } catch (error) {
    const code = error instanceof EstimateError && SAFE_CODES.has(error.code) ? error.code : controller.signal.aborted ? 'RPC_TIMEOUT' : 'RPC_UNAVAILABLE';
    const httpStatus = code === 'RPC_TIMEOUT' ? 504 : code.startsWith('CONFIGURATION_') || code === 'REVIEW_INVALID' || code === 'CLOCK_INVALID' ? 503 : 502;
    return {httpStatus, body: freeze({...initialObservation(), error: {code}})};
  } finally { clearTimeout(timer); controller.abort(); }
}
