import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const pausedJobs = {
  'numina-ios-branch-build.yml': ['ios'],
  'numina-native-packages.yml': ['android', 'ios'],
  'probe-numina-runtime-auth.yml': ['probe'],
  'rebuild-nusd-artifacts.yml': ['rebuild'],
  'settle-numina-aggregate-model.yml': ['settle']
};

// Exercise the real CLI in isolated, complete workflow fixtures. No workflow runs.
function fixture(change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'numina-runner-policy-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'config'));
    cpSync(join(source, 'scripts/check-runner-policy.mjs'), join(root, 'scripts/check-runner-policy.mjs'));
    cpSync(join(source, '.github'), join(root, '.github'), { recursive: true });
    const policy = JSON.parse(readFileSync(join(source, 'config/numina-runners.json'), 'utf8'));
    const workflowPath = name => join(root, '.github/workflows', name);
    const update = (name, transform) => writeFileSync(workflowPath(name), transform(readFileSync(workflowPath(name), 'utf8')));
    change({ policy, update, workflowPath });
    writeFileSync(join(root, 'config/numina-runners.json'), JSON.stringify(policy));
    return spawnSync(process.execPath, ['scripts/check-runner-policy.mjs'], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function rejects(change) {
  const result = fixture(change);
  assert.equal(result.status, 1, `Unsafe fixture accepted:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /RUNNER_POLICY_VIOLATION/);
}

test('runner policy accepts only the hosted fixture with all six legacy jobs disabled', () => {
  const result = fixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /34 preserved hosted declarations/);
});

test('NUMINA logical identity cannot authorize a custom runner target', () => {
  rejects(({ policy, update }) => {
    policy.runnerTarget = 'NUMINA';
    policy.executionTargets.default = 'NUMINA';
    delete policy.executionTargets.workflowOverrides['numina-ios-branch-build.yml'];
    delete policy.executionTargets.workflowTargetSets['numina-native-packages.yml'];
    for (const name of Object.keys(pausedJobs)) update(name, text => text.replace(/^    runs-on:.*$/gm, '    runs-on: NUMINA'));
  });
});

for (const [description, value] of [
  ['unknown custom label', 'private-linux'],
  ['logical NUMINA label', 'NUMINA'],
  ['floating Ubuntu label', 'ubuntu-latest'],
  ['flow runner array', '[ubuntu-24.04]'],
  ['block runner array', '\n      - ubuntu-24.04'],
  ['flow runner map', '{group: NUMINA, labels: ubuntu-24.04}'],
  ['block runner map', '\n      group: NUMINA\n      labels: ubuntu-24.04'],
  ['folded runner scalar', '>-\n      ubuntu-24.04'],
  ['literal runner scalar with indentation and chomp indicators', '|2-\n      ubuntu-24.04'],
  ['runner expression', '${{ matrix.runner }}'],
  ['runner alias', '*hosted'],
  ['tagged runner scalar', '!!str ubuntu-24.04']
]) {
  test(`runner policy rejects ${description}`, () => {
    rejects(({ update }) => update('numina-ci-start.yml', text => text.replace('runs-on: ubuntu-24.04', `runs-on: ${value}`)));
  });
}

test('quoted custom runner key cannot hide behind a fake declaration inside a script', () => {
  rejects(({ update }) => update('numina-ci-start.yml', text => text.replace('runs-on: ubuntu-24.04', '"runs-on": NUMINA') + '\n      - run: |\n          runs-on: ubuntu-24.04\n'));
});

for (const [description, transform] of [
  ['spaced runner key', text => text.replace('runs-on: ubuntu-24.04', 'runs-on : ubuntu-24.04')],
  ['inline job mapping', text => text + '\n  hidden: {runs-on: NUMINA, steps: []}\n'],
  ['merged job properties', text => text.replace('    runs-on:', '    <<: {runs-on: NUMINA}\n    runs-on:')],
  ['duplicate runner property', text => text.replace('    runs-on:', '    runs-on: NUMINA\n    runs-on:')],
  ['duplicate job identifier', text => text + '\n  release-artifacts:\n    runs-on: ubuntu-24.04\n    steps: []\n'],
  ['extra workflow document', text => text + '\n---\njobs: {hidden: {runs-on: NUMINA}}\n'],
  ['quoted jobs root key', text => text.replace('jobs:', '"jobs":')]
]) {
  test(`runner policy fails closed on ${description}`, () => rejects(({ update }) => update('numina-ci-start.yml', transform)));
}

test('policy records cannot add an unapproved execution target', () => {
  rejects(({ policy }) => { policy.executionTargets.workflowOverrides['numina-ci-start.yml'] = 'NUMINA'; });
});

test('policy records cannot expand the verified hosted label allowlist', () => {
  rejects(({ policy }) => { policy.executionTargets.approvedHostedLabels.push('NUMINA'); });
});

for (const condition of ['true', "${{ inputs.platform != 'ios' }}", '${{ false || true }}', '"false"']) {
  test(`legacy jobs must remain disabled rather than use ${condition}`, () => {
    rejects(({ update }) => update('numina-native-packages.yml', text => text.replace('    if: false', `    if: ${condition}`)));
  });
}

test('step-level false cannot replace a disabled job condition', () => {
  rejects(({ update }) => update('probe-numina-runtime-auth.yml', text => text.replace(/^    if: false[^\r\n]*\r?\n/m, '').replace('      - name:', '      - if: false\n        name:')));
});

test('disabled legacy job records cannot be removed from policy', () => {
  rejects(({ policy }) => { delete policy.executionTargets.disabledJobs['settle-numina-aggregate-model.yml']; });
});

test('plain scalar continuation cannot hide a custom runner label', () => {
  rejects(({ update }) => update('numina-ci-start.yml', text => text.replace('runs-on: ubuntu-24.04', 'runs-on: ubuntu-24.04\n      NUMINA')));
});

test('plain scalar continuation cannot turn a disabled job condition true', () => {
  rejects(({ update }) => update('numina-native-packages.yml', text => text.replace(/^    if: false[^\r\n]*/m, '    if: false\n      || true')));
});

test('reusable workflow calls cannot hide multiline scalar continuations', () => {
  rejects(({ update }) => update('numina-nusd-runtime.yml', text => text.replace(/^    uses:.*$/m, match => match + '\n      unverified-workflow')));
});

test('new reusable workflow callers cannot bypass the preserved runner inventory', () => {
  rejects(({ update }) => update('numina-ci-start.yml', text => text + '\n  unreviewed-caller:\n    uses: arbitrary-org/example/.github/workflows/build.yml@' + '1'.repeat(40) + '\n'));
});

test('known reusable caller cannot change its external workflow reference', () => {
  rejects(({ update }) => update('historical-numina-rc26-verifier.yml', text => text.replace('f85e9428fa8bf0371931429479f31b0348ead454', '1'.repeat(40))));
});

test('known reusable caller cannot change its local workflow target', () => {
  rejects(({ update }) => update('numina-nusd-runtime.yml', text => text.replace('uses: ./.github/workflows/numina-nusd-runtime-builder.yml', 'uses: ./.github/workflows/numina-site-builder.yml')));
});

test('known reusable caller cannot be remapped to a different job identity', () => {
  rejects(({ update }) => update('numina-nusd-runtime.yml', text => text.replace('  build-and-attest:', '  another-caller:')));
});

test('known reusable caller cannot be removed from the preserved inventory', () => {
  rejects(({ workflowPath }) => rmSync(workflowPath('historical-numina-rc26-verifier.yml')));
});

test('reusable caller policy records cannot authorize an unknown caller', () => {
  rejects(({ policy }) => {
    policy.executionTargets.reusableWorkflowCalls ||= {};
    policy.executionTargets.reusableWorkflowCalls['numina-ci-start.yml'] = { 'unreviewed-caller': './.github/workflows/numina-site-builder.yml' };
  });
});

for (const [description, count] of [['missing', undefined], ['nonnumeric', 'unbounded'], ['changed', 35]]) {
  test(`${description} preserved count cannot authorize an extra hosted declaration`, () => {
    rejects(({ policy, update }) => {
      policy.preservedRunnerCount = count;
      update('numina-ci-start.yml', text => text + '\n  extra-runner:\n    runs-on: ubuntu-24.04\n    steps: []\n');
    });
  });
}

test('an extra hosted declaration is denied even when its label is approved', () => {
  rejects(({ update }) => update('numina-ci-start.yml', text => text + '\n  extra-runner:\n    runs-on: ubuntu-24.04\n    steps: []\n'));
});

test('removing a hosted declaration violates the preserved runner inventory', () => {
  rejects(({ workflowPath }) => rmSync(workflowPath('numina-ci-start.yml')));
});

test('approved literal quoting and runner comments do not change the hosted target', () => {
  const result = fixture(({ update }) => update('numina-ci-start.yml', text => text.replace('runs-on: ubuntu-24.04', 'runs-on: "ubuntu-24.04" # approved hosted substrate')));
  assert.equal(result.status, 0, result.stderr);
});
