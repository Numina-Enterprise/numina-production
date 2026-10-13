import {observeHttp} from '../lib/http-telemetry.mjs';
import {observeNuminaNode} from '../lib/network-observation.mjs';

// Preserve the Node adapter API and its server environment default.
export async function observeNode({env = process.env, fetcher = (...args) => globalThis.fetch(...args)} = {}) {
  return observeNuminaNode({env, fetcher});
}

export default async function handler(request, response) {
  observeHttp(request, response);
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('CDN-Cache-Control', 'no-store');
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
