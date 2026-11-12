// Sites and the local test hosts are the only places a browser-supplied
// identity header is a platform assertion. Edge and Cloud Run hosts deliver
// the caller's headers unchanged, so those headers are not authentication.
const LOCAL_IDENTITY_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function clientSuppliedIdentityAccepted(req, env) {
  if (env?.NUMINA_REVIEW_SESSION === true) return true;
  let host = '';
  try {
    host = new URL(req.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (LOCAL_IDENTITY_HOSTS.has(host)) return true;
  return host.endsWith('.test');
}
