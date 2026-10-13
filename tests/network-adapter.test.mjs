import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, copyFileSync, cpSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {routeLocalRuntime} from '../src/runtime-release-local.js';
import {routeRuntime} from '../src/runtime-http.js';
import {observeNode} from '../runtime/vercel-production/api/node-connection.mjs';

// Offline RPC fixtures. Neither a real credential nor a provider request is used.
const rpcUrl = 'https://u0yth28mgh-u0vtj8pzdz-rpc.us0-aws.kaleido.io/';
const signer = '0x1a45671ae2ee3e52264116151924faacb80fc02e';
const contract = '0x491c1df1b5ca77af797f052c2310ca17039c931b';
const chainId = '962421430';
const supply = '1500000000000000000000000000000000';
const policyHash = '0x2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5';
const authorization = 'Basic OFFLINE_ADAPTER_CREDENTIAL_MUST_NOT_ESCAPE';
const canary = 'PRIVATE_RPC_DETAIL_MUST_NOT_ESCAPE';
const config = () => ({NUMINA_RPC_URL:rpcUrl, NUMINA_RPC_AUTHORIZATION:authorization,
  NUMINA_EXPECTED_CHAIN_ID:chainId, NUMINA_DEPLOYER_ADDRESS:signer});
const word = value => '0x' + BigInt(value).toString(16).padStart(64, '0');
const hash = character => '0x' + character.repeat(64);
const routeRequest = (method = 'GET') => new Request('https://numinalabs.xyz/v2/network/status?method=eth_sendTransaction&rpc=https://attacker.test', {
  method, headers:{Authorization:'Bearer caller-credential', Cookie:'private=caller-cookie'}
});

function rpcResponse(body, {status = 200, url = rpcUrl, redirected = false, headers = {}} = {}) {
  const response = new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json', ...headers}});
  Object.defineProperties(response, {url:{value:url}, redirected:{value:redirected}});
  return response;
}

function fixture({replace = () => undefined, respond, rejectUnsupportedCache = false} = {}) {
  const requests = [];
  const fetcher = async function(url, options) {
    if (rejectUnsupportedCache && Object.hasOwn(options, 'cache')) {
      throw new TypeError("The 'cache' field on 'RequestInitializerDict' is not implemented.");
    }
    const request = JSON.parse(options.body);
    requests.push({url, options, request});
    if (respond) return respond(request, options);
    let result;
    switch (request.method) {
      case 'eth_chainId': result = '0x' + BigInt(chainId).toString(16); break;
      case 'eth_accounts': result = [signer]; break;
      case 'eth_getBlockByNumber': result = request.params[0] === '0x0'
        ? {number:'0x0', hash:hash('1'), timestamp:'0x1'}
        : {number:'0x123', hash:hash('2'), timestamp:'0x70000000'}; break;
      case 'eth_getCode': result = '0x60006000'; break;
      case 'eth_call':
        switch (request.params[0].data) {
          case '0x313ce567': result = word(18); break;
          case '0x18160ddd': result = word(supply); break;
          case '0x6bcbfc3c': result = policyHash; break;
          case '0x5c975abb': result = word(0); break;
          case '0xcf6eefb7': result = '0x' + signer.slice(2).padStart(64,'0') + word(1).slice(2); break;
          default: assert.fail('Unexpected contract read');
        }
        break;
      default: assert.fail('Unexpected RPC method');
    }
    const replacement = replace(request, result);
    if (replacement !== undefined) result = replacement;
    return rpcResponse({jsonrpc:'2.0', id:request.id, result});
  };
  return {fetcher, requests};
}

async function workerObservation(provider, env = config(), request = routeRequest(), gateway = routeLocalRuntime) {
  const original = globalThis.fetch;
  globalThis.fetch = provider.fetcher;
  try {
    const response = gateway === routeRuntime
      ? await gateway(request, () => assert.fail('Same-origin observation must use its local adapter'), 12000, env)
      : await gateway(request, env);
    return {response, body:request.method === 'HEAD' ? null : await response.json()};
  } finally { globalThis.fetch = original; }
}

function withoutObservationTime(body) {
  assert.match(body.observedAt, /^\d{4}-\d{2}-\d{2}T/);
  return {...body, observedAt:null};
}

function assertPrivate(body) {
  const text = JSON.stringify(body);
  for (const privateValue of [authorization, canary, 'caller-credential', 'caller-cookie', 'attacker.test']) {
    assert.equal(text.includes(privateValue), false, privateValue);
  }
}

