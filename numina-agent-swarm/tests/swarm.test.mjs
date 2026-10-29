import test from 'node:test';
import assert from 'node:assert/strict';
import { AutonomousSwarmDispatcher, DIVISIONS, CLUSTER_STATE_ROOT, SPRINT_GID } from '../src/swarm-dispatcher.mjs';

test('▶ Numina Autonomous Swarm Dispatcher Suite', async (t) => {

  await t.test('1. Verify 15 Division Roster & Room Invariants', () => {
    assert.equal(DIVISIONS.length, 15, 'All 15 divisions registered');
    const ids = new Set(DIVISIONS.map(d => d.id));
    assert.equal(ids.size, 15, 'All 15 division IDs unique');
    assert.ok(ids.has('numina-finance-treasury'));
    assert.ok(ids.has('numina-apple-team'));
    assert.ok(ids.has('numina-google-enterprise'));
    assert.ok(ids.has('numina-website-soc'));
    assert.ok(ids.has('vengeance-independent-review'));
  });

  await t.test('2. Execute Concurrent Parallel Swarm Task Cycle', async () => {
    const swarm = new AutonomousSwarmDispatcher();
    const cycle = await swarm.runParallelSwarmCycle();

    assert.equal(cycle.divisionsExecuted, 15);
    assert.equal(cycle.stateRoot, CLUSTER_STATE_ROOT);
    assert.equal(cycle.results.length, 15);

    for (const r of cycle.results) {
      assert.equal(r.status, 'TASK_COMPLETED_SUCCESSFULLY');
      assert.equal(r.sprintGid, SPRINT_GID);
      assert.equal(r.stateRoot, CLUSTER_STATE_ROOT);
      assert.ok(r.proofDigest);
      assert.equal(r.proofDigest.length, 64);
    }
  });

});
