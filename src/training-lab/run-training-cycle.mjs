// Private deterministic curriculum runner. NOT an LLM, WoW bot, financial executor, or live agent service.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const parse=(relative)=>JSON.parse(readFileSync(new URL(relative,import.meta.url),'utf8'));
export const trainingConfig=parse('../../config/numina-agent-training-lab.v1.json');
export const capitalConfig=parse('../../config/numina-agent-capital.v1.json');

export function runTrainingCycle({seed=1,scenario='dungeons'}={}){
  if(!Number.isSafeInteger(seed)||seed<0)throw new TypeError('seed must be a nonnegative safe integer');
  if(!['leveling','dungeons','guild-economy','raid-leadership'].includes(scenario))
    throw new TypeError('unknown scenario');
  if(trainingConfig.environment!=='PRIVATE_OFFLINE_SIMULATION'||trainingConfig.live_wow_automation!=='DISABLED')
    throw new Error('LIVE_AUTOMATION_NOT_PERMITTED');
  if(capitalConfig.ledger_policy.treasury_count!==1||capitalConfig.ledger_policy.agent_authorization_to_move_funds!==false)
    throw new Error('TREASURY_POLICY_INVALID');
  const rooms=trainingConfig.rooms;
  const ids=capitalConfig.agents.map(a=>a.id);
  if(rooms.length!==15||ids.length!==15||new Set(ids).size!==15||
      rooms.some(r=>!ids.includes(r.id)))throw new Error('ROOM_REGISTRY_MISMATCH');
  const tasks=rooms.map((room,i)=>{
    const budget=capitalConfig.agents.find(a=>a.id===room.id).simulation.starting_balance;
    const simulatedCost=5+((seed+i*11)%23);
    const remaining=budget-simulatedCost;
    const input={challenge:scenario,seed,room:room.id,budget};
    return {
      room_id:room.id,simulation_only:true,scenario,decision:'SPEND_SIMULATED_CREDITS',
      input,output:{simulated_cost:simulatedCost,remaining_training_credits:remaining},
      disposition:remaining>=0?'SIMULATION_COMPLETED':'SIMULATION_BLOCKED',
      actual_gameplay_actions:0,real_money_transfers:0,external_network_calls:0
    };
  });
  return {
    schema:'numina.agent-training-run.v1',mode:'OFFLINE_DETERMINISTIC',
    is_real_model_inference:false,is_live_game_control:false,seed,scenario,
    room_count:tasks.length,completed:tasks.filter(t=>t.disposition==='SIMULATION_COMPLETED').length,
    total_simulated_spend:tasks.reduce((n,t)=>n+t.output.simulated_cost,0),
    real_money_transfers:0,external_network_calls:0,tasks
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const scenario=process.argv[2]||'dungeons';
  const seed=process.argv[3]===undefined?1:Number(process.argv[3]);
  console.log(JSON.stringify(runTrainingCycle({scenario,seed}),null,2));
}
