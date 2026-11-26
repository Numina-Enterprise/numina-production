import test from 'node:test';
import assert from 'node:assert/strict';
import {runTrainingCycle,trainingConfig,capitalConfig} from '../src/training-lab/run-training-cycle.mjs';

test('all fifteen divisions map to capital allocations under one treasury',()=>{
  assert.equal(trainingConfig.rooms.length,15);
  assert.equal(capitalConfig.agents.length,15);
  assert.deepEqual(new Set(trainingConfig.rooms.map(r=>r.id)),new Set(capitalConfig.agents.map(r=>r.id)));
  assert.equal(capitalConfig.ledger_policy.treasury_count,1);
  assert.equal(capitalConfig.ledger_policy.simulated_balances_spendable,false);
  assert.equal(capitalConfig.ledger_policy.agent_authorization_to_move_funds,false);
});
test('repeatable dungeon simulation uses only nonspendable credits',()=>{
  const a=runTrainingCycle({scenario:'dungeons',seed:17});
  const b=runTrainingCycle({scenario:'dungeons',seed:17});
  assert.deepEqual(a,b);
  assert.equal(a.room_count,15);
  assert.equal(a.completed,15);
  assert.equal(a.real_money_transfers,0);
  assert.equal(a.external_network_calls,0);
  assert.equal(a.is_live_game_control,false);
  assert.equal(a.is_real_model_inference,false);
  for(const t of a.tasks){
    assert.equal(t.actual_gameplay_actions,0);
    assert.ok(t.output.remaining_training_credits>=0);
  }
});
test('invalid scenarios and seeds fail closed',()=>{
  assert.throws(()=>runTrainingCycle({scenario:'real-wow'}),/unknown scenario/);
  assert.throws(()=>runTrainingCycle({seed:-1}),/seed/);
});
