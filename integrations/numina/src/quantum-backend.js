// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
import {prepareQuantumJob} from './quantum.js';
export const NUMINA_QUANTUM_LIMITS = Object.freeze({qubits: 8, gates: 256, shots: 4096, concurrentPerProcess: 2, requestsPerMinutePerProcess: 30});
export function numinaQuantumCapabilities(env = {}) {
  return {schema: 'numina.quantum-backend.v1', backend: 'numina-statevector', version: '4.0.0',
    connected: env.NUMINA_QUANTUM_SIMULATOR_ENABLED !== 'false', kind: 'classical_simulator',
    hardwareConnected: false, quantumAdvantageMeasured: false, execution: 'synchronous',
    endpoint: '/api/ops/v1/quantum/measure', measurement: 'computational_basis_sample_counts',
    limits: NUMINA_QUANTUM_LIMITS, treasuryWrites: false};
}
function quantumMatrix(gate) {
  const c = Math.cos((gate.angle ?? 0) / 2), s = Math.sin((gate.angle ?? 0) / 2), h = Math.SQRT1_2;
  // Row-major complex entries: real0, imag0, real1, imag1, ...
  return {H:[h,0,h,0,h,0,-h,0], X:[0,0,1,0,1,0,0,0], Y:[0,0,0,-1,0,1,0,0],
    Z:[1,0,0,0,0,0,-1,0], S:[1,0,0,0,0,0,0,1], T:[1,0,0,0,0,0,h,h],
    RX:[c,0,0,-s,0,-s,c,0], RY:[c,0,-s,0,s,0,c,0], RZ:[c,-s,0,0,0,0,c,s]}[gate.gate];
}
export async function measureNuminaCircuit(input) {
  const start = performance.now(), prepared = await prepareQuantumJob(input);
  const {qubits, gates, shots, measure} = prepared.request.Intent;
  if (qubits > NUMINA_QUANTUM_LIMITS.qubits || gates.length > NUMINA_QUANTUM_LIMITS.gates || shots > NUMINA_QUANTUM_LIMITS.shots) {
    throw Object.assign(new Error('SIMULATOR_LIMIT_EXCEEDED'), {code:'SIMULATOR_LIMIT_EXCEEDED', status:413});
  }
  const real = new Float64Array(1 << qubits), imag = new Float64Array(1 << qubits); real[0] = 1;
  for (const gate of gates) {
    const mask = 1 << gate.target;
    if (gate.gate === 'CX') {
      for (let i = 0; i < real.length; i++) if (!(i & mask) && (i & (1 << gate.control))) {
        const j = i | mask; [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]];
      }
      continue;
    }
    const m = quantumMatrix(gate);
    for (let i = 0; i < real.length; i++) if (!(i & mask)) {
      const j = i | mask, ar = real[i], ai = imag[i], br = real[j], bi = imag[j];
      real[i] = m[0]*ar - m[1]*ai + m[2]*br - m[3]*bi;
      imag[i] = m[0]*ai + m[1]*ar + m[2]*bi + m[3]*br;
      real[j] = m[4]*ar - m[5]*ai + m[6]*br - m[7]*bi;
      imag[j] = m[4]*ai + m[5]*ar + m[6]*bi + m[7]*br;
    }
  }
  const probabilities = new Float64Array(1 << measure.length);
  for (let i = 0; i < real.length; i++) {
    let outcome = 0;
    for (const bit of measure) outcome = (outcome << 1) | ((i >> bit) & 1);
    probabilities[outcome] += real[i]**2 + imag[i]**2;
  }
  const total = probabilities.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-9) throw Object.assign(new Error('SIMULATOR_STATE_INVALID'), {code:'SIMULATOR_STATE_INVALID'});
  const cdf = new Float64Array(probabilities.length), idealProbabilities = {};
  let cumulative = 0;
  for (let i = 0; i < probabilities.length; i++) {
    probabilities[i] /= total; cumulative += probabilities[i]; cdf[i] = cumulative;
    if (probabilities[i] > 0) idealProbabilities[i.toString(2).padStart(measure.length,'0')] = probabilities[i];
  }
  cdf[cdf.length - 1] = 1;
  const random = crypto.getRandomValues(new Uint32Array(shots)), counts = {};
  for (const sample of random) {
    const u = sample / 4294967296; let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (u >= cdf[mid]) lo = mid + 1; else hi = mid; }
    const label = lo.toString(2).padStart(measure.length,'0'); counts[label] = (counts[label] ?? 0) + 1;
  }
  return {schema:'numina.quantum-measurement.v1', measurementId:crypto.randomUUID(), requestSha256:prepared.sha256,
    observedAt:new Date().toISOString(), backend:'numina-statevector', backendVersion:'4.0.0', kind:'classical_simulator',
    qubits, gates:gates.length, shots, measuredQubits:measure, bitOrder:'measuredQubits_left_to_right',
    counts, idealProbabilities, durationMs:performance.now()-start, randomness:'Web_Crypto_uniform_uint32',
    hardwareExecution:false, quantumAdvantageMeasured:false, canonicalFinalCommitted:false, treasuryWrites:false};
}
