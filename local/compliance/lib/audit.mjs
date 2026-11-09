// Append-only, hash-chained audit log (JSON Lines). Entries carry ids, states and hashes only, never PII.
import {appendFileSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson, sha256Hex, dataDir, ensureDir} from './util.mjs';

export const auditPath = (env = process.env) => join(ensureDir(dataDir(env)), 'audit.log.jsonl');
const GENESIS = '0'.repeat(64);

export function readAudit(env = process.env) {
  const p = auditPath(env);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const PII_KEYS = /name|email|address|dob|birth|tin|ein|phone|passport/i;

export function appendAudit(event, env = process.env, now = new Date()) {
  for (const k of Object.keys(event)) if (PII_KEYS.test(k)) throw new Error(`audit entries must not carry PII-like field "${k}"`);
  const entries = readAudit(env);
  const prev = entries.at(-1);
  const body = {seq: (prev?.seq ?? 0) + 1, at: now.toISOString(), prev: prev?.hash ?? GENESIS, ...event};
  const entry = {...body, hash: sha256Hex(canonicalJson(body))};
  appendFileSync(auditPath(env), JSON.stringify(entry) + '\n', {mode: 0o600});
  return entry;
}

/** Verify sequence numbers and the hash chain. */
export function verifyAudit(env = process.env) {
  const entries = readAudit(env);
  const problems = [];
  let prevHash = GENESIS;
  entries.forEach((e, i) => {
    const {hash, ...body} = e;
    if (e.seq !== i + 1) problems.push(`entry ${i + 1}: seq ${e.seq}`);
    if (e.prev !== prevHash) problems.push(`entry ${i + 1}: broken chain`);
    if (sha256Hex(canonicalJson(body)) !== hash) problems.push(`entry ${i + 1}: hash mismatch (edited)`);
    prevHash = hash;
  });
  return {valid: problems.length === 0, count: entries.length, problems, head: prevHash};
}
