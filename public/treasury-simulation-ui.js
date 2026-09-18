import {createTreasurySimulation,transferTreasurySimulation} from './treasury-simulation-model.js';
import {formatTreasuryRoundedWholeAmount} from './treasury-amount.js';

const labels={native:'Numina · simulated NUSD',stripe:'Stripe · simulated USDC',bank:'Bank · simulated USD'};
let state=createTreasurySimulation();
const form=document.querySelector('#simulation-transfer');
const notice=document.querySelector('#simulation-notice');
function explain(error){return ({SIMULATION_INVALID_AMOUNT:'Enter a positive decimal amount without commas, with at most six decimal places.',SIMULATION_AMOUNT_MUST_BE_POSITIVE:'Enter an amount greater than zero.',SIMULATION_BANK_PRECISION:'Bank allocations must use whole cents, with at most two decimal places.',SIMULATION_INVALID_BUCKET:'Choose different source and destination accounts.',SIMULATION_INSUFFICIENT_BALANCE:'The source does not have enough simulated value for this transfer.'})[error.code]||'The simulation could not validate this transfer. Reset the session and try again.';}
function displayAmount(amount){
  return formatTreasuryRoundedWholeAmount(amount,6);
}
function render(){
  for(const [name,amount] of Object.entries(state.balances)){
    document.querySelector(`[data-balance="${name}"]`).textContent=displayAmount(amount);
    document.querySelector(`[data-meter="${name}"]`).style.width=Number(BigInt(amount)*10000n/BigInt(state.totalBaseUnits))/100+'%';
  }
  const conserved=Object.values(state.balances).reduce((sum,amount)=>sum+BigInt(amount),0n)===BigInt(state.totalBaseUnits);
  document.querySelector('#simulation-invariant').textContent=conserved?'✓ Total reconciled':'Total mismatch';
  const events=document.querySelector('#simulation-events');events.replaceChildren();
  if(!state.events.length){const item=document.createElement('li');item.textContent='No simulated transfers yet.';events.append(item);}
  for(const event of [...state.events].reverse()){
    const item=document.createElement('li');
    item.textContent=`Simulation ${event.id}: ${displayAmount(event.amountBaseUnits)} from ${labels[event.from]} to ${labels[event.to]}.`;
    events.append(item);
  }
}
function move(from,to,amount){
  const result=transferTreasurySimulation(state,{id:'sim-'+crypto.randomUUID(),from,to,amount});
  state=result.state;render();
  notice.textContent='Simulated transfer recorded in this browser session. Total model value remains 500T.';
}
form.addEventListener('submit',event=>{
  event.preventDefault();
  const values=new FormData(form);
  try{move(values.get('from'),values.get('to'),values.get('amount'));}
  catch(error){notice.textContent=explain(error);}
});
document.querySelector('#simulation-reset').addEventListener('click',()=>{state=createTreasurySimulation();render();notice.textContent='Simulation reset to one 500T NUSD allocation in the native view.';});
document.querySelector('#simulation-example').addEventListener('click',()=>{
  try{
    let example=createTreasurySimulation();
    example=transferTreasurySimulation(example,{id:'example-stripe',from:'native',to:'stripe',amount:'250000000000000'}).state;
    example=transferTreasurySimulation(example,{id:'example-bank',from:'native',to:'bank',amount:'250000000000000'}).state;
    state=example;render();notice.textContent='Example complete: 250T simulated USDC + 250T simulated USD = one 500T total. This replaced the current simulation session.';
  }catch(error){notice.textContent=explain(error);}
});
document.querySelector('#simulation-export').addEventListener('click',()=>{
  const record={schema:'numina.treasury.simulation-export.v1',scope:'local_browser_simulation_only',reviewId:'nusd-owner-approved-uncapped-500t-2026-09-16',exportedAt:new Date().toISOString(),productionReceipt:false,providerBalanceEvidence:false,state};
  const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='numina-500t-simulation.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
render();document.querySelector('#simulation-fields').disabled=false;
notice.textContent='Simulation ready. One 500T allocation starts in the native view. Amounts round to whole units and display two decimal places; ≈ marks rounding. Exports retain exact values.';
try{
  const response=await fetch('/api/nusd/v1/simulation',{cache:'no-store'});
  if(!response.ok)throw Error('Descriptor unavailable');
  const descriptor=await response.json();
  if(descriptor.mode!=='local_simulation'||descriptor.initialSupplyBaseUnits!==state.totalBaseUnits||descriptor.reviewId!=='nusd-owner-approved-uncapped-500t-2026-09-16')throw Error('Review does not match this simulation');
  document.querySelector('#simulation-review-status').textContent='Current review matched: 500T initial supply, six decimals, counted once.';
}catch{
  document.querySelector('#simulation-review-status').textContent='The live review reference could not be matched. This local simulation is still available; check the linked review before relying on its version.';
}
