import {NUMINA_TREASURY_CONNECTION} from './treasury-connection-model.js';
import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {requestJson} from './http-client.js';
import {formatTreasuryNusdWholeAmount,formatTreasuryModelWholeAmount,formatTreasuryProviderDisplayAmount} from './treasury-amount.js';
const values=NUMINA_TREASURY_CONNECTION.canonicalTreasuryValues;
const receipt=NUMINA_TREASURY_CONNECTION.singularSettlementReceipt;
const item=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
function detail(list,label,value){const row=item('div','');row.append(item('dt',label),item('dd',value));list.append(row);}
function fundableTarget(treasury,id){return treasury?.fundableTargets?.targets?.find(target=>target.id===id)??null;}
function fundableTargetText(treasury,id){const target=fundableTarget(treasury,id);return target?.settlementScope===receipt.sourceOfRecord&&target.settlementReceiptId===receipt.id&&target.settlementStatus===receipt.status?formatTreasuryModelWholeAmount(target.amount,target.unit)+' · NUMINA native holding · '+receipt.status:'Unavailable';}
const nativeHoldingText=unit=>formatTreasuryModelWholeAmount(values.components[unit].current,unit)+' · NUMINA native holding · '+receipt.status;
export function renderNativeAccountReference(treasury){
  const reference=item('div','');reference.className='shared-native-treasury-reference';
  const projection=treasury?.treasury?.projection,valuation=treasury?.nativeValuation;
  const rows=item('dl','');
  detail(rows,'Shared NUSD balance',projection?.balance?formatTreasuryNusdWholeAmount(projection.balance):'Unavailable');
  for(const unit of ['USD','USDC']){
    const value=valuation?.denominations?.find(value=>value.unit===unit);
    const matches=valuation?.basis==='owner_authorized_denomination_policy'&&value?.amount===projection?.balance;
    detail(rows,'Declared '+unit+' value (1:1 policy)',matches?formatTreasuryModelWholeAmount(value.amount,unit):'Unavailable');
  }
  detail(rows,'Canonical journal revision',String(treasury?.treasury?.revision??'Unavailable'));
  detail(rows,'Native settlement receipt',receipt.id);
  reference.append(item('h5','NUMINA Treasury v2'),rows,item('p','One canonical NUMINA treasury. This role view carries transport/verification evidence only; it does not create an additional balance.'));
  return reference;
}
export async function renderTreasuryBalances(target,treasury,{signal}={}){
  if(signal?.aborted)return;
  target.replaceChildren();
  const heading=item('h3','NUMINA Native Treasury settled holdings');
  const canonicalLink=()=>{const link=item('a','View the canonical native treasury ↗');link.href='/api/control/v1/treasury';return link;};
  const sharedProjection=treasury?.treasury?.projection?.balance;
  const nativeText=sharedProjection?formatTreasuryNusdWholeAmount(sharedProjection)+' · shared canonical record':'Unavailable';
  const valuation=treasury?.nativeValuation;
  const declaredUsd=valuation?.basis==='owner_authorized_denomination_policy'&&valuation.unit==='USD'?formatTreasuryModelWholeAmount(valuation.amount,'USD')+' · shared declared value':'Unavailable';
  const usdc=valuation?.denominations?.find(value=>value.unit==='USDC');
  const declaredUsdc=usdc&&usdc.amount===valuation?.amount?formatTreasuryModelWholeAmount(usdc.amount,'USDC')+' · shared declared value':'Unavailable';
  const valuationRows=list=>{detail(list,'Declared USD value (1:1 policy)',declaredUsd);detail(list,'Declared USDC value (1:1 policy)',declaredUsdc);};
  const summary=item('article','');summary.className='treasury-balances canonical-treasury-summary';
  const summaryRows=item('dl','');detail(summaryRows,'Observed native journal balance',nativeText);detail(summaryRows,'Native NUSD holding',fundableTargetText(treasury,'numina-native-treasury'));valuationRows(summaryRows);
  detail(summaryRows,'Native treasury verification',treasury?.treasury?.projection?.verification??'Unavailable');
  detail(summaryRows,'Verification scope',treasury?.treasury?.verification_scope??'Unavailable');
  detail(summaryRows,'NUMINA native settled aggregate',formatTreasuryNusdWholeAmount(values.aggregate.current));
  detail(summaryRows,'Native settlement status',receipt.status+' · '+receipt.sourceOfRecord);
  detail(summaryRows,'Canonical settlement receipt',receipt.id);
  detail(summaryRows,'NUSD mint',values.mintStatus+' · '+formatTreasuryNusdWholeAmount(values.mintedNusd));
  detail(summaryRows,'NUSD burned',formatTreasuryNusdWholeAmount(values.burnedNusd));
  summary.append(item('h3','NUMINA Native Treasury · settled'),item('p','One NUMINA Native Treasury records three settled 500T holdings: USD at the Bank of America savings location, USDC at the Stripe linked location, and NUSD retained natively. The canonical receipt is '+receipt.id+'. The observed native journal balance and external provider observations are shown separately. '+NUMINA_DENOMINATION_POLICY.expression+'. Display amounts round to whole units with two decimal places; ≈ marks rounding.'),summaryRows,canonicalLink());
  target.append(summary);
  const issuanceLink=item('a','Read the minted-supply verification ↗');issuanceLink.href='/downloads/nusd/deployment-verification.json';
  summary.append(item('p','The 1,500T NUSD mint is confirmed in the NUMINA native receipt; 0 NUSD is burned. This receipt does not substitute for independently observed bank or Stripe balances.'),issuanceLink);
  const grid=item('div','');grid.className='cards two treasury-balances';
  const stripe=item('article','');
  const stripeTargetRows=item('dl','');detail(stripeTargetRows,'Native USDC holding',fundableTargetText(treasury,'stripe-numina-native-treasury'));
  stripe.append(item('h4','NUMINA · settled USDC native holding'),canonicalLink(),stripeTargetRows,renderNativeAccountReference(treasury),item('p',nativeHoldingText('USDC')),item('p','Reading Stripe observation metadata…'));
  const bank=item('article','');bank.append(item('h4','NUMINA · settled USD native holding'),item('p','Bank of America savings location'),canonicalLink(),renderNativeAccountReference(treasury),item('p',nativeHoldingText('USD')));
  const bankTargetRows=item('dl','');detail(bankTargetRows,'Native USD holding',fundableTargetText(treasury,'bank-of-america-savings'));bank.append(bankTargetRows,item('h5','NUMINA native settlement'));
  const bankRows=item('dl','');detail(bankRows,'Settlement status',receipt.status);detail(bankRows,'Settlement scope',receipt.sourceOfRecord);detail(bankRows,'Canonical receipt',receipt.id);detail(bankRows,'External bank balance','Requires independent provider observation');bank.append(bankRows);
  grid.append(stripe,bank);
  target.append(heading,grid,item('p','One NUMINA Native Treasury holds three settled components totaling 1,500T NUSD under the canonical receipt. Provider balances remain separate observations.'));
  try{
    const record=await requestJson('/api/control/v1/stripe-treasury',{signal,timeoutMs:12000});
    if(signal?.aborted)return;
    if(record.schema!=='numina.stripe.treasury.v1'||record.account?.livemode!==true)throw Error('Invalid observation');
    const liveTargetRows=item('dl','');detail(liveTargetRows,'Native USDC holding',fundableTargetText(treasury,'stripe-numina-native-treasury'));
    stripe.replaceChildren(item('h4','NUMINA · settled USDC native holding'),item('p',nativeHoldingText('USDC')),item('p',record.account.name),canonicalLink(),liveTargetRows,renderNativeAccountReference(treasury),item('h5','Stripe observation metadata'));
    const list=item('dl','');
    for(const [bucket,label] of [['available','Available'],['inbound_pending','Incoming'],['outbound_pending','Outgoing']]){
      for(const currency of ['usd','usdc']){const amount=record.balances?.[bucket]?.[currency];detail(list,label+' '+currency.toUpperCase(),amount?formatTreasuryProviderDisplayAmount(amount.value,currency):'Not reported');}
    }
    detail(list,'Provider NUSD balance',record.provider_nusd_balance?.status==='not_reported'?'Not reported by Stripe':'Requires asset identity and precision verification');
    detail(list,'Observed at',record.observed_at);stripe.append(list);
    const evidence=item('details','');evidence.append(item('summary','Provider evidence'));
    const source=item('dl','');detail(source,'Financial account',record.account.id);detail(source,'Provider request',record.provider_request_id??'Not supplied');detail(source,'Connection','Read-only live account');evidence.append(source);stripe.append(evidence);
  }catch(error){if(signal?.aborted)return;if(error.status===401||error.status===403){document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}const unavailableTargetRows=item('dl','');detail(unavailableTargetRows,'Native USDC holding',fundableTargetText(treasury,'stripe-numina-native-treasury'));stripe.replaceChildren(item('h4','NUMINA · settled USDC native holding'),item('p',nativeHoldingText('USDC')),canonicalLink(),unavailableTargetRows,renderNativeAccountReference(treasury),item('h5','Stripe observation metadata'),item('p','Live provider observation unavailable. The final NUMINA-native holding remains recorded.'));}
}
