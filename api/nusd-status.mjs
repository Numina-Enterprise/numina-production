import {NUSD_POLICY} from '../src/nusd-http.js';

export default function handler(request, response) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Numina-Identity', 'NUMINA');
  response.setHeader('Allow', 'GET');
  if (request.method !== 'GET') {
    response.statusCode = 405;
    response.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
    return;
  }
  response.statusCode = 200;
  response.end(JSON.stringify(NUSD_POLICY));
}
