function rc20Error(status, message, extra = {}) {
  return new Response(JSON.stringify({error: message}), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra}});
}

// rc20 remains only as a local compatibility view. External legacy-runtime proxying
// is retired; historical rc20 evidence is served from repository artifacts instead.
export async function routeRc20(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path !== '/control' && path !== '/control/') return null;
  if (!['GET', 'HEAD'].includes(request.method)) return rc20Error(405, 'METHOD_NOT_ALLOWED', {Allow: 'GET, HEAD'});
  if (!env?.ASSETS?.fetch) return rc20Error(503, 'LOCAL_ASSETS_UNAVAILABLE');
  const asset = await env.ASSETS.fetch(new Request(new URL('/control', url), {method: 'GET'}));
  const html = (await asset.text())
    .replace('rel="canonical" href="https://www.numinalabs.xyz/"', 'rel="canonical" href="https://www.numinalabs.xyz/control"')
    .replace('href="/" aria-current="page">Control plane', 'href="/control" aria-current="page">Control plane')
    .replace('return_to=%2F"', 'return_to=%2Fcontrol"');
  const headers = new Headers(asset.headers);
  headers.delete('Content-Length'); headers.delete('Content-Encoding'); headers.delete('ETag');
  headers.set('Cache-Control', 'no-store');
  return new Response(request.method === 'HEAD' ? null : html, {status: asset.status, headers});
}
