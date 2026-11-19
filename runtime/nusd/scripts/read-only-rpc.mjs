// Read-only JSON-RPC client shared by the NUSD admin-handoff and Safe verification scripts.
// It can only issue the allowlisted read methods below: no signing, no eth_sendTransaction,
// no eth_sendRawTransaction, no account access. The endpoint and authorization header come from
// the environment and are never printed, logged, or included in errors.
export const READ_ONLY_METHODS = Object.freeze(['eth_chainId', 'eth_call', 'eth_getCode', 'eth_blockNumber']);
const ALLOWED = new Set(READ_ONLY_METHODS);
const MAX_BODY_BYTES = 1024 * 1024;

export class RpcUnavailableError extends Error {
  constructor(reason) { super('rpc_unavailable'); this.code = 'rpc_unavailable'; this.reason = reason; }
}
export class ConfigurationError extends Error {
  constructor(reason) { super('configuration_error'); this.code = 'configuration_error'; this.reason = reason; }
}

/** Validate an endpoint without echoing it. HTTPS is required except for loopback test servers. */
export function checkEndpoint(value) {
  if (typeof value !== 'string' || !value) throw new ConfigurationError('rpc_url_missing');
  let url;
  try { url = new URL(value); } catch { throw new ConfigurationError('rpc_url_invalid'); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new ConfigurationError('rpc_url_must_be_https');
  return url;
}

export function createReadOnlyRpc({ endpoint, authorization, timeoutMs = 15000, fetchImpl = globalThis.fetch }) {
  const url = checkEndpoint(endpoint);
  if (authorization !== undefined && authorization !== null && authorization !== '' &&
      (typeof authorization !== 'string' || !/^[\x21-\x7e][\x20-\x7e]*$/.test(authorization))) {
    throw new ConfigurationError('rpc_authorization_invalid');
  }
  let id = 0;
  return async function rpc(method, params = []) {
    if (!ALLOWED.has(method)) throw new ConfigurationError('rpc_method_not_read_only');
    const requestId = ++id;
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (authorization) headers.authorization = authorization;
    let response, text;
    try {
      response = await fetchImpl(url, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) });
      text = await response.text();
    } catch (error) {
      throw new RpcUnavailableError(error?.name === 'TimeoutError' ? 'timeout' : 'network_error');
    }
    if (!response.ok) throw new RpcUnavailableError('http_' + response.status);
    if (text.length > MAX_BODY_BYTES) throw new RpcUnavailableError('response_too_large');
    let body;
    try { body = JSON.parse(text); } catch { throw new RpcUnavailableError('invalid_json'); }
    if (body?.jsonrpc !== '2.0' || body.id !== requestId) throw new RpcUnavailableError('invalid_envelope');
    if (body.error) throw new RpcUnavailableError('rpc_error_' + (Number.isSafeInteger(body.error.code) ? body.error.code : 'unknown'));
    if (!Object.hasOwn(body, 'result')) throw new RpcUnavailableError('invalid_envelope');
    return body.result;
  };
}

/** Parse --name value / --flag arguments. */
export function parseArgs(argv, known) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--') || !Object.hasOwn(known, arg.slice(2))) throw new ConfigurationError('unknown_argument');
    const name = arg.slice(2);
    if (known[name] === 'flag') { options[name] = true; continue; }
    if (i + 1 >= argv.length) throw new ConfigurationError('missing_argument_value');
    options[name] = argv[++i];
  }
  return options;
}

/** Print the result as JSON and set the exit code: 0 ok, 1 mismatch, 2 rpc_unavailable, 3 configuration error. */
export function finish(result, error) {
  if (error) {
    const code = error.code === 'rpc_unavailable' ? 2 : error.code === 'configuration_error' ? 3 : 4;
    console.log(JSON.stringify({ ...result, ok: false, error: error.code || 'unexpected_error', reason: error.reason || null }, null, 2));
    process.exitCode = code;
    return;
  }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
