#!/usr/bin/env node
// Read-only Node 26 HTTP adapter for the canonical generated Worker and assets.
// Private services, financial execution and signing are deliberately unavailable.
import {createServer} from 'node:http';
import {constants} from 'node:fs';
import {lstat, open, readFile} from 'node:fs/promises';
import {extname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ASSET_ROOT = resolve(ROOT, 'dist/client');
const HOST = '127.0.0.1';
const PUBLIC_MCP = new Set(['/mcp', '/api/control/v2/discovery-mcp']);
const MCP_METHODS = new Set(['initialize', 'ping', 'tools/list', 'notifications/initialized']);
const PUBLIC_TOOLS = new Set(['numina_connections', 'numina_architecture', 'numina_capabilities', 'numina_head']);
const PUBLIC_API = new Set(['/api/control/v2/architecture', '/api/control/v2/manifest', '/api/control/v2/head', '/api/core/v1.8/manifest', '/api/core/v1.8/context', '/.well-known/agent-card.json', '/v2/release/manifest', '/v3/release/manifest', '/v4/release/manifest']);
const MIME = {'.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8', '.xml':'application/xml; charset=utf-8', '.pdf':'application/pdf', '.zip':'application/zip', '.gz':'application/gzip', '.apk':'application/vnd.android.package-archive', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json', '.pem':'text/plain; charset=utf-8', '.sig64':'application/octet-stream'};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
}

function unavailable(service) {
  return json({error:'CLOUD_PREVIEW_SERVICE_UNAVAILABLE', service, scope:'Local read-only preview', configured:false}, 503);
}

function serviceFailure(service) {
  const error = new Error('CLOUD_PREVIEW_SERVICE_UNAVAILABLE');
  error.code = 'CLOUD_PREVIEW_SERVICE_UNAVAILABLE';
  error.service = service;
  throw error;
}

const DATABASE = Object.freeze({prepare(){serviceFailure('D1');}, batch(){serviceFailure('D1');}, exec(){serviceFailure('D1');}});
const BUCKET = Object.freeze({get(){serviceFailure('R2');}, head(){serviceFailure('R2');}, put(){serviceFailure('R2');}, delete(){serviceFailure('R2');}, list(){serviceFailure('R2');}});

async function assets(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return json({error:'METHOD_NOT_ALLOWED'}, 405);
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url).pathname); }
  catch { return json({error:'INVALID_ASSET_PATH'}, 400); }
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part === '..')) return json({error:'INVALID_ASSET_PATH'}, 400);
  if (pathname === '/') pathname = '/index.html';
  let path = resolve(ASSET_ROOT, '.' + pathname);
  const contained = candidate => candidate.startsWith(ASSET_ROOT + sep);
  if (!contained(path)) return json({error:'ASSET_NOT_FOUND'}, 404);
  let metadata;
  try { metadata = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!extname(path)) { path += '.html'; try { metadata = await lstat(path); } catch (next) { if (next.code !== 'ENOENT') throw next; } }
  }
  if (metadata?.isDirectory()) { path = join(path, 'index.html'); try { metadata = await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; metadata = null; } }
  if (!contained(path) || !metadata?.isFile() || metadata.isSymbolicLink()) return json({error:'ASSET_NOT_FOUND'}, 404);
  let parent = ASSET_ROOT;
  for (const component of relative(ASSET_ROOT, path).split(sep).slice(0, -1)) {
    parent = join(parent, component);
    const part = await lstat(parent);
    if (!part.isDirectory() || part.isSymbolicLink()) return json({error:'ASSET_NOT_FOUND'}, 404);
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const actual = await file.stat();
  if (!actual.isFile()) { await file.close(); return json({error:'ASSET_NOT_FOUND'}, 404); }
  const headers = {'Content-Type':MIME[extname(path).toLowerCase()] || 'application/octet-stream', 'Content-Length':String(actual.size), 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'};
  if (request.method === 'HEAD') { await file.close(); return new Response(null, {headers}); }
  return new Response(Readable.toWeb(file.createReadStream({autoClose:true})), {headers});
}

async function requestBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16384) { const error = new Error('BODY_TOO_LARGE'); error.code = 'BODY_TOO_LARGE'; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function portFromArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) return 8788;
  if (args.length !== 2 || args[0] !== '--port' || !/^[0-9]{1,5}$/.test(args[1])) throw new Error('USAGE: node scripts/serve-numina-cloud.mjs [--port PORT]');
  const port = Number(args[1]);
  if (port < 1 || port > 65535) throw new Error('INVALID_PORT');
  return port;
}

