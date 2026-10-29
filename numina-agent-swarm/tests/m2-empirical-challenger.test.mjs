// tests/m2-empirical-challenger.test.mjs
// Milestone 2 Empirical Challenger Test Suite: Autonomous Agent Swarm & Invariants
// Tests:
// 1. 15-Division Concurrent Swarm Execution with SHA-256 Proof Generation
// 2. Physical Deployment Ledger Generation and Disk Verification
// 3. High-Load Stress Harness: 10 Parallel Cycles (150 Tasks) with Zero Collision
// 4. Cluster State Root, Sprint GID, and Otter-Raft Singularity Invariants

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AutonomousSwarmDispatcher,
  CLUSTER_STATE_ROOT,
  SPRINT_GID,
  FORBIDDEN_SPRINT_GIDS,
  OTTER_RAFT_SINGULARITY_MOTTO,
  DIVISIONS
} from '../src/swarm-dispatcher.mjs';
import { deploySwarm } from '../src/deploy-divisions.mjs';

test('▶ ▶ Milestone 2 Empirical Challenge: Autonomous Swarm & Protocol Invariants', async (t) => {
  const dispatcher = new AutonomousSwarmDispatcher();

  await t.test('CHALLENGE-1: 15-Division Parallel Execution & Cryptographic Proof Verification', async () => {
    assert.equal(DIVISIONS.length, 15, 'Exactly 15 Numina Enterprise Agent Divisions must be registered');

    const expectedDivisionIds = [
      'numina-accounting',
      'numina-apple-team',
      'numina-compliance-risk',
      'numina-engineering-cio',
      'numina-federal-capture',
      'numina-finance-treasury',
      'numina-crypto-monitor',
      'numina-google-play-team',
      'numina-google-enterprise',
      'numina-legal',
      'numina-growth-matrix',
      'numina-publicity-narrative',
      'numina-strategy',
      'numina-website-soc',
      'vengeance-independent-review'
    ];

    const registeredIds = DIVISIONS.map(d => d.id);
    for (const expectedId of expectedDivisionIds) {
      assert.ok(registeredIds.includes(expectedId), `Division ${expectedId} must be in roster`);
    }

    // Execute parallel cycle
    const cycle = await dispatcher.runParallelSwarmCycle();
    assert.equal(cycle.divisionsExecuted, 15, 'All 15 divisions must execute');
    assert.equal(cycle.stateRoot, CLUSTER_STATE_ROOT);
    assert.equal(cycle.sprintGid, SPRINT_GID);
    assert.equal(cycle.results.length, 15);

    const digests = new Set();
    for (const res of cycle.results) {
      assert.equal(res.status, 'TASK_COMPLETED_SUCCESSFULLY');
      assert.match(res.proofDigest, /^[a-f0-9]{64}$/, 'Proof digest must be valid SHA-256');
      assert.equal(res.stateRoot, CLUSTER_STATE_ROOT);
      assert.equal(res.sprintGid, SPRINT_GID);
      digests.add(res.proofDigest);
    }
    assert.equal(digests.size, 15, 'All 15 proof digests within cycle must be distinct');
  });

  await t.test('CHALLENGE-2: Swarm Deployment Ledger Physical Disk Persistence & Schema Integrity', async () => {
    const deploymentRecord = await deploySwarm();

    assert.ok(deploymentRecord.deploymentId.startsWith('dep-'));
    assert.equal(deploymentRecord.milestone, 'Milestone 2');
    assert.equal(deploymentRecord.divisionsCount, 15);
    assert.equal(deploymentRecord.clusterStateRoot, CLUSTER_STATE_ROOT);
    assert.equal(deploymentRecord.sprintGid, SPRINT_GID);
    assert.equal(deploymentRecord.singularityProtocol, OTTER_RAFT_SINGULARITY_MOTTO);

    const ledgerDir = fileURLToPath(new URL('../deployments', import.meta.url));
    const ledgerFile = path.join(ledgerDir, `swarm-deployment-${deploymentRecord.deploymentId}.json`);

    assert.ok(fs.existsSync(ledgerFile), `Ledger file ${ledgerFile} must exist on disk`);
    const fileContent = JSON.parse(fs.readFileSync(ledgerFile, 'utf-8'));

    assert.equal(fileContent.deploymentId, deploymentRecord.deploymentId);
    assert.equal(fileContent.divisionsCount, 15);
    assert.equal(fileContent.clusterStateRoot, CLUSTER_STATE_ROOT);
    assert.equal(fileContent.sprintGid, SPRINT_GID);
    assert.equal(fileContent.divisions.length, 15);

    for (const div of fileContent.divisions) {
      assert.equal(div.status, 'ACTIVE_AND_DEPLOYED');
      assert.match(div.proofDigest, /^[a-f0-9]{64}$/);
    }
  });

  await t.test('CHALLENGE-3: Swarm Stress Harness: 10 Consecutive Cycles (150 Tasks) with Zero Collision', async () => {
    const allDigests = new Set();
    const cycleCount = 10;

    for (let c = 0; c < cycleCount; c++) {
      const cycle = await dispatcher.runParallelSwarmCycle();
      assert.equal(cycle.divisionsExecuted, 15);
      for (const res of cycle.results) {
        assert.equal(res.status, 'TASK_COMPLETED_SUCCESSFULLY');
        assert.match(res.proofDigest, /^[a-f0-9]{64}$/);
        assert.ok(!allDigests.has(res.proofDigest), `Duplicate digest detected: ${res.proofDigest}`);
        allDigests.add(res.proofDigest);
      }
    }

    assert.equal(allDigests.size, 150, 'All 150 tasks across 10 cycles must have globally unique SHA-256 digests');
  });

  await t.test('CHALLENGE-4: Invariant Boundaries & Self-Hosted Denial Enforcement', async () => {
    // State Root Invariant
    assert.equal(CLUSTER_STATE_ROOT, '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd');
    assert.throws(() => new AutonomousSwarmDispatcher({ clusterStateRoot: 'bad_root' }), /STATE_ROOT_MISMATCH/);

    // Sprint GID Invariant
    assert.equal(SPRINT_GID, '1219183110870936');
    for (const forbidden of FORBIDDEN_SPRINT_GIDS) {
      assert.throws(() => new AutonomousSwarmDispatcher({ sprintGid: forbidden }), /FORBIDDEN_SPRINT_GID/);
    }

    // Singularity Motto Invariant
    const expectedMotto = 'Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned.';
    assert.equal(OTTER_RAFT_SINGULARITY_MOTTO, expectedMotto);
    assert.equal(dispatcher.singularityMotto, expectedMotto);

    // Runner Denial (Section 45)
    assert.throws(() => dispatcher.assertPermittedRunnerEnvironment('self-hosted'), /DENY_SELF_HOSTED_RUNNERS_VIOLATION/);
    assert.throws(() => dispatcher.assertPermittedRunnerEnvironment(['linux', 'self-hosted']), /DENY_SELF_HOSTED_RUNNERS_VIOLATION/);
    assert.throws(() => dispatcher.assertPermittedRunnerEnvironment(null), TypeError);
    assert.equal(dispatcher.assertPermittedRunnerEnvironment('ubuntu-latest'), true);

    // Task Execution Null Safety
    await assert.rejects(async () => dispatcher.executeTask(null), TypeError);
    await assert.rejects(async () => dispatcher.executeTask(undefined), TypeError);
    await assert.rejects(async () => dispatcher.executeTask({ id: '' }), TypeError);
    await assert.rejects(async () => dispatcher.executeTask({ id: 'test', room: '' }), TypeError);
    await assert.rejects(async () => dispatcher.executeTask({ id: 'test', room: 'room', task: '' }), TypeError);
  });
});
