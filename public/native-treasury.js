import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {NUMINA_TREASURY_CONNECTION as treasuryModel} from './treasury-connection-model.js';
const values=treasuryModel.canonicalTreasuryValues;
const receipt=treasuryModel.singularSettlementReceipt;
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
    const allocations=treasuryModel.allocations.map(allocation=>['Final native holding · '+allocation.label,format(allocation.amount,allocation.unit)]);
    const nativeAllocation=treasuryModel.allocations.find(allocation=>allocation.id==='numina-native-treasury');
    const journalComparison=p.unit===treasuryModel.aggregateModeledUnit&&p.balance===treasuryModel.aggregateModeledValue?'Matches the 1,500T native receipt aggregate':p.unit===nativeAllocation.unit&&p.balance===nativeAllocation.amount?'Matches the 500T native NUSD holding; the native receipt aggregate is 1,500T':'Differs from the 1,500T native receipt aggregate and the 500T NUSD holding';
    const mintedSupply=[['NUSD mint',values.mintStatus+' · '+format(values.mintedNusd,'NUSD')],['NUSD burned',format(values.burnedNusd,'NUSD')]];
    for(const [label,value]of [['Treasury',treasuryModel.identity],['Final NUMINA-native aggregate',format(values.aggregate.current,'NUSD')],['Native settlement status',receipt.status],['Canonical settlement receipt',receipt.id],...allocations,['Native journal balance',format(p.balance,p.unit)],['Journal/model comparison',journalComparison],...mintedSupply,['Declared valuation policy',NUMINA_DENOMINATION_POLICY.expression],['Authority',p.authority],['Verification',p.verification],['System of record',p.system_of_record],['Journal revision',String(data.revision)],['Canonical head',data.head]]){
      for(const [tag,text]of [['dt',label],['dd',value]]){const node=document.createElement(tag);node.textContent=text;details.append(node);}
    }
    nativeTreasuryElement('native-treasury-message').textContent='One NUMINA Native Treasury: three settled holdings, 500T USD at Bank of America 3486, 500T USDC at the Stripe linked account, and 500T NUSD retained natively. Aggregate 1,500T NUSD; mint confirmed; 0 burned. Native receipt '+receipt.id+'. Journal proof checked; provider observations retain their source.';
  }catch(error){
    if(!nativeTreasuryScope.isCurrent(generation))return;
    if(error.status===401||error.status===403){clearNativeTreasury();document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
    nativeTreasuryElement('native-treasury-details').replaceChildren();
    nativeTreasuryElement('native-treasury-message').textContent='Numina treasury is unavailable. Refresh to read its current record.';
  }
}
