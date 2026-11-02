#!/usr/bin/env node
// Cloud Run adapter for the canonical generated Worker and assets.
// New file only: does not change src/worker.js, wrangler.jsonc,
// scripts/serve-numina-cloud.mjs, or config/numina-node26.v1.json.
//
// Differences from the local preview server, deliberately:
// - Listens on 0.0.0.0, not 127.0.0.1, so Cloud Run can reach it.
// - Port comes from process.env.PORT (Cloud Run sets it, default 8080),
//   not from --port args and not from a fixed 8788.
// - No PINNED_NODE_VERSION_REQUIRED check. The Dockerfile pins
//   Node 26.13.0, matching .nvmrc 26.13.0 (Nov 1 alignment).
//   The preview server is frozen to 26.11.1 by its own config
//   (config.version must equal '26.11.1'), so it cannot run on
//   a 26.13.0 machine. This adapter does not re-impose that pin.
// - Private services, financial execution and signing are
//   deliberately unavailable, same as the preview: D1 and R2
//   bindings throw, NUMINA_LIVEMODE is 'false'.
// - No secrets are read from code. Control secrets, if ever used,
//   belong in Cloud Run / Worker configuration, never in this file.
import { createServer } from 'node:http';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ASSET_ROOT = resolve(ROOT, 'dist/client');
const HOST = '0.0.0.0';

function portFromEnv() {
  const raw = process.env.PORT;
  if (raw === undefined || raw === '') return 8080;
  if (!/^[0-9]{1,5}$/.test(raw)) throw new Error('INVALID_PORT');
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error('INVALID_PORT');
  return port;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.apk': 'application/vnd.android.package-archive',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.pem': 'text/plain; charset=utf-8',
  '.sig64': 'application/octet-stream',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function serviceFailure(service) {
  const error = new Error('CLOUDRUN_SERVICE_UNAVAILABLE');
  error.code = 'CLOUDRUN_SERVICE_UNAVAILABLE';
  error.service = service;
  throw error;
}

const DATABASE = Object.freeze({
  prepare() { serviceFailure('D1'); },
  batch() { serviceFailure('D1'); },
  exec() { serviceFailure('D1'); },
});
const BUCKET = Object.freeze({
  get() { serviceFailure('R2'); },
  head() { serviceFailure('R2'); },
  put() { serviceFailure('R2'); },
  delete() { serviceFailure('R2'); },
  list() { serviceFailure('R2'); },
});

async function assets(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return json({ error: 'INVALID_ASSET_PATH' }, 400);
  }
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some((part) => part === '..')) {
    return json({ error: 'INVALID_ASSET_PATH' }, 400);
  }
  if (pathname === '/') pathname = '/index.html';
  let path = resolve(ASSET_ROOT, '.' + pathname);
  const contained = (candidate) => candidate.startsWith(ASSET_ROOT + sep);
  if (!contained(path)) return json({ error: 'ASSET_NOT_FOUND' }, 404);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!extname(path)) {
      path += '.html';
      try {
        metadata = await lstat(path);
      } catch (next) {
        if (next.code !== 'ENOENT') throw next;
      }
    }
  }
  if (metadata?.isDirectory()) {
    path = join(path, 'index.html');
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      metadata = null;
    }
  }
  if (!contained(path) || !metadata?.isFile() || metadata.isSymbolicLink()) {
    return json({ error: 'ASSET_NOT_FOUND' }, 404);
  }
  let parent = ASSET_ROOT;
  for (const component of relative(ASSET_ROOT, path).split(sep).slice(0, -1)) {
    parent = join(parent, component);
    const part = await lstat(parent);
    if (!part.isDirectory() || part.isSymbolicLink()) return json({ error: 'ASSET_NOT_FOUND' }, 404);
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const actual = await file.stat();
  if (!actual.isFile()) {
    await file.close();
    return json({ error: 'ASSET_NOT_FOUND' }, 404);
  }
  const headers = {
    'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
    'Content-Length': String(actual.size),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method === 'HEAD') {
    await file.close();
    return new Response(null, { headers });
  }
  return new Response(Readable.toWeb(file.createReadStream({ autoClose: true })), { headers });
}

