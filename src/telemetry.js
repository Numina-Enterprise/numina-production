// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
// Bounded, process-local measurements. No request bodies, headers or identities.
export const TELEMETRY_VERSION = '4.0.0';
export const TELEMETRY_RUNTIME = '1.9.0-rc26';
export const TELEMETRY_BOUNDS_MS = Object.freeze([10, 50, 100, 250, 500, 1000, 2500, 5000, 15000, 60000]);
const TELEMETRY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
export function telemetryRoute(path) {
  if (['/healthz', '/readyz'].includes(path)) return path;
  if (path === '/api/ops/v1/telemetry') return '/api/ops/v1/telemetry';
  if (path.startsWith('/api/ops/v1/quantum/')) return '/api/ops/v1/quantum/*';
  if (path === '/v2/network/status' || path === '/api/node-connection') return '/v2/network/status';
  if (/^\/v[234]\/release\/manifest$/.test(path)) return '/v4/release/manifest';
  for (const prefix of ['/api/control/v1/', '/api/control/v2/', '/api/app/v1/', '/api/nusd/v1/', '/v1/']) {
    if (path.startsWith(prefix)) return prefix + '*';
  }
  return path.startsWith('/api/') ? '/api/*' : '/site/*';
}
export function createTelemetry({service = 'numina-web', clock = () => performance.now(), now = () => Date.now(),
  emit = value => console.log(JSON.stringify(value))} = {}) {
  if (!['numina-web', 'numina-node-gateway', 'numina-verifier'].includes(service)) throw Error('INVALID_TELEMETRY_SERVICE');
  const windows = new Map();
  let started = null, instanceId = null;
  // Worker startup cannot generate randomness; initialize on the first request.
  function initialize() {
    if (instanceId === null) { instanceId = crypto.randomUUID(); started = now(); }
  }
  let active = 0, peak = 0, completed = 0, loggingFailures = 0;
  function prune(time) {
    const minute = Math.floor(time / 60000);
    for (const key of windows.keys()) if (key < minute - 4 || key > minute) windows.delete(key);
    return minute;
  }
  function window(time) {
    const minute = prune(time);
    if (!windows.has(minute)) windows.set(minute, {count: 0, errors: 0, limited: 0, aborted: 0,
      durationMs: 0, histogram: Array(TELEMETRY_BOUNDS_MS.length + 1).fill(0)});
    return windows.get(minute);
  }
  return {
    begin({path = '/', method = 'GET', log = true, phase = 'response_created'} = {}) {
      initialize();
      const requestId = crypto.randomUUID(), start = clock(), route = telemetryRoute(path);
      const safeMethod = TELEMETRY_METHODS.has(method) ? method : 'OTHER';
      active++; peak = Math.max(peak, active);
      let finished = false;
      return {requestId, finish(status, {aborted = false} = {}) {
        if (finished) return;
        finished = true; active = Math.max(0, active - 1); completed++;
        const measured = clock() - start, durationMs = Number.isFinite(measured) ? Math.max(0, measured) : 0;
        const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 500;
        const time = now(), row = window(time);
        row.count++; row.errors += safeStatus >= 500 ? 1 : 0; row.limited += safeStatus === 429 ? 1 : 0;
        row.aborted += aborted ? 1 : 0; row.durationMs += durationMs;
        const bound = TELEMETRY_BOUNDS_MS.findIndex(limit => durationMs <= limit);
        row.histogram[bound < 0 ? TELEMETRY_BOUNDS_MS.length : bound]++;
        if (log) {
          try { emit({schema: 'numina.http-request.v1', event: 'http_request', service,
            version: TELEMETRY_VERSION, runtimeVersion: TELEMETRY_RUNTIME, instanceId, requestId,
            observedAt: new Date(time).toISOString(), route, method: safeMethod, status: safeStatus,
            durationMs: Math.round(durationMs * 100) / 100, activeRequests: active, aborted: !!aborted,
            phase: phase === 'response_sent' ? 'response_sent' : 'response_created', sampleRate: 1}); }
          catch { loggingFailures++; }
        }
      }};
    },
    snapshot() {
      initialize();
      const time = now(), minute = prune(time), histogram = Array(TELEMETRY_BOUNDS_MS.length + 1).fill(0);
      let count = 0, errors = 0, limited = 0, aborted = 0, durationMs = 0;
      for (const row of windows.values()) {
        count += row.count; errors += row.errors; limited += row.limited; aborted += row.aborted; durationMs += row.durationMs;
        row.histogram.forEach((value, index) => { histogram[index] += value; });
      }
      const windowStart = Math.max(started, (minute - 4) * 60000), seconds = Math.max(1, (time - windowStart) / 1000);
      let p95Index = -1, cumulative = 0;
      if (count) p95Index = histogram.findIndex(value => { cumulative += value; return cumulative >= Math.ceil(count * .95); });
      const p95 = p95Index < 0 || p95Index === TELEMETRY_BOUNDS_MS.length ? null : TELEMETRY_BOUNDS_MS[p95Index];
      const signals = [];
      if (count >= 100) {
        if (errors / count >= .01) signals.push('investigate_server_errors');
        if (limited / count >= .05) signals.push('review_rate_limits_and_capacity');
        if (p95 === null || p95 > 1000) signals.push('investigate_latency');
      }
      return {schema: 'numina.telemetry.v1', service, version: TELEMETRY_VERSION, runtimeVersion: TELEMETRY_RUNTIME,
        observedAt: new Date(time).toISOString(), scope: 'current_process_only', instanceId,
        measurement: 'response_created_for_worker_response_sent_for_node',
        fleetAggregation: 'provider_log_pipeline_required', persistence: 'ephemeral',
        uptimeSeconds: Math.max(0, (time - started) / 1000), activeRequests: active, peakActiveRequests: peak,
        completedRequests: completed, loggingFailures,
        window: {start: new Date(windowStart).toISOString(), end: new Date(time).toISOString(),
          requests: count, requestsPerSecond: count / seconds, serverErrors: errors, rateLimited: limited,
          aborted, errorRate: count ? errors / count : null, rateLimitedRate: count ? limited / count : null,
          averageDurationMs: count ? durationMs / count : null, p95UpperBoundMs: p95,
          p95AboveLargestBucket: p95Index === TELEMETRY_BOUNDS_MS.length,
          histogram: {boundsMs: [...TELEMETRY_BOUNDS_MS, null], counts: histogram, cumulative: false}},
        capacity: {status: count < 100 ? 'insufficient_data' : signals.length ? 'attention' : 'within_configured_thresholds',
          signals, minimumSamples: 100, errorRateThreshold: .01, rateLimitedRateThreshold: .05,
          p95TargetMs: 1000, automaticScalingEnabled: false}};
    }
  };
}
export const numinaWebTelemetry = createTelemetry();
