// Copyright © 2026 SK Consulting LLC. Numina™. See OWNERSHIP.md.
import {controlActor} from './control-http.js';
import {numinaWebTelemetry} from './telemetry.js';
import {numinaQuantumCapabilities} from './quantum-backend.js';
import {numinaQuantumWorkload} from './quantum-telemetry.js';
import {ibmQuantumConfiguration} from './ibm-quantum.js';
export async function telemetryHttp(req, env) {
  const headers = {'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Vary': 'Cookie, Authorization'};
  try {
    const actor = await controlActor(req, env);
    if (actor !== env.NUMINA_CONTROL_OWNER) return Response.json({error: 'OWNER_VIEW_REQUIRED'}, {status: 403, headers});
    if (req.method !== 'GET') return Response.json({error: 'METHOD_NOT_ALLOWED'}, {status: 405, headers: {...headers, Allow: 'GET'}});
    return Response.json({...numinaWebTelemetry.snapshot(), quantum:{...numinaQuantumCapabilities(env),workload:numinaQuantumWorkload.snapshot(),ibm:ibmQuantumConfiguration(env)}}, {headers});
  } catch (error) {
    const code = ['UNAUTHENTICATED', 'AUTHORITY_CONFIGURATION_MISSING'].includes(error.code) ? error.code : 'TELEMETRY_UNAVAILABLE';
    return Response.json({error: code}, {status: code === 'UNAUTHENTICATED' ? 401 : 503, headers});
  }
}
