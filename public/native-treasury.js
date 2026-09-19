import {NUMINA_DENOMINATION_POLICY} from './treasury-valuation.js';
import {NUMINA_TREASURY_CONNECTION as treasuryModel} from './treasury-connection-model.js';
import {NUSD_CONTRACT_RECORD} from './nusd-contract-record.js';
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
    const allocations=treasuryModel.allocations.map(allocation=>['Denomination view · '+allocation.label,format(allocation.amount,allocation.unit)]);
    const nativeAllocation=treasuryModel.allocations.find(allocation=>allocation.id==='numina-native-treasury');
    const journalComparison=p.unit===treasuryModel.aggregateModeledUnit&&p.balance===treasuryModel.aggregateModeledValue?'Matches the verified 500T model':p.unit===nativeAllocation.unit&&p.balance===nativeAllocation.amount?'Matches the verified 500T native value':'Differs from the verified 500T model';
    const issuance=NUSD_CONTRACT_RECORD.issuance;
    const mintedSupply=issuance?.constructorMint===true&&issuance.decimals===18?[['Recorded minted NUSD supply',format(issuance.amountNusd,'NUSD')]]:[];
    for(const [label,value]of [['Treasury',treasuryModel.identity],['Verified treasury model',format(treasuryModel.aggregateModeledValue,treasuryModel.aggregateModeledUnit)+' verified NUMINA-native value'],...allocations,['Native journal balance',format(p.balance,p.unit)],['Journal/model comparison',journalComparison],...mintedSupply,['Declared valuation policy',NUMINA_DENOMINATION_POLICY.expression],['Authority',p.authority],['Verification',p.verification],['System of record',p.system_of_record],['Journal revision',String(data.revision)],['Canonical head',data.head]]){
      for(const [tag,text]of [['dt',label],['dd',value]]){const node=document.createElement(tag);node.textContent=text;details.append(node);}
    }
    nativeTreasuryElement('native-treasury-message').textContent='One verified 500T NUMINA treasury. USD, USDC and NUSD are non-additive denomination views of the same canonical value. Journal proof checked. The recorded 1,500T constructor issuance is separate token-supply evidence; provider observations remain separate evidence.';
  }catch(error){
    if(!nativeTreasuryScope.isCurrent(generation))return;
    if(error.status===401||error.status===403){clearNativeTreasury();document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
    nativeTreasuryElement('native-treasury-details').replaceChildren();
    nativeTreasuryElement('native-treasury-message').textContent='Numina treasury is unavailable. Refresh to read its current record.';
  }
}
