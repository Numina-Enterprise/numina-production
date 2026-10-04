import {MANIFEST_ROUTES,canonicalManifest,controlHealth} from './manifest-surface.js';
import {networkPresentation} from './network-status.js';
const set=(id,value)=>{const element=document.getElementById(id);if(element)element.textContent=String(value);};
let generation=0;
export async function refreshControlRoom({signal,isCurrent=()=>true}={}){
  const current=++generation;
  for(const id of ['canonical-head','canonical-root','head-revision','head-state','chain-state','chain-height','chain-observed'])set(id,'Loading…');
  const read=async url=>{const response=await fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});if(!response.ok&&!(url===MANIFEST_ROUTES.health&&response.status===503))throw Error('Unavailable');return response.json();};
  const results=await Promise.allSettled([read(MANIFEST_ROUTES.manifest),read(MANIFEST_ROUTES.head),read(MANIFEST_ROUTES.health),read(MANIFEST_ROUTES.networkEvidence)]);
  if(current!==generation||signal?.aborted||!isCurrent())return;
  const value=index=>{if(results[index].status!=='fulfilled')throw results[index].reason;return results[index].value;};
  try{
    const manifest=canonicalManifest(value(0)),head=value(1);
    if(head.schema!=='numina.public-head.v2'||head.identity!=='NUMINA'||head.applicationVersion!==manifest.applicationVersion||head.currentJournalRootVerified!==false||head.revision!==null||!/^[a-f0-9]{64}$/.test(head.head)||!/^[a-f0-9]{64}$/.test(head.rootHash))throw Error('Unexpected projection');
    set('canonical-head',head.head);set('canonical-root',head.rootHash);
    set('head-state','Numina '+manifest.applicationVersion+' public build projection; these hashes are not a live journal head.');
  }catch{set('canonical-head','Unavailable');set('canonical-root','Unavailable');set('head-state','Canonical build projection unavailable.');}
  try{const health=controlHealth(value(2));set('head-revision',health.revision+' · control '+health.status+' · continuity '+(health.checks.journalContinuity?'reported':'unavailable'));}
  catch{set('head-revision','Control journal health unavailable');}
  set('chain-state','Current node connection is not verified');set('chain-height','No current block observation');
  try{set('chain-observed',networkPresentation(value(3)).observed);}catch{set('chain-observed','Dated network evidence unavailable');}
}
