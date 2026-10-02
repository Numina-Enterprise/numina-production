import {NUMINA_TREASURY_CONNECTION,journalTreasuryMetadata} from './treasury-connection-model.js';
import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {requestJson} from './http-client.js';
import {formatTreasuryNusdWholeAmount,formatTreasuryModelWholeAmount,formatTreasuryProviderDisplayAmount} from './treasury-amount.js';

const historicalReceipt=NUMINA_TREASURY_CONNECTION.historicalSettlementReceipt;
const item=(tag,value)=>{const element=document.createElement(tag);element.textContent=value;return element;};
function detail(list,label,value){const row=item('div','');row.append(item('dt',label),item('dd',value));list.append(row);}
const target=(treasury,id)=>treasury?.fundableTargets?.targets?.find(target=>target.id===id)??null;
function targetText(treasury,id){
  const record=target(treasury,id);if(!record)return 'Unavailable';
  const value=formatTreasuryModelWholeAmount(record.amount,record.unit);
  return record.targetOnly?value+' · historical allocation target; provider balance unverified':
    record.currentNativeBalance===record.amount?value+' · matches current journal projection':value+' · historical target; current journal balance differs';
}
function nativeHoldingText(unit){
  const value=NUMINA_TREASURY_CONNECTION.canonicalTreasuryValues.components[unit];
  return value.current===null?'Current '+unit+' amount unverified · historical target '+formatTreasuryModelWholeAmount(value.modeledTarget,unit):formatTreasuryModelWholeAmount(value.current,unit);
}
const currentReceiptText=journal=>journal.singularSettlementReceiptId??'No current journal settlement receipt';

export function renderNativeAccountReference(treasury){
  const reference=item('div','');reference.className='shared-native-treasury-reference';
  const projection=treasury?.treasury?.projection,valuation=treasury?.nativeValuation,journal=journalTreasuryMetadata(projection);
  const rows=item('dl','');
  detail(rows,'Shared NUSD journal balance',projection?.unit==='NUSD'?formatTreasuryNusdWholeAmount(projection.balance):'Unavailable');
  for(const unit of ['USD','USDC']){
    const value=valuation?.denominations?.find(value=>value.unit===unit);
    const matches=valuation?.basis==='owner_authorized_denomination_policy'&&value?.amount===projection?.balance;
    detail(rows,'Declared '+unit+' value (1:1 policy)',matches?formatTreasuryModelWholeAmount(value.amount,unit):'Unavailable');
  }
  detail(rows,'Canonical journal revision',String(treasury?.treasury?.revision??'Unavailable'));
  detail(rows,'Current native settlement',journal.settlementStatus);
  detail(rows,'Current native settlement receipt',currentReceiptText(journal));
  reference.append(item('h5','NUMINA Treasury v2'),rows,item('p','One canonical NUMINA treasury. This role view carries transport and verification evidence only; it does not create an additional balance.'));
  return reference;
}

