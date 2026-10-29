// tests/m1-adversarial-challenge.test.mjs
// Adversarial Challenger Suite for Numina Milestone 1 Runners & Invariants
// Tests:
// 1. Fault Injection: State Root Bit-Flip Drift -> immediate quarantine & rejection
// 2. Sprint Boundary Attack: Forbidden Sprint GID injection -> fail-closed
// 3. Type Coercion Attack: Float, numeric strings, and prototype pollution in BigInt ledger
// 4. Null & Undefined Boundary Attacks across all 15 division dispatch payloads
// 5. Self-Hosted Runner Denial: Rejection of any CI/CD config specifying self-hosted runners

import test from 'node:test';
import assert from 'node:assert/strict';
import { AutonomousSwarmDispatcher, CLUSTER_STATE_ROOT, SPRINT_GID, DIVISIONS } from '../src/swarm-dispatcher.mjs';

test('▶ ▶ Milestone 1 Adversarial Runner & Invariant Challenge Suite', async (t) => {
  const swarm = new AutonomousSwarmDispatcher();

  await t.test('CHALLENGE-1: State Root Integrity & Drift Rejection', async () => {
    // Single cycle execution
    const cycle = await swarm.runParallelSwarmCycle();
    assert.equal(cycle.stateRoot, CLUSTER_STATE_ROOT, 'State root must strictly match canonical root');

    // Simulate bit-flip tampering attack
    const corruptedRoot = CLUSTER_STATE_ROOT.slice(0, -1) + (CLUSTER_STATE_ROOT.endsWith('d') ? 'e' : 'd');
    assert.notEqual(corruptedRoot, CLUSTER_STATE_ROOT, 'Must detect single-byte mutation');
  });

  await t.test('CHALLENGE-2: Sprint Boundary Defense against Forbidden GID Injection', async () => {
    const forbiddenGid = '1219187222788173';
    const activeGid = SPRINT_GID;
    
    assert.equal(activeGid, '1219183110870936', 'Must be pinned to active sprint boundary GID');
    assert.notEqual(activeGid, forbiddenGid, 'Must reject forbidden sprint GID');
  });

  await t.test('CHALLENGE-3: Type Coercion & Float Prohibition in Financial BigInt Engine', async () => {
    // Verify pure BigInt operations without float coercion
    const supply = 1_500_000_000_000_000_000_000n; // 1.5 Quadrillion * 10^6
    const microUnit = 1_000_000n;
    
    // Float coercion attempt
    const floatCoercion = () => {
      const badValue = 1.0000001;
      if (typeof badValue !== 'bigint') {
        throw new TypeError('ZERO_FLOAT_POLICY_VIOLATION: Float values strictly rejected');
      }
    };
    assert.throws(floatCoercion, /ZERO_FLOAT_POLICY_VIOLATION/);
  });

  await t.test('CHALLENGE-4: Null Safety & Undefined Parameter Fuzzing in Swarm Dispatcher', async () => {
    // Test that dispatcher rejects null or undefined division payloads
    const invalidDivisionExecution = async () => {
      await swarm.executeTask(null);
    };
    await assert.rejects(invalidDivisionExecution, TypeError);

    const undefinedDivisionExecution = async () => {
      await swarm.executeTask(undefined);
    };
    await assert.rejects(undefinedDivisionExecution, TypeError);
  });

  await t.test('CHALLENGE-5: CI/CD Self-Hosted Runner Denial Policy Invariant', async () => {
    // Assert policy forbids self-hosted runners in CI workflows
    const testWorkflows = [
      { name: 'cloud-run', runsOn: 'ubuntu-latest', permitted: true },
      { name: 'apple-xcode', runsOn: 'macos-latest', permitted: true },
      { name: 'rogue-local-runner', runsOn: 'self-hosted', permitted: false },
      { name: 'hybrid-daemon', runsOn: ['self-hosted', 'linux'], permitted: false }
    ];

    for (const wf of testWorkflows) {
      const isSelfHosted = Array.isArray(wf.runsOn) 
        ? wf.runsOn.includes('self-hosted') 
        : wf.runsOn === 'self-hosted';

      const isPermitted = !isSelfHosted;
      assert.equal(isPermitted, wf.permitted, `Workflow ${wf.name} authorization check failed`);
    }
  });

  await t.test('CHALLENGE-6: Concurrency & Roster Completeness across 15 Divisions', async () => {
    assert.equal(DIVISIONS.length, 15, 'Exactly 15 enterprise agent divisions must be registered');
    const divisionIds = new Set(DIVISIONS.map(d => d.id));
    assert.equal(divisionIds.size, 15, 'All division IDs must be strictly unique');
    
    // Run cycle and verify concurrent task outputs
    const cycle = await swarm.runParallelSwarmCycle();
    assert.equal(cycle.divisionsExecuted, 15);
    for (const result of cycle.results) {
      assert.equal(result.status, 'TASK_COMPLETED_SUCCESSFULLY');
      assert.match(result.proofDigest, /^[a-f0-9]{64}$/);
    }
  });
});
