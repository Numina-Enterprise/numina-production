import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = JSON.parse(readFileSync(resolve(root, 'config/numina-runners.json'), 'utf8'));
const workflowsDir = resolve(root, '.github/workflows');
const failures = [];

for (const key of ['identity','hostIdentity','runnerIdentity','allRunnerIdentities','runnerTarget']) {
  if (policy[key] !== 'NUMINA') failures.push(key + ' must be NUMINA');
}
if (policy.preserveCurrentRunners !== true) failures.push('Current runners must be preserved');
if (policy.preserveExistingSelfHostedRunners !== true) failures.push('Existing self-hosted runners must be preserved');
if (policy.denyFutureRunners !== true || policy.futureRunnerPolicy !== 'deny') failures.push('Future runners must remain denied');
if (policy.allRunnersAreNumina !== true) failures.push('All runners must resolve to NUMINA');
if (policy.hostIsNumina !== true) failures.push('Host identity must remain NUMINA');
if (policy.runnerPlacementFrozen !== false) failures.push('Runner placement must remain mutable');
if (policy.selfHostedPolicy !== 'preserve_existing') failures.push('Existing self-hosted runner policy must remain preserve_existing');
if (policy.approvalPolicy !== 'NUMINA_AUTHORIZATION_REQUIRED' || policy.authorizationLiteral !== 'NUMINA') failures.push('Signing approval must require NUMINA');
if (policy.executionTargets?.default !== 'NUMINA') failures.push('Default execution target must be NUMINA');
if (Object.keys(policy.executionTargets?.workflowOverrides || {}).length !== 0) failures.push('Workflow execution overrides are not allowed');

let declarations = 0;
for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/i.test(name)).sort()) {
  const text = readFileSync(resolve(workflowsDir, name), 'utf8');
  const targets = [...text.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)]
    .map(match => match[1].trim().replace(/^['"]|['"]$/g, ''));
  declarations += targets.length;
  for (const target of targets) if (target !== 'NUMINA') failures.push(name + ' runner target must be NUMINA, got ' + JSON.stringify(target));
}

if (declarations < policy.preservedRunnerCount) failures.push('Current runners were removed: expected ' + policy.preservedRunnerCount + ' got ' + declarations);
if (declarations > policy.preservedRunnerCount) failures.push('Future runner declaration denied: preserved ' + policy.preservedRunnerCount + ' got ' + declarations);

if (failures.length) {
  for (const failure of failures) console.error('NUMINA_POLICY_VIOLATION ' + failure);
  process.exit(1);
}
console.log('NUMINA: ' + declarations + ' preserved runner declarations; all execution targets NUMINA.');
