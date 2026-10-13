import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const policy = JSON.parse(readFileSync(resolve(root, 'config/numina-runners.json'), 'utf8'));
const workflowsDir = resolve(root, '.github/workflows');
const failures = [];

if (policy.preservedRunnerCount !== 34) failures.push('Preserved local runner declaration count must remain the integer 34');
if (policy.identity !== 'NUMINA' || policy.hostIdentity !== 'NUMINA' || policy.runnerIdentity !== 'NUMINA' || policy.allRunnerIdentities !== 'NUMINA') {
  failures.push('Logical host and runner identities must be NUMINA');
}
if (policy.rules?.preserveCurrentRunners !== true) failures.push('Current runners must be preserved');
if (policy.rules?.preserveExistingSelfHostedRunners !== false) failures.push('Self-hosted runner execution must not be preserved');
if (policy.rules?.preserveExistingSelfHostedRunnerRegistrations !== true) failures.push('Existing self-hosted registration records must be preserved as non-executing state');
if (policy.rules?.denySelfHostedRunnerExecution !== true || policy.rules?.denySelfHostedRunnerScheduling !== true) failures.push('Self-hosted runner execution and scheduling must remain denied');
if (policy.rules?.denyFutureRunners !== true || policy.futureRunnerPolicy !== 'deny') failures.push('Future runners must remain denied');
if (policy.rules?.allRunnersAreNumina !== true) failures.push('All runners must resolve to NUMINA');
if (policy.rules?.hostIsNumina !== true) failures.push('Host identity must remain NUMINA');
if (policy.rules?.runnerPlacementFrozen !== false) failures.push('Runner placement must not be frozen');
if (policy.rules?.floatingHostedLinuxLabelsDenied !== true) failures.push('Floating hosted Linux labels must be denied');
if (policy.selfHostedPolicy !== 'deny_execution_preserve_registration_records') failures.push('Self-hosted runner policy must deny execution while preserving registration records');
const executionTargets = policy.executionTargets;
const overrides = executionTargets?.workflowOverrides || {};
const targetSets = executionTargets?.workflowTargetSets || {};
const hostedLinuxPolicy = executionTargets?.hostedLinuxPolicy || {};
const approvedHostedLabels = new Set(['ubuntu-24.04', 'macos-latest']);
const requiredDisabledJobs = {
  'numina-ios-branch-build.yml': ['ios'],
  'numina-native-packages.yml': ['android', 'ios'],
  'probe-numina-runtime-auth.yml': ['probe'],
  'rebuild-nusd-artifacts.yml': ['rebuild'],
  'settle-numina-aggregate-model.yml': ['settle']
};
const disabledJobs = executionTargets?.disabledJobs || {};
const approvedReusableWorkflowCalls = {
  'historical-numina-rc26-verifier.yml': {
    'build-and-attest': 'skott34-dot/numina-builder/.github/workflows/numina-rc26-verifier-builder.yml@f85e9428fa8bf0371931429479f31b0348ead454'
  },
  'numina-nusd-runtime.yml': {
    'build-and-attest': './.github/workflows/numina-nusd-runtime-builder.yml'
  }
};
const recordedReusableCalls = executionTargets?.reusableWorkflowCalls || {};
const deniedFloatingLabels = new Set(hostedLinuxPolicy.floatingLabelsDenied || []);
if (hostedLinuxPolicy.pinnedTarget !== 'ubuntu-24.04') failures.push('Hosted Linux execution must remain pinned to ubuntu-24.04');
if (!deniedFloatingLabels.has('ubuntu-latest')) failures.push('ubuntu-latest must remain denied before its Ubuntu 26 migration');
if (policy.runnerTarget !== 'ubuntu-24.04' || executionTargets?.default !== policy.runnerTarget) failures.push('Default execution target must be the hosted ubuntu-24.04 substrate');
if (!Array.isArray(executionTargets?.approvedHostedLabels) || JSON.stringify([...executionTargets.approvedHostedLabels].sort()) !== JSON.stringify([...approvedHostedLabels].sort())) failures.push('Hosted execution label allowlist must contain only ubuntu-24.04 and macos-latest');
for (const [name, target] of Object.entries(overrides)) if (!approvedHostedLabels.has(target)) failures.push(name + ' has an unsupported execution target');
for (const [name, targets] of Object.entries(targetSets)) if (!Array.isArray(targets) || !targets.length || targets.some(target => !approvedHostedLabels.has(target))) failures.push(name + ' has an unsupported execution target set');
for (const [name, ids] of Object.entries(requiredDisabledJobs)) {
  if (!Array.isArray(disabledJobs[name]) || JSON.stringify([...disabledJobs[name]].sort()) !== JSON.stringify([...ids].sort())) failures.push(name + ' must record its disabled legacy jobs');
}
for (const name of Object.keys(disabledJobs)) if (!Object.hasOwn(requiredDisabledJobs, name)) failures.push(name + ' has an unreviewed disabled-job record');
for (const [name, calls] of Object.entries(approvedReusableWorkflowCalls)) {
  for (const [id, reference] of Object.entries(calls)) if (recordedReusableCalls[name]?.[id] !== reference) failures.push(name + ':' + id + ' must record its preserved reusable workflow reference');
}
for (const [name, calls] of Object.entries(recordedReusableCalls)) {
  if (!calls || typeof calls !== 'object' || Array.isArray(calls) || !Object.hasOwn(approvedReusableWorkflowCalls, name)) { failures.push(name + ' has an unreviewed reusable workflow record'); continue; }
  for (const [id, reference] of Object.entries(calls)) if (approvedReusableWorkflowCalls[name][id] !== reference) failures.push(name + ':' + id + ' has an unreviewed reusable workflow reference');
}
const usedOverrides = new Set();
const usedReusableCalls = new Set();

