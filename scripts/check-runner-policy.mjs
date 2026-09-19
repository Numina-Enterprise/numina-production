import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const policy = JSON.parse(readFileSync(resolve(root, 'config/numina-runners.json'), 'utf8'));
const workflows = resolve(root, '.github/workflows');
const allowedExecution = new Set(Object.values(policy.execution || {}));
const failures = [];
let declarations = 0;

if (policy.identity !== 'NUMINA') failures.push('Runner policy identity must be NUMINA');
if (policy.runner?.identity !== 'NUMINA' || policy.runner?.name !== 'NUMINA') failures.push('Runner identity must be NUMINA');
if (policy.runner?.singular !== true || policy.runner?.count !== 1) failures.push('Runner model must contain exactly one singular NUMINA runner');
if (policy.runner?.selfHosted !== false) failures.push('NUMINA self-hosted execution is denied');
for (const [role, identity] of Object.entries(policy.roles || {})) if (identity !== 'NUMINA') failures.push(`${role} must resolve to NUMINA`);

for (const name of readdirSync(workflows).filter(name => /\.ya?ml$/i.test(name)).sort()) {
  const path = resolve(workflows, name);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/);
    if (!match) return;
    declarations += 1;
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    if (/self-hosted/i.test(value)) {
      failures.push(`${name}:${index + 1} self-hosted execution denied by NUMINA`);
      return;
    }
    if (!allowedExecution.has(value)) failures.push(`${name}:${index + 1} execution target "${value}" is outside NUMINA policy`);
  });
}

if (failures.length) {
  for (const failure of failures) console.error('RUNNER_POLICY_VIOLATION ' + failure);
  process.exit(1);
}
console.log(`NUMINA runner validated: singular identity NUMINA; ${declarations} platform execution declaration(s).`);
