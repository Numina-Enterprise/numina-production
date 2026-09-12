const SCALE=1000000n;
export function units(value){
  if(!/^\d{1,12}(\.\d{1,6})?$/.test(String(value)))throw new Error('Use a non-negative number with up to six decimal places.');
  const [whole,fraction='']=String(value).split('.');return BigInt(whole)*SCALE+BigInt(fraction.padEnd(6,'0'));
}
export function decimal(value){return (value/SCALE)+'.'+(value%SCALE).toString().padStart(6,'0');}
export function planWork(input){
  const count=Number(input.acceptedUnits);
  if(!Number.isSafeInteger(count)||count<0||count>1000000000)throw new Error('Accepted units must be a whole number from 0 to 1,000,000,000.');
  const rate=units(input.unitPrice),funding=units(input.fundedAmount),provider=units(input.providerCost);
  const bps=Number(input.feeBps);
  if(!Number.isInteger(bps)||bps<0||bps>10000)throw new Error('The proposed software fee must be from 0 to 10,000 basis points.');
  const gross=BigInt(count)*rate,fee=gross*BigInt(bps)/10000n,net=gross-fee-provider;
  const reasons=[];
  if(gross===0n)reasons.push('Add an accepted unit count and agreed price.');
  if(!input.meteringVerified)reasons.push('Authenticated compute evidence is required.');
  if(!input.customerAccepted)reasons.push('The customer must accept the result.');
  if(!input.authorized)reasons.push('A valid spending authorization is required.');
  if(funding<gross)reasons.push('The funded amount is below the accepted order value.');
  if(net<0n)reasons.push('Fees exceed the accepted order value.');
  const eligible=reasons.length===0;
  const confirmed=eligible&&input.transferConfirmed===true;
  const redeemed=confirmed&&input.payoutConfirmed===true;
  const delivered=confirmed&&input.experienceDelivered===true;
  return {mode:'simulation',external_execution_performed:false,conversion_assumption:'1 USDC = 1 USD for scenario arithmetic only; no issuer or payout quote is obtained.',accepted_units:count,unit_price_usd:decimal(rate),order_value_usdc:decimal(gross),proposed_software_fee_usdc:decimal(fee),provider_cost_assumption_usdc:decimal(provider),recipient_net_usdc:decimal(net<0n?0n:net),unused_funding_usdc:decimal(funding>gross?funding-gross:0n),funding_gap_usdc:decimal(funding<gross?gross-funding:0n),eligible_in_scenario:eligible,transfer_confirmed_in_scenario:confirmed,payout_confirmed_in_scenario:redeemed,experience_delivered_in_scenario:delivered,reasons};
}
