// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
import {createTelemetry} from './telemetry.mjs';
const metrics = createTelemetry({service: 'numina-node-gateway'});
export function observeHttp(request, response) {
  // Only the trusted handler assigns the route label, never the raw request URL.
  const span = metrics.begin({path: '/api/node-connection', method: request.method,
    phase: 'response_sent', log: process.env.NUMINA_TELEMETRY_LOGS !== 'false'});
  response.setHeader('X-Request-Id', span.requestId);
  response.once('finish', () => span.finish(response.statusCode));
  response.once('close', () => span.finish(response.statusCode, {aborted: !response.writableFinished}));
}
