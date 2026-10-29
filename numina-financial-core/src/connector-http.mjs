import https from 'node:https';

export function requestText(url, { method = 'GET', headers = {}, body, cert, key, timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = https.request(target, { method, headers, cert, key, timeout: timeoutMs }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('timeout', () => request.destroy(new Error('CONNECTOR_REQUEST_TIMEOUT')));
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

export async function requestJson(url, options = {}) {
  const response = await requestText(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
  const text = response.body.toString('utf8');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error(`CONNECTOR_JSON_INVALID:${response.status}`); }
  if (response.status < 200 || response.status >= 300) throw new Error(`CONNECTOR_HTTP_${response.status}`);
  return parsed;
}
