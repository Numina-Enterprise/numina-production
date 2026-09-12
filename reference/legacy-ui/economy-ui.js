import {planWork} from './economy-model.js';
const $=id=>document.getElementById(id);let current=null;
const money=n=>{const [whole,fraction='']=n.split('.');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction.replace(/0+$/,'').padEnd(2,'0');};
function update(){
  try{
    const input={acceptedUnits:$('accepted-units').value,unitPrice:$('unit-price').value,fundedAmount:$('funded-amount').value,feeBps:$('fee-bps').value,providerCost:$('provider-cost').value,meteringVerified:$('metered').checked,customerAccepted:$('accepted').checked,authorized:$('authorized').checked,transferConfirmed:$('transferred').checked,payoutConfirmed:$('paid-out').checked,experienceDelivered:$('delivered').checked};
    current=planWork(input);current.scenario_inputs=input;
    $('order-value').textContent=money(current.order_value_usdc)+' USDC';$('software-fee').textContent=money(current.proposed_software_fee_usdc)+' USDC';$('net-value').textContent=money(current.recipient_net_usdc)+' USDC';$('unused-funding').textContent=money(current.unused_funding_usdc)+' USDC';
    $('scenario-outcome').textContent=current.eligible_in_scenario?'Eligible in this scenario':'Payment held in this scenario';
    $('scenario-reasons').textContent=current.reasons.length?current.reasons.join(' '):'The modeled conditions pass. A real adapter would still need authenticated evidence, an approved network and token, replay protection, and a signed transaction.';
    $('transfer-state').textContent=current.transfer_confirmed_in_scenario?'Confirmed in scenario':'Awaiting transfer evidence';
    $('payout-state').textContent=current.payout_confirmed_in_scenario?'Bank receipt in scenario':'Awaiting recipient bank receipt';
    $('experience-state').textContent=current.experience_delivered_in_scenario?'Delivered in scenario':'Awaiting confirmed payment and delivery';
    $('scenario-error').textContent='';$('export-plan').disabled=false;
  }catch(error){current=null;$('scenario-error').textContent=error.message;$('scenario-outcome').textContent='Check the inputs';$('scenario-reasons').textContent='No valid scenario is being shown.';for(const id of ['order-value','software-fee','net-value','unused-funding','transfer-state','payout-state','experience-state'])$(id).textContent='—';$('export-plan').disabled=true;}
}
document.querySelectorAll('.economy-studio input').forEach(el=>el.addEventListener('input',update));
$('export-plan').addEventListener('click',()=>{if(!current)return;const data={...current,created_at:new Date().toISOString(),contract_requirements:['Funded order and spending cap','Approved token, network, buyer and recipient','Authenticated compute meter and result acceptance','Unique order and nonce, deadline, dispute/refund policy','Idempotent payout and independent settlement evidence'],signed:false,transaction_submitted:false};const href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=href;a.download='numina-compute-value-scenario.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);$('export-message').textContent='Scenario export prepared. It is unsigned and cannot move funds.';});
update();
