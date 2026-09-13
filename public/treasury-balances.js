const item=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
function detail(list,label,value){const row=item('div','');row.append(item('dt',label),item('dd',value));list.append(row);}
export async function renderTreasuryBalances(target){
  target.replaceChildren();
  const heading=item('h3','Designated funding sources');
  const grid=item('div','');grid.className='cards two treasury-balances';
  const stripe=item('article','');stripe.append(item('h4','Stripe Treasury'),item('p','Reading the connected financial account…'));
  const bank=item('article','');bank.append(item('h4','Bank of America Savings'),item('p','SK Consulting LLC'));
  const bankRows=item('dl','');detail(bankRows,'Available USD','Unavailable — bank connection required');detail(bankRows,'Reserve allocation','Unverified');bank.append(bankRows);
  grid.append(stripe,bank);
  target.append(heading,grid,item('p','Reconciliation is incomplete. The native NUSD projection has no verified allocation to these accounts. A funding gap cannot be calculated until bank balances, asset eligibility and allocation are verified.'));
  try{
    const response=await fetch('/api/control/v1/stripe-treasury',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Provider observation unavailable');
    const record=await response.json();
    if(record.schema!=='numina.stripe.treasury.v1'||record.account?.livemode!==true)throw Error('Invalid observation');
    stripe.replaceChildren(item('h4','Stripe Treasury'),item('p',record.account.name));
    const list=item('dl','');
    for(const [bucket,label] of [['available','Available'],['inbound_pending','Incoming'],['outbound_pending','Outgoing']]){
      for(const currency of ['usd','usdc'])detail(list,label+' '+currency.toUpperCase(),record.balances?.[bucket]?.[currency]?.formatted??'Not reported');
    }
    detail(list,'Provider NUSD balance',record.provider_nusd_balance?.status==='not_reported'?'Not reported by Stripe':'Requires asset identity and precision verification');
    detail(list,'Observed at',record.observed_at);stripe.append(list);
    const evidence=item('details','');evidence.append(item('summary','Provider evidence'));
    const source=item('dl','');detail(source,'Financial account',record.account.id);detail(source,'Provider request',record.provider_request_id??'Not supplied');detail(source,'Connection','Read-only live account');evidence.append(source);stripe.append(evidence);
  }catch{stripe.replaceChildren(item('h4','Stripe Treasury'),item('p','Live balance unavailable. Refresh to request a new provider observation.'));}
}
