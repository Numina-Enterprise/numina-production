// Static checks for the shipped local service configs (Watchman, Docassemble, Probo, Comp AI) and the
// checklist / GRC mapping. Pure file reads; no Docker, no network.
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {MODULE_ROOT, REPO_ROOT} from './util.mjs';
import {loadChecklist, renderChecklist} from './checklist.mjs';

export const COMPOSE_FILES = ['watchman/docker-compose.yml', 'docassemble/docker-compose.yml', 'grc/probo/compose.yaml', 'grc/comp-ai/docker-compose.yml'];

/** Line-based scan of a compose file: every published port must be 127.0.0.1-bound; no host networking. */
export function composeFindings(text, file = '') {
  const out = [];
  const lines = text.split(/\r?\n/);
  let inPorts = -1;
  lines.forEach((raw, n) => {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) return;
    const indent = line.match(/^ */)[0].length;
    if (/^\s*network_mode:\s*["']?host/.test(line)) out.push({file, line: n + 1, issue: 'host networking'});
    if (/^\s*privileged:\s*true/.test(line)) out.push({file, line: n + 1, issue: 'privileged container'});
    if (/^\s*ports:\s*$/.test(line)) { inPorts = indent; return; }
    if (inPorts >= 0) {
      const m = line.match(/^\s*-\s*["']?([^"'\s]+)["']?\s*$/);
      if (m && indent >= inPorts) { if (!/^127\.0\.0\.1:\d+:\d+(\/(tcp|udp))?$/.test(m[1])) out.push({file, line: n + 1, issue: `port not bound to 127.0.0.1: ${m[1]}`}); return; }
      if (indent <= inPorts) inPorts = -1;
      else if (/^\s*(target|published|host_ip):/.test(line)) out.push({file, line: n + 1, issue: 'long-form port syntax not allowed (use "127.0.0.1:H:C")'});
    }
    if (/^\s*ports:\s*\[/.test(line) && !/^\s*ports:\s*\[\s*("127\.0\.0\.1:[^"]+"\s*,?\s*)*\]/.test(line)) out.push({file, line: n + 1, issue: 'inline ports not bound to 127.0.0.1'});
  });
  if (/opensanctions|yente/i.test(text)) out.push({file, issue: 'OpenSanctions/yente referenced (excluded)'});
  return out;
}

export function checkComposeFiles(root = MODULE_ROOT) {
  const findings = [];
  for (const f of COMPOSE_FILES) {
    const p = join(root, f);
    if (!existsSync(p)) { findings.push({file: f, issue: 'missing'}); continue; }
    findings.push(...composeFindings(readFileSync(p, 'utf8'), f));
  }
  const wm = readFileSync(join(root, 'watchman', 'watchman.yml'), 'utf8');
  if (!/Bind(Address)?:\s*["']?127\.0\.0\.1:/.test(wm)) findings.push({file: 'watchman/watchman.yml', issue: 'HTTP bind is not 127.0.0.1'});
  return findings;
}

/** Checklist <-> GRC mapping <-> module consistency. */
export function checkChecklistAndMapping({root = MODULE_ROOT, repoRoot = REPO_ROOT} = {}) {
  const issues = [];
  const cl = loadChecklist(join(root, 'checklist.json'));
  const ids = new Set(cl.items.map((i) => i.id));
  if (ids.size !== cl.items.length) issues.push('duplicate checklist ids');
  const md = readFileSync(join(root, 'CHECKLIST.md'), 'utf8');
  if (md.replace(/\r\n/g, '\n') !== renderChecklist(cl)) issues.push('CHECKLIST.md is out of date: run `npm run compliance -- checklist --out local/compliance/CHECKLIST.md`');
  for (const i of cl.items.filter((x) => x.control === 'automated')) {
    const mod = i.check.match(/^([a-z-]+)\./)?.[1];
    if (mod && !['aml', 'kyc-schema', 'risk', 'workflow', 'screen', 'lists', 'merchant-rules', 'idv-provider', 'watchman', 'store', 'signoff-core'].includes(mod)) issues.push(`${i.id}: unknown module ${mod}`);
    if (mod && !existsSync(join(root, 'lib', `${mod}.mjs`))) issues.push(`${i.id}: lib/${mod}.mjs missing`);
  }
  const map = JSON.parse(readFileSync(join(root, 'grc', 'control-mapping.json'), 'utf8'));
  const ctl = new Set(map.controls.map((c) => c.id));
  for (const r of map.risks) for (const c of r.controls) if (!ctl.has(c)) issues.push(`${r.id}: unknown control ${c}`);
  const used = new Set(map.risks.flatMap((r) => r.controls));
  for (const c of map.controls) {
    if (!used.has(c.id)) issues.push(`${c.id}: not linked to any risk`);
    for (const x of c.checklist) if (!ids.has(x)) issues.push(`${c.id}: unknown checklist item ${x}`);
    if (!c.evidence?.length) issues.push(`${c.id}: no evidence`);
    for (const e of c.evidence ?? []) {
      if (!/^(cmd|file|url):/.test(e)) issues.push(`${c.id}: bad evidence ${e}`);
      if (e.startsWith('file:') && !e.includes('/data/') && !existsSync(join(repoRoot, e.slice(5)))) issues.push(`${c.id}: evidence file missing ${e.slice(5)}`);
    }
  }
  const covered = new Set(map.controls.flatMap((c) => c.checklist));
  for (const i of ids) if (!covered.has(i)) issues.push(`checklist ${i} not mapped to any control`);
  return {issues, items: cl.items.length, risks: map.risks.length, controls: map.controls.length};
}
