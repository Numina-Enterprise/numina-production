import {requestJson} from './http-client.js';

// The provider observation has a fixed date. Loading it never turns it into a live health check.
export function networkPresentation(data){
 const n=data?.network_policy;
 if(data?.schema!=='numina.nusd.status.v1'||n?.status!=='provider_reported_live'||n.evidence_type!=='authenticated_provider_dashboard_observation'||!/^\d+$/.test(n.chain_id)||!Number.isFinite(Date.parse(n.observed_at))||!Number.isSafeInteger(n.validator_count)||n.validator_count<1)throw new Error('Network record unavailable');
 return {
  summary:`${n.name} · ${n.validator_count} validators running when observed`,
  detail:`Chain ${n.chain_id} · ${n.protocol} · ${n.region}`,
  observed:`${n.provider} dashboard observation: ${new Date(n.observed_at).toISOString().replace('T',' ').replace('.000Z',' UTC')}. This is a dated record, not continuous monitoring.`,
  asset:data.asset?.contract?'See the NUSD status record for contract and activation details.':'NUSD contract not deployed. Issuance, transfers and settlement are not enabled.'
 };
}

export async function loadNetworkPanels(panels,read=()=>requestJson('/api/nusd/v1/status')){
 const update=(panel,name,text)=>{const target=panel.querySelector(`[data-network-${name}]`);if(target)target.textContent=text;};
 for(const p of panels){update(p,'summary','Loading network record…');for(const key of ['detail','observed','asset'])update(p,key,'');}
 try{const view=networkPresentation(await read());for(const p of panels)for(const [key,value]of Object.entries(view))update(p,key,value);}
 catch{for(const p of panels)update(p,'summary','Network record unavailable. Open network details or reload to try again.');}
}
if(typeof document!=='undefined'){
 const panels=[...document.querySelectorAll('[data-network-status]')];
 if(panels.length){void loadNetworkPanels(panels);window.addEventListener('pageshow',event=>{if(event.persisted)void loadNetworkPanels(panels);});}
}
