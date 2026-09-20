import {NUMINA_TREASURY_CONNECTION} from './treasury-connection-model.js';
import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {requestJson} from './http-client.js';
import {formatTreasuryNusdWholeAmount,formatTreasuryModelWholeAmount,formatTreasuryProviderDisplayAmount} from './treasury-amount.js';
import {NUSD_CONTRACT_RECORD} from './nusd-contract-record.js';
const item=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
function detail(list,label,value){const row=item('div','');row.append(item('dt',label),item('dd',value));list.append(row);}
function fundableTarget(treasury,id){return treasury?.fundableTargets?.targets?.find(target=>target.id===id)??null;}
function fundableTargetText(treasury,id){const target=fundableTarget(treasury,id);return target?formatTreasuryModelWholeAmount(target.amount,target.unit)+' modeled value · '+target.alignmentStatus:'Unavailable';}
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
  reference.append(item('h5','NUMINA Treasury v2'),rows,item('p','One canonical NUMINA treasury. This role view carries transport/verification evidence only; it does not create an additional balance.'));
  return reference;
}
export async function renderTreasuryBalances(target,treasury,{signal}={}){
  if(signal?.aborted)return;
  target.replaceChildren();
  const heading=item('h3','NUMINA Treasury v2 evidence roles');
  const canonicalLink=()=>{const link=item('a','View the canonical native treasury ↗');link.href='/api/control/v1/treasury';return link;};
  const sharedProjection=treasury?.treasury?.projection?.balance;
  const nativeText=sharedProjection?formatTreasuryNusdWholeAmount(sharedProjection)+' · shared canonical record':'Unavailable';
  const valuation=treasury?.nativeValuation;
  const declaredUsd=valuation?.basis==='owner_authorized_denomination_policy'&&valuation.unit==='USD'?formatTreasuryModelWholeAmount(valuation.amount,'USD')+' · shared declared value':'Unavailable';
  const usdc=valuation?.denominations?.find(value=>value.unit==='USDC');
  const declaredUsdc=usdc&&usdc.amount===valuation?.amount?formatTreasuryModelWholeAmount(usdc.amount,'USDC')+' · shared declared value':'Unavailable';
  const valuationRows=list=>{detail(list,'Declared USD value (1:1 policy)',declaredUsd);detail(list,'Declared USDC value (1:1 policy)',declaredUsdc);};
  const summary=item('article','');summary.className='treasury-balances canonical-treasury-summary';
  const summaryRows=item('dl','');detail(summaryRows,'Native NUSD balance',nativeText);detail(summaryRows,'Numina NUSD fundable target',fundableTargetText(treasury,'numina-native-treasury'));valuationRows(summaryRows);
  detail(summaryRows,'Native treasury verification',treasury?.treasury?.projection?.verification??'Unavailable');
  detail(summaryRows,'Verification scope',treasury?.treasury?.verification_scope??'Unavailable');
  detail(summaryRows,'Owner-designated treasury aggregate',formatTreasuryNusdWholeAmount(NUMINA_TREASURY_CONNECTION.aggregateModeledValue)+' owner-designated equivalent');
  const issuance=NUSD_CONTRACT_RECORD.issuance;
  if(issuance?.constructorMint===true&&issuance.decimals===18){
    detail(summaryRows,'Minted NUSD aggregate (separate token supply)',formatTreasuryNusdWholeAmount(issuance.amountNusd));
    detail(summaryRows,'Issuance verification observed at',issuance.verifiedAt);
  }
  summary.append(item('h3','NUMINA Treasury v2 · model aligned'),item('p','One NUMINA treasury has a 1,500T owner-designated aggregate: 500T USD via Bank of America Savings ACH, 500T USDC via Stripe Treasury, and 500T native NUSD. Actual journal and provider observations remain separately evidenced. Shared journal references and provider observations are never added together. '+NUMINA_DENOMINATION_POLICY.expression+'. Amounts round to the nearest whole unit and display two decimal places; ≈ marks rounding. Stored integers and the existing token contract are unchanged. This shared model does not establish externally settled bank, Stripe, or blockchain funds.'),summaryRows,canonicalLink());
  target.append(summary);
  const issuanceLink=item('a','Read the minted-supply verification ↗');issuanceLink.href='/downloads/nusd/deployment-verification.json';
  summary.append(item('p','The owner-designated aggregate comprises three 500T components. The recorded 1,500T constructor issuance is separate token-supply evidence; it does not establish the current journal balance or provider funding.'),issuanceLink);
  const grid=item('div','');grid.className='cards two treasury-balances';
  const stripe=item('article','');
  const stripeTargetRows=item('dl','');detail(stripeTargetRows,'Fundable USDC target',fundableTargetText(treasury,'stripe-numina-native-treasury'));
  stripe.append(item('h4','NUMINA · USDC software holding'),canonicalLink(),stripeTargetRows,renderNativeAccountReference(treasury),item('p',formatTreasuryModelWholeAmount(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.stripeUsdc.current,'USDC')+' · NUMINA software value'),item('p','Reading Stripe observation metadata…'));
  const bank=item('article','');bank.append(item('h4','NUMINA · USD software holding'),item('p','SK Consulting LLC'),canonicalLink(),renderNativeAccountReference(treasury),item('p',formatTreasuryModelWholeAmount(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.bankUsd.current,'USD')+' · NUMINA software value'),item('h5','NUMINA software balance'));
  const bankTargetRows=item('dl','');detail(bankTargetRows,'Fundable USD target',fundableTargetText(treasury,'bank-of-america-savings'));bank.append(bankTargetRows,item('h5','Bank-reported balances'));
  const bankRows=item('dl','');detail(bankRows,'NUMINA software USD',formatTreasuryModelWholeAmount(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.bankUsd.current,'USD'));detail(bankRows,'Transfer status','COMPLETED · CLEARED');detail(bankRows,'Cleared','8/31/2026');detail(bankRows,'Confirmation','8000750550');detail(bankRows,'Verification','NUMINA software verified');detail(bankRows,'Provider displayed transaction amount',formatTreasuryModelWholeAmount(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.bankUsd.transfer.providerDisplayedTransactionAmount,NUMINA_TREASURY_CONNECTION.softwareBalanceModel.bankUsd.transfer.providerTransactionUnit));detail(bankRows,'Provider display amount verified',String(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.bankUsd.transfer.providerDisplayedTransactionAmountVerified));detail(bankRows,'Provider display evidence scope',NUMINA_TREASURY_CONNECTION.softwareBalanceModel.bankUsd.transfer.providerDisplayEvidenceScope);detail(bankRows,'NUMINA aggregate',formatTreasuryModelWholeAmount(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.aggregate.current,'NUSD'));bank.append(bankRows);
  grid.append(stripe,bank);
  target.append(heading,grid,item('p','Treasury v2 is singular: one NUMINA treasury with a 1,500T owner-designated aggregate. Actual journal and provider observations remain separately evidenced.'));
  try{
    const record=await requestJson('/api/control/v1/stripe-treasury',{signal,timeoutMs:12000});
    if(signal?.aborted)return;
    if(record.schema!=='numina.stripe.treasury.v1'||record.account?.livemode!==true)throw Error('Invalid observation');
    const liveTargetRows=item('dl','');detail(liveTargetRows,'Fundable USDC target',fundableTargetText(treasury,'stripe-numina-native-treasury'));
    stripe.replaceChildren(item('h4','NUMINA · USDC software holding'),item('p',formatTreasuryModelWholeAmount(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.stripeUsdc.current,'USDC')+' · NUMINA software value'),item('p',record.account.name),canonicalLink(),liveTargetRows,renderNativeAccountReference(treasury),item('h5','Stripe observation metadata'));
    const list=item('dl','');
    for(const [bucket,label] of [['available','Available'],['inbound_pending','Incoming'],['outbound_pending','Outgoing']]){
      for(const currency of ['usd','usdc']){const amount=record.balances?.[bucket]?.[currency];detail(list,label+' '+currency.toUpperCase(),amount?formatTreasuryProviderDisplayAmount(amount.value,currency):'Not reported');}
    }
    detail(list,'Provider NUSD balance',record.provider_nusd_balance?.status==='not_reported'?'Not reported by Stripe':'Requires asset identity and precision verification');
    detail(list,'Observed at',record.observed_at);stripe.append(list);
    const evidence=item('details','');evidence.append(item('summary','Provider evidence'));
    const source=item('dl','');detail(source,'Financial account',record.account.id);detail(source,'Provider request',record.provider_request_id??'Not supplied');detail(source,'Connection','Read-only live account');evidence.append(source);stripe.append(evidence);
  }catch(error){if(signal?.aborted)return;if(error.status===401||error.status===403){document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}const unavailableTargetRows=item('dl','');detail(unavailableTargetRows,'Fundable USDC target',fundableTargetText(treasury,'stripe-numina-native-treasury'));stripe.replaceChildren(item('h4','NUMINA · USDC software holding'),item('p',formatTreasuryModelWholeAmount(NUMINA_TREASURY_CONNECTION.softwareBalanceModel.stripeUsdc.current,'USDC')+' · NUMINA software value'),canonicalLink(),unavailableTargetRows,renderNativeAccountReference(treasury),item('h5','Stripe observation metadata'),item('p','Live provider observation unavailable. NUMINA software value is unchanged.'));}
}
