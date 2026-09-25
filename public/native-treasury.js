import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {NUMINA_TREASURY_CONNECTION as treasuryModel} from './treasury-connection-model.js';
import {verifyTreasuryRecord} from './treasury-proof.js';
import {requestJson,createViewScope} from './http-client.js';
import {formatTreasuryModelWholeAmount} from './treasury-amount.js';
const nativeTreasuryScope=createViewScope();
const nativeTreasuryElement=id=>document.getElementById(id);
export const verifyNativeTreasury=verifyTreasuryRecord;
export function clearNativeTreasury(){
  nativeTreasuryScope.reset();
  const panel=nativeTreasuryElement('native-treasury-panel');if(!panel)return;
  panel.hidden=true;nativeTreasuryElement('native-treasury-details').replaceChildren();nativeTreasuryElement('native-treasury-message').textContent='';
}
export async function loadNativeTreasury(){
  clearNativeTreasury();const panel=nativeTreasuryElement('native-treasury-panel');if(!panel)return;
  const generation=nativeTreasuryScope.generation;panel.hidden=false;
  nativeTreasuryElement('native-treasury-message').textContent='Reading Numina treasury…';
  try{
    const data=await requestJson('/api/control/v1/treasury',{signal:nativeTreasuryScope.signal});
    if(!nativeTreasuryScope.isCurrent(generation))return;
    if(!await verifyTreasuryRecord(data,{allowUninitialized:true}))throw Error('Treasury record could not be verified.');
    if(!nativeTreasuryScope.isCurrent(generation))return;
    if(data.status==='NOT_INITIALIZED'){
      nativeTreasuryElement('native-treasury-message').textContent='The Numina treasury model is awaiting its first journal record.';return;
    }
    if(!nativeTreasuryScope.isCurrent(generation))return;
    const p=data.projection,details=nativeTreasuryElement('native-treasury-details');
    const format=(value,unit)=>formatTreasuryModelWholeAmount(value,unit);
    const allocations=treasuryModel.allocations.map(allocation=>['Historical allocation target · '+allocation.label,format(allocation.amount,allocation.unit)]);
    const nativeAllocation=treasuryModel.allocations.find(allocation=>allocation.id==='numina-native-treasury');
    const journalComparison=p.unit===nativeAllocation.unit&&p.balance===nativeAllocation.amount?'Matches the dated 500T NUSD allocation target':'Differs from the dated 500T NUSD allocation target';
    for(const [label,value]of [['Treasury',treasuryModel.identity],['Current NUSD journal balance',format(p.balance,p.unit)],['Current native settlement status',data.settlementStatus],['Current native settlement receipt',data.singularSettlementReceiptId??'No current journal settlement receipt'],['Historical release receipt',treasuryModel.historicalSettlementReceipt?.id??'Unavailable'],...allocations,['Journal/target comparison',journalComparison],['Mint evidence reference',data.mintEvidence??'No current journal mint evidence'],['NUSD minted in current journal','Unverified'],['NUSD burned in current journal','Unverified'],['Declared valuation policy',NUMINA_DENOMINATION_POLICY.expression],['Authority',p.authority],['Verification',p.verification],['System of record',p.system_of_record],['Journal revision',String(data.revision)],['Canonical head',data.head]]){
      for(const [tag,text]of [['dt',label],['dd',value]]){const node=document.createElement(tag);node.textContent=text;details.append(node);}
    }
    nativeTreasuryElement('native-treasury-message').textContent='One NUMINA Native Treasury. Current journal projection: '+format(p.balance,p.unit)+'. Native settlement: '+data.settlementStatus+'. The three 500T allocation targets are historical metadata. Bank and Stripe balances require separate provider evidence.';
  }catch(error){
    if(!nativeTreasuryScope.isCurrent(generation))return;
    if(error.status===401||error.status===403){clearNativeTreasury();document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
    nativeTreasuryElement('native-treasury-details').replaceChildren();
    nativeTreasuryElement('native-treasury-message').textContent='Numina treasury is unavailable. Refresh to read its current record.';
  }
}
