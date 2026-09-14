# Numina 4.0 telemetry and quantum adapter

Numina emits one structured HTTP completion event for each instrumented request. The Sites Worker, Vercel Node gateway and rc26 ASGI deployment wrapper use the same field names and bounded route groups. Native apps and plugins using the canonical APIs appear in those server measurements; this does not install agents on devices.

The owner can open **Frontier → Runtime metrics** and choose **Read runtime metrics**, or request **GET /api/ops/v1/telemetry** using the existing owner authentication. Metrics reads do not access or change the treasury. The endpoint uses private, no-store responses and excludes its own polling from request counts. The public field map is **/telemetry-metrics.json**.

## Metric map

| Signal | Source / field | Units and aggregation | Operational use |
| --- | --- | --- | --- |
| Traffic | HTTP events; window.requestsPerSecond | Requests/second, sum per service across instances | Establish demand before choosing capacity |
| Latency | durationMs; window.histogram | Merge histogram counts before deriving percentiles | Locate slow service groups; never average p95s |
| p95 estimate | window.p95UpperBoundMs | Upper histogram bound in ms; null if no samples or overflow | Initial target ≤ 1000 ms |
| Server errors | HTTP status ≥ 500; window.errorRate | Error count / request count | Investigate dependencies at ≥ 1% |
| Throttling | HTTP status 429; window.rateLimitedRate | Throttled count / request count | Review capacity and policy at ≥ 5% |
| Aborted responses | aborted; window.aborted | Count by service | Investigate disconnects and incomplete responses |
| Concurrency | activeRequests; peakActiveRequests | Current process gauge and lifetime peak | Compare demand with actual provider limits |
| Observation loss | loggingFailures | Current process counter | Repair the logging pipeline |
| Quantum demand | quantum metric qubits, gates, shots | Requested work, scoped to configured driver | Check hardware limits and cost before submission |
| Quantum backpressure | outcome=capacity_limited | Rejected submissions | Adjust host concurrency only within provider quota |
| Quantum state | submitted, outcome_unknown, status outcomes | Driver-reported states | Reconcile ambiguous acceptance before retrying |

Capacity signals require 100 requests in the current window. These are initial diagnostic thresholds, not measured service guarantees. HTTP telemetry reports response creation for Workers, and response transmission for Node/ASGI. It does not measure browser render time, GPU utilization or a quantum processor's utilization.

## Scale without duplicating the treasury

The local window retains five minute buckets (the current partial minute plus four previous minutes). Counters disappear when an instance restarts. A snapshot covers the responding process; a second read can reach another instance. **Do not scrape this load-balanced endpoint as if it were a complete persistent Prometheus counter.**

Aggregate structured events in the hosting provider's log pipeline to obtain fleet totals. Group by service, version, runtimeVersion, method and route. Use requestId only for event correlation, never as a metric label. Deduplicate replayed log events by instanceId + requestId. Do not sum observations from the Worker and downstream verifier as unique user requests: use numina-web for inbound demand and the other services for component demand. Data from static requests served before the Worker is available only through the provider's access logs.

Increase stateless application capacity using the host's deployment controls when measurements support it. Keep the existing canonical journal, root and readTreasury()/writeTreasury(event) boundary. Telemetry does not create another balance, write the ledger, authenticate external reserves or activate financial transfers.

Logs contain no raw paths, query strings, IPs, user identifiers, authorization headers, request bodies, provider URLs, circuits, objectives or treasury values. NUMINA_TELEMETRY_LOGS=false disables the new HTTP event logs; local metrics remain available. No telemetry collector credential is embedded, no drain is configured by source changes, and no telemetry network request is made on the business request path. Provider-native access logs may have their own retention and redaction settings.

Vercel's active rc26 assembly is created with scripts/package-rc26.py. Its generated entrypoint wraps the preserved ASGI app; the 105 frozen core files remain unchanged. The old rc22 gateway files are historical and are not the telemetry deployment target.

## Provider-neutral quantum compute

The connected **Numina state-vector backend** runs bounded classical simulation at **POST /api/ops/v1/quantum/measure**. **GET /api/ops/v1/quantum/capabilities** reports its configured state. Both require the existing authenticated owner. A measurement request uses canonical JSON and the prepared request fields (id, Principal, Authority, Objective, Intent); Principal must match the authenticated owner and Authority must be NUMINA. Session-based writes also require a matching Origin header.

The backend returns actual randomly sampled counts, ideal probabilities, the measured qubit order, request SHA-256 and local elapsed time. Its measurement ID is a computation identifier, not a signed proof or provider receipt. Limits are 8 qubits, 256 gates, 4096 shots, 2 concurrent requests and 30 requests/minute per process. They bound CPU and memory without creating ledger contention. Results are returned to the authenticated caller and are not persisted in the canonical treasury or telemetry logs. Set NUMINA_QUANTUM_SIMULATOR_ENABLED=false to disable this backend.

The same simulator is packaged at **@numina/nusd-integration/quantum-backend**, exporting measureNuminaCircuit and numinaQuantumCapabilities. This module runs locally in the calling process; its presence does not establish a hosted connection. The packaged examples/quantum-measurement.mjs executes it and prints measured counts. The HTTP capability response establishes the responding deployment's state. Quantum hardware remains unconnected.

Import prepareQuantumJob and createQuantumAdapter from **@numina/nusd-integration/quantum**. The packaged example is examples/quantum.mjs. Preparation validates a bounded circuit and creates a SHA-256 digest of the normalized request. It does not run a simulator or a QPU.

Supported gates: H, X, Y, Z, S, T, RX, RY, RZ and CX; rotation angles are radians. Limits: 32 logical qubits, 2048 gates, 10000 shots and a unique subset of measured qubits. Provider hardware can impose stricter limits, topology, transpilation and shot constraints. The driver must apply those constraints.

optimizeQuantumJob(input, newJobId) removes adjacent exact inverse gates and zero-angle rotations before preparation. It preserves ideal circuit semantics and returns original and optimized gate counts with a new digest. It does not commute gates, transpile for hardware, estimate quantum advantage or claim a measured hardware speedup. Keep the new job ID distinct from the unoptimized request.

A host-supplied driver implements submit(request, {idempotencyKey}) and status(providerJobId), with a local authorize callback. No driver is bundled or configured. Credentials remain in the deployment host. P/A/O/I fields describe a request; they do not themselves authenticate its author. The host's authorize callback must check authenticated identity, permissions and spending policy before submission.

The adapter defaults to two concurrent submissions and retains at most 1000 job identities per process. Duplicate IDs with changed contents are rejected. Pending or ambiguous submissions are not automatically retried. This local guard is not a distributed transaction system: the provider driver must implement durable idempotency, deadlines, quota enforcement and reconciliation across restarts and hosts.

A provider job ID means the configured driver reported acceptance. SUCCEEDED is a reported state, not an independently verified quantum result or canonical FINAL proof. A hardware-backed capability requires actual provider access and evidence. The current build reports hardwareExecutionVerified=false and leaves treasury writes disabled.

Provider references: [Vercel tracing](https://vercel.com/docs/tracing/instrumentation), [Cloudflare Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
