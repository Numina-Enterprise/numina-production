import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = JSON.parse(readFileSync(resolve(root, 'config/numina-runners.json'), 'utf8'));
const workflowsDir = resolve(root, '.github/workflows');
const failures = [];

if (policy.identity !== 'NUMINA' || policy.hostIdentity !== 'NUMINA' || policy.runnerIdentity !== 'NUMINA' || policy.allRunnerIdentities !== 'NUMINA' || policy.runnerTarget !== 'NUMINA') {
  failures.push('Host, runner identities and runner targets must be NUMINA');
}
if (policy.invariants?.preserveCurrentRunners !== true) failures.push('Current runners must be preserved');
if (policy.invariants?.preserveExistingSelfHostedRunners !== true) failures.push('Existing self-hosted runners must be preserved');
if (policy.invariants?.denyFutureRunners !== true || policy.futureRunnerPolicy !== 'deny') failures.push('Future runners must remain denied');
if (policy.invariants?.allRunnersAreNumina !== true) failures.push('All runners must resolve to NUMINA');
if (policy.invariants?.hostIsNumina !== true) failures.push('Host identity must remain NUMINA');
if (policy.invariants?.runnerPlacementFrozen !== false) failures.push('Runner placement must not be frozen');
if (policy.selfHostedPolicy !== 'preserve_existing') failures.push('Existing self-hosted runner policy must remain preserve_existing');
const executionTargets = policy.executionTargets;
const overrides = executionTargets?.workflowOverrides || {};
const targetSets = executionTargets?.workflowTargetSets || {};
if (executionTargets?.default !== policy.runnerTarget) failures.push('Default execution target must remain NUMINA');
const usedOverrides = new Set();

let declarations = 0;
for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/i.test(name)).sort()) {
  const text = readFileSync(resolve(workflowsDir, name), 'utf8');
  const targets = [...text.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)]
    .map(match => match[1].trim().replace(/^['"]|['"]$/g, ''));
  declarations += targets.length;
  const expectedSet = Object.hasOwn(targetSets,name) ? targetSets[name] : null;
  const expectedTarget = Object.hasOwn(overrides, name) ? overrides[name] : executionTargets?.default;
  if (Object.hasOwn(overrides, name) && targets.length) usedOverrides.add(name);
  if (expectedSet) {
    for (const expected of expectedSet) if (!['NUMINA','ubuntu-latest','ubuntu-24.04','macos-latest'].includes(expected)) failures.push(name + ' has an unsupported execution target');
    const actualSorted=[...targets].sort(), expectedSorted=[...expectedSet].sort();
    if (JSON.stringify(actualSorted)!==JSON.stringify(expectedSorted)) failures.push(name + ' runner targets must match recorded target set ' + JSON.stringify(expectedSet) + ', got ' + JSON.stringify(targets));
  } else {
    if (!['NUMINA','ubuntu-latest','ubuntu-24.04','macos-latest'].includes(expectedTarget)) failures.push(name + ' has an unsupported execution target');
    for (const target of targets) if (target !== expectedTarget) failures.push(name + ' runner target must match its recorded execution target ' + expectedTarget + ', got ' + JSON.stringify(target));
  }
}
for (const name of Object.keys(overrides)) if (!usedOverrides.has(name)) failures.push('Execution override has no preserved workflow job: ' + name);
for (const name of Object.keys(targetSets)) if (!readdirSync(workflowsDir).includes(name)) failures.push('Execution target set has no preserved workflow: ' + name);

if (declarations < policy.preservedRunnerCount) {
  failures.push('Current runners were removed: expected ' + policy.preservedRunnerCount + ' got ' + declarations);
}
if (declarations > policy.preservedRunnerCount) {
  failures.push('Future runner declaration denied: preserved ' + policy.preservedRunnerCount + ' got ' + declarations);
}

if (failures.length) {
  for (const failure of failures) console.error('RUNNER_POLICY_VIOLATION ' + failure);
  process.exit(1);
}
console.log('NUMINA runners preserved: ' + declarations + '; placement mutable; future runners denied.');
