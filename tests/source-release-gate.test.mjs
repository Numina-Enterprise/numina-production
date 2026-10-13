import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const readWorkflow = name => readFileSync(join(root, '.github/workflows', name), 'utf8');
async function gateModule() {
  assert.equal(existsSync(join(root, 'scripts/verify-source-gate.mjs')), true, 'Source gate implementation is required');
  return import('../scripts/verify-source-gate.mjs');
}

test('source gate requires the exact hosted Node26 runtime', async () => {
  const { validateRuntime } = await gateModule();
  assert.doesNotThrow(() => validateRuntime({ platform: 'linux', version: 'v26.11.1' }));
  for (const version of ['v24.19.0', 'v26.10.0', 'v26.11.2']) assert.throws(() => validateRuntime({ platform: 'linux', version }));
  assert.throws(() => validateRuntime({ platform: 'win32', version: 'v26.11.1' }));
});

test('source mount cannot carry persisted Git authorization or credential includes', async () => {
  const { assertCredentialFreeGitConfig } = await gateModule();
  assert.doesNotThrow(() => assertCredentialFreeGitConfig('[remote "origin"]\nurl = https://github.com/skott34-dot/numina-production\n'));
  for (const config of ['extraheader = AUTHORIZATION: fixture', '[credential]\nhelper = fixture', '[include]\npath = /home/runner/.gitconfig', 'url = https://fixture@github.com/example/repo']) assert.throws(() => assertCredentialFreeGitConfig(config));
  try {
    assertCredentialFreeGitConfig('[http "https://github.com/"]\nextraheader = AUTHORIZATION: fixture-sensitive-token\n');
    assert.fail('Persisted authorization must fail');
  } catch (error) {
    assert.doesNotMatch(inspect(error), /fixture-sensitive-token|\[http/);
  }
});

test('Docker boundary emits only readonly source/runtime mounts and an isolated environment', async () => {
  const { dockerArguments } = await gateModule();
  const args = dockerArguments({ sourceRoot: '/home/runner/work/numina/numina', nodeHome: '/opt/hostedtoolcache/node/26.11.1/x64' });
  assert.equal(args[args.indexOf('--network') + 1], 'none');
  assert.equal(args[args.indexOf('--user') + 1], '1000:1000');
  assert.equal(args[args.indexOf('--cap-drop') + 1], 'ALL');
  assert.equal(args[args.indexOf('--security-opt') + 1], 'no-new-privileges');
  assert.ok(args.includes('--read-only'));
  const values = flag => args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);
  assert.deepEqual(values('--mount'), ['type=bind,src=/home/runner/work/numina/numina,dst=/source,readonly', 'type=bind,src=/opt/hostedtoolcache/node/26.11.1/x64,dst=/node26,readonly']);
  assert.deepEqual(values('--env'), ['HOME=/work', 'PATH=/node26/bin:/usr/local/bin:/usr/bin:/bin']);
  assert.equal(args[args.indexOf('--entrypoint') + 1], '/node26/bin/node');
  assert.ok(args.includes('node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'));
  assert.throws(() => dockerArguments({ sourceRoot: '/repo,readonly=false', nodeHome: '/opt/hostedtoolcache/node/26.11.1/x64' }));
  assert.throws(() => dockerArguments({ sourceRoot: '/repo', nodeHome: '/home/runner' }));
});

function stepScript(workflow, name) {
  const step = workflow.split(/(?=^      - )/m).find(value => value.includes(`- name: ${name}\n`));
  assert.ok(step, `Missing source gate step: ${name}`);
  const match = step.match(/^        run: \|\r?\n((?:          [^\r\n]*\r?\n|\r?\n)+)/m);
  assert.ok(match, 'Source gate must be a reviewable shell block');
  return match[1].split(/\r?\n/).map(line => line.slice(10)).join('\n');
}

test('failed Docker boundary cannot produce a successful full-suite result', async () => {
  const { runGateContainer } = await gateModule();
  const plan = { sourceRoot: '/repo', nodeHome: '/opt/hostedtoolcache/node/26.11.1/x64', environment: {} };
  assert.throws(() => runGateContainer(plan, () => ({ status: 42 })), /SOURCE_GATE_CONTAINER_FAILED/);
  assert.throws(() => runGateContainer(plan, () => ({ error: Error('missing'), status: null })), /SOURCE_GATE_DOCKER_UNAVAILABLE/);
  assert.throws(() => runGateContainer(plan, () => ({ status: 0, stdout: '' })), /SOURCE_GATE_DISPOSABLE_RECEIPT_REQUIRED/);
});

