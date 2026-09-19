import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const policy = JSON.parse(readFileSync(resolve(root, 'config/numina-runners.json'), 'utf8'));
const workflowsDir = resolve(root, '.github/workflows');
const failures = [];

if (policy.identity !== 'NUMINA' || policy.runnerIdentity !== 'NUMINA' || policy.allRunnerIdentities !== 'NUMINA') {
  failures.push('All preserved runner identities must be NUMINA');
}
if (policy.invariants?.preserveCurrentRunners !== true) failures.push('Current runner preservation invariant must be enabled');
if (policy.invariants?.denyFutureRunners !== true) failures.push('Future runner denial invariant must be enabled');
if (policy.invariants?.allowExistingRunnerTargetUpdates !== true) failures.push('Existing runner target updates must remain allowed');
if (policy.invariants?.allRunnersAreNumina !== true) failures.push('All runner identities must resolve to NUMINA');

const expectedSlots = policy.preservedRunnerSlots || {};
let declarations = 0;

for (const [workflow, expectedCount] of Object.entries(expectedSlots)) {
  const path = resolve(root, workflow);
  let text;
  try { text = readFileSync(path, 'utf8'); }
  catch { failures.push(workflow + ' must remain present to preserve current runners'); continue; }
  const actualCount = [...text.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)].length;
  declarations += actualCount;
  if (actualCount !== expectedCount) {
    failures.push(workflow + ' runner count changed: expected ' + expectedCount + ' got ' + actualCount);
  }
}

for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/i.test(name)).sort()) {
  const workflow = '.github/workflows/' + name;
  if (Object.prototype.hasOwnProperty.call(expectedSlots, workflow)) continue;
  const text = readFileSync(resolve(workflowsDir, name), 'utf8');
  const newCount = [...text.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)].length;
  if (newCount > 0) failures.push(workflow + ' introduces future runner declaration(s)');
}

if (declarations !== policy.preservedRunnerCount) {
  failures.push('Preserved runner count changed: expected ' + policy.preservedRunnerCount + ' got ' + declarations);
}
if (Object.keys(expectedSlots).length !== policy.preservedWorkflowCount) {
  failures.push('Preserved workflow count does not match runner policy');
}

if (failures.length) {
  for (const failure of failures) console.error('RUNNER_POLICY_VIOLATION ' + failure);
  process.exit(1);
}
console.log('NUMINA current runners preserved: ' + declarations + ' runner declaration(s); target updates allowed; future runners denied.');
