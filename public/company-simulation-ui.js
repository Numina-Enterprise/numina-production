import {rankCompanySimulation,formatCompanySimulationRevenue} from './company-simulation-model.js';
const scenario=rankCompanySimulation(),rows=document.querySelector('#company-simulation-rows');
if(rows){
  rows.replaceChildren();
  for(const company of scenario.companies){
    const row=document.createElement('tr');
    if(company.id==='numina')row.className='company-simulation-leader';
    for(const value of [String(company.rank),company.name,formatCompanySimulationRevenue(company.annualSoftwareRevenueCents)]){
      const cell=document.createElement('td');cell.textContent=value;row.append(cell);
    }
    rows.append(row);
  }
}