test('Docker success must carry one matching disposable build receipt', async () => {
  const { runGateContainer } = await gateModule();
  const plan = { sourceRoot: '/repo', nodeHome: '/opt/hostedtoolcache/node/26.11.1/x64', environment: {}, expectedSourceCommit: 'a'.repeat(40) };
  const receipt = { schema: 'numina.source-gate.disposable-build.v1', nodeVersion: 'v26.11.1', sourceCommit: 'a'.repeat(40), fullRootSuitePassed: true, scope: 'disposable_build_and_full_root_tests_not_release_or_deployment_proof', postBuildChanges: [{ path: 'package.json', type: 'file', sha256: 'b'.repeat(64) }], postTestChanges: [] };
  const output = value => 'NUMINA_SOURCE_GATE_DISPOSABLE_BUILD ' + JSON.stringify(value) + '\n';
  const result = runGateContainer(plan, () => ({ status: 0, stdout: output(receipt) }));
  assert.deepEqual(result.postBuildChanges, [{ path: 'package.json', type: 'file', sha256: 'b'.repeat(64) }]);
  assert.equal(result.scope, 'disposable_build_and_full_root_tests_not_release_or_deployment_proof');
  for (const change of [{ nodeVersion: 'v24.21.0' }, { sourceCommit: 'c'.repeat(40) }, { fullRootSuitePassed: false }, { postBuildChanges: [{ path: '../outside', type: 'file', sha256: 'b'.repeat(64) }] }]) assert.throws(() => runGateContainer(plan, () => ({ status: 0, stdout: output({ ...receipt, ...change }) })));
  assert.throws(() => runGateContainer(plan, () => ({ status: 0, stdout: output(receipt) + output(receipt) })));
});

test('source verification marker follows the failing isolated gate boundary', () => {
  const script = stepScript(readWorkflow('verify-provider-observations.yml'), 'Verify current Numina source before trusting release');
  assert.ok(script.indexOf('node scripts/verify-source-gate.mjs') >= 0);
  assert.ok(script.indexOf('node scripts/verify-source-gate.mjs') < script.indexOf('NUMINA_ROOT_VERIFIED=true'));
  assert.match(script, /set -euo pipefail/);
  assert.doesNotMatch(script, /\|\|\s*true|continue-on-error/);
});

test('namespace preflight rejects credential environment, external routes and sockets', async () => {
  const { validateSandboxState } = await gateModule();
  const safe = { version: 'v26.11.1', uid: 1000, noNewPrivileges: true, effectiveCapabilities: '0000000000000000', environment: { HOME: '/work', PATH: '/node26/bin:/usr/bin:/bin' }, interfaces: { lo: [{ internal: true }] }, routes: 'Iface Destination Gateway\n', socketPresent: false };
  assert.doesNotThrow(() => validateSandboxState(safe));
  for (const change of [
    { version: 'v24.21.0' }, { environment: { HOME: '/work', GITHUB_TOKEN: 'fixture' } },
    { interfaces: { eth0: [{ internal: false }] } }, { routes: 'Iface Destination Gateway\neth0 00000000 fixture\n' },
    { socketPresent: true }, { environment: { HOME: '/home/runner' } },
    { uid: 0 }, { noNewPrivileges: false }, { effectiveCapabilities: '0000000000000001' }
  ]) assert.throws(() => validateSandboxState({ ...safe, ...change }));
});

test('a failing full root npm test propagates through the suite runner', async () => {
  const { runSandboxSuite } = await gateModule();
  assert.equal(typeof runSandboxSuite, 'function');
  assert.throws(() => runSandboxSuite({ nodeExecutable: '/node26/bin/node', npmEntry: '/node26/lib/node_modules/npm/bin/npm-cli.js', workingDirectory: '/repo', captureChanges: () => [] }, (_command, args) => ({ status: args[1] === 'test' ? 42 : 0 })), /SOURCE_GATE_FULL_ROOT_SUITE_FAILED/);
});

