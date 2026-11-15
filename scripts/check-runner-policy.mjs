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
if (policy.rules?.preserveCurrentRunners !== true) failures.push('Current runners must be preserved');
if (policy.rules?.preserveExistingSelfHostedRunners !== false) failures.push('Self-hosted runner execution must not be preserved');
if (policy.rules?.preserveExistingSelfHostedRunnerRegistrations !== true) failures.push('Existing self-hosted registration records must be preserved as non-executing state');
if (policy.rules?.denySelfHostedRunnerExecution !== true || policy.rules?.denySelfHostedRunnerScheduling !== true) failures.push('Self-hosted runner execution and scheduling must remain denied');
if (policy.schema !== 'numina.runner-policy.v15' || policy.rules?.denyFutureRunners !== false || policy.futureRunnerPolicy !== 'explicit_allowlist_only') failures.push('New runner declarations require v15 explicit allowlist');
if (policy.rules?.allRunnersAreNumina !== true) failures.push('All runners must resolve to NUMINA');
if (policy.rules?.hostIsNumina !== true) failures.push('Host identity must remain NUMINA');
if (policy.rules?.runnerPlacementFrozen !== false) failures.push('Runner placement must not be frozen');
if (policy.rules?.floatingHostedLinuxLabelsDenied !== true) failures.push('Floating hosted Linux labels must be denied');
if (policy.selfHostedPolicy !== 'deny_execution_preserve_registration_records') failures.push('Self-hosted runner policy must deny execution while preserving registration records');
const executionTargets = policy.executionTargets;
const overrides = executionTargets?.workflowOverrides || {};
const targetSets = executionTargets?.workflowTargetSets || {};
const hostedLinuxPolicy = executionTargets?.hostedLinuxPolicy || {};
const deniedFloatingLabels = new Set(hostedLinuxPolicy.floatingLabelsDenied || []);
if (hostedLinuxPolicy.pinnedTarget !== 'ubuntu-24.04') failures.push('Hosted Linux execution must remain pinned to ubuntu-24.04');
if (!deniedFloatingLabels.has('ubuntu-latest')) failures.push('ubuntu-latest must remain denied before its Ubuntu 26 migration');
if (executionTargets?.default !== policy.runnerTarget) failures.push('Default execution target must remain NUMINA');
const usedOverrides = new Set();

const authorized = policy.authorizedNewWorkflows || {};
const approvedNames = new Set(Object.keys(authorized));
const seenApproved = new Set();
let declarations = 0;
for (const name of readdirSync(workflowsDir).filter(name => /\.ya?ml$/i.test(name)).sort()) {
  const text = readFileSync(resolve(workflowsDir, name), 'utf8');
  if (/\bself-hosted\b/i.test(text)) failures.push(name + ' contains a denied self-hosted runner reference');
  const targets = [...text.matchAll(/^\s*runs-on:\s*(.+?)\s*(?:#.*)?$/gm)]
    .map(match => match[1].trim().replace(/^['"]|['"]$/g, ''));
  declarations += targets.length;
  if (approvedNames.has(name)) {
    seenApproved.add(name);
    const approved = authorized[name];
    if (!approved || !Array.isArray(approved.targets) || !approved.purpose || JSON.stringify(targets) !== JSON.stringify(approved.targets)) failures.push(name + ' does not match explicitly authorized runner targets');
    if (targets.some(t => t !== 'ubuntu-24.04' && t !== 'macos-latest')) failures.push(name + ' has unauthorized substrate');
  }
  for (const target of targets) if (deniedFloatingLabels.has(target)) failures.push(name + ' uses denied floating runner label ' + target);
  const expectedSet = Object.hasOwn(targetSets,name) ? targetSets[name] : null;
  const expectedTarget = Object.hasOwn(overrides, name) ? overrides[name] : executionTargets?.default;
  if (Object.hasOwn(overrides, name) && targets.length) usedOverrides.add(name);
  if (expectedSet) {
    for (const expected of expectedSet) if (!['NUMINA','ubuntu-24.04','macos-latest'].includes(expected)) failures.push(name + ' has an unsupported execution target');
    const actualSorted=[...targets].sort(), expectedSorted=[...expectedSet].sort();
    if (JSON.stringify(actualSorted)!==JSON.stringify(expectedSorted)) failures.push(name + ' runner targets must match recorded target set ' + JSON.stringify(expectedSet) + ', got ' + JSON.stringify(targets));
  } else {
    if (!['NUMINA','ubuntu-24.04','macos-latest'].includes(expectedTarget)) failures.push(name + ' has an unsupported execution target');
    for (const target of targets) if (target !== expectedTarget) failures.push(name + ' runner target must match its recorded execution target ' + expectedTarget + ', got ' + JSON.stringify(target));
  }
}
for (const name of Object.keys(overrides)) if (!usedOverrides.has(name)) failures.push('Execution override has no preserved workflow job: ' + name);
for (const name of Object.keys(targetSets)) if (!readdirSync(workflowsDir).includes(name)) failures.push('Execution target set has no preserved workflow: ' + name);

if (declarations < policy.preservedRunnerCount) {
  failures.push('Current runners were removed: expected ' + policy.preservedRunnerCount + ' got ' + declarations);
}
for (const name of approvedNames) if (!seenApproved.has(name)) failures.push('Authorized workflow absent: ' + name);
const authorizedCount = Object.values(authorized).reduce((n, a) => n + (Array.isArray(a.targets) ? a.targets.length : 0), 0);
if (declarations !== policy.preservedRunnerCount + authorizedCount) failures.push('Runner count does not match baseline plus authorized additions: expected ' + (policy.preservedRunnerCount + authorizedCount) + ' got ' + declarations);

if (failures.length) {
  for (const failure of failures) console.error('RUNNER_POLICY_VIOLATION ' + failure);
  process.exit(1);
}
console.log('NUMINA runner policy verified: ' + declarations + ' preserved hosted declarations; self-hosted execution denied; new runner declarations explicitly allowlisted.');
