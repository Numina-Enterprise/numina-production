// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
import {controlActor, controlBody} from './control-http.js';
import {numinaQuantumCapabilities, NUMINA_QUANTUM_LIMITS, measureNuminaCircuit} from './quantum-backend.js';
let quantumActiveRequests = 0, quantumRateMinute = -1, quantumRateCount = 0;
export async function quantumHttp(req, env) {
  const headers = {'Content-Type':'application/json', 'Cache-Control':'private, no-store', Vary:'Cookie, Authorization'};
  const reply = (body,status=200,extra={}) => Response.json(body,{status,headers:{...headers,...extra}});
  let acquired = false;
  try {
    const actor = await controlActor(req,env);
    if (actor !== env.NUMINA_CONTROL_OWNER) return reply({error:'OWNER_VIEW_REQUIRED'},403);
    const path = new URL(req.url).pathname, capability = numinaQuantumCapabilities(env);
    if (path === '/api/ops/v1/quantum/capabilities') return req.method === 'GET'
      ? reply(capability) : reply({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET'});
    if (path !== '/api/ops/v1/quantum/measure') return reply({error:'NOT_FOUND'},404);
    if (req.method !== 'POST') return reply({error:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'});
    if (!capability.connected) return reply({error:'QUANTUM_SIMULATOR_DISABLED'},503);
    if (!req.headers.get('authorization') && req.headers.get('origin') !== new URL(req.url).origin) return reply({error:'ORIGIN_REQUIRED'},403);
    const minute = Math.floor(Date.now()/60000);
    if (minute !== quantumRateMinute) { quantumRateMinute=minute; quantumRateCount=0; }
    if (quantumActiveRequests >= NUMINA_QUANTUM_LIMITS.concurrentPerProcess ||
        quantumRateCount >= NUMINA_QUANTUM_LIMITS.requestsPerMinutePerProcess) return reply({error:'QUANTUM_CAPACITY_LIMIT'},429,{'Retry-After':'60'});
    quantumActiveRequests++; quantumRateCount++; acquired=true;
    const input = await controlBody(req);
    if (input.Principal !== actor || input.Authority !== 'NUMINA') return reply({error:'QUANTUM_AUTHORITY_MISMATCH'},403);
    const result = await measureNuminaCircuit(input);
    if (env.NUMINA_TELEMETRY_LOGS !== 'false') {
      try { console.log(JSON.stringify({schema:'numina.quantum-metric.v1',operation:'measure',outcome:'succeeded',
        durationMs:result.durationMs,activeJobs:quantumActiveRequests,qubits:result.qubits,gates:result.gates,
        shots:result.shots,provider:'numina-statevector',kind:'classical_simulator'})); } catch {}
    }
    return reply(result);
  } catch (error) {
    const allowed = new Set(['UNAUTHENTICATED','AUTHORITY_CONFIGURATION_MISSING','JSON_REQUIRED','EMPTY_BODY',
      'BODY_TOO_LARGE','BODY_TIMEOUT','CANONICAL_JSON_REQUIRED','INVALID_QUANTUM_JOB','UNSUPPORTED_QUANTUM_GATE','SIMULATOR_LIMIT_EXCEEDED']);
    const code = allowed.has(error.code) ? error.code : 'QUANTUM_SERVICE_UNAVAILABLE';
    const status = code === 'UNAUTHENTICATED' ? 401 : code === 'AUTHORITY_CONFIGURATION_MISSING' || code === 'QUANTUM_SERVICE_UNAVAILABLE' ? 503 : error.status ?? 400;
    return reply({error:code},status);
  } finally { if(acquired)quantumActiveRequests--; }
}
