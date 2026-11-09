// AES-256-GCM encryption at rest for local compliance records (node:crypto only).
import {createCipheriv, createDecipheriv, randomBytes, createHash} from 'node:crypto';
import {readFileSync, writeFileSync, renameSync, existsSync} from 'node:fs';

export const KEY_ENV = 'NUMINA_COMPLIANCE_KEY';

/** Parse a 32-byte key from base64 (44 chars) or hex (64 chars). */
export function parseKey(raw) {
  const s = String(raw ?? '').trim();
  if (!s) throw new Error(`${KEY_ENV} is not set. Generate one with: npm run compliance -- keygen-data-key (store it in your password manager, never in the repo).`);
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(s)) key = Buffer.from(s, 'hex');
  else { key = Buffer.from(s, 'base64'); if (key.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) key = null; }
  if (!key || key.length !== 32) throw new Error(`${KEY_ENV} must be 32 bytes as base64 or 64 hex characters`);
  return key;
}
export const keyFromEnv = (env = process.env) => parseKey(env[KEY_ENV]);
export const keyId = (key) => createHash('sha256').update(key).digest('hex').slice(0, 16);
export const generateKey = () => randomBytes(32).toString('base64');

export function encryptJson(value, key, aad = '') {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
  return {v: 1, alg: 'AES-256-GCM', kid: keyId(key), aad: String(aad), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64')};
}

export function decryptJson(envelope, key, aad = envelope?.aad ?? '') {
  if (envelope?.v !== 1 || envelope.alg !== 'AES-256-GCM') throw new Error('unsupported envelope');
  if (envelope.kid !== keyId(key)) throw new Error('record was encrypted with a different key (kid mismatch)');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(envelope.ct, 'base64')), d.final()]).toString('utf8'));
}

export function writeEncrypted(path, value, key, aad) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(encryptJson(value, key, aad)), {mode: 0o600});
  renameSync(tmp, path);
}
export function readEncrypted(path, key, aad) {
  if (!existsSync(path)) return null;
  const env = JSON.parse(readFileSync(path, 'utf8'));
  if (aad !== undefined && env.aad !== String(aad)) throw new Error('record AAD mismatch (file renamed or swapped?)');
  return decryptJson(env, key, aad ?? env.aad);
}