test('successful full root suite returns success only after build and pin checks', async () => {
  const { runSandboxSuite } = await gateModule();
  assert.equal(typeof runSandboxSuite, 'function');
  const result = runSandboxSuite({ nodeExecutable: '/node26/bin/node', npmEntry: '/node26/lib/node_modules/npm/bin/npm-cli.js', workingDirectory: '/repo', captureChanges: phase => [{ path: 'package.json', sha256: phase === 'post_build' ? 'a'.repeat(64) : 'b'.repeat(64) }] }, (_command, args) => {
    assert.ok(JSON.stringify(args) === '["/node26/lib/node_modules/npm/bin/npm-cli.js","run","build"]' || JSON.stringify(args) === '["scripts/sync-application-release-pin.mjs"]' || JSON.stringify(args) === '["/node26/lib/node_modules/npm/bin/npm-cli.js","test"]');
    return { status: 0 };
  });
  assert.equal(result.fullRootSuitePassed, true);
  assert.deepEqual(result.postBuildChanges, [{ path: 'package.json', sha256: 'a'.repeat(64) }]);
  assert.deepEqual(result.postTestChanges, [{ path: 'package.json', sha256: 'b'.repeat(64) }]);
});

test('build and pin failures remain blocking gates', async () => {
  const { runSandboxSuite } = await gateModule();
  for (const [badArgument, failure] of [['build', /SOURCE_GATE_BUILD_FAILED/], ['scripts/sync-application-release-pin.mjs', /SOURCE_GATE_ARTIFACT_PIN_CHECK_FAILED/]]) {
    assert.throws(() => runSandboxSuite({ nodeExecutable: '/node26/bin/node', npmEntry: '/npm', workingDirectory: '/repo', captureChanges: () => [] }, (_command, args) => ({ status: args.includes(badArgument) ? 42 : 0 })), failure);
  }
});

test('failed full suite retains post-build input evidence', async () => {
  const { runSandboxSuite } = await gateModule();
  let published;
  const changes = [{ path: 'package.json', type: 'file', sha256: 'd'.repeat(64) }];
  assert.throws(() => runSandboxSuite({ nodeExecutable: '/node26/bin/node', npmEntry: '/npm', workingDirectory: '/repo', captureChanges: () => changes, onBuildCapture: value => { published = value; } }, (_command, args) => ({ status: args[1] === 'test' ? 42 : 0 })), /SOURCE_GATE_FULL_ROOT_SUITE_FAILED/);
  assert.deepEqual(published, [{ path: 'package.json', type: 'file', sha256: 'd'.repeat(64) }]);
});

test('dirty tracked files or index cannot acquire a source-commit verification receipt', async () => {
  const { assertCleanTrackedSource } = await gateModule();
  assert.equal(typeof assertCleanTrackedSource, 'function');
  for (const dirty of ['worktree', 'index']) {
    assert.throws(() => assertCleanTrackedSource({ sourceRoot: '/repo', environment: {} }, (_command, args) => ({ status: (dirty === 'index') === args.includes('--cached') ? 1 : 0 })), /SOURCE_GATE_DIRTY_TRACKED_SOURCE/);
  }
});

test('durable NUSD verification is preceded by a source gate with step-scoped credentials', () => {
  const workflow = readWorkflow('verify-nusd-production.yml');
  const gate = workflow.indexOf('- name: Verify exact source in isolated full-suite gate');
  const observation = workflow.indexOf('- name: Verify production deployment from chain state');
  const publication = workflow.indexOf('- name: Commit durable NUMINA verification');
  assert.ok(gate >= 0 && observation > gate && publication > observation);
  const beforeSteps = workflow.slice(0, workflow.indexOf('    steps:'));
  assert.doesNotMatch(beforeSteps, /secrets\./);
  const checkout = workflow.slice(workflow.indexOf('      - uses: actions/checkout'), gate);
  assert.match(checkout, /persist-credentials: false/);
  assert.doesNotMatch(checkout, /ref: main/);
  assert.match(workflow.slice(observation, publication), /secrets\.NUMINA_RPC_AUTHORIZATION/);
  assert.doesNotMatch(workflow.slice(gate, observation), /continue-on-error|always\(\)|\|\|\s*true/);
});

test('existing nonfinancial PR job invokes the isolated full-suite gate before release creation', () => {
  const workflow = readWorkflow('numina.yml');
  const gate = workflow.indexOf('run: node scripts/verify-source-gate.mjs');
  assert.ok(gate > workflow.indexOf('- name: NUMINA pinned dependencies'));
  assert.ok(gate < workflow.indexOf('- name: NUMINA release'));
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  const step = workflow.split(/(?=^      - )/m).find(value => value.includes('run: node scripts/verify-source-gate.mjs'));
  assert.doesNotMatch(step, /continue-on-error|always\(\)|\|\|\s*true/);
});
