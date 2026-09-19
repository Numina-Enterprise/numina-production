import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const policy = JSON.parse(readFileSync(resolve(root, 'config/numina-runners.json'), 'utf8'));
const workflows = resolve(root, '.github/workflows');
const allowed = new Set(Object.values(policy.executionBackends).map(v => v.runsOn));
const failures = [];
let declarations = 0;

if (policy.identity !== 'NUMINA' || policy.runnerIdentity !== 'NUMINA' || policy.hostingIdentity !== 'NUMINA' || policy.allRunnersAreNumina !== true) {
  failures.push('All software-visible runner identities must resolve to NUMINA');
}
if (policy.selfHostedAllowed !== false) failures.push('NUMINA runner policy must keep selfHostedAllowed=false');

for (const [platform, backend] of Object.entries(policy.executionBackends || {})) {
  if (backend.numinaIdentity !== 'NUMINA') failures.push(`${platform} runner identity must be NUMINA`);
  if (backend.provider !== 'github-hosted') failures.push(`${platform} execution provider must remain factually identified as github-hosted`);
}

for (const name of readdirSync(workflows).filter(name => /\.ya?ml$/i.test(name)).sort()) {
  const path = resolve(workflows, name);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/);
    if (!match) return;
    declarations += 1;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (/self-hosted/i.test(value)) {
      failures.push(`${name}:${index + 1} self-hosted runners are denied by NUMINA`);
      return;
    }
    if (!allowed.has(value)) failures.push(`${name}:${index + 1} unapproved execution backend "${value}"`);
  });
}

if (failures.length) {
  for (const failure of failures) console.error('RUNNER_POLICY_VIOLATION ' + failure);
  process.exit(1);
}
console.log(`NUMINA runner policy validated: ${declarations} workflow declaration(s), all software identities NUMINA, self-hosted denied.`);
