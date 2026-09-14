// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
import {controlActor, controlBody} from './control-http.js';
import {numinaQuantumCapabilities, measureNuminaCircuit} from './quantum-backend.js';
import {numinaQuantumWorkload} from './quantum-telemetry.js';
import {ibmQuantumConfiguration,connectIBMQuantum} from './ibm-quantum.js';
export async function quantumHttp(req, env) {
  const headers = {'Content-Type':'application/json', 'Cache-Control':'private, no-store', Vary:'Cookie, Authorization'};
  const reply = (body,status=200,extra={}) => Response.json(body,{status,headers:{...headers,...extra}});
  let admission, outcome='service_unavailable', measurement;
  try {
    const actor = await controlActor(req,env);
    if (actor !== env.NUMINA_CONTROL_OWNER) return reply({error:'OWNER_VIEW_REQUIRED'},403);
    const path = new URL(req.url).pathname, capability = numinaQuantumCapabilities(env);
    if(path==='/api/ops/v1/quantum/ibm/connection') {
      if(req.method==='GET')return reply(ibmQuantumConfiguration(env));
      if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET, POST'});
      if(!req.headers.get('authorization')&&req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'ORIGIN_REQUIRED'},403);
      return reply(await connectIBMQuantum(env));
    }
    if (path === '/api/ops/v1/quantum/capabilities') return req.method === 'GET'
      ? reply(capability) : reply({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET'});
    if (path !== '/api/ops/v1/quantum/measure') return reply({error:'NOT_FOUND'},404);
    if (req.method !== 'POST') return reply({error:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'});
    if (!capability.connected) return reply({error:'QUANTUM_SIMULATOR_DISABLED'},503);
    if (!req.headers.get('authorization') && req.headers.get('origin') !== new URL(req.url).origin) return reply({error:'ORIGIN_REQUIRED'},403);
    admission=numinaQuantumWorkload.begin({log:env.NUMINA_TELEMETRY_LOGS!=='false'});
    if(!admission.admitted)return reply({error:'QUANTUM_CAPACITY_LIMIT',reason:admission.reason},429,{'Retry-After':String(admission.retryAfterSeconds)});
    const input = await controlBody(req);
    if (input.Principal !== actor || input.Authority !== 'NUMINA') {outcome='invalid_request';return reply({error:'QUANTUM_AUTHORITY_MISMATCH'},403);}
    measurement=await measureNuminaCircuit(input);
    const response=reply(measurement);outcome='succeeded';return response;
  } catch (error) {
    const allowed = new Set(['UNAUTHENTICATED','AUTHORITY_CONFIGURATION_MISSING','JSON_REQUIRED','EMPTY_BODY',
      'BODY_TOO_LARGE','BODY_TIMEOUT','CANONICAL_JSON_REQUIRED','INVALID_QUANTUM_JOB','UNSUPPORTED_QUANTUM_GATE','SIMULATOR_LIMIT_EXCEEDED']);
    const code = allowed.has(error.code) ? error.code : 'QUANTUM_SERVICE_UNAVAILABLE';
    const status = code === 'UNAUTHENTICATED' ? 401 : code === 'AUTHORITY_CONFIGURATION_MISSING' || code === 'QUANTUM_SERVICE_UNAVAILABLE' ? 503 : error.status ?? 400;
    outcome=status>=500?'service_unavailable':'invalid_request';
    return reply({error:code},status);
  } finally { if(admission?.admitted)admission.finish(outcome,measurement); }
}
