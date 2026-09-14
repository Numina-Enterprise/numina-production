// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
// Portable quantum job boundary; credentials and provider SDKs belong to the host.
const QUANTUM_LIMITS = Object.freeze({qubits: 32, gates: 2048, shots: 10000, retainedJobs: 1000});
const quantumObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function quantumFail(code) { throw Object.assign(new Error(code), {code}); }
function quantumFields(value, allowed) {
  if (!quantumObject(value) || Object.keys(value).some(key => !allowed.includes(key))) quantumFail('INVALID_QUANTUM_JOB');
}
function quantumText(value, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) quantumFail('INVALID_QUANTUM_JOB');
  return value;
}
function freezeQuantum(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeQuantum); Object.freeze(value); }
  return value;
}
export async function prepareQuantumJob(input) {
  quantumFields(input, ['id', 'Principal', 'Authority', 'Objective', 'Intent']);
  const id = quantumText(input.id, 128);
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) quantumFail('INVALID_QUANTUM_JOB');
  const Principal = quantumText(input.Principal), Authority = quantumText(input.Authority);
  const Objective = quantumText(input.Objective, 1024), intent = input.Intent;
  quantumFields(intent, ['qubits', 'shots', 'gates', 'measure']);
  const {qubits, shots} = intent;
  if (!Number.isInteger(qubits) || qubits < 1 || qubits > QUANTUM_LIMITS.qubits ||
      !Number.isInteger(shots) || shots < 1 || shots > QUANTUM_LIMITS.shots ||
      !Array.isArray(intent.gates) || intent.gates.length > QUANTUM_LIMITS.gates) quantumFail('INVALID_QUANTUM_JOB');
  const qubit = value => {
    if (!Number.isInteger(value) || value < 0 || value >= qubits) quantumFail('INVALID_QUANTUM_JOB');
    return value;
  };
  const gates = intent.gates.map(gate => {
    quantumFields(gate, ['gate', 'target', 'control', 'angle']);
    if (!['H', 'X', 'Y', 'Z', 'S', 'T', 'RX', 'RY', 'RZ', 'CX'].includes(gate.gate)) quantumFail('UNSUPPORTED_QUANTUM_GATE');
    const item = {gate: gate.gate, target: qubit(gate.target)};
    if (gate.gate === 'CX') {
      item.control = qubit(gate.control);
      if (item.control === item.target || Object.hasOwn(gate, 'angle')) quantumFail('INVALID_QUANTUM_JOB');
    } else if (Object.hasOwn(gate, 'control')) quantumFail('INVALID_QUANTUM_JOB');
    if (['RX', 'RY', 'RZ'].includes(gate.gate)) {
      if (!Number.isFinite(gate.angle) || Math.abs(gate.angle) > 2 * Math.PI) quantumFail('INVALID_QUANTUM_JOB');
      item.angle = gate.angle;
    } else if (Object.hasOwn(gate, 'angle')) quantumFail('INVALID_QUANTUM_JOB');
    return item;
  });
  if (!Array.isArray(intent.measure) || !intent.measure.length || intent.measure.length > qubits) quantumFail('INVALID_QUANTUM_JOB');
  const measure = intent.measure.map(qubit);
  if (new Set(measure).size !== measure.length) quantumFail('INVALID_QUANTUM_JOB');
  const request = {schema: 'numina.quantum-job.v1', id, Principal, Authority, Objective,
    Intent: {qubits, shots, gates, measure}};
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(request)));
  const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return freezeQuantum({request, sha256, status: 'PREPARED', submitted: false, hardwareExecutionVerified: false});
}
// Only adjacent identities are simplified; no backend topology or noise claims.
export async function optimizeQuantumJob(input, optimizedId) {
  const original = await prepareQuantumJob(input), gates = [];
  if (optimizedId === input.id) quantumFail('OPTIMIZED_JOB_REQUIRES_NEW_ID');
  for (const item of original.request.Intent.gates) {
    let gate = {...item};
    if (['RX', 'RY', 'RZ'].includes(gate.gate) && gate.angle === 0) continue;
    const previous = gates.at(-1);
    if (previous && previous.gate === gate.gate && previous.target === gate.target && previous.control === gate.control) {
      if (['H', 'X', 'Y', 'Z', 'CX'].includes(gate.gate)) { gates.pop(); continue; }
      if (['RX', 'RY', 'RZ'].includes(gate.gate) && previous.angle === -gate.angle) { gates.pop(); continue; }
    }
    gates.push(gate);
  }
  const {schema, ...request} = original.request;
  const job = await prepareQuantumJob({...request, id: optimizedId,
    Intent: {...original.request.Intent, gates}});
  return {job, originalSha256: original.sha256, originalGateCount: original.request.Intent.gates.length,
    optimizedGateCount: gates.length, removedGates: original.request.Intent.gates.length - gates.length,
    scope: 'adjacent_exact_inverse_gates_in_ideal_circuit', hardwareSpeedupMeasured: false};
}
export function createQuantumAdapter({driver = null, authorize = null, maxConcurrent = 2,
  emit = () => {}, clock = () => performance.now()} = {}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) quantumFail('INVALID_QUANTUM_CONCURRENCY');
  if (driver !== null && (!quantumObject(driver) || typeof driver.submit !== 'function' ||
      typeof driver.status !== 'function' || !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(driver.name))) quantumFail('INVALID_QUANTUM_DRIVER');
  const jobs = new Map();
  let active = 0;
  function event(operation, started, outcome, job) {
    try { emit({schema: 'numina.quantum-metric.v1', operation, outcome,
      durationMs: Math.max(0, clock() - started), activeJobs: active,
      qubits: job?.request.Intent.qubits ?? null, gates: job?.request.Intent.gates.length ?? null,
      shots: job?.request.Intent.shots ?? null, provider: driver?.name ?? null}); } catch {}
  }
  return {
    capabilities() { return {schema: 'numina.quantum-capabilities.v1', backendConfigured: driver !== null,
      provider: driver?.name ?? null, mode: 'provider_neutral', hardwareExecutionVerified: false,
      submissionRequiresHostAuthorization: true, limits: {...QUANTUM_LIMITS, maxConcurrent},
      scope: 'local_driver_boundary', treasuryWrites: false}; },
    prepare: prepareQuantumJob,
    async submit(input) {
      const started = clock(), job = await prepareQuantumJob(input);
      if (!driver) { event('submit', started, 'backend_not_configured', job); quantumFail('QUANTUM_BACKEND_NOT_CONFIGURED'); }
      if (typeof authorize !== 'function' || await authorize(job) !== true) {
        event('submit', started, 'authorization_denied', job); quantumFail('QUANTUM_AUTHORIZATION_REQUIRED');
      }
      // Recheck after awaiting authorization: concurrent calls cannot submit the same ID twice.
      const old = jobs.get(job.request.id);
      if (old) {
        if (old.sha256 !== job.sha256) quantumFail('QUANTUM_JOB_ID_CONFLICT');
        if (old.result) return old.result;
        quantumFail(old.unknown ? 'QUANTUM_SUBMISSION_OUTCOME_UNKNOWN' : 'QUANTUM_JOB_IN_FLIGHT');
      }
      if (active >= maxConcurrent) { event('submit', started, 'capacity_limited', job); quantumFail('QUANTUM_CAPACITY_LIMIT'); }
      if (jobs.size >= QUANTUM_LIMITS.retainedJobs) quantumFail('QUANTUM_JOB_LEDGER_FULL');
      const record = {sha256: job.sha256, result: null, unknown: false};
      jobs.set(job.request.id, record); active++;
      try {
        // The provider driver must enforce durable idempotency with this key across hosts/restarts.
        const accepted = await driver.submit(job.request, {idempotencyKey: job.sha256});
        if (!quantumObject(accepted) || typeof accepted.jobId !== 'string' ||
            !/^[A-Za-z0-9._:/-]{1,256}$/.test(accepted.jobId)) quantumFail('INVALID_QUANTUM_PROVIDER_RESPONSE');
        record.result = freezeQuantum({schema: 'numina.quantum-submission.v1', id: job.request.id,
          requestSha256: job.sha256, provider: driver.name, providerJobId: accepted.jobId,
          status: 'SUBMITTED', submitted: true, hardwareExecutionVerified: false,
          providerAcceptance: 'reported_by_configured_driver', canonicalFinalCommitted: false});
        event('submit', started, 'submitted', job);
        return record.result;
      } catch {
        // Provider timeouts may occur after acceptance. Do not automatically resubmit.
        record.unknown = true; event('submit', started, 'outcome_unknown', job);
        quantumFail('QUANTUM_SUBMISSION_OUTCOME_UNKNOWN');
      } finally { active--; }
    },
    async status(id) {
      const record = jobs.get(id);
      if (!driver || !record?.result) quantumFail('QUANTUM_JOB_NOT_SUBMITTED');
      if (typeof authorize !== 'function' || await authorize(record.result) !== true) quantumFail('QUANTUM_AUTHORIZATION_REQUIRED');
      const started = clock();
      try {
        const observed = await driver.status(record.result.providerJobId);
        if (!quantumObject(observed) || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(observed.status)) quantumFail('INVALID_QUANTUM_PROVIDER_RESPONSE');
        event('status', started, observed.status.toLowerCase());
        return {...record.result, status: observed.status, observedAt: new Date().toISOString(),
          resultVerified: false, hardwareExecutionVerified: false};
      } catch { event('status', started, 'unavailable'); quantumFail('QUANTUM_STATUS_UNAVAILABLE'); }
    }
  };
}
