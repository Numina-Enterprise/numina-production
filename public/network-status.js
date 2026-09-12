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

const connectionLoads=new WeakMap();
const expectedChain='962421430';
const expectedSigner='0x1a45671ae2ee3e52264116151924faacb80fc02e';
const decimal=/^(?:0|[1-9][0-9]{0,77})$/;
const blockHash=/^0x[0-9a-f]{64}$/;

// This presentation consumes the authenticated server observation only. It does
// not infer contract deployment, reserves or execution from network connectivity.
export function nodeConnectionPresentation(data){
 const scope=data?.scope;
 if(data?.schema!=='numina.node-connection.v1'||data.status!=='connected'||data.provider!=='Kaleido'||data.expectedChainId!==expectedChain||data.chainId!==expectedChain||data.configuredSigner!==expectedSigner||
  !['rpcResponding','authorizationHeaderIncluded','chainMatched','configuredSignerListed','genesisObserved','latestBlockObserved','observationComplete'].every(key=>data[key]===true)||
  scope?.evidence!=='single_provider_read_only_observation'||!['independentNetworkVerification','expectedGenesisPinned','signerExecutionVerified','contractDeploymentVerified','nusdActivationPerformed','reservesVerified','settlementVerified','fundsMovedByThisEndpoint'].every(key=>scope[key]===false)||
  typeof data.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.observedAt)||!Number.isFinite(Date.parse(data.observedAt))||
  data.genesis?.number!=='0'||typeof data.genesis.hash!=='string'||!blockHash.test(data.genesis.hash)||/^0x0{64}$/.test(data.genesis.hash)||typeof data.genesis.timestampUnixSeconds!=='string'||!decimal.test(data.genesis.timestampUnixSeconds)||
  typeof data.latestBlock?.number!=='string'||!decimal.test(data.latestBlock.number)||typeof data.latestBlock.hash!=='string'||!blockHash.test(data.latestBlock.hash)||/^0x0{64}$/.test(data.latestBlock.hash)||typeof data.latestBlock.timestampUnixSeconds!=='string'||!decimal.test(data.latestBlock.timestampUnixSeconds)||
  data.latestBlock.number==='0'&&data.latestBlock.hash!==data.genesis.hash)throw new Error('Node connection unavailable');
 return {
  connection:'Application node connected when checked',
  'connection-detail':`Chain ${data.chainId} · latest observed block ${data.latestBlock.number} · configured signer listed · genesis read`,
  'connection-observed':`${data.provider} read-only provider check: ${new Date(data.observedAt).toISOString().replace('T',' ').replace('.000Z',' UTC').replace('Z',' UTC')}. This single-provider check does not verify signing, contract deployment, reserves or settlement.`
 };
}

export async function loadNodeConnections(panels,read=()=>requestJson('/v2/network/status')){
 const token={};
 const update=(panel,name,text)=>{if(connectionLoads.get(panel)!==token)return;const target=panel.querySelector(`[data-network-${name}]`);if(target)target.textContent=text;};
 for(const panel of panels){connectionLoads.set(panel,token);update(panel,'connection','Checking application node connection…');for(const key of ['connection-detail','connection-observed'])update(panel,key,'');}
 try{const view=nodeConnectionPresentation(await read());for(const panel of panels)for(const [key,value]of Object.entries(view))update(panel,key,value);}
 catch{for(const panel of panels){update(panel,'connection','Application node connection unavailable. Reload to check again.');for(const key of ['connection-detail','connection-observed'])update(panel,key,'');}}
}

if(typeof document!=='undefined'){
 const panels=[...document.querySelectorAll('[data-network-status]')];
 if(panels.length){const refresh=()=>{void loadNetworkPanels(panels);void loadNodeConnections(panels);};refresh();window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});}
}
