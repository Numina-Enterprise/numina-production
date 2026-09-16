// Customer identity and provider credentials stay local.
import {RUNTIME_ORIGIN,RUNTIME_VERSION,EXPECTED_RELEASE} from '../public/runtime-contract.js';
import {routeRuntimeRevocation} from './runtime-revocation.js';
export {RUNTIME_ORIGIN};
export const RUNTIME_READ_PATHS = new Set([
  '/v1/status', '/v1/control/state', '/v1/release/manifest',
  '/v1/release/attestation', '/v1/release/supply-chain', '/v1/execution/providers',
  '/v2/network/status', '/v2/network/deployment-estimate', '/readyz', '/v1/preflight', '/v1/bootstrap/attestation',
  '/v1/release/sbom', '/v1/release/build-provenance', '/v1/release/core-binding'
]);
const VERSIONED_RUNTIME_PATHS = new Set(['/v1/status','/v1/control/state','/v1/release/manifest','/v1/release/attestation','/v1/execution/providers']);
const RELEASE_IDENTITY_PATHS = new Set(['/v1/status','/v1/release/manifest','/v1/release/attestation']);

function runtimeError(status, error, extra = {}) {
  return Response.json({error}, {status, headers: {'Cache-Control':'no-store', ...extra}});
}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function releaseIdentityMatches(value){return object(value)&&Object.entries(EXPECTED_RELEASE).every(([field,expected])=>value[field]===expected);}
function releaseIdentityFor(path,payload){return path==='/v1/release/attestation'?payload?.payload:payload;}
function supplyIdentityMatches(value){return object(value)&&value.valid===true&&['spdx_sbom_sha256','slsa_provenance_sha256'].every(field=>value[field]===EXPECTED_RELEASE[field]);}

export async function routeRuntime(request, upstreamFetch = fetch, timeoutMs = 12000) {
  const path = new URL(request.url).pathname;
  if(path==='/v1/evidence/revoke')return routeRuntimeRevocation(request,upstreamFetch);
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
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    const observed = payload?.production_version ?? payload?.state?.release ?? payload?.payload?.production_version ?? payload?.release ?? payload?.attestation?.release;
    const versioned = VERSIONED_RUNTIME_PATHS.has(path);
    if(response.ok && versioned && ![RUNTIME_VERSION,EXPECTED_RELEASE.release].includes(observed)) {
      return Response.json({error:'RUNTIME_RELEASE_MISMATCH',expected:RUNTIME_VERSION,observed:typeof observed==='string'?observed:null},{status:502,headers:{'Cache-Control':'no-store'}});
    }
    if(response.ok && RELEASE_IDENTITY_PATHS.has(path) && !releaseIdentityMatches(releaseIdentityFor(path,payload))) {
      return runtimeError(502,'RUNTIME_RELEASE_IDENTITY_MISMATCH');
    }
    if(response.ok && path==='/v1/release/supply-chain' && !supplyIdentityMatches(payload)) {
      return runtimeError(502,'RUNTIME_RELEASE_IDENTITY_MISMATCH');
    }
    const releaseBound=versioned||path==='/v1/release/supply-chain';
    return new Response(request.method === 'HEAD' ? null : bytes, {status:response.status, headers:{
      'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
      ...(releaseBound && response.ok?{'X-Numina-Runtime-Release':RUNTIME_VERSION}:{}), 'X-Content-Type-Options':'nosniff'
    }});
  } catch { return runtimeError(controller.signal.aborted ? 504 : 502, 'RUNTIME_SERVICE_UNAVAILABLE'); }
  finally { clearTimeout(timer); if (controller.signal.aborted && reader) void reader.cancel().catch(() => {}); }
}
