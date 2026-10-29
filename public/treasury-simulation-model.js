// Pure local simulation. No network, storage, canonical journal or provider adapter.
export const TREASURY_SIMULATION_INITIAL_NUSD='500000000000000';
export const TREASURY_SIMULATION_DECIMALS=6;
export const TREASURY_SIMULATION_BUCKETS=Object.freeze({
  native:Object.freeze({label:'Numina native treasury simulation',unit:'NUSD'}),
  stripe:Object.freeze({label:'Stripe treasury simulation',unit:'USDC'}),
  bank:Object.freeze({label:'Bank savings simulation',unit:'USD'})
});
const schema='numina.treasury.local-simulation.v1',scale=1000000n;
const initialBaseUnits=(BigInt(TREASURY_SIMULATION_INITIAL_NUSD)*scale).toString();
const buckets=Object.keys(TREASURY_SIMULATION_BUCKETS),units=['NUSD','USDC','USD'];
const stateFields=['schema','mode','decimals','totalBaseUnits','balances','events','providerWrites','journalWrites'];
const transferFields=['id','from','to','amount'],eventFields=[...transferFields,'amountBaseUnits'];
function fail(code){throw Object.assign(new Error(code),{code});}
const fullMatch=(pattern,value)=>pattern.exec(value)?.[0]===value;
function exact(value,fields,code){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==fields.length||fields.some(key=>!Object.hasOwn(value,key)))fail(code);
}
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function integer(value){
  if(typeof value==='bigint'&&value>=0n)return value;
  if(typeof value!=='string'||!fullMatch(/^(0|[1-9][0-9]{0,83})$/,value))fail('SIMULATION_INVALID_BASE_UNITS');
  return BigInt(value);
}
export function parseTreasurySimulationAmount(amount){
  // Never accept Number, exponent notation or silently round a fractional unit.
  if(typeof amount!=='string'||!fullMatch(/^(0|[1-9][0-9]{0,77})(?:\.([0-9]{1,6}))?$/,amount))fail('SIMULATION_INVALID_AMOUNT');
  const [whole,fraction='']=amount.split('.');return BigInt(whole)*scale+BigInt(fraction.padEnd(6,'0'));
}
export function formatTreasurySimulationAmount(baseUnits){
  const value=integer(baseUnits).toString().padStart(7,'0');return value.slice(0,-6)+'.'+value.slice(-6);
}
export function quoteTreasurySimulation(amount,fromUnit='NUSD',toUnit='USDC'){
  if(!units.includes(fromUnit)||!units.includes(toUnit))fail('SIMULATION_INVALID_UNIT');
  const amountBaseUnits=parseTreasurySimulationAmount(amount).toString(),formatted=formatTreasurySimulationAmount(amountBaseUnits);
  return freeze({schema:'numina.treasury.local-quote.v1',mode:'local_simulation',decimals:6,
    from:{unit:fromUnit,amount:formatted},to:{unit:toUnit,amount:formatted},amountBaseUnits,
    rate:{numerator:'1',denominator:'1'},providerAcceptanceVerified:false,executable:false});
}
function validateTransfer(value){
  exact(value,transferFields,'SIMULATION_INVALID_TRANSFER');
  if(typeof value.id!=='string'||!fullMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,value.id))fail('SIMULATION_INVALID_ID');
  if(!buckets.includes(value.from)||!buckets.includes(value.to)||value.from===value.to)fail('SIMULATION_INVALID_BUCKET');
  const amount=parseTreasurySimulationAmount(value.amount);if(amount===0n)fail('SIMULATION_AMOUNT_MUST_BE_POSITIVE');
  if((value.from==='bank'||value.to==='bank')&&amount%10000n!==0n)fail('SIMULATION_BANK_PRECISION');
  return amount;
}
function initialBalances(){return {native:BigInt(initialBaseUnits),stripe:0n,bank:0n};}
function move(balances,event,amount){
  if(balances[event.from]<amount)fail('SIMULATION_INSUFFICIENT_BALANCE');
  balances[event.from]-=amount;balances[event.to]+=amount;
}
function validateState(state){
  try{
    exact(state,stateFields,'SIMULATION_INVALID_STATE');exact(state.balances,buckets,'SIMULATION_INVALID_STATE');
    if(state.schema!==schema||state.mode!=='local_simulation'||state.decimals!==6||state.totalBaseUnits!==initialBaseUnits||state.providerWrites!==false||state.journalWrites!==false||!Array.isArray(state.events))fail('SIMULATION_INVALID_STATE');
    const replay=initialBalances(),seen=new Set();
    for(const event of state.events){
      exact(event,eventFields,'SIMULATION_INVALID_STATE');
      const amount=validateTransfer(Object.fromEntries(transferFields.map(key=>[key,event[key]])));
      if(seen.has(event.id)||typeof event.amountBaseUnits!=='string'||event.amountBaseUnits!==amount.toString())fail('SIMULATION_INVALID_STATE');
      seen.add(event.id);move(replay,event,amount);
    }
    for(const bucket of buckets)if(typeof state.balances[bucket]!=='string'||integer(state.balances[bucket])!==replay[bucket])fail('SIMULATION_INVALID_STATE');
    return replay;
  }catch{fail('SIMULATION_INVALID_STATE');}
}
export function createTreasurySimulation(){
  return freeze({schema,mode:'local_simulation',decimals:6,totalBaseUnits:initialBaseUnits,
    balances:{native:initialBaseUnits,stripe:'0',bank:'0'},events:[],providerWrites:false,journalWrites:false});
}
export function transferTreasurySimulation(state,transfer){
  const balances=validateState(state),amount=validateTransfer(transfer),previous=state.events.find(event=>event.id===transfer.id);
  if(previous){
    if(transferFields.some(key=>previous[key]!==transfer[key]))fail('SIMULATION_ID_CONFLICT');
    // The complete event identity is reused; no second allocation occurs.
    return freeze({state,event:previous,replayed:true});
  }
  move(balances,transfer,amount);
  const event={id:transfer.id,from:transfer.from,to:transfer.to,amount:transfer.amount,amountBaseUnits:amount.toString()};
  const next={...state,balances:Object.fromEntries(buckets.map(bucket=>[bucket,balances[bucket].toString()])),events:[...state.events,event]};
  return freeze({state:next,event,replayed:false});
}
export function summarizeTreasurySimulation(state){
  const balances=validateState(state),allocated=balances.stripe+balances.bank;
  return freeze({mode:'local_simulation',totalBaseUnits:initialBaseUnits,totalNusd:formatTreasurySimulationAmount(initialBaseUnits),
    allocatedBaseUnits:allocated.toString(),unallocatedBaseUnits:balances.native.toString(),
    buckets:buckets.map(id=>({id,...TREASURY_SIMULATION_BUCKETS[id],amountBaseUnits:balances[id].toString(),amount:formatTreasurySimulationAmount(balances[id])})),
    providerAcceptanceVerified:false,providerWrites:false,journalWrites:false});
}
