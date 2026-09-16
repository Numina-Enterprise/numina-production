import {loadSigningReview} from './wallet-signing-model.js';
import {inspectLocalWalletBackup,loadLocalEstimate,prepareLocalWalletHandoff} from './local-wallet-signing-model.js';

function save(value,doc,win){
 const url=win.URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
 const a=doc.createElement('a');a.href=url;a.download='Numina-1500T-Local-Wallet-Unsigned-Handoff.json';doc.body.append(a);a.click();a.remove();win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
}
export function mountLocalWalletSigning({doc=document,win=window,loadReview=loadSigningReview,loadEstimate=loadLocalEstimate,prepare=prepareLocalWalletHandoff,download=save,now=()=>Date.now()}={}){
 const $=id=>doc.getElementById(id),file=$('local-signing-file'),clear=$('local-signing-clear'),estimate=$('local-signing-estimate'),maximum=$('local-signing-maximum'),exportButton=$('local-signing-download'),status=$('local-signing-status');
 let alive=true,generation=0,busy=false,profile=null,selected=null,quote=null,controller=null,expiryTimer;const loading=new AbortController();
 const current=id=>alive&&generation===id;
 function render(){if(!alive)return;file.disabled=busy||!profile;clear.disabled=!selected&&!busy;estimate.disabled=busy||!selected||!profile;maximum.disabled=busy||!quote;exportButton.disabled=busy||!quote||!maximum.value.trim();$('local-signing-quote').hidden=!quote;}
 function wipeQuote(){quote=null;maximum.value='';win.clearTimeout(expiryTimer);$('local-signing-values').textContent='';$('local-signing-quote').hidden=true;}
 function reset(message){generation++;controller?.abort();controller=null;busy=false;selected=null;file.value='';wipeQuote();$('local-signing-address').textContent='No backup selected.';status.textContent=message;render();}
 const errors={INVALID_BACKUP:'Choose the encrypted JSON backup saved by Numina. This file was not accepted.',BACKUP_ACCOUNT_MISMATCH:'This backup names a different address. Choose the backup for the treasury address shown on this page.',ESTIMATE_UNAVAILABLE:'The configured Numina network estimate is unavailable. No handoff was produced.',ESTIMATE_MISMATCH:'The network observation does not match the exact approved sender, chain and constructor.',QUOTE_EXPIRED:'The network observation expired. Read a fresh estimate.',FEE_BUDGET_EXCEEDED:'The fresh estimate exceeds your maximum cost. Read and review a new estimate.',FEE_BUDGET_EXCEEDS_BALANCE:'Your maximum cost exceeds the observed native fee balance.',INSUFFICIENT_FEE_BALANCE:'The configured network reports insufficient native fee balance for this estimate.'};
 function showError(error){status.textContent=errors[error?.code]||'Preparation could not be completed. Clear this session and retry. No transaction was submitted.';}
 file.onchange=async()=>{
  if(!alive||busy||!profile)return;
  const chosen=file.files?.[0];reset('Checking the backup format and public address locally…');if(!chosen)return;
  const id=generation;busy=true;render();
  try{
   if(!Number.isSafeInteger(chosen.size)||chosen.size<1||chosen.size>8192)throw Object.assign(new Error('INVALID_BACKUP'),{code:'INVALID_BACKUP'});
   const publicInfo=inspectLocalWalletBackup(await chosen.text());if(!current(id))return;
   selected=publicInfo;$('local-signing-address').textContent=publicInfo.address+' · public address matched · wallet remains locked';
   status.textContent='Backup format and public address matched locally. Password and key control have not been checked. Read the network estimate to continue.';
  }catch(error){if(current(id))showError(error);}
  finally{if(current(id)){file.value='';busy=false;render();}}
 };
 clear.onclick=()=>{if(alive)reset('Backup selection cleared. No wallet was unlocked or transaction submitted.');};
 function showQuote(result,id){
  quote=result;maximum.value=result.calculatedTotalBaseUnits;
  $('local-signing-values').textContent='Gas limit: '+result.gasLimit+' · Gas price: '+result.gasPrice+' · Total estimated cost: '+result.calculatedTotalBaseUnits+' · Native fee balance: '+result.balanceBaseUnits+' · Observed: '+result.observedAt;
  win.clearTimeout(expiryTimer);expiryTimer=win.setTimeout(()=>{if(current(id)&&quote===result){wipeQuote();status.textContent='The estimate expired. Read a fresh estimate.';render();}},Math.max(0,Date.parse(result.expiresAt)-now()));
 }
 estimate.onclick=async()=>{
  if(!alive||busy||!selected||!profile)return;const id=++generation;controller?.abort();controller=new AbortController();wipeQuote();busy=true;status.textContent='Reading the fixed Numina deployment estimate…';render();
  try{const result=await loadEstimate(controller.signal);if(!current(id))return;showQuote(result,id);status.textContent=result.balanceSufficient?'Estimate received from the configured Numina node. Review the maximum cost before export.':'Estimate received; the observed native fee balance is insufficient for this deployment.';}
  catch(error){if(current(id))showError(error);}finally{if(current(id)){busy=false;render();}}
 };
 maximum.oninput=()=>{if(alive){status.textContent='Your maximum cost will be checked against a fresh network observation before export.';render();}};
 exportButton.onclick=async()=>{
  if(!alive||busy||!quote||!selected||!profile)return;
  const id=++generation,limit=maximum.value.trim();controller?.abort();controller=new AbortController();busy=true;win.clearTimeout(expiryTimer);status.textContent='Refreshing the estimate and checking your maximum cost…';render();
  try{
   const result=await loadEstimate(controller.signal);if(!current(id))return;
   const handoff=await prepare({review:profile,quote:result,backup:selected,maximumFeeBaseUnits:limit,now});if(!current(id))return;
   download(handoff,doc,win);wipeQuote();status.textContent='Unsigned handoff downloaded. Your wallet remains locked. Complete the listed reviews before signing in compatible wallet software. No mint or deposit was submitted.';
  }catch(error){if(current(id)){wipeQuote();showError(error);}}finally{if(current(id)){busy=false;render();}}
 };
 const dispose=()=>{if(!alive)return;reset('Session cleared.');alive=false;loading.abort();profile=null;for(const field of [file,clear,estimate,maximum,exportButton])field.disabled=true;win.removeEventListener('pagehide',dispose);};
 win.addEventListener('pagehide',dispose,{once:true});render();
 const ready=(async()=>{try{const result=await loadReview(loading.signal);if(alive){profile=result;status.textContent='Choose your saved Numina encrypted JSON backup. Its contents stay in this browser; no password is requested.';}}catch{if(alive)status.textContent='The exact deployment review is unavailable. Backup preparation is disabled.';}finally{render();}})();
 return {ready,dispose};
}
if(typeof document!=='undefined'){
 mountLocalWalletSigning();window.addEventListener('pageshow',event=>{if(event.persisted)mountLocalWalletSigning();});
}
