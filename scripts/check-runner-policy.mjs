import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const policy = JSON.parse(readFileSync(resolve(root, 'config/numina-runners.json'), 'utf8'));
const workflowsDir = resolve(root, '.github/workflows');
const failures = [];

if (policy.identity !== 'NUMINA' || policy.runnerIdentity !== 'NUMINA' || policy.allRunnerIdentities !== 'NUMINA') {
  failures.push('All preserved runner identities must be NUMINA');
}
if (policy.invariants?.preserveAllCurrentRunners !== true) failures.push('Current runner preservation invariant must be enabled');
if (policy.invariants?.denyFutureRunners !== true) failures.push('Future runner denial invariant must be enabled');
if (policy.invariants?.denyRunnerTargetChanges !== true) failures.push('Runner target mutation denial invariant must be enabled');
if (policy.invariants?.allRunnersAreNumina !== true) failures.push('All runner identities must resolve to NUMINA');

const expected = policy.preservedRunners || {};
let declarations = 0;
for (const [workflow, expectedTargets] of Object.entries(expected)) {
  const path = resolve(root, workflow);
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch { failures.push(workflow + ' must remain present to preserve its runner footprint'); continue; }
  const actualTargets = [...text.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)]
    .map(match => match[1].trim().replace(/^['"]|['"]$/g, ''));
  declarations += actualTargets.length;
  if (JSON.stringify(actualTargets) !== JSON.stringify(expectedTargets)) {
    failures.push(workflow + ' runner declarations changed: expected ' + JSON.stringify(expectedTargets) + ' got ' + JSON.stringify(actualTargets));
  }
}

for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/i.test(name)).sort()) {
  const workflow = '.github/workflows/' + name;
  if (Object.prototype.hasOwnProperty.call(expected, workflow)) continue;
  const text = readFileSync(resolve(workflowsDir, name), 'utf8');
  const newTargets = [...text.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)];
  if (newTargets.length) failures.push(workflow + ' introduces future runner declaration(s)');
}

if (declarations !== policy.preservedDeclarationCount) {
  failures.push('Preserved runner declaration count changed: expected ' + policy.preservedDeclarationCount + ' got ' + declarations);
}
if (Object.keys(expected).length !== policy.preservedWorkflowCount) {
  failures.push('Preserved workflow count does not match runner policy');
}

if (failures.length) {
  for (const failure of failures) console.error('RUNNER_POLICY_VIOLATION ' + failure);
  process.exit(1);
}
console.log('NUMINA runners preserved: ' + declarations + ' runner declaration(s); future runners denied.');
