// Simulated scenario inputs only. No network, storage, treasury or provider access.
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const COMPANY_SIMULATION_SCOPE=freeze({
  schema:'numina.company-ranking.local-simulation.v1',mode:'simulated_scenario',
  metric:'simulated_annual_software_revenue',unit:'USD scenario units',period:'Scenario year 1',
  scope:'Simulated modeled companies only; not actual revenue, a real-market ranking, treasury balances or provider evidence.',
  source:'synthetic_scenario_inputs',realMarketRankingVerified:false,providerEvidence:false,
  treasuryBalanceChanged:false,providerWrites:false,journalWrites:false
});
export const COMPANY_SIMULATION_INPUTS=freeze([
  {id:'numina',name:'Numina',annualSoftwareRevenue:'1000000000000.00'},
  {id:'simulated-peer-a',name:'Simulated peer A',annualSoftwareRevenue:'750000000000.00'},
  {id:'simulated-peer-b',name:'Simulated peer B',annualSoftwareRevenue:'500000000000.00'},
  {id:'simulated-peer-c',name:'Simulated peer C',annualSoftwareRevenue:'250000000000.00'}
]);
export function parseCompanySimulationRevenue(value){
  if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,77})(?:\.[0-9]{1,2})?$/.test(value)||/[\r\n]/.test(value))throw Error('SIMULATION_INVALID_REVENUE');
  const [whole,fraction='']=value.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function formatCompanySimulationRevenue(cents){
  if(typeof cents!=='string'||!/^(0|[1-9][0-9]{0,79})$/.test(cents)||/[\r\n]/.test(cents))throw Error('SIMULATION_INVALID_REVENUE_CENTS');
  const digits=cents.padStart(3,'0');return digits.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+digits.slice(-2);
}
export function rankCompanySimulation(inputs=COMPANY_SIMULATION_INPUTS){
  if(!Array.isArray(inputs)||inputs.length===0||inputs.length>100)throw Error('SIMULATION_INVALID_COMPANIES');
  const ids=new Set();
  const ordered=inputs.map(company=>{
    if(!company||typeof company.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(company.id)||/[\r\n]/.test(company.id)||ids.has(company.id)||typeof company.name!=='string'||company.name.trim()!==company.name||!company.name||company.name.length>100)throw Error('SIMULATION_INVALID_COMPANY');
    ids.add(company.id);
    return {id:company.id,name:company.name,annualSoftwareRevenueCents:parseCompanySimulationRevenue(company.annualSoftwareRevenue).toString()};
  }).sort((a,b)=>{
    const difference=BigInt(b.annualSoftwareRevenueCents)-BigInt(a.annualSoftwareRevenueCents);
    return difference<0n?-1:difference>0n?1:a.id<b.id?-1:a.id>b.id?1:0;
  });
  let rank=0,previous=null;
  const companies=ordered.map((company,index)=>{
    if(company.annualSoftwareRevenueCents!==previous)rank=index+1;
    previous=company.annualSoftwareRevenueCents;return {...company,rank};
  });
  return freeze({...COMPANY_SIMULATION_SCOPE,companyCount:companies.length,companyCountBasis:'one unique company per row',companies});
}