test('configured Worker network route observes the same pinned read-only state as the Node adapter', async () => {
  const nodeProvider = fixture(), workerProvider = fixture();
  const expected = await observeNode({env:config(), fetcher:nodeProvider.fetcher});
  const {response, body} = await workerObservation(workerProvider);
  assert.equal(response.status, 200);
  assert.equal(body.status, 'connected');
  assert.deepEqual(withoutObservationTime(body), withoutObservationTime(expected.body));
  assert.equal(body.chainId, chainId);
  assert.equal(body.nusd.totalSupplyBaseUnits, supply);
  assert.equal(body.nusd.managedSignerCanAcceptDefaultAdmin, true);
  assert.equal(body.scope.independentNetworkVerification, false);
  assert.equal(body.scope.signerExecutionVerified, false);
  assert.equal(body.scope.fundsMovedByThisEndpoint, false);
  assert.deepEqual(workerProvider.requests.map(({request}) => request), nodeProvider.requests.map(({request}) => request));
  assert.equal(workerProvider.requests.length, 10);
  for (const {url, options, request} of workerProvider.requests) {
    assert.equal(url, rpcUrl);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.ok(['eth_chainId','eth_accounts','eth_getBlockByNumber','eth_getCode','eth_call'].includes(request.method));
    assert.deepEqual(new Headers(options.headers).get('Authorization'), authorization);
    assert.equal(new Headers(options.headers).has('Cookie'), false);
    if (request.method === 'eth_call' || request.method === 'eth_getCode') {
      assert.equal(request.method === 'eth_call' ? request.params[0].to : request.params[0], contract);
    }
  }
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assertPrivate(body);
});

test('same-origin runtime gateway passes server configuration to the network observer', async () => {
  const {response, body} = await workerObservation(fixture(), config(), routeRequest(), routeRuntime);
  assert.equal(response.status, 200);
  assert.equal(body.status, 'connected');
  assert.equal(body.observationComplete, true);
});

test('Worker network observation preserves the host fetch receiver without RequestInit cache support', async () => {
  const provider = fixture({rejectUnsupportedCache:true}), fetcher = provider.fetcher;
  provider.fetcher = async function(...args) {
    assert.equal(this, globalThis);
    const headers = new Headers(args[1].headers);
    assert.equal(headers.get('Cache-Control'), 'no-store');
    assert.equal(headers.get('Pragma'), 'no-cache');
    return fetcher(...args);
  };
  const {response, body} = await workerObservation(provider);
  assert.equal(response.status, 200);
  assert.equal(body.observationComplete, true);
});

test('missing or mismatched server configuration fails closed before contacting RPC', async () => {
  const cases = [
    [{}, 'CONFIGURATION_INCOMPLETE'],
    [{...config(), NUMINA_RPC_AUTHORIZATION:''}, 'CONFIGURATION_INCOMPLETE'],
    [{...config(), NUMINA_RPC_URL:'https://attacker.test/'}, 'CONFIGURATION_MISMATCH'],
    [{...config(), NUMINA_RPC_URL:rpcUrl+'?token=private'}, 'CONFIGURATION_MISMATCH'],
    [{...config(), NUMINA_EXPECTED_CHAIN_ID:'1'}, 'CONFIGURATION_MISMATCH'],
    [{...config(), NUMINA_DEPLOYER_ADDRESS:'0x'+'0'.repeat(40)}, 'CONFIGURATION_MISMATCH'],
    [{...config(), NUMINA_RPC_AUTHORIZATION:authorization+'\r\nX-Injected: secret'}, 'CONFIGURATION_MISMATCH']
  ];
  for (const [env, code] of cases) {
    const provider = fixture();
    const {response, body} = await workerObservation(provider, env);
    assert.equal(response.status, 503);
    assert.equal(body.status, 'unavailable');
    assert.equal(body.observationComplete, false);
    assert.deepEqual(body.error, {code});
    assert.equal(provider.requests.length, 0);
    assertPrivate(body);
  }
});

