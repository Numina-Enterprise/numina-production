# Numina 4.0 telemetry and quantum adapter

Numina emits one structured HTTP completion event for each instrumented request. The Sites Worker, Vercel Node gateway and rc27 ASGI deployment wrapper use the same field names and bounded route groups. Native apps and plugins using the canonical APIs appear in those server measurements; this does not install agents on devices.

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

Increase application compute capacity using the host's deployment controls when measurements support it. Keep the existing canonical journal, root and readTreasury()/writeTreasury(event) boundary. Telemetry does not create another balance, write the ledger, authenticate external reserves or activate financial transfers.

Logs contain no raw paths, query strings, IPs, user identifiers, authorization headers, request bodies, provider URLs, circuits, objectives or treasury values. NUMINA_TELEMETRY_LOGS=false disables the new HTTP event logs; local metrics remain available. No telemetry collector credential is embedded, no drain is configured by source changes, and no telemetry network request is made on the business request path. Provider-native access logs may have their own retention and redaction settings.

Vercel's active rc27 assembly is created with scripts/package-rc27.py. Its generated entrypoint wraps the preserved ASGI app; the 105 frozen core files remain unchanged. The old rc22 gateway files are historical and are not the telemetry deployment target.

## Publishing telemetry and recovery

Run `npm run publish:source -- github` or `npm run publish:source -- sites` from the committed Numina repository using the host's existing publishing credentials. The Sites owner workflow obtains the short-lived repository credential and supplies its Authorization header through per-process Git configuration. Keep credentials out of command arguments, files and source. The exported `publishGit({cwd, target, env, reportDirectory})` function also supports the existing Numina builder repository with target `builder`.

The publisher accepts only the configured Numina HTTPS repositories. It requires a clean repository and pins the exact local commit when updating `refs/heads/main`. It never force pushes. A Git success is followed by a remote revision read; source publication is verified only when the full remote commit matches the requested commit. Hosting still requires saving the matching artifact, deploying it and checking the provider's deployment result.

Each run writes a private JSON report under ignored `.openai/publishing/`, or the caller's private report directory. The report captures actual per-command exit codes, timeouts, durations, bounded failure categories, source and observed remote commits, and actual push and retry counts. Raw command output, credentials, environment values and treasury balances are excluded. These records are local observations, not builder-signed attestations or provider receipts. Reports are not served by `/api/ops/v1/telemetry` and are not included in the hosted build.

| Publishing signal | Report field | Recovery |
| --- | --- | --- |
| Command result | steps[].exitCode, failure, timedOut | Identify the failed operation without claiming a successful exit |
| Access or authentication denial | access_denied, proxy_denied, authentication | Restore access through the host or provider's owning controls; no automatic retry |
| DNS, TLS or connection failure | dns, tls, connection_failed | Diagnose the configured host; keep certificate verification enabled |
| Temporary failure | timeout, connection_reset, temporary_http_failure | Read the remote revision first; retry once after two seconds only if that read succeeds and differs |
| Ambiguous acceptance | push_outcome_unconfirmed | Reconcile with the provider before repeating the write |
| Accepted but unverified source | push_accepted_verification_unavailable | Restore the remote read; do not call the deployment complete |
| Source alignment | sourceCommit, remoteCommit, sourcePushVerified | Save and deploy only the matching source and artifact |

A generic connection failure does not prove a permissions fault. Separately observed operating-system errors, such as Windows socket error 10013, belong in host diagnostics. Telemetry does not change network policy, grant provider access, or repair missing credentials. Git operations retain the host's configured HTTPS and proxy behavior. Each command has a 30-second deadline; retries are bounded to two total push attempts. No application test suite runs as part of publishing.

## Provider-neutral quantum compute

