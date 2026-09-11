const RC20_READ_PATHS = new Set(['/', '/index.html', '/status', '/site.css', '/site.js', '/healthz', '/readyz', '/metrics', '/.well-known/security.txt', '/sitemap.xml', '/site.webmanifest', '/robots.txt', '/v1/preflight', '/v1/status', '/v1/capabilities', '/v1/release/manifest', '/v1/release/supply-chain', '/v1/release/sbom', '/v1/release/build-provenance', '/v1/release/attestation', '/v1/keys/release-verification']);
const RC20_POST_PATHS = new Set(['/v1/control/evaluate', '/v1/verify/release-attestation', '/v1/verify/status-witness', '/v1/verify/checkpoint']);

function rc20Error(status, message, extra = {}) {
  return new Response(JSON.stringify({error: message}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra}});
}

export async function routeRc20(request, env, upstreamFetch = fetch) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/control' || path === '/control/') {
    if (!['GET', 'HEAD'].includes(request.method)) return rc20Error(405, 'METHOD_NOT_ALLOWED', {Allow: 'GET, HEAD'});
    const asset = await env.ASSETS.fetch(new Request(new URL('/', url), {method: 'GET'}));
    const html = (await asset.text())
      .replace('rel="canonical" href="https://www.numinalabs.xyz/"', 'rel="canonical" href="https://www.numinalabs.xyz/control"')
      .replace('href="/" aria-current="page">Control plane', 'href="/control" aria-current="page">Control plane')
      .replace('return_to=%2F"', 'return_to=%2Fcontrol"');
    const headers = new Headers(asset.headers);
    headers.delete('Content-Length'); headers.delete('Content-Encoding'); headers.delete('ETag');
    headers.set('Cache-Control', 'no-store');
    return new Response(request.method === 'HEAD' ? null : html, {status: asset.status, headers});
  }
  // This branch stays inactive until a verified upstream is configured.
  if (!env.NUMINA_RC20_ORIGIN || (!RC20_READ_PATHS.has(path) && !RC20_POST_PATHS.has(path))) return null;
  const isPost = RC20_POST_PATHS.has(path);
  if (!(isPost ? request.method === 'POST' : ['GET', 'HEAD'].includes(request.method))) return rc20Error(405, 'METHOD_NOT_ALLOWED', {Allow: isPost ? 'POST' : 'GET, HEAD'});
  let origin;
  try {
    origin = new URL(env.NUMINA_RC20_ORIGIN);
    if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.vercel.app') || origin.username || origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
  } catch { return rc20Error(503, 'RC20_ORIGIN_NOT_CONFIGURED'); }
  const upstream = new URL(path === '/index.html' ? '/' : path, origin);
  upstream.search = url.search;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let incomingReader;
  try {
    const headers = new Headers({Accept: isPost || path.startsWith('/v1/') ? 'application/json' : '*/*'});
    let body;
    if (isPost) {
      if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') return rc20Error(415, 'JSON_REQUIRED');
      if (request.headers.has('Content-Encoding')) return rc20Error(415, 'ENCODING_UNSUPPORTED');
      if (Number(request.headers.get('Content-Length')) > 65536) return rc20Error(413, 'BODY_TOO_LARGE');
      if (!request.body) return rc20Error(400, 'EMPTY_BODY');
      const reader = incomingReader = request.body.getReader(), chunks = [];
      const deadline = new Promise((_, reject) => {
        if (controller.signal.aborted) return reject(new Error('deadline'));
        controller.signal.addEventListener('abort', () => reject(new Error('deadline')), {once: true});
      });
      let size = 0;
      while (true) {
        const result = await Promise.race([reader.read(), deadline]);
        if (result.done) break;
        size += result.value.byteLength;
        if (size > 65536) { void reader.cancel().catch(() => {}); return rc20Error(413, 'BODY_TOO_LARGE'); }
        chunks.push(result.value);
      }
      body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      headers.set('Content-Type', 'application/json');
    }
    // Send public requests only. Never forward identity, cookies or credentials.
    const result = await upstreamFetch(upstream.href, {method: isPost ? 'POST' : 'GET', headers, body, redirect: 'manual', signal: controller.signal});
    if (result.status >= 300 && result.status < 400) return rc20Error(502, 'RC20_UPSTREAM_REDIRECT');
    const responseHeaders = new Headers();
    for (const key of ['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'strict-transport-security']) {
      if (result.headers.has(key)) responseHeaders.set(key, result.headers.get(key));
    }
    responseHeaders.set('Cache-Control', 'no-store');
    let content = await result.arrayBuffer();
    if ((path === '/' || path === '/index.html') && result.status === 200 && (result.headers.get('content-type') || '').includes('text/html')) {
      content = new TextEncoder().encode(new TextDecoder().decode(content).replace('</nav>', '<a href="/control">Control plane</a><a href="/labs.html">Numina Labs</a></nav>'));
    }
    return new Response(request.method === 'HEAD' ? null : content, {status: result.status, headers: responseHeaders});
  } catch { return rc20Error(controller.signal.aborted ? 504 : 502, 'RC20_SERVICE_UNAVAILABLE'); }
  finally {
    clearTimeout(timer);
    if (controller.signal.aborted && incomingReader) void incomingReader.cancel().catch(() => {});
  }
}
