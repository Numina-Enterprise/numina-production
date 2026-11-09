// Shared helpers for the local-only compliance module. Node built-ins only.
import {createHash, randomBytes} from 'node:crypto';
import {readFileSync, existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';

export const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(MODULE_ROOT, '..', '..');

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
export const newId = (prefix) => `${prefix}_${randomBytes(8).toString('hex')}`;

export function dataDir(env = process.env) {
  return resolve(env.NUMINA_COMPLIANCE_DATA_DIR || join(MODULE_ROOT, 'data'));
}
export function ensureDir(p) { mkdirSync(p, {recursive: true}); return p; }

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = {...base};
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** Defaults from config.default.json, overridden by <dataDir>/config.json, then by an explicit object. */
export function loadConfig(overrides = {}, env = process.env) {
  const base = JSON.parse(readFileSync(join(MODULE_ROOT, 'config.default.json'), 'utf8'));
  const localPath = join(dataDir(env), 'config.json');
  const local = existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : {};
  return deepMerge(deepMerge(base, local), overrides);
}

export const DAY_MS = 86_400_000;
export const round4 = (x) => Math.round(x * 10000) / 10000;
