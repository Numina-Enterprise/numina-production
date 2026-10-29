import {loadSigningReview,createWalletSigningControls} from './wallet-signing-model.js';

const reviewNames={independentSecurityAudit:'Independent security audit',authorizedIssuerAndJurisdictions:'Issuer and supported jurisdictions',custodianAndReserveEvidence:'Custody and reserve evidence',redeemabilityTermsAndOperations:'Redemption terms and operations',financialCrimeAndSanctionsControls:'Financial-crime and sanctions controls',independentRoleKeyCustody:'Role-key custody',incidentAndPauseRecovery:'Incident and pause recovery',applicationSettlementAndFulfillmentReview:'Settlement and fulfillment integration'};
function saveHandoff(value,doc,win){
 const url=win.URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
 const a=doc.createElement('a');a.href=url;a.download='Numina-1500T-Unsigned-Wallet-Handoff.json';doc.body.append(a);a.click();a.remove();
 win.setTimeout(()=>win.URL.revokeObjectURL(url),1000);
}
export function mountWalletSigning({doc=document,win=window,loadReview=loadSigningReview,clientFactory=createWalletSigningControls,download=saveHandoff}={}){
 const $=id=>doc.getElementById(id),connect=$('signing-connect'),clear=$('signing-clear'),estimate=$('signing-estimate'),maximum=$('signing-maximum'),exportButton=$('signing-download'),status=$('signing-status');
 const loading=new AbortController();let alive=true,generation=0,busy=false,profile=null,client=null,connected=false,quote=null,expiryTimer;
 const current=id=>alive&&id===generation;
 function availability(){const provider=win.ethereum;return provider&&typeof provider.request==='function'&&typeof provider.on==='function'&&typeof provider.removeListener==='function'?provider:null;}
 function render(){if(!alive)return;connect.disabled=busy||!profile||!availability();clear.disabled=busy||!client;estimate.disabled=busy||!connected;maximum.disabled=busy||!quote;exportButton.disabled=busy||!quote||!maximum.value.trim();$('signing-quote').hidden=!quote;}
 function wipe(message){
  generation++;busy=false;connected=false;quote=null;win.clearTimeout(expiryTimer);maximum.value='';
  if(!alive)return;
  $('signing-connection').textContent='No wallet connected.';
  for(const id of ['signing-gas-limit','signing-gas-price','signing-total','signing-balance','signing-observed'])$(id).textContent='';
  status.textContent=message;render();
 }
 function providerChanged(reason){
  const messages={ACCOUNT_MISMATCH:'Select the approved treasury account in your wallet, then reconnect.',CHAIN_MISMATCH:'Select Numina’s network in your wallet, then reconnect.',GENESIS_MISMATCH:'The wallet’s network does not match Numina’s expected genesis block. Check the network configuration before reconnecting.',INVALID_QUANTITY:'The fee limit must be an exact unsigned integer. Reconnect for a fresh estimate.',FEE_BUDGET_EXCEEDED:'The fee limit is below the estimated network cost. Reconnect for a fresh estimate.',INSUFFICIENT_FEE_BALANCE:'The wallet reports insufficient native balance for this network estimate. Reconnect after resolving the balance.',FEE_BUDGET_EXCEEDS_BALANCE:'The fee limit exceeds the wallet’s reported native balance. Reconnect for a fresh estimate.',QUOTE_EXPIRED:'The estimate expired. Connect again for a fresh estimate.',timeout:'The wallet request timed out. Connect again to retry.',WALLET_REQUEST_FAILED:'The wallet request was declined or unavailable. Check the wallet, then reconnect.',INVALID_RPC_QUANTITY:'The wallet returned an invalid network amount. Check the provider before reconnecting.'};
  wipe(messages[reason]||'The wallet account, network or connection changed. Connect again for a new estimate.');
 }
 function resetClient(message){const previous=client;client=null;previous?.dispose();wipe(message);}
 function fail(error,fallback){
  const messages={4001:'Wallet connection was declined.',4100:'Authorize the selected account in your wallet.',4900:'The wallet is disconnected.',4901:'Select Numina’s network in your wallet.'};
  status.textContent=messages[error?.code]||fallback;
 }
 connect.onclick=async()=>{
  if(!alive||busy||!profile)return;resetClient('Waiting for your wallet connection…');
  const provider=availability();if(!provider){$('wallet-availability').textContent='Open this page in the browser containing your Numina-compatible wallet.';render();return;}
  const id=generation;busy=true;render();
  try{
   let instance;instance=clientFactory({provider,onInvalidated:reason=>{if(client===instance)providerChanged(reason);}});client=instance;
   const connection=await instance.connect();if(!current(id)||client!==instance)return;
   connected=true;$('signing-connection').textContent=connection.account+' · Numina chain '+connection.chainId+' · genesis matched';
   status.textContent='Wallet account and network observed. Read the estimate for the exact deployment.';
  }catch(error){if(current(id)){connected=false;fail(error,'Connection could not be checked. Select the treasury account and Numina network in your wallet, then reconnect.');}}
  finally{if(current(id)){busy=false;render();}}
 };
 clear.onclick=()=>{if(alive&&!busy)resetClient('Local wallet connection cleared. No transaction was submitted.');};
 estimate.onclick=async()=>{
  if(!alive||busy||!connected||!profile||!client)return;
  const id=generation,instance=client;quote=null;maximum.value='';win.clearTimeout(expiryTimer);busy=true;status.textContent='Reading the wallet’s network estimate…';render();
  try{
   const result=await instance.estimate(profile);if(!current(id)||client!==instance)return;
   quote=result;maximum.value=result.calculatedTotalBaseUnits;
   $('signing-gas-limit').textContent=result.gasLimit;
   $('signing-gas-price').textContent=result.gasPrice+' native base units';
   $('signing-total').textContent=result.calculatedTotalBaseUnits+' native base units';
   $('signing-balance').textContent=result.balanceBaseUnits+' native base units';
   $('signing-observed').textContent=result.observedAt;
   status.textContent='Estimate received. Review the maximum cost before downloading the unsigned handoff.';
   expiryTimer=win.setTimeout(()=>{if(current(id)&&quote===result)resetClient('The estimate expired. Connect again to obtain a fresh network estimate.');},60000);
  }catch(error){if(current(id))fail(error,'The estimate could not be completed. Check the selected account, network and available native fee balance.');}
  finally{if(current(id)){busy=false;render();}}
 };
 maximum.oninput=()=>{if(alive){status.textContent='Fee limit changed. The wallet identity and estimate will be checked again before export.';render();}};
 exportButton.onclick=async()=>{
  if(!alive||busy||!quote||!client)return;
  const id=generation,instance=client,limit=maximum.value.trim();busy=true;status.textContent='Checking the wallet and fee limit before export…';render();
  try{
   const handoff=await instance.handoff({maximumFeeBaseUnits:limit});if(!current(id)||client!==instance)return;
   download(handoff,doc,win);status.textContent='Unsigned handoff downloaded. Complete the remaining production reviews and sign only through your wallet’s own workflow. No transaction was submitted.';
  }catch(error){if(current(id))fail(error,'Handoff could not be prepared. Check the fee limit, wallet balance and estimate freshness.');}
  finally{if(current(id)){busy=false;render();}}
 };
 const dispose=()=>{if(!alive)return;alive=false;generation++;loading.abort();win.clearTimeout(expiryTimer);client?.dispose();client=null;profile=null;quote=null;connected=false;maximum.value='';for(const button of [connect,clear,estimate,exportButton])button.disabled=true;maximum.disabled=true;$('signing-quote').hidden=true;for(const id of ['signing-gas-limit','signing-gas-price','signing-total','signing-balance','signing-observed'])$(id).textContent='';$('signing-connection').textContent='No wallet connected.';win.removeEventListener('pagehide',dispose);};
 win.addEventListener('pagehide',dispose,{once:true});
 $('wallet-availability').textContent=availability()?'A browser wallet is available. Connect only the selected treasury account.':'No browser wallet is available here. If you created your wallet inside Numina, use the saved-backup section above.';
 render();
 const ready=(async()=>{try{
  const review=await loadReview(loading.signal);if(!alive)return;profile=review;
  $('signing-profile-status').textContent='Exact 1,500T constructor matched · 10,746 creation bytes · unsigned';
  const details=$('signing-contract-details');details.replaceChildren();
  for(const [key,label] of [['admin','Administrator'],['issuer','Issuer'],['minter','Minter'],['pauser','Pauser'],['adminDelaySeconds','Administrator delay (seconds)'],['approvedIssuerPolicyHash','Revised policy hash']]){const dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=label;dd.textContent=review.constructor[key];details.append(dt,dd);}
  const reviews=$('signing-reviews');reviews.replaceChildren();
  for(const item of review.unresolvedReviews){const li=doc.createElement('li');li.textContent=reviewNames[item.id]||'Production review';reviews.append(li);}
 }catch{if(alive){$('signing-profile-status').textContent='The exact 1,500T constructor could not be verified.';status.textContent='Preparation is unavailable until the published request matches its recorded bytes.';}}
 finally{render();}})();
 return {ready,dispose};
}
if(typeof document!=='undefined'){
 mountWalletSigning();
 // BFCache restores a disposed page; require a fresh local provider session.
 window.addEventListener('pageshow',event=>{if(event.persisted)mountWalletSigning();});
}
