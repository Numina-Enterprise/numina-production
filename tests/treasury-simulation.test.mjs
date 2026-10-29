import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTreasurySimulation,transferTreasurySimulation,quoteTreasurySimulation,parseTreasurySimulationAmount,formatTreasurySimulationAmount,summarizeTreasurySimulation,TREASURY_SIMULATION_INITIAL_NUSD,TREASURY_SIMULATION_BUCKETS} from '../public/treasury-simulation-model.js';

const initial='500000000000000000000';
const move=(state,id,from,to,amount)=>transferTreasurySimulation(state,{id,from,to,amount});
const rejects=(action,code)=>assert.throws(action,error=>error.code===code);
const sum=state=>Object.values(state.balances).reduce((total,value)=>total+BigInt(value),0n);

test('one finite 500T NUSD simulation starts unallocated across three distinct currency buckets',()=>{
 const state=createTreasurySimulation(),summary=summarizeTreasurySimulation(state);
 assert.equal(TREASURY_SIMULATION_INITIAL_NUSD,'500000000000000');assert.equal(state.decimals,6);assert.equal(state.totalBaseUnits,initial);
 assert.deepEqual(state.balances,{native:initial,stripe:'0',bank:'0'});assert.equal(sum(state),BigInt(initial));assert.equal(summary.allocatedBaseUnits,'0');assert.equal(summary.unallocatedBaseUnits,initial);
 assert.deepEqual(summary.buckets.map(item=>[item.id,item.unit]),[['native','NUSD'],['stripe','USDC'],['bank','USD']]);
 assert.equal(state.mode,'local_simulation');assert.equal(state.providerWrites,false);assert.equal(state.journalWrites,false);assert.deepEqual(state.events,[]);
 assert.equal(summary.providerAcceptanceVerified,false);assert.equal(JSON.stringify(state).includes('Infinity'),false);
});

test('decimal parsing and formatting retain exact micro-units far above safe Number precision',()=>{
 for(const [decimal,base] of [['0','0'],['1','1000000'],['0.000001','1'],['1.234567','1234567'],['500000000000000','500000000000000000000'],['9007199254740993.123456','9007199254740993123456']])assert.equal(parseTreasurySimulationAmount(decimal),BigInt(base));
 assert.equal(formatTreasurySimulationAmount(9007199254740993123456n),'9007199254740993.123456');assert.equal(formatTreasurySimulationAmount('1'),'0.000001');assert.equal(formatTreasurySimulationAmount('0'),'0.000000');
 for(const value of [1,1.5,NaN,Infinity,null,undefined,'',' 1','1 ','1\n','1\r','1\r\n','01','-0','-1','+1','.1','1.','1e6','1,000','0.0000001','1.1234567','9'.repeat(79)])rejects(()=>parseTreasurySimulationAmount(value),'SIMULATION_INVALID_AMOUNT');
 for(const value of [-1n,1,Infinity,'-1','01','1.0','1e6','1\n'])rejects(()=>formatTreasurySimulationAmount(value),'SIMULATION_INVALID_BASE_UNITS');
});

test('all 1:1 quotes preserve exact currency identity without allocating or creating funds',()=>{
 const state=createTreasurySimulation(),before=JSON.stringify(state);
 for(const from of ['NUSD','USDC','USD'])for(const to of ['NUSD','USDC','USD']){
  const quote=quoteTreasurySimulation('500000000000000.000001',from,to);
  assert.deepEqual(quote.from,{unit:from,amount:'500000000000000.000001'});assert.deepEqual(quote.to,{unit:to,amount:'500000000000000.000001'});assert.equal(quote.amountBaseUnits,'500000000000000000001');assert.deepEqual(quote.rate,{numerator:'1',denominator:'1'});assert.equal(quote.executable,false);assert.equal(quote.providerAcceptanceVerified,false);
 }
 assert.equal(JSON.stringify(state),before);assert.equal(quoteTreasurySimulation('1').to.unit,'USDC');rejects(()=>quoteTreasurySimulation('1','NUSD','usd'),'SIMULATION_INVALID_UNIT');
});

test('allocation is counted once and a second full 500T allocation is rejected',()=>{
 const initialState=createTreasurySimulation(),first=move(initialState,'allocate-stripe','native','stripe','500000000000000'),summary=summarizeTreasurySimulation(first.state);
 assert.deepEqual(first.state.balances,{native:'0',stripe:initial,bank:'0'});assert.equal(summary.allocatedBaseUnits,initial);assert.equal(sum(first.state),BigInt(initial));assert.equal(initialState.balances.native,initial);
 rejects(()=>move(first.state,'allocate-bank','native','bank','500000000000000'),'SIMULATION_INSUFFICIENT_BALANCE');
 const second=move(first.state,'reallocate-to-bank','stripe','bank','500000000000000');assert.deepEqual(second.state.balances,{native:'0',stripe:'0',bank:initial});assert.equal(summarizeTreasurySimulation(second.state).allocatedBaseUnits,initial);
});

test('fractional transfers between all buckets conserve every micro-unit',()=>{
 let state=createTreasurySimulation();
 for(const [id,from,to,amount] of [['a','native','stripe','123456789012345.123456'],['b','native','bank','100000000000000.01'],['c','stripe','bank','0.01'],['d','bank','native','1.02'],['e','stripe','native','123456789012345.113456']]){
  state=move(state,id,from,to,amount).state;assert.equal(sum(state),BigInt(initial));for(const value of Object.values(state.balances))assert.ok(BigInt(value)>=0n);
 }
 assert.deepEqual(state.balances,{native:'400000000000001000000',stripe:'0',bank:'99999999999999000000'});
 assert.equal(summarizeTreasurySimulation(state).allocatedBaseUnits,state.balances.bank);
});