async function requestBody(incoming) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of incoming) {
    bytes += chunk.length;
    if (bytes > 1048576) {
      const error = new Error('BODY_TOO_LARGE');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

async function send(response, incoming, outgoing) {
  const headers = new Headers(response.headers);
  headers.set('X-Numina-Cloud-Run', 'adapter');
  headers.set('X-Numina-Node-Version', process.versions.node);
  headers.set('X-Content-Type-Options', 'nosniff');
  outgoing.writeHead(response.status, Object.fromEntries(headers));
  if (incoming.method === 'HEAD' || !response.body) {
    await response.body?.cancel();
    outgoing.end();
    return;
  }
  const stream = Readable.fromWeb(response.body);
  stream.on('error', () => {
    console.error(JSON.stringify({ event: 'numina_cloudrun_stream_error' }));
    outgoing.destroy();
  });
  outgoing.on('close', () => {
    if (!stream.destroyed) stream.destroy();
  });
  stream.pipe(outgoing);
}

async function main() {
  const port = portFromEnv();
  for (const path of [resolve(ROOT, 'dist'), ASSET_ROOT]) {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('CANONICAL_ASSET_DIRECTORY_REQUIRED');
    }
  }
  const { default: worker } = await import(new URL('../dist/server/index.js', import.meta.url));
  if (typeof worker?.fetch !== 'function') throw new Error('CANONICAL_WORKER_FETCH_REQUIRED');
  const env = Object.freeze({
    ASSETS: { fetch: assets },
    DB: DATABASE,
    BUCKET,
    NUMINA_LIVEMODE: 'false',
    NUMINA_TELEMETRY_LOGS: 'false',
  });
  const identity = {
    schema: 'numina.cloudrun-runtime.v1',
    canonicalRepository: ROOT.replace(/\/$/, ''),
    runtime: 'Node.js',
    nodeVersion: process.versions.node,
    bindAddress: HOST,
    port,
    workerAdapter: 'canonical dist/server/index.js Web API fetch',
    scope: 'Cloud Run adapter, public readback only',
    productionWorkerActivated: false,
    privateD1Configured: false,
    privateR2Configured: false,
    signingConfigured: false,
    financialExecutionEnabled: false,
  };
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url || '/', `http://localhost:${port}`);
      let result;
      const method = incoming.method || 'GET';
      if (url.pathname === '/__numina/cloud-runtime') {
        result = ['GET', 'HEAD'].includes(method) ? json(identity) : json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      } else {
        const body = ['GET', 'HEAD'].includes(method) ? undefined : await requestBody(incoming);
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        // Present the canonical origin to the worker so routeRuntime
        // treats same-origin reads as local (File 3) instead of
        // upstream-fetching https://numinalabs.xyz and returning 502
        // when localhost (or a run.app URL) is used to reach the adapter.
        const workerUrl = new URL(url.pathname + url.search, 'https://numinalabs.xyz');
        result = await worker.fetch(
          new Request(workerUrl, { method, headers, body: body ?? undefined }),
          env,
        );
      }
      await send(result, incoming, outgoing);
    } catch (error) {
      const code = error?.code === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'CLOUDRUN_REQUEST_FAILED';
      console.error(JSON.stringify({ event: 'numina_cloudrun_request_error', code }));
      if (!outgoing.headersSent) {
        await send(json({ error: code }, code === 'BODY_TOO_LARGE' ? 413 : 503), incoming, outgoing);
      } else {
        outgoing.destroy();
      }
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  server.on('error', (error) => {
    console.error(JSON.stringify({ event: 'numina_cloudrun_server_error', code: error.code || 'SERVER_UNAVAILABLE' }));
    process.exitCode = 1;
  });
  server.listen(port, HOST, () => {
    console.log(JSON.stringify({ event: 'numina_cloudrun_started', url: `http://${HOST}:${port}`, ...identity }));
  });
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      console.log(JSON.stringify({ event: 'numina_cloudrun_stopping', signal }));
      server.close(() => {
        process.exitCode = 0;
      });
      server.closeIdleConnections();
      const timer = setTimeout(() => server.closeAllConnections(), 5000);
      timer.unref();
    });
  }
}

main().catch((error) => {
  const known = new Set(['CANONICAL_ASSET_DIRECTORY_REQUIRED', 'CANONICAL_WORKER_FETCH_REQUIRED', 'INVALID_PORT']);
  console.error(JSON.stringify({
    event: 'numina_cloudrun_start_failed',
    code: known.has(error?.message) ? error.message : error?.code || 'STARTUP_UNAVAILABLE',
    exception: error?.name === 'Error' ? 'Error' : 'ConfigurationError',
  }));
  process.exitCode = 1;
});
