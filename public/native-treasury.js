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
    const allocations=treasuryModel.allocations.map(allocation=>['Owner-designated component · '+allocation.label,format(allocation.amount,allocation.unit)]);
    const softwareTransfer=data.softwareTransfer??treasuryModel.softwareBalanceModel.bankUsd.transfer;
    const nativeAllocation=treasuryModel.allocations.find(allocation=>allocation.id==='NUSD');
    const journalComparison=p.unit===treasuryModel.aggregateModeledUnit&&p.balance===treasuryModel.aggregateModeledValue?'Matches the 1,500T owner-designated aggregate':p.unit===nativeAllocation.unit&&p.balance===nativeAllocation.amount?'Matches the 500T owner-designated NUSD component; the owner-designated aggregate is 1,500T':'Differs from the 1,500T owner-designated aggregate and the 500T NUSD holding';
    const issuance=NUSD_CONTRACT_RECORD.issuance;
    const mintedSupply=issuance?.constructorMint===true&&issuance.decimals===18?[['Recorded minted NUSD supply',format(issuance.amountNusd,'NUSD')]]:[];
    for(const [label,value]of [['Treasury',treasuryModel.identity],['Owner-designated treasury aggregate',format(treasuryModel.aggregateModeledValue,treasuryModel.aggregateModeledUnit)+' owner-designated equivalent'],...allocations,['Native journal balance',format(p.balance,p.unit)],['Journal/model comparison',journalComparison],...mintedSupply,['Declared valuation policy',NUMINA_DENOMINATION_POLICY.expression],['Bank software transfer',format(softwareTransfer.amount,softwareTransfer.unit)],['Transfer status',softwareTransfer.status+' · '+softwareTransfer.clearingStatus],['Cleared date',softwareTransfer.clearedDate],['Confirmation',softwareTransfer.confirmation],['Transfer verification',softwareTransfer.verification],['Authority',p.authority],['Verification',p.verification],['System of record',p.system_of_record],['Journal revision',String(data.revision)],['Canonical head',data.head]]){
      for(const [tag,text]of [['dt',label],['dd',value]]){const node=document.createElement(tag);node.textContent=text;details.append(node);}
    }
    nativeTreasuryElement('native-treasury-message').textContent='One NUMINA treasury has a 1,500T owner-designated aggregate: 500T USD, 500T USDC, and 500T NUSD. The NUMINA USD software transaction is COMPLETED and CLEARED on 8/31/2026 with confirmation 8000750550. Journal proof checked; provider-origin provenance remains separately attributable.';
  }catch(error){
    if(!nativeTreasuryScope.isCurrent(generation))return;
    if(error.status===401||error.status===403){clearNativeTreasury();document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
    nativeTreasuryElement('native-treasury-details').replaceChildren();
    nativeTreasuryElement('native-treasury-message').textContent='Numina treasury is unavailable. Refresh to read its current record.';
  }
}
