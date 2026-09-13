import {requestJson,createViewScope} from './http-client.js';
const nativeTreasuryScope=createViewScope();
const nativeTreasuryElement=id=>document.getElementById(id);
const nativeCanonical=value=>Array.isArray(value)?'['+value.map(nativeCanonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+nativeCanonical(value[key])).join(',')+'}':JSON.stringify(value);
export async function verifyNativeTreasury(data){
  if(data?.schema!=='numina.treasury.v1'||data.status!=='READY'||data.route!=='numina.treasury.v1')return false;
  const p=data.projection,proof=data.canonical_proof;
  if(!p||p.schema!=='numina.treasury.projection.v1'||p.unit!=='NUSD'||p.authority!=='NUMINA'||p.verification!=='VERIFIED'||p.system_of_record!=='NUMINA'||p.scope!=='Numina-native'||typeof p.balance!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(p.balance)||proof?.algorithm!=='SHA-256'||proof.event?.type!=='treasury'||proof.event?.id!==p.last_event_id||proof.event?.result?.outcome!=='FINAL'||proof.event?.result?.route!=='numina.treasury.v1')return false;
  try{
    if(nativeCanonical(p)!==nativeCanonical(proof.event.result.projection))return false;
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(nativeCanonical(proof.event)))),b=>b.toString(16).padStart(2,'0')).join('');
    return digest===proof.hash;
  }catch{return false;}
}
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
    if(data.schema==='numina.treasury.v1'&&data.status==='NOT_INITIALIZED'){
      nativeTreasuryElement('native-treasury-message').textContent='The Numina treasury model is awaiting its first journal record.';return;
    }
    if(!await verifyNativeTreasury(data))throw Error('Treasury record could not be verified.');
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