test('provider chain, signer and contract-state mismatches cannot become connected', async () => {
  const cases = [
    [request => request.method === 'eth_chainId' ? '0x1' : undefined, 'CHAIN_MISMATCH'],
    [request => request.method === 'eth_accounts' ? [] : undefined, 'CONFIGURED_SIGNER_NOT_LISTED'],
    [request => request.method === 'eth_getCode' ? '0x' : undefined, 'NUSD_STATE_MISMATCH'],
    [request => request.method === 'eth_call' && request.params[0].data === '0x18160ddd' ? word(BigInt(supply)-1n) : undefined, 'NUSD_STATE_MISMATCH']
  ];
  for (const [replace, code] of cases) {
    const node = await observeNode({env:config(), fetcher:fixture({replace}).fetcher});
    const {response, body} = await workerObservation(fixture({replace}));
    assert.equal(response.status, 502);
    assert.equal(body.status, 'unavailable');
    assert.equal(body.observationComplete, false);
    assert.deepEqual(body.error, {code});
    assert.deepEqual(withoutObservationTime(body), withoutObservationTime(node.body));
    assertPrivate(body);
  }
});

test('RPC authentication failures and raw transport errors return only public error codes', async () => {
  for (const status of [401, 403]) {
    const {response, body} = await workerObservation(fixture({respond:() => rpcResponse({error:canary}, {status})}));
    assert.equal(response.status, 502);
    assert.deepEqual(body.error, {code:'RPC_AUTHENTICATION_REJECTED'});
    assertPrivate(body);
  }
  const {response, body} = await workerObservation({fetcher:async () => {throw new Error(canary+' '+authorization);}});
  assert.equal(response.status, 502);
  assert.deepEqual(body.error, {code:'RPC_UNAVAILABLE'});
  assertPrivate(body);
});

test('Worker rejects unpinned response URLs, redirects and malformed JSON-RPC envelopes', async () => {
  const cases = [
    [request => rpcResponse({jsonrpc:'2.0', id:request.id, result:'0x1'}, {url:'https://attacker.test/'}), 'RPC_UNAVAILABLE'],
    [request => rpcResponse({jsonrpc:'2.0', id:request.id, result:'0x1'}, {redirected:true}), 'RPC_UNAVAILABLE'],
    [request => rpcResponse({jsonrpc:'2.0', id:request.id+1, result:'0x1'}), 'RPC_RESPONSE_INVALID'],
    [request => rpcResponse({jsonrpc:'2.0', id:request.id, result:'0x1', extra:canary}), 'RPC_RESPONSE_INVALID'],
    [request => rpcResponse({jsonrpc:'2.0', id:request.id, error:{message:canary}}), 'RPC_METHOD_FAILED'],
    [request => rpcResponse({jsonrpc:'2.0', id:request.id, result:'0x01'}), 'RPC_RESPONSE_INVALID'],
    [request => rpcResponse({jsonrpc:'2.0', id:request.id, result:'0x1'}, {headers:{'Content-Type':'text/html'}}), 'RPC_RESPONSE_INVALID'],
    [request => rpcResponse({jsonrpc:'2.0', id:request.id, result:'0x1'}, {headers:{'Content-Length':String(128*1024+1)}}), 'RPC_RESPONSE_TOO_LARGE']
  ];
  for (const [respond, code] of cases) {
    const {response, body} = await workerObservation(fixture({respond}));
    assert.equal(response.status, 502);
    assert.deepEqual(body.error, {code});
    assert.equal(body.observationComplete, false);
    assertPrivate(body);
  }
});

test('HEAD observes the same read-only state and returns no response body', async () => {
  const provider = fixture();
  const {response} = await workerObservation(provider, config(), routeRequest('HEAD'));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(provider.requests.length, 10);
});

test('network route rejects write methods without contacting RPC', async () => {
  for (const method of ['POST','PUT','PATCH','DELETE']) {
    const provider = fixture();
    const {response, body} = await workerObservation(provider, config(), routeRequest(method));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET, HEAD');
    assert.deepEqual(body, {error:'METHOD_NOT_ALLOWED'});
    assert.equal(provider.requests.length, 0);
  }
});

test('standalone verifier assembly imports its Node adapter and retains the server API', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'numina-network-adapter-'));
  t.after(() => rmSync(directory, {recursive:true, force:true}));
  mkdirSync(join(directory, 'api'));
  copyFileSync(new URL('../runtime/vercel-production/api/node-connection.mjs', import.meta.url), join(directory, 'api/node-connection.mjs'));
  cpSync(new URL('../runtime/vercel-production/lib', import.meta.url), join(directory, 'lib'), {recursive:true});
  // Both package-rc26.py and package-rc27.py retain this api/lib layout.
  const {observeNode:assembledObserver, default:handler} = await import(pathToFileURL(join(directory, 'api/node-connection.mjs')));
  assert.equal(typeof handler, 'function');
  const expected = await observeNode({env:config(), fetcher:fixture().fetcher});
  const assembled = await assembledObserver({env:config(), fetcher:fixture().fetcher});
  assert.deepEqual(withoutObservationTime(assembled.body), withoutObservationTime(expected.body));
});