async function main() {
  const config = JSON.parse(await readFile(new URL('../config/numina-node26.v1.json', import.meta.url), 'utf8'));
  if (process.versions.node !== config.version || config.version !== '26.11.1') throw new Error('PINNED_NODE_VERSION_REQUIRED');
  const port = portFromArgs();
  for (const path of [resolve(ROOT, 'dist'), ASSET_ROOT]) {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('CANONICAL_ASSET_DIRECTORY_REQUIRED');
  }
  const {default:worker} = await import(new URL('../dist/server/index.js', import.meta.url));
  if (typeof worker?.fetch !== 'function') throw new Error('CANONICAL_WORKER_FETCH_REQUIRED');
  const env = Object.freeze({ASSETS:{fetch:assets}, DB:DATABASE, BUCKET, NUMINA_LIVEMODE:'false', NUMINA_TELEMETRY_LOGS:'false'});
  const identity = {schema:'numina.cloud-preview-runtime.v1', canonicalRepository:ROOT.replace(/\/$/, ''), runtime:'Node.js', nodeVersion:process.versions.node, v8Version:process.versions.v8, nodeAbi:process.versions.modules, bindAddress:HOST, port, workerAdapter:'canonical dist/server/index.js Web API fetch', scope:'Local read-only cloud preview', productionWorkerActivated:false, privateD1Configured:false, privateR2Configured:false, signingConfigured:false, financialExecutionEnabled:false};
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url || '/', `http://${HOST}:${port}`);
      if (url.origin !== `http://${HOST}:${port}`) { await send(json({error:'LOCAL_REQUEST_REQUIRED'}, 400), incoming, outgoing); return; }
      let result;
      const method = incoming.method || 'GET';
      if (url.pathname === '/__numina/cloud-runtime') {
        result = ['GET', 'HEAD'].includes(method) ? json(identity) : json({error:'METHOD_NOT_ALLOWED'}, 405);
      } else if (method === 'POST' && PUBLIC_MCP.has(url.pathname)) {
        if (!(incoming.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { result = json({error:'JSON_REQUIRED'}, 415); }
        else {
          const body = await requestBody(incoming);
          let message;
          try { message = JSON.parse(body.toString('utf8')); } catch { result = json({error:'INVALID_JSON'}, 400); }
          if (!result) {
            const publicCall = message?.method === 'tools/call' && PUBLIC_TOOLS.has(message.params?.name);
            if (!message || Array.isArray(message) || (!MCP_METHODS.has(message.method) && !publicCall)) result = json({error:'CLOUD_PREVIEW_READ_ONLY'}, 403);
            else result = await worker.fetch(new Request(url, {method, headers:incoming.headers, body}), env);
          }
        }
      } else if (!['GET', 'HEAD'].includes(method)) result = json({error:'CLOUD_PREVIEW_READ_ONLY'}, 405);
      else if (url.pathname === '/readyz' || url.pathname.startsWith('/v1/')) result = unavailable('Persistent runtime signer');
      else if ((url.pathname.startsWith('/api/') || url.pathname === '/mcp') && !PUBLIC_API.has(url.pathname)) result = unavailable('Private D1 control service');
      else result = await worker.fetch(new Request(url, {method, headers:incoming.headers}), env);
      await send(result, incoming, outgoing);
    } catch (error) {
      const code = error?.code === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'CLOUD_PREVIEW_REQUEST_FAILED';
      console.error(JSON.stringify({event:'numina_cloud_preview_request_error', code}));
      if (!outgoing.headersSent) await send(json({error:code}, code === 'BODY_TOO_LARGE' ? 413 : 503), incoming, outgoing);
      else outgoing.destroy();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  server.on('error', error => { console.error(JSON.stringify({event:'numina_cloud_preview_server_error', code:error.code || 'SERVER_UNAVAILABLE'})); process.exitCode = 1; });
  server.listen(port, HOST, () => console.log(JSON.stringify({event:'numina_cloud_preview_started', url:`http://${HOST}:${port}`, ...identity})));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    if (closing) return;
    closing = true;
    console.log(JSON.stringify({event:'numina_cloud_preview_stopping', signal}));
    server.close(() => { process.exitCode = 0; });
    server.closeIdleConnections();
    const timer = setTimeout(() => server.closeAllConnections(), 5000);
    timer.unref();
  });
}

async function send(response, request, output) {
  const headers = new Headers(response.headers);
  headers.set('X-Numina-Cloud-Preview', 'read-only');
  headers.set('X-Numina-Node-Version', process.versions.node);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.delete('Strict-Transport-Security');
  if (headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', headers.get('Content-Security-Policy').replace(/(?:^|;)\s*upgrade-insecure-requests\s*(?=;|$)/g, ''));
  output.writeHead(response.status, Object.fromEntries(headers));
  if (request.method === 'HEAD' || !response.body) { await response.body?.cancel(); output.end(); return; }
  const stream = Readable.fromWeb(response.body);
  stream.on('error', () => { console.error(JSON.stringify({event:'numina_cloud_preview_stream_error'})); output.destroy(); });
  output.on('close', () => { if (!stream.destroyed) stream.destroy(); });
  stream.pipe(output);
}

main().catch(error => {
  const known = new Set(['PINNED_NODE_VERSION_REQUIRED', 'CANONICAL_ASSET_DIRECTORY_REQUIRED', 'CANONICAL_WORKER_FETCH_REQUIRED', 'INVALID_PORT']);
  console.error(JSON.stringify({event:'numina_cloud_preview_start_failed', code:known.has(error?.message) ? error.message : error?.code || 'STARTUP_UNAVAILABLE', exception:error?.name === 'Error' ? 'Error' : 'ConfigurationError'}));
  process.exitCode = 1;
});