test('simulated bank transfers require exact USD cents and never round micro-units',()=>{
 const funded=move(createTreasurySimulation(),'fund-bank','native','bank','1.01').state;
 for(const [from,to] of [['native','bank'],['bank','native'],['stripe','bank'],['bank','stripe']])for(const amount of ['0.000001','0.001','0.010001'])rejects(()=>move(funded,'invalid-bank',from,to,amount),'SIMULATION_BANK_PRECISION');
 const first=move(funded,'bank-cent','bank','stripe','0.010000').state;assert.equal(first.balances.bank,'1000000');assert.equal(first.balances.stripe,'10000');assert.equal(sum(first),BigInt(initial));
 const second=move(first,'token-micro','stripe','native','0.000001').state;assert.equal(second.balances.stripe,'9999');assert.equal(second.balances.bank,'1000000');assert.equal(sum(second),BigInt(initial));
});

test('exact retries return the same event and state even after later transfers',()=>{
 const request={id:'stable-id',from:'native',to:'stripe',amount:'10.000000'},first=transferTreasurySimulation(createTreasurySimulation(),request);
 const later=move(first.state,'another-id','stripe','bank','3').state,retry=transferTreasurySimulation(later,{amount:'10.000000',to:'stripe',id:'stable-id',from:'native'});
 assert.equal(first.replayed,false);assert.equal(retry.replayed,true);assert.equal(retry.state,later);assert.equal(retry.event,later.events[0]);assert.equal(retry.state.events.length,2);assert.equal(sum(retry.state),BigInt(initial));
 for(const mutation of [{amount:'10'},{amount:'11'},{to:'bank'},{from:'bank'}])rejects(()=>transferTreasurySimulation(later,{...request,...mutation}),'SIMULATION_ID_CONFLICT');
});

test('invalid transfers and overdraws never mutate the current simulation',()=>{
 const state=createTreasurySimulation(),before=JSON.stringify(state),valid={id:'transfer-1',from:'native',to:'stripe',amount:'1'};
 for(const transfer of [{...valid,id:''},{...valid,id:'trailing\n'},{...valid,id:'x'.repeat(129)},{...valid,from:'unknown'},{...valid,to:'native'},{...valid,amount:'0'},{...valid,amount:'-1'},{...valid,amount:'0.0000001'},{...valid,amount:1},{...valid,amount:'500000000000000.000001'},{...valid,providerConfirmed:true},{...valid,receipt:{id:'not-real'}}])assert.throws(()=>transferTreasurySimulation(state,transfer));
 rejects(()=>move(state,'overdraw-empty','stripe','bank','1'),'SIMULATION_INSUFFICIENT_BALANCE');assert.equal(JSON.stringify(state),before);
});

test('snapshots are immutable and serialize without losing exact amounts',()=>{
 const result=move(createTreasurySimulation(),'small','native','stripe','0.000001');assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.state.balances));assert.ok(Object.isFrozen(result.state.events));assert.ok(Object.isFrozen(result.event));
 assert.throws(()=>{result.state.balances.bank='1';},TypeError);assert.throws(()=>{TREASURY_SIMULATION_BUCKETS.stripe.unit='NUSD';},TypeError);
 const restored=JSON.parse(JSON.stringify(result.state));assert.deepEqual(summarizeTreasurySimulation(restored),summarizeTreasurySimulation(result.state));
 const next=move(restored,'return','stripe','native','0.000001').state;assert.equal(next.balances.native,initial);assert.equal(next.balances.stripe,'0');
});

test('corrupted or counterfeit snapshots fail replay validation before a transfer',()=>{
 const valid=move(createTreasurySimulation(),'one','native','stripe','1').state;
 const changes=[s=>s.totalBaseUnits='1000000000000000000000',s=>s.providerWrites=true,s=>s.journalWrites=true,s=>s.mode='live',s=>s.balances.native='0',s=>s.balances.stripe='01',s=>s.balances.bank=1,s=>s.balances.bank='-1',s=>s.events.push({...s.events[0]}),s=>s.events[0].amountBaseUnits='2',s=>s.events[0].amount='2',s=>s.events=[],s=>s.receipt={verified:true}];
 for(const change of changes){const state=JSON.parse(JSON.stringify(valid));change(state);rejects(()=>move(state,'two','stripe','bank','0.000001'),'SIMULATION_INVALID_STATE');rejects(()=>summarizeTreasurySimulation(state),'SIMULATION_INVALID_STATE');}
});

test('the model performs no network, browser storage or provider/journal writes',async t=>{
 let network=0;t.mock.method(globalThis,'fetch',()=>{network++;throw Error('Unexpected network');});
 const source=readFileSync(new URL('../public/treasury-simulation-model.js',import.meta.url),'utf8');assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\s*[.(]/);assert.doesNotMatch(source,/^import /m);
 const result=move(createTreasurySimulation(),'offline','native','bank','0.01');quoteTreasurySimulation('1');summarizeTreasurySimulation(result.state);assert.equal(network,0);assert.equal(result.state.providerWrites,false);assert.equal(result.state.journalWrites,false);
});
