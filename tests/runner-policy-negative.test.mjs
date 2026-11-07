import test from 'node:test';
import assert from 'node:assert/strict';

// ============================================================================
// 1. Policy Enforcement Logic
// ============================================================================
export const RunnerErrorCodes = {
  ERR_RUNNER_WRONG_REPO: 'ERR_RUNNER_WRONG_REPO',
  ERR_RUNNER_LEGACY_DISALLOWED: 'ERR_RUNNER_LEGACY_DISALLOWED',
  ERR_RUNNER_IDENTITY_UNAPPROVED: 'ERR_RUNNER_IDENTITY_UNAPPROVED',
  ERR_RUNNER_REGISTRATION_UNREGISTERED: 'ERR_RUNNER_REGISTRATION_UNREGISTERED',
  ERR_RUNNER_FLOATING_LABEL_DISALLOWED: 'ERR_RUNNER_FLOATING_LABEL_DISALLOWED'
};

export const AUTHORIZED_REPO = 'skott34-dot/numina-production';
export const PRESERVED_HOSTED_TARGETS = new Set(['NUMINA', 'ubuntu-24.04', 'macos-latest']);
export const DENIED_FLOATING_LABELS = new Set(['ubuntu-latest']);

export function evaluateRunnerPolicy(context) {
  const {
    repo,
    runnerId,
    runnerType = 'hosted',
    isRegistered = true,
    workflowTarget = 'NUMINA'
  } = context;

  // 1. Repository Boundary
  if (repo !== AUTHORIZED_REPO) {
    return {
      allowed: false,
      exitCode: 1,
      errorCode: RunnerErrorCodes.ERR_RUNNER_WRONG_REPO,
      reason: `Repository '${repo}' is unauthorized. Execution locked to '${AUTHORIZED_REPO}'.`
    };
  }

  // 2. Prohibit Legacy Self-Hosted
  if (runnerType === 'legacy' || runnerType === 'self-hosted') {
    return {
      allowed: false,
      exitCode: 1,
      errorCode: RunnerErrorCodes.ERR_RUNNER_LEGACY_DISALLOWED,
      reason: 'Legacy and self-hosted runners are denied execution.'
    };
  }

  // 3. Strict Identity
  if (runnerId !== 'NUMINA') {
    return {
      allowed: false,
      exitCode: 1,
      errorCode: RunnerErrorCodes.ERR_RUNNER_IDENTITY_UNAPPROVED,
      reason: `Runner identity '${runnerId}' is unapproved. Identity must be 'NUMINA'.`
    };
  }

  // 4. Prohibit Unregistered / Future Registrations
  if (!isRegistered) {
    return {
      allowed: false,
      exitCode: 1,
      errorCode: RunnerErrorCodes.ERR_RUNNER_REGISTRATION_UNREGISTERED,
      reason: 'Unregistered runner detected. Future runner creation is denied.'
    };
  }

  // 5. Serve Hosted Workflow; Reject Floating Labels
  if (DENIED_FLOATING_LABELS.has(workflowTarget)) {
    return {
      allowed: false,
      exitCode: 1,
      errorCode: RunnerErrorCodes.ERR_RUNNER_FLOATING_LABEL_DISALLOWED,
      reason: `Floating runner label '${workflowTarget}' is denied before migration.`
    };
  }

  if (!PRESERVED_HOSTED_TARGETS.has(workflowTarget)) {
    return {
      allowed: false,
      exitCode: 1,
      errorCode: RunnerErrorCodes.ERR_RUNNER_FLOATING_LABEL_DISALLOWED,
      reason: `Unsupported workflow target '${workflowTarget}'.`
    };
  }

  return {
    allowed: true,
    exitCode: 0,
    errorCode: null,
    reason: 'Authorized hosted execution.'
  };
}

// ============================================================================
// 2. Negative Path Rejection Test Suite
// ============================================================================
test('Runner Policy Negative Path & Enforcement Suite', async (t) => {
  const negativeCases = [
    {
      name: 'rejects wrong repository runner',
      context: {
        repo: 'unauthorized-org/external-repo',
        runnerId: 'NUMINA',
        runnerType: 'hosted',
        isRegistered: true,
        workflowTarget: 'ubuntu-24.04'
      },
      expectedCode: RunnerErrorCodes.ERR_RUNNER_WRONG_REPO
    },
    {
      name: 'rejects legacy self-hosted runner',
      context: {
        repo: AUTHORIZED_REPO,
        runnerId: 'NUMINA',
        runnerType: 'self-hosted',
        isRegistered: true,
        workflowTarget: 'ubuntu-24.04'
      },
      expectedCode: RunnerErrorCodes.ERR_RUNNER_LEGACY_DISALLOWED
    },
    {
      name: 'rejects unapproved runner identity',
      context: {
        repo: AUTHORIZED_REPO,
        runnerId: 'UNAPPROVED_RUNNER_ID',
        runnerType: 'hosted',
        isRegistered: true,
        workflowTarget: 'ubuntu-24.04'
      },
      expectedCode: RunnerErrorCodes.ERR_RUNNER_IDENTITY_UNAPPROVED
    },
    {
      name: 'rejects unregistered runner',
      context: {
        repo: AUTHORIZED_REPO,
        runnerId: 'NUMINA',
        runnerType: 'hosted',
        isRegistered: false,
        workflowTarget: 'ubuntu-24.04'
      },
      expectedCode: RunnerErrorCodes.ERR_RUNNER_REGISTRATION_UNREGISTERED
    },
    {
      name: 'rejects unpinned floating labels (ubuntu-latest)',
      context: {
        repo: AUTHORIZED_REPO,
        runnerId: 'NUMINA',
        runnerType: 'hosted',
        isRegistered: true,
        workflowTarget: 'ubuntu-latest'
      },
      expectedCode: RunnerErrorCodes.ERR_RUNNER_FLOATING_LABEL_DISALLOWED
    }
  ];

  for (const { name, context, expectedCode } of negativeCases) {
    await t.test(name, () => {
      const result = evaluateRunnerPolicy(context);
      assert.equal(result.allowed, false, `Expected ${name} to be disallowed`);
      assert.equal(result.exitCode, 1, 'Expected exitCode 1');
      assert.equal(result.errorCode, expectedCode, `Expected errorCode ${expectedCode}`);
      assert.ok(result.reason.length > 0, 'Expected non-empty failure reason');
    });
  }

  // Preserved Hosted Workflow Execution (Allowed)
  await t.test('serves preserved hosted workflow execution', () => {
    for (const target of ['NUMINA', 'ubuntu-24.04', 'macos-latest']) {
      const result = evaluateRunnerPolicy({
        repo: AUTHORIZED_REPO,
        runnerId: 'NUMINA',
        runnerType: 'hosted',
        isRegistered: true,
        workflowTarget: target
      });

      assert.equal(result.allowed, true);
      assert.equal(result.exitCode, 0);
      assert.equal(result.errorCode, null);
    }
  });
});
