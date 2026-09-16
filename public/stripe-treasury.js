import {requestJson,createViewScope} from './http-client.js';
import {isTreasuryMinorInteger} from './treasury-amount.js';
const stripeElement=id=>document.getElementById(id),stripeScope=createViewScope();
const stripeNode=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
function stripeProviderRouteControl(generation){
  const container=stripeNode('dd',''),button=stripeNode('button','Check deposit routes'),result=stripeNode('div','');
  button.type='button';
  button.onclick=async()=>{
    button.disabled=true;result.replaceChildren(stripeNode('p','Checking current Stripe destinations…'));
    try{
      const data=await requestJson('/api/control/v2/treasury/provider-routes',{signal:stripeScope.signal,timeoutMs:12000});
      if(!stripeScope.isCurrent(generation))return;
      if(data.schema!=='numina.treasury.provider-routes.v1'||data.provider!=='Stripe'||data.connection!=='read_only'||data.transfer_execution!==false||data.submission_performed!==false||data.receipt!==null||data.nusd?.provider_acceptance_verified!==false||!['NOT_REPORTED','OBSERVATION_INCOMPLETE','ASSET_IDENTITY_NOT_VERIFIED'].includes(data.nusd.status)||typeof data.complete!=='boolean'||!Array.isArray(data.routes)||data.routes.length>50)throw Error('Invalid provider routes');
      const nodes=[stripeNode('p',data.nusd.status==='NOT_REPORTED'?'Stripe has not listed an NUSD deposit route.':data.nusd.status==='OBSERVATION_INCOMPLETE'?'The provider route list is incomplete; NUSD acceptance is unverified.':'Stripe reports an NUSD label; the token identity still requires verification.')];
      for(const route of data.routes){
        if(!['currency','network','address','status'].every(key=>typeof route[key]==='string'&&route[key].length<=256)||!(route.memo===null||typeof route.memo==='string'&&route.memo.length<=256)||typeof route.provider_reported_active!=='boolean')throw Error('Invalid route');
        nodes.push(stripeNode('p',route.currency.toUpperCase()+' · '+route.network+' · '+(route.provider_reported_active?'Provider reports active':'Unavailable')+' · '+route.address+(route.memo===null?'':' · Memo: '+route.memo)));
      }
      nodes.push(stripeNode('p','Destination information only. Source funds and conversion require separate verification. No deposit was submitted.'));
      if(!data.complete)nodes.push(stripeNode('p','Additional provider records were not included in this observation.'));
      result.replaceChildren(...nodes);
    }catch(error){
      if(!stripeScope.isCurrent(generation))return;
      if(error.status===401||error.status===403){clearStripeTreasury();document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
      result.replaceChildren(stripeNode('p','Deposit routes could not be checked. No acceptance is confirmed.'));
    }finally{button.disabled=false;}
  };
  container.append(button,result);return container;
}
export function clearStripeTreasury(){
  stripeScope.reset();stripeElement('stripe-treasury-panel').hidden=true;stripeElement('stripe-treasury-details').replaceChildren();stripeElement('stripe-treasury-message').textContent='';stripeElement('stripe-treasury-dashboard').removeAttribute('href');stripeElement('stripe-treasury-dashboard').hidden=true;
}
export async function loadStripeTreasury(){
  clearStripeTreasury();const generation=stripeScope.generation;
  stripeElement('stripe-treasury-panel').hidden=false;stripeElement('stripe-treasury-message').textContent='Checking Stripe Financial account…';
  try{
    const data=await requestJson('/api/control/v1/stripe-treasury',{signal:stripeScope.signal});
    if(!stripeScope.isCurrent(generation))return;
    if(data.schema!=='numina.stripe.treasury.v1'||data.provider!=='Stripe'||data.connection!=='read_only'||data.account?.livemode!==true||!['open','closed'].includes(data.account.status)||data.transfer_execution!==false||data.nusd_settlement!==false||!Number.isFinite(Date.parse(data.observed_at)))throw Error('Invalid Stripe response');
    const dashboard=new URL(data.dashboard_url);
    if(dashboard.href!=='https://dashboard.stripe.com/acct_1UEEPnQdJat0efmT/treasury')throw Error('Invalid Stripe destination');
    const rows=[['Connection','Read only'],['Financial account',data.account.name],['Account status',data.account.status==='open'?'Open':'Closed']];
    for(const [bucket,label]of [['available','Available'],['inbound_pending','Incoming pending'],['outbound_pending','Outgoing pending']]){
      for(const currency of ['usd','usdc']){
        const amount=data.balances?.[bucket]?.[currency];
        if(amount!==null&&(!amount||amount.currency!==currency||!isTreasuryMinorInteger(amount.value)||typeof amount.formatted!=='string'||amount.formatted.length>112))throw Error('Invalid Stripe balance');
        rows.push([label+' '+currency.toUpperCase(),amount===null?'Not provided by Stripe':amount.formatted]);
      }
    }
    if(data.provider_nusd_balance){rows.push(['Stripe NUSD currency record',data.provider_nusd_balance.status==='not_reported'?'Not reported by Stripe':'Provider currency reported; token identity and precision require verification']);}
    rows.push(['Checked',new Date(data.observed_at).toLocaleString()],['Transfers from Numina','Not connected'],['NUSD settlement','Not connected']);
    const details=stripeElement('stripe-treasury-details');details.replaceChildren();for(const [label,value]of rows)details.append(stripeNode('dt',label),stripeNode('dd',value));
    details.append(stripeNode('dt','Provider deposit routes'),stripeProviderRouteControl(generation));
    const link=stripeElement('stripe-treasury-dashboard');link.href=dashboard.href;link.hidden=false;
    stripeElement('stripe-treasury-message').textContent='Balances retrieved from Stripe. Funding and available transfer actions are managed in Stripe.';
  }catch(error){
    if(!stripeScope.isCurrent(generation))return;
    if(error.status===401||error.status===403){clearStripeTreasury();document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
    stripeElement('stripe-treasury-details').replaceChildren();
    stripeElement('stripe-treasury-message').textContent=error.code==='STRIPE_TREASURY_NOT_CONNECTED'?'Stripe balance connection is not configured. No current balance is available here.':'Stripe balance could not be checked. Use Refresh to try again.';
  }
}
