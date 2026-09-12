// Public rc22 runtime evidence. Customer identity and provider credentials stay local.
export const RUNTIME_ORIGIN = 'https://numina-production.vercel.app';
export const RUNTIME_READ_PATHS = new Set([
  '/v1/status', '/v1/control/state', '/v1/release/manifest',
  '/v1/release/attestation', '/v1/release/supply-chain', '/v1/execution/providers'
]);

function runtimeError(status, error, extra = {}) {
  return Response.json({error}, {status, headers: {'Cache-Control':'no-store', ...extra}});
}

export async function routeRuntime(request, upstreamFetch = fetch, timeoutMs = 12000) {
  const path = new URL(request.url).pathname;
  if (!RUNTIME_READ_PATHS.has(path)) return null;
  if (!['GET','HEAD'].includes(request.method)) return runtimeError(405, 'METHOD_NOT_ALLOWED', {Allow:'GET, HEAD'});
  const controller = new AbortController();
  let reader;
  const deadline = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('deadline')), {once:true});
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await Promise.race([upstreamFetch(RUNTIME_ORIGIN + path, {
      method:'GET', headers:{Accept:'application/json'}, redirect:'manual', signal:controller.signal
    }), deadline]);
    if (response.status >= 300 && response.status < 400) return runtimeError(502, 'RUNTIME_UPSTREAM_REDIRECT');
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) return runtimeError(502, 'RUNTIME_INVALID_RESPONSE');
    if (!response.body) return runtimeError(502, 'RUNTIME_EMPTY_RESPONSE');
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 262144) { void reader.cancel().catch(() => {}); return runtimeError(502, 'RUNTIME_RESPONSE_TOO_LARGE'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    JSON.parse(new TextDecoder().decode(bytes));
    return new Response(request.method === 'HEAD' ? null : bytes, {status:response.status, headers:{
      'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
      'X-Numina-Runtime-Release':'1.9.0-rc22', 'X-Content-Type-Options':'nosniff'
    }});
  } catch { return runtimeError(controller.signal.aborted ? 504 : 502, 'RUNTIME_SERVICE_UNAVAILABLE'); }
  finally { clearTimeout(timer); if (controller.signal.aborted && reader) void reader.cancel().catch(() => {}); }
}