The connected **Numina state-vector backend** runs bounded classical simulation at **POST /api/ops/v1/quantum/measure**. **GET /api/ops/v1/quantum/capabilities** reports its configured state. Both require the existing authenticated owner. A measurement request uses canonical JSON and the prepared request fields (id, Principal, Authority, Objective, Intent); Principal must match the authenticated owner and Authority must be NUMINA. Session-based writes also require a matching Origin header.

The backend returns actual randomly sampled counts, ideal probabilities, the measured qubit order, request SHA-256 and local elapsed time. Its measurement ID is a computation identifier, not a signed proof or provider receipt. Limits are 8 qubits, 256 gates, 4096 shots, 2 concurrent requests and 30 requests/minute per process. They bound CPU and memory without creating ledger contention. Results are returned to the authenticated caller and are not persisted in the canonical treasury or telemetry logs. Set NUMINA_QUANTUM_SIMULATOR_ENABLED=false to disable this backend.

### Quantum workload and scaling signals

The owner metrics response includes `quantum.workload` using schema `numina.quantum-workload.v1`. Frontier's Runtime metrics panel shows actual successful and failed jobs, active jobs, current-minute admissions, completed simulator shots, compute latency and capacity rejections. The admission controller and telemetry share the same counters and existing limits. Concurrent capacity rejection returns a one-second Retry-After; rate rejection returns the remaining seconds in the current minute. There is no queue or automatic retry.

The five-minute window counts concurrency and request-rate rejections separately. Invalid payloads and mismatched authority are counted as invalid requests and excluded from the completed-work failure rate. Unauthorized, disabled-backend and capability requests are handled by the HTTP metrics; they do not enter the quantum admission controller. An admitted invalid request still consumes the existing per-minute quota. Admissions are counted when a slot is acquired; completions are counted when it is released, so they need not match across window boundaries.

Successful jobs contribute measured compute-time histogram buckets and totals of qubits, gates and shots. These totals describe completed workload; they do not measure utilization or quantum speedup. The completion event's durationMs covers the admitted request, including body handling; computeDurationMs covers the simulator measurement. No circuits, principals, objectives, request hashes or measurement contents enter the metrics. NUMINA_TELEMETRY_LOGS=false suppresses events while retaining private local counters. Logging failures are counted separately.

Capacity signals require 20 workload observations. At least 1% failed completed work calls for failure investigation; at least 5% concurrency rejections calls for a compute-capacity review; at least 5% rate rejections calls for a request-rate policy review. A compute p95 above 1000 ms requires at least 20 successful jobs. These are initial diagnostic thresholds, not measured guarantees. They do not automatically increase quotas, replica counts or spending.

Before changing fleet capacity, aggregate `numina.quantum-metric.v1` measurement events in the provider log pipeline, deduplicating instanceId + eventId. Merge compute histogram buckets or derive them from successful events; never average per-process percentiles. Correlate failures and latency with provider CPU and memory measurements. The process-local snapshot cannot determine a fleet replica count, and its in-flight gauges are not a measure of CPU utilization. Scaling a serving tier requires preserving the single canonical treasury and respecting both provider quotas and the intended fleet-wide request policy. A distributed quota must be enforced outside these per-process counters before treating the limit as global.

Vercel forwards the owner telemetry and measurement routes to the canonical application origin. Native apps and plugins that use these routes contribute to the same server measurements. Local SDK calls and external quantum drivers are not included in the canonical Worker snapshot; their event streams must be aggregated separately. Simulator measurements do not establish hardware execution.

The same simulator is packaged at **@numina/nusd-integration/quantum-backend**, exporting measureNuminaCircuit and numinaQuantumCapabilities. This module runs locally in the calling process; its presence does not establish a hosted connection. The packaged examples/quantum-measurement.mjs executes it and prints measured counts. The HTTP capability response establishes the responding deployment's state.

Import prepareQuantumJob and createQuantumAdapter from **@numina/nusd-integration/quantum**. The packaged example is examples/quantum.mjs. Preparation validates a bounded circuit and creates a SHA-256 digest of the normalized request. It does not run a simulator or a QPU.

