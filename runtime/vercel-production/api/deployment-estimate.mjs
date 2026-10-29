import {observeDeploymentEstimate} from '../lib/deployment-estimate.mjs';
import {createTelemetry} from '../lib/telemetry.mjs';
const metrics = createTelemetry({service: 'numina-node-gateway'});
const schema = 'numina.deployment-estimate.v1';

// GET only; HEAD returns 405 without a body or any upstream request.
export function createEstimateHandler({observe = observeDeploymentEstimate} = {}) {
  let pending = null;
  return async function handler(request, response) {
    const span = metrics.begin({path: '/api/deployment-estimate', method: request.method,
      phase: 'response_sent', log: process.env.NUMINA_TELEMETRY_LOGS !== 'false'});
    response.setHeader('X-Request-Id', span.requestId);
    response.once('finish', () => span.finish(response.statusCode));
    response.once('close', () => span.finish(response.statusCode, {aborted: !response.writableFinished}));
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    for (const name of ['Cache-Control', 'CDN-Cache-Control']) response.setHeader(name, 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Allow', 'GET');
    const reject = (status, code) => { response.statusCode = status; response.end(request.method === 'HEAD' ? undefined : JSON.stringify({schema, status: 'unavailable', error: {code}})); };
    if (request.method !== 'GET') return reject(405, 'METHOD_NOT_ALLOWED');
    // This read-only endpoint consumes no caller input. Hosting transports may
    // decorate the internal URL and request object, so treating transport metadata
    // as caller input causes false rejections. Ignore all
    // query/body/framing data and derive the response only from the observation.
    try {
      // Coalesce simultaneous public reads; never retain a completed estimate.
      if (!pending) { const work = Promise.resolve().then(() => observe()); pending = work; void work.finally(() => { if (pending === work) pending = null; }).catch(() => {}); }
      const result = await pending;
      response.statusCode = result.httpStatus;
      response.end(JSON.stringify(result.body));
    } catch { reject(503, 'OBSERVATION_UNAVAILABLE'); }
  };
}
export default createEstimateHandler();
