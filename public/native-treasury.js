import {verifyTreasuryRecord} from './treasury-proof.js';
import {requestJson,createViewScope} from './http-client.js';
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
    for(const [label,value]of [['Balance',new Intl.NumberFormat('en-US').format(BigInt(p.balance))+' '+p.unit],['Authority',p.authority],['Verification',p.verification],['System of record',p.system_of_record],['Journal revision',String(data.revision)],['Canonical head',data.head]]){
      for(const [tag,text]of [['dt',label],['dd',value]]){const node=document.createElement(tag);node.textContent=text;details.append(node);}
    }
    nativeTreasuryElement('native-treasury-message').textContent='Numina-native treasury. Model and journal record checked.';
  }catch(error){
    if(!nativeTreasuryScope.isCurrent(generation))return;
    if(error.status===401||error.status===403){clearNativeTreasury();document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));return;}
    nativeTreasuryElement('native-treasury-details').replaceChildren();
    nativeTreasuryElement('native-treasury-message').textContent='Numina treasury is unavailable. Refresh to read its current record.';
  }
}