// Deliberately accept only the block job/property format verified in this repo.
// Quoted keys, flow mappings, aliases, merges and other YAML forms fail closed.
// Nested step/script text is never counted as a runner declaration.
function workflowJobs(text, name) {
  const jobs = new Map(), rootKeys = new Set();
  let section = null, job = null, propertyName = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const fail = reason => failures.push(name + ':' + (index + 1) + ' ' + reason);
    if (/^ *\t/.test(line)) { fail('unverified tab indentation'); continue; }
    const indent = line.match(/^ */)[0].length;
    if (indent === 0) {
      const key = line.match(/^([A-Za-z][\w-]*):(?:\s+(.*))?\s*$/);
      section = null;
      job = null;
      propertyName = null;
      if (!key) { fail('unverified workflow root mapping'); continue; }
      if (rootKeys.has(key[1])) fail('duplicate workflow root key ' + key[1]);
      rootKeys.add(key[1]);
      section = key[1];
      if (section === 'jobs' && key[2] && !key[2].startsWith('#')) fail('jobs must use the verified block mapping format');
      continue;
    }
    if (section !== 'jobs') continue;
    if (indent === 2) {
      const id = line.match(/^  ([A-Za-z_][\w-]*):\s*(?:#.*)?$/);
      job = null;
      propertyName = null;
      if (!id) { fail('unverified job mapping'); continue; }
      if (jobs.has(id[1])) fail('duplicate job ' + id[1]);
      job = { id: id[1], properties: new Map() };
      jobs.set(job.id, job);
    } else if (indent === 4 && job) {
      const property = line.match(/^    ([A-Za-z][\w-]*):(?:[ \t]+(.*))?\s*$/);
      if (!property) { fail('unverified job property'); continue; }
      if (job.properties.has(property[1])) fail('duplicate job property ' + property[1]);
      propertyName = property[1];
      job.properties.set(property[1], (property[2] || '').trim());
    } else if (indent < 4 || !job || !job.properties.size) {
      fail('unverified job indentation or structure');
    } else if (['runs-on', 'if', 'uses'].includes(propertyName)) {
      fail('multiline runner, condition or reusable-workflow scalar is not verified');
    }
  }
  if (!rootKeys.has('jobs') || !jobs.size) failures.push(name + ' has no verified block jobs mapping');
  for (const job of jobs.values()) {
    const hasTarget = job.properties.has('runs-on'), hasCall = job.properties.has('uses');
    if (hasTarget === hasCall) failures.push(name + ':' + job.id + ' must have one runner target or reusable workflow call');
    if (hasCall) {
      const reference = job.properties.get('uses');
      if (!Object.hasOwn(approvedReusableWorkflowCalls[name] || {}, job.id) || reference !== approvedReusableWorkflowCalls[name][job.id]) failures.push(name + ':' + job.id + ' reusable workflow call must match the preserved reviewed reference');
      else usedReusableCalls.add(name + ':' + job.id);
    }
    if (hasTarget) {
      const value = job.properties.get('runs-on');
      const literal = value.match(/^(?:([A-Za-z0-9_.-]+)|'([A-Za-z0-9_.-]+)'|"([A-Za-z0-9_.-]+)")(?:[ \t]+#.*)?$/);
      job.target = literal ? (literal[1] || literal[2] || literal[3]) : null;
      if (!approvedHostedLabels.has(job.target)) failures.push(name + ':' + job.id + ' runner target must be an approved literal hosted label, got ' + JSON.stringify(value));
    }
  }
  return jobs;
}

let declarations = 0;
let disabledDeclarations = 0;
const workflowNames = readdirSync(workflowsDir).filter(name => /\.ya?ml$/i.test(name)).sort();
for (const name of workflowNames) {
  const text = readFileSync(resolve(workflowsDir, name), 'utf8');
  if (/\bself-hosted\b/i.test(text)) failures.push(name + ' contains a denied self-hosted runner reference');
  const jobs = workflowJobs(text, name);
  const targets = [...jobs.values()].filter(job => job.properties.has('runs-on')).map(job => job.target);
  declarations += targets.length;
  for (const id of requiredDisabledJobs[name] || []) {
    const job = jobs.get(id);
    if (!job?.properties.has('runs-on') || !/^false(?:[ \t]+#.*)?$/.test(job.properties.get('if') || '')) failures.push(name + ':' + id + ' legacy job must remain explicitly disabled with job-level if: false');
    else disabledDeclarations++;
  }
  for (const target of targets) if (deniedFloatingLabels.has(target)) failures.push(name + ' uses denied floating runner label ' + target);
  const expectedSet = Object.hasOwn(targetSets,name) && Array.isArray(targetSets[name]) ? targetSets[name] : null;
  const expectedTarget = Object.hasOwn(overrides, name) ? overrides[name] : executionTargets?.default;
  if (Object.hasOwn(overrides, name) && targets.length) usedOverrides.add(name);
  if (expectedSet) {
    for (const expected of expectedSet) if (!approvedHostedLabels.has(expected)) failures.push(name + ' has an unsupported execution target');
    const actualSorted=[...targets].sort(), expectedSorted=[...expectedSet].sort();
    if (JSON.stringify(actualSorted)!==JSON.stringify(expectedSorted)) failures.push(name + ' runner targets must match recorded target set ' + JSON.stringify(expectedSet) + ', got ' + JSON.stringify(targets));
  } else {
    if (!approvedHostedLabels.has(expectedTarget)) failures.push(name + ' has an unsupported execution target');
    for (const target of targets) if (target !== expectedTarget) failures.push(name + ' runner target must match its recorded execution target ' + expectedTarget + ', got ' + JSON.stringify(target));
  }
}
for (const name of Object.keys(overrides)) if (!usedOverrides.has(name)) failures.push('Execution override has no preserved workflow job: ' + name);
for (const name of Object.keys(targetSets)) if (!workflowNames.includes(name)) failures.push('Execution target set has no preserved workflow: ' + name);
for (const name of Object.keys(requiredDisabledJobs)) if (!workflowNames.includes(name)) failures.push('Disabled legacy workflow was removed: ' + name);
for (const [name, calls] of Object.entries(approvedReusableWorkflowCalls)) {
  for (const id of Object.keys(calls)) if (!usedReusableCalls.has(name + ':' + id)) failures.push('Preserved reusable workflow call was removed: ' + name + ':' + id);
}

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
console.log('NUMINA runner policy verified: ' + declarations + ' preserved hosted declarations (local scope); self-hosted targets and additional local runner declarations denied. Disabled legacy jobs: ' + disabledDeclarations + '; other local declarations: ' + (declarations - disabledDeclarations) + '.');
