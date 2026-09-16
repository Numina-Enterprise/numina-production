import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rankCompanySimulation,parseCompanySimulationRevenue,formatCompanySimulationRevenue,COMPANY_SIMULATION_INPUTS} from '../public/company-simulation-model.js';

test('Numina leads only the simulated revenue scenario, with unique companies and immutable inputs',()=>{
  const before=JSON.stringify(COMPANY_SIMULATION_INPUTS),scenario=rankCompanySimulation();
  assert.equal(scenario.companies[0].id,'numina');assert.equal(scenario.companies[0].rank,1);
  assert.equal(scenario.companies[0].annualSoftwareRevenueCents,'100000000000000');
  assert.deepEqual(scenario.companies.map(company=>company.rank),[1,2,3,4]);
  assert.equal(scenario.companyCount,4);assert.equal(new Set(scenario.companies.map(company=>company.id)).size,4);
  assert.equal(scenario.mode,'simulated_scenario');assert.equal(scenario.source,'synthetic_scenario_inputs');
  for(const flag of ['realMarketRankingVerified','providerEvidence','treasuryBalanceChanged','providerWrites','journalWrites'])assert.equal(scenario[flag],false);
  assert.equal(JSON.stringify(COMPANY_SIMULATION_INPUTS),before);assert.ok(Object.isFrozen(scenario.companies[0]));
  assert.deepEqual(JSON.parse(JSON.stringify(scenario)),scenario);
});

test('exact cents beyond Number precision rank correctly and ties share competition rank deterministically',()=>{
  const company=(id,revenue)=>({id,name:id,annualSoftwareRevenue:revenue});
  const inputs=[company('zulu','9007199254740993.01'),company('leader','9007199254740993.02'),company('alpha','9007199254740993.01'),company('last','1')],before=JSON.stringify(inputs);
  const ranked=rankCompanySimulation(inputs);
  assert.deepEqual(ranked.companies.map(({id,rank})=>[id,rank]),[['leader',1],['alpha',2],['zulu',2],['last',4]]);
  assert.equal(parseCompanySimulationRevenue('9007199254740993.02'),900719925474099302n);
  assert.equal(formatCompanySimulationRevenue(ranked.companies[0].annualSoftwareRevenueCents),'9,007,199,254,740,993.02');
  assert.equal(JSON.stringify(inputs),before);
});

test('invalid or duplicate revenue inputs cannot silently round or double-count a company',()=>{
  for(const value of [1,NaN,Infinity,null,'-1','01','1e12','1,000','1.001','1\n',' 1','1 '])assert.throws(()=>parseCompanySimulationRevenue(value),/SIMULATION_INVALID_REVENUE/);
  assert.equal(parseCompanySimulationRevenue('0.01'),1n);assert.equal(formatCompanySimulationRevenue('1'),'0.01');
  assert.throws(()=>rankCompanySimulation([...COMPANY_SIMULATION_INPUTS,COMPANY_SIMULATION_INPUTS[0]]),/SIMULATION_INVALID_COMPANY/);
  assert.throws(()=>rankCompanySimulation([]),/SIMULATION_INVALID_COMPANIES/);
});

test('the page labels the simulated metric and no ranking code contacts providers or modifies the treasury',()=>{
  const html=readFileSync(new URL('../public/treasury-simulation.html',import.meta.url),'utf8');
  assert.match(html,/SIMULATED COMPANY SCENARIO/);assert.match(html,/Numina ranks #1 in this simulated scenario/);
  assert.match(html,/Simulated annual software revenue/);assert.match(html,/not actual company revenue, a real-market ranking, treasury balances or provider evidence/);
  for(const file of ['company-simulation-model.js','company-simulation-ui.js']){
    const source=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\s*[.(]|innerHTML|writeTreasury|eth_sendTransaction/);
  }
  assert.match(html,/500,000,000,000,000/);
});
