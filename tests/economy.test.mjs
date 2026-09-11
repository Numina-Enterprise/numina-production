import test from 'node:test';
import assert from 'node:assert/strict';
import {planWork,units,decimal} from '../public/economy-model.js';
const input={acceptedUnits:'1000',unitPrice:'0.50',fundedAmount:'600',feeBps:'200',providerCost:'2',meteringVerified:true,customerAccepted:true,authorized:true,transferConfirmed:false,payoutConfirmed:false,experienceDelivered:false};
test('scenario conserves funded value and never represents an executed transaction',()=>{
 const r=planWork(input);assert.equal(r.order_value_usdc,'500.000000');assert.equal(r.proposed_software_fee_usdc,'10.000000');assert.equal(r.recipient_net_usdc,'488.000000');assert.equal(r.unused_funding_usdc,'100.000000');assert.equal(r.eligible_in_scenario,true);assert.equal(r.external_execution_performed,false);assert.equal(r.transfer_confirmed_in_scenario,false);
 assert.equal(units(r.recipient_net_usdc)+units(r.proposed_software_fee_usdc)+units(r.provider_cost_assumption_usdc)+units(r.unused_funding_usdc),units(input.fundedAmount));
});
test('missing acceptance, authority, evidence, or funding prevents all dependent payment states',()=>{
 for(const change of [{customerAccepted:false},{authorized:false},{meteringVerified:false},{fundedAmount:'499.999999'},{providerCost:'500'},{acceptedUnits:'0'}]){
  const r=planWork({...input,...change,transferConfirmed:true,payoutConfirmed:true,experienceDelivered:true});assert.equal(r.eligible_in_scenario,false);assert.ok(r.reasons.length);assert.equal(r.transfer_confirmed_in_scenario,false);assert.equal(r.payout_confirmed_in_scenario,false);assert.equal(r.experience_delivered_in_scenario,false);
 }
});
test('bank payout and user delivery are distinct and require confirmed transfer',()=>{
 assert.equal(planWork({...input,payoutConfirmed:true}).payout_confirmed_in_scenario,false);
 const r=planWork({...input,transferConfirmed:true,experienceDelivered:true});assert.equal(r.experience_delivered_in_scenario,true);assert.equal(r.payout_confirmed_in_scenario,false);
});
test('micro-unit arithmetic remains exact and malformed or out-of-range inputs fail',()=>{
 assert.equal(decimal(units('0.000001')),'0.000001');
 assert.equal(planWork({...input,acceptedUnits:'3',unitPrice:'0.000001',providerCost:'0',feeBps:'0'}).order_value_usdc,'0.000003');
 for(const change of [{acceptedUnits:'1.5'},{acceptedUnits:'Infinity'},{feeBps:'10001'},{unitPrice:'-1'},{fundedAmount:'1e6'},{providerCost:'0.0000001'}])assert.throws(()=>planWork({...input,...change}));
});