Supported gates: H, X, Y, Z, S, T, RX, RY, RZ and CX; rotation angles are radians. Limits: 32 logical qubits, 2048 gates, 10000 shots and a unique subset of measured qubits. Provider hardware can impose stricter limits, topology, transpilation and shot constraints. The driver must apply those constraints.

optimizeQuantumJob(input, newJobId) removes adjacent exact inverse gates and zero-angle rotations before preparation. It preserves ideal circuit semantics and returns original and optimized gate counts with a new digest. It does not commute gates, transpile for hardware, estimate quantum advantage or claim a measured hardware speedup. Keep the new job ID distinct from the unoptimized request.

A host-supplied driver implements submit(request, {idempotencyKey}) and status(providerJobId), with a local authorize callback. No driver is bundled or configured. Credentials remain in the deployment host. P/A/O/I fields describe a request; they do not themselves authenticate its author. The host's authorize callback must check authenticated identity, permissions and spending policy before submission.

The adapter defaults to two concurrent submissions and retains at most 1000 job identities per process. Duplicate IDs with changed contents are rejected. Pending or ambiguous submissions are not automatically retried. This local guard is not a distributed transaction system: the provider driver must implement durable idempotency, deadlines, quota enforcement and reconciliation across restarts and hosts.

A provider job ID means the configured driver reported acceptance. SUCCEEDED is a reported state, not an independently verified quantum result or canonical FINAL proof. A hardware-backed capability requires actual provider access and evidence. The current build reports hardwareExecutionVerified=false and leaves treasury writes disabled.

## IBM Quantum connection

The canonical Worker owns IBM credentials and device discovery. Store `NUMINA_IBM_QUANTUM_API_KEY` and `NUMINA_IBM_QUANTUM_INSTANCE_CRN` as secrets in that environment. Optionally set `NUMINA_IBM_QUANTUM_BACKEND` to an allocated backend name. The CRN selects IBM's us-east or eu-de regional endpoint. Other hosts, apps, plugins and OS packages use the same canonical API; they do not receive copies of the provider credential or a separate treasury.

An owner-authenticated `GET /api/ops/v1/quantum/ibm/connection` reads configuration presence without contacting IBM. `POST` exchanges the configured API key for a temporary IAM token and reads the instance's hardware catalog. Cookie authentication also requires the canonical Origin header. The operation has an 18-second deadline, bounded response sizes, fixed IBM origins and no redirects. Responses exclude the key, IAM token, instance CRN and raw provider errors. A configured backend must be online; otherwise the default selection chooses an online backend with the smallest reported queue. A missing queue count sorts after known counts.

The connection response includes the observation time, selected backend, availability and duration. `providerApiAuthenticated` records a successful authenticated catalog read, and `connected` records observed access to an online backend. Neither field proves a circuit ran. `GET /api/ops/v1/telemetry` includes configuration under `quantum.ibm` without performing a provider request. For a local connection read, run `node scripts/connect-ibm-quantum.mjs` with the same variables supplied through the host's secret environment; the command prints only the sanitized connection result.

This module implements credential exchange and discovery, not a hardware submission driver. A circuit submitted through IBM Composer is a separate provider operation with its own job ID and result. Keep that receipt associated with the release privately; it does not mark the application deployed, establish continuous QPU usage, advance the canonical head or change treasury balances. Programmatic hardware submission remains subject to provider transpilation, durable idempotency and the host-driver boundary described above.

Provider references: [IBM Runtime REST API](https://quantum.cloud.ibm.com/docs/en/api/qiskit-runtime-rest) (pinned API version `2026-04-15`), [IBM REST setup](https://quantum.cloud.ibm.com/docs/en/guides/cloud-setup-rest-api), [Vercel tracing](https://vercel.com/docs/tracing/instrumentation), [Cloudflare Workers logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