test('concatenated network observer runs without Node globals and isolates its internal names', async () => {
  const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
  const source = "const object = 'other module'; const configuration = 'other module'; class ConnectionError {}\n"
    + read('public/runtime-contract.js').replace(/export /g, '') + '\n'
    + read('runtime/vercel-production/lib/network-observation.mjs').replace(/export /g, '') + '\n'
    + read('src/runtime-release-local.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '') + '\nrouteLocalRuntime';
  const provider = fixture({rejectUnsupportedCache:true});
  const portableRoute = runInNewContext(source, {
    TextEncoder, TextDecoder, Uint8Array, AbortController, Response, URL, structuredClone,
    setTimeout, clearTimeout, fetch:provider.fetcher
  });
  const response = await portableRoute(routeRequest(), config());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.observationComplete, true);
  assert.equal(body.nusd.totalSupplyBaseUnits, supply);
  assert.equal(provider.requests.length, 10);
});

test('network deadline ends a stalled fetch and prevents late upstream replies from continuing reads', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let signal, resolveFetch, calls = 0, settled = false;
  const pending = workerObservation({fetcher:(_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise(resolve => {resolveFetch = resolve;});
  }});
  pending.then(() => {settled = true;});
  t.mock.timers.tick(7999);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  const {response, body} = await pending;
  assert.equal(response.status, 504);
  assert.deepEqual(body.error, {code:'RPC_TIMEOUT'});
  assert.equal(body.observationComplete, false);
  assert.equal(signal.aborted, true);
  resolveFetch(rpcResponse({jsonrpc:'2.0', id:1, result:'0x'+BigInt(chainId).toString(16)}));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  assertPrivate(body);
});

test('network deadline also ends a stalled response stream', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let releaseChunk, signal;
  const provider = fixture({respond:(request, options) => {
    signal = options.signal;
    const response = rpcResponse({jsonrpc:'2.0', id:request.id, result:'0x1'});
    Object.defineProperty(response, 'body', {value:{getReader:() => ({
      read:() => new Promise(resolve => {releaseChunk = resolve;}),
      cancel:async () => {}, releaseLock:() => {}
    })}});
    return response;
  }});
  const pending = workerObservation(provider);
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();
  assert.equal(typeof releaseChunk, 'function');
  t.mock.timers.tick(8000);
  const {response, body} = await pending;
  assert.equal(response.status, 504);
  assert.deepEqual(body.error, {code:'RPC_TIMEOUT'});
  assert.equal(signal.aborted, true);
  releaseChunk({done:true});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(provider.requests.length, 1);
});

test('connected provider observations retain paused token state without implying activation', async () => {
  const replace = request => request.method === 'eth_call' && request.params[0].data === '0x5c975abb' ? word(1) : undefined;
  const {response, body} = await workerObservation(fixture({replace}));
  assert.equal(response.status, 200);
  assert.equal(body.status, 'connected');
  assert.equal(body.nusd.paused, true);
  assert.equal(body.nusd.transfersEnabled, false);
  assert.equal(body.scope.nusdActivationPerformed, false);
});

test('concurrent Node adapter observations keep request IDs and partial results independent', async () => {
  const good = fixture(), bad = fixture({replace:request => request.method === 'eth_chainId' ? '0x1' : undefined});
  const [connected, rejected] = await Promise.all([
    observeNode({env:config(), fetcher:good.fetcher}),
    observeNode({env:config(), fetcher:bad.fetcher})
  ]);
  assert.equal(connected.body.status, 'connected');
  assert.equal(rejected.body.status, 'unavailable');
  assert.deepEqual(rejected.body.error, {code:'CHAIN_MISMATCH'});
  assert.equal(rejected.body.nusd.codeObserved, false);
  assert.deepEqual(good.requests.map(({request}) => request.id), [1,2,3,4,5,6,7,8,9,10]);
  assert.deepEqual(bad.requests.map(({request}) => request.id), [1]);
});
