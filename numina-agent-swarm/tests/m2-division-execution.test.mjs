// tests/m2-division-execution.test.mjs
// Milestone 2 Division Execution, Protocol Invariant & Swarm Deployment Suite

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

const EXPECTED_DIVISIONS = [
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

test('▶ ▶ Milestone 2 15-Division Swarm Execution & Invariant Suite', async (t) => {
  const dispatcher = new AutonomousSwarmDispatcher();

  await t.test('1. Verify 15 Division Roster, Room & Operational Task Invariants', () => {
    assert.equal(DIVISIONS.length, 15, 'Exactly 15 Numina Enterprise Agent Divisions must be registered');
    
    const divisionIds = DIVISIONS.map(d => d.id);
    for (const expectedId of EXPECTED_DIVISIONS) {
      assert.ok(divisionIds.includes(expectedId), `Division ${expectedId} must be present in roster`);
    }

    for (const division of DIVISIONS) {
      assert.ok(division.room && division.room.length > 0, `Room for ${division.id} must be specified`);
      assert.ok(division.task && division.task.length > 0, `Task for ${division.id} must be specified`);
    }
  });

  await t.test('2. Execute Parallel Swarm Cycle Across All 15 Divisions with Proof Digests', async () => {
    const summary = await dispatcher.runParallelSwarmCycle();

    assert.equal(summary.divisionsExecuted, 15, 'All 15 divisions must execute in parallel cycle');
    assert.equal(summary.stateRoot, CLUSTER_STATE_ROOT);
    assert.equal(summary.sprintGid, SPRINT_GID);
    assert.equal(summary.results.length, 15);

    for (const res of summary.results) {
      assert.equal(res.status, 'TASK_COMPLETED_SUCCESSFULLY');
      assert.match(res.proofDigest, /^[a-f0-9]{64}$/, 'Proof digest must be valid SHA-256 hex string');
      assert.equal(res.stateRoot, CLUSTER_STATE_ROOT);
      assert.equal(res.sprintGid, SPRINT_GID);
    }
  });

  await t.test('3. Cluster State Root Invariant Enforcement', () => {
    assert.equal(CLUSTER_STATE_ROOT, '726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd');
    assert.equal(dispatcher.clusterStateRoot, CLUSTER_STATE_ROOT);

    // Any corrupted or drifted state root fails closed
    assert.throws(() => {
      new AutonomousSwarmDispatcher({ clusterStateRoot: '0000000000000000000000000000000000000000000000000000000000000000' });
    }, /STATE_ROOT_MISMATCH/);
  });

  await t.test('4. Asana Sprint Boundary Defense against Forbidden GIDs', () => {
    assert.equal(SPRINT_GID, '1219183110870936');
    assert.equal(dispatcher.sprintGid, SPRINT_GID);

    for (const forbiddenGid of FORBIDDEN_SPRINT_GIDS) {
      assert.throws(() => {
        new AutonomousSwarmDispatcher({ sprintGid: forbiddenGid });
      }, /FORBIDDEN_SPRINT_GID/);
    }
  });

  await t.test('5. Otter-Raft Singularity Protocol Invariant Alignment', () => {
    const expectedMotto = 'Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned.';
    assert.equal(OTTER_RAFT_SINGULARITY_MOTTO, expectedMotto);
    assert.equal(dispatcher.singularityMotto, expectedMotto);
  });

  await t.test('6. Execute Swarm Deployment & Validate Deployment Ledger Record', async () => {
    const deploymentRecord = await deploySwarm();

    assert.ok(deploymentRecord.deploymentId.startsWith('dep-'));
    assert.equal(deploymentRecord.milestone, 'Milestone 2');
    assert.equal(deploymentRecord.divisionsCount, 15);
    assert.equal(deploymentRecord.clusterStateRoot, CLUSTER_STATE_ROOT);
    assert.equal(deploymentRecord.sprintGid, SPRINT_GID);
    assert.equal(deploymentRecord.singularityProtocol, OTTER_RAFT_SINGULARITY_MOTTO);

    const ledgerDir = fileURLToPath(new URL('../deployments', import.meta.url));
    const recordFile = path.join(ledgerDir, `swarm-deployment-${deploymentRecord.deploymentId}.json`);
    assert.ok(fs.existsSync(recordFile), `Deployment file ${recordFile} must exist on disk`);

    const savedRecord = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    assert.equal(savedRecord.deploymentId, deploymentRecord.deploymentId);
    assert.equal(savedRecord.divisionsCount, 15);
    assert.equal(savedRecord.clusterStateRoot, CLUSTER_STATE_ROOT);
    assert.equal(savedRecord.sprintGid, SPRINT_GID);
    assert.equal(savedRecord.divisions.length, 15);
    for (const div of savedRecord.divisions) {
      assert.equal(div.status, 'ACTIVE_AND_DEPLOYED');
      assert.match(div.proofDigest, /^[a-f0-9]{64}$/);
    }
  });
});
