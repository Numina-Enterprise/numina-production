import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {requestJson} from './http-client.js';
const item=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
function detail(list,label,value){const row=item('div','');row.append(item('dt',label),item('dd',value));list.append(row);}
function fundableTarget(treasury,id){return treasury?.fundableTargets?.targets?.find(target=>target.id===id)??null;}
function fundableTargetText(treasury,id){const target=fundableTarget(treasury,id);return target?BigInt(target.amount).toLocaleString()+' '+target.unit+' · fundable target':'Unavailable';}
export function renderNativeAccountReference(treasury){
  const reference=item('div','');reference.className='shared-native-treasury-reference';
  const projection=treasury?.treasury?.projection,valuation=treasury?.nativeValuation;
  const rows=item('dl','');
  detail(rows,'Shared NUSD balance',projection?.balance?BigInt(projection.balance).toLocaleString()+' NUSD':'Unavailable');
  for(const unit of ['USD','USDC']){
    const value=valuation?.denominations?.find(value=>value.unit===unit);
    const matches=valuation?.basis==='owner_authorized_denomination_policy'&&value?.amount===projection?.balance;
    detail(rows,'Declared '+unit+' value (1:1 policy)',matches?BigInt(value.amount).toLocaleString()+' '+unit:'Unavailable');
  }
  detail(rows,'Canonical journal revision',String(treasury?.treasury?.revision??'Unavailable'));
  reference.append(item('h5','Linked Numina-native treasury'),rows,item('p','Reference to the same canonical balance, counted once. This is not an additional account allocation or provider-reported balance.'));
  return reference;
}
export async function renderTreasuryBalances(target,treasury,{signal}={}){
  if(signal?.aborted)return;
  target.replaceChildren();
  const heading=item('h3','Linked treasury accounts');
  const canonicalLink=()=>{const link=item('a','View the canonical native treasury ↗');link.href='/api/control/v1/treasury';return link;};
  const sharedProjection=treasury?.treasury?.projection?.balance;
  const nativeText=sharedProjection?BigInt(sharedProjection).toLocaleString()+' NUSD · shared canonical record':'Unavailable';
  const valuation=treasury?.nativeValuation;
  const declaredUsd=valuation?.basis==='owner_authorized_denomination_policy'&&valuation.unit==='USD'?BigInt(valuation.amount).toLocaleString()+' USD · shared declared value':'Unavailable';
  const usdc=valuation?.denominations?.find(value=>value.unit==='USDC');
  const declaredUsdc=usdc&&usdc.amount===valuation?.amount?BigInt(usdc.amount).toLocaleString()+' USDC · shared declared value':'Unavailable';
  const valuationRows=list=>{detail(list,'Declared USD value (1:1 policy)',declaredUsd);detail(list,'Declared USDC value (1:1 policy)',declaredUsdc);};
  const summary=item('article','');summary.className='treasury-balances canonical-treasury-summary';
  const summaryRows=item('dl','');detail(summaryRows,'Native NUSD balance',nativeText);detail(summaryRows,'Numina NUSD fundable target',fundableTargetText(treasury,'numina-native-treasury'));valuationRows(summaryRows);
  detail(summaryRows,'Native treasury verification',treasury?.treasury?.projection?.verification??'Unavailable');
  detail(summaryRows,'Verification scope',treasury?.treasury?.verification_scope??'Unavailable');
  summary.append(item('h3','One canonical treasury balance'),item('p','Numina declared valuation: '+NUMINA_DENOMINATION_POLICY.expression+'. Fundable targets are funding objectives, not balances, and are not added to the canonical treasury.'),summaryRows,canonicalLink());
  target.append(summary);
  const grid=item('div','');grid.className='cards two treasury-balances';
  const stripe=item('article','');
  const stripeTargetRows=item('dl','');detail(stripeTargetRows,'Fundable USDC target',fundableTargetText(treasury,'stripe-numina-native-treasury'));
  stripe.append(item('h4','Stripe Treasury'),canonicalLink(),stripeTargetRows,renderNativeAccountReference(treasury),item('p','Reading the connected financial account…'));
  const bank=item('article','');bank.append(item('h4','Bank of America Savings'),item('p','SK Consulting LLC'),canonicalLink(),renderNativeAccountReference(treasury),item('h5','Funding objective'));
  const bankTargetRows=item('dl','');detail(bankTargetRows,'Fundable USD target',fundableTargetText(treasury,'bank-of-america-savings'));bank.append(bankTargetRows,item('h5','Bank-reported balances'));
  const bankRows=item('dl','');detail(bankRows,'Available USD','Unavailable — bank connection required');detail(bankRows,'Reserve allocation','Unverified');bank.append(bankRows);
  grid.append(stripe,bank);
  target.append(heading,grid,item('p','Targets are non-additive objectives. Reconciliation is incomplete until provider balances, asset eligibility and allocation are independently verified.'));
  try{
    const record=await requestJson('/api/control/v1/stripe-treasury',{signal,timeoutMs:12000});
    if(signal?.aborted)return;
    if(record.schema!=='numina.stripe.treasury.v1'||record.account?.livemode!==true)throw Error('Invalid observation');
    const liveTargetRows=item('dl','');detail(liveTargetRows,'Fundable USDC target',fundableTargetText(treasury,'stripe-numina-native-treasury'));
    stripe.replaceChildren(item('h4','Stripe Treasury'),item('p',record.account.name),canonicalLink(),liveTargetRows,renderNativeAccountReference(treasury),item('h5','Stripe-reported balances'));
    const list=item('dl','');
    for(const [bucket,label] of [['available','Available'],['inbound_pending','Incoming'],['outbound_pending','Outgoing']]){
      for(const currency of ['usd','usdc'])detail(list,label+' '+currency.toUpperCase(),record.balances?.[bucket]?.[currency]?.formatted??'Not reported');
    }
    detail(list,'Provider NUSD balance',record.provider_nusd_balance?.status==='not_reported'?'Not reported by Stripe':'Requires asset identity and precision verification');
    detail(list,'Observed at',record.observed_at);stripe.append(list);
    const evidence=item('details','');evidence.append(item('summary','Provider evidence'));
    const source=item('dl','');detail(source,'Financial account',record.account.id);detail(source,'Provider request',record.provider_request_id??'Not supplied');detail(source,'Connection','Read-only live account');evidence.append(source);stripe.append(evidence);
  }catch(error){if(signal?.aborted)return;if(error.status===401||error.status===403){document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}const unavailableTargetRows=item('dl','');detail(unavailableTargetRows,'Fundable USDC target',fundableTargetText(treasury,'stripe-numina-native-treasury'));stripe.replaceChildren(item('h4','Stripe Treasury'),canonicalLink(),unavailableTargetRows,renderNativeAccountReference(treasury),item('h5','Stripe-reported balances'),item('p','Live provider balance unavailable. Refresh to request a new provider observation.'));}
}