export async function renderTreasuryBalances(host,treasury,{signal}={}){
  if(signal?.aborted)return;
  host.replaceChildren();
  const projection=treasury?.treasury?.projection,journal=journalTreasuryMetadata(projection),current=journal.journalProjectionBalance;
  const canonicalLink=()=>{const link=item('a','View the canonical native treasury ↗');link.href='/api/control/v1/treasury';return link;};
  const valuation=treasury?.nativeValuation;
  const declared=unit=>{
    const value=valuation?.denominations?.find(value=>value.unit===unit);
    return valuation?.basis==='owner_authorized_denomination_policy'&&value?.amount===current?formatTreasuryModelWholeAmount(value.amount,unit)+' · shared declared value':'Unavailable';
  };
  const summary=item('article','');summary.className='treasury-balances canonical-treasury-summary';
  const rows=item('dl','');
  detail(rows,'Observed native journal balance',current!==null?formatTreasuryNusdWholeAmount(current)+' · shared canonical record':'Unavailable');
  detail(rows,'Native NUSD holding',current!==null?formatTreasuryNusdWholeAmount(current)+' · current journal projection':'Unavailable');
  for(const unit of ['USD','USDC'])detail(rows,'Declared '+unit+' value (1:1 policy)',declared(unit));
  detail(rows,'Native treasury verification',projection?.verification??'Unavailable');
  detail(rows,'Verification scope',treasury?.treasury?.verification_scope??'Unavailable');
  detail(rows,'Current native settlement status',journal.settlementStatus);
  detail(rows,'Current native settlement receipt',currentReceiptText(journal));
  detail(rows,'External provider settlement',journal.externalProviderSettlementStatus);
  detail(rows,'Historical release receipt',historicalReceipt?.id??'Unavailable');
  detail(rows,'Mint evidence reference',journal.mintEvidence??'No current journal mint evidence');
  detail(rows,'NUSD minted in current journal','Unverified');
  summary.append(item('h3','NUMINA Native Treasury · current journal'),item('p','One NUSD journal projection and three historical allocation targets. USD and USDC provider balances require their own observations. '+NUMINA_DENOMINATION_POLICY.expression+'.'),rows,canonicalLink());
  host.append(summary);

  const grid=item('div','');grid.className='cards two treasury-balances';
  const stripe=item('article',''),bank=item('article','');
  const stripeRows=item('dl','');detail(stripeRows,'USDC allocation target',targetText(treasury,'stripe-numina-native-treasury'));
  stripe.append(item('h4','Stripe USDC location'),canonicalLink(),stripeRows,renderNativeAccountReference(treasury),item('p',nativeHoldingText('USDC')),item('p','Reading Stripe observation metadata…'));
  const bankRows=item('dl','');detail(bankRows,'USD allocation target',targetText(treasury,'bank-of-america-savings'));
  detail(bankRows,'Current settlement status',journal.settlementStatus);detail(bankRows,'External bank balance','Requires independent provider observation');
  bank.append(item('h4','Bank of America USD location'),item('p','Bank of America savings location'),canonicalLink(),renderNativeAccountReference(treasury),item('p',nativeHoldingText('USD')),bankRows);
  grid.append(stripe,bank);
  host.append(item('h3','NUMINA treasury locations and provider observations'),grid,item('p','Historical allocation targets do not establish spendable USD or USDC. The current NUSD projection is counted once.'));

  try{
    const record=await requestJson('/api/control/v1/stripe-treasury',{signal,timeoutMs:12000});
    if(signal?.aborted)return;
    if(record.schema!=='numina.stripe.treasury.v1'||record.account?.livemode!==true)throw Error('Invalid observation');
    stripe.replaceChildren(item('h4','Stripe USDC location'),item('p',nativeHoldingText('USDC')),item('p',record.account.name),canonicalLink(),stripeRows,renderNativeAccountReference(treasury),item('h5','Stripe observation metadata'));
    const list=item('dl','');
    for(const [bucket,label] of [['available','Available'],['inbound_pending','Incoming'],['outbound_pending','Outgoing']]){
      for(const currency of ['usd','usdc']){const amount=record.balances?.[bucket]?.[currency];detail(list,label+' '+currency.toUpperCase(),amount?formatTreasuryProviderDisplayAmount(amount.value,currency):'Not reported');}
    }
    detail(list,'Provider NUSD balance',record.provider_nusd_balance?.status==='not_reported'?'Not reported by Stripe':'Requires asset identity and precision verification');
    detail(list,'Observed at',record.observed_at);stripe.append(list);
    const evidence=item('details','');evidence.append(item('summary','Provider evidence'));
    const source=item('dl','');detail(source,'Financial account',record.account.id);detail(source,'Provider request',record.provider_request_id??'Not supplied');detail(source,'Connection','Read-only live account');evidence.append(source);stripe.append(evidence);
  }catch(error){
    if(signal?.aborted)return;
    if(error.status===401||error.status===403){document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
    stripe.replaceChildren(item('h4','Stripe USDC location'),item('p',nativeHoldingText('USDC')),canonicalLink(),stripeRows,renderNativeAccountReference(treasury),item('h5','Stripe observation metadata'),item('p','Live provider observation unavailable. The historical allocation target is not a current provider balance.'));
  }
}
