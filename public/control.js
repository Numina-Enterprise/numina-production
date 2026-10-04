import {workspaceSignInUrl,resumeWorkspaceSession} from './workspace-session.js';
import {clearNativeTreasury,loadNativeTreasury} from './native-treasury.js';
import {clearTreasuryDocuments,loadTreasuryDocuments} from './treasury-documents.js';
import {clearStripeTreasury,loadStripeTreasury} from './stripe-treasury.js';
import {requestJson,createViewScope} from './http-client.js';
import {clearControlReceipt,renderControlReceipt} from './control-receipts.js';
const $=id=>document.getElementById(id);let snapshot=null,selected=null,busy=false,treasuryGeneration=0,refreshGeneration=0,refreshOnReturn=false;
const viewScope=createViewScope();
$('signin').querySelector('a')?.setAttribute('href',workspaceSignInUrl(location.href,'/control'+new URL(location.href).hash));
function controlView(current){
 const invalid=()=>{throw new Error('Current records could not be read. Use Refresh state to try again.');};
 const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(current?.identity!=='NUMINA'||current.root!=='NUMINA'||current.manifest!=='NUMINA'||!['complete','authority-scoped'].includes(current.scope)||!Number.isSafeInteger(current.revision)||current.revision<0||!hash(current.manifestHash)||!hash(current.evidenceHead)||current.content?.schema!==1||!['requests','evidence','grants','records'].every(key=>Array.isArray(current.content[key]))||!Array.isArray(current.decisions))invalid();
 const requests=current.content.requests.map(request=>{
  const status=request?.execution?.status??request?.execution?.state;
  if(typeof request?.id!=='string'||!request.id||typeof request.wants?.resource!=='string'||typeof request.wants?.payload!=='string'||typeof request.who!=='string'||typeof request.authority!=='string'||!Array.isArray(request.evidence)||!['pending','committed'].includes(status))invalid();
  return {...request,execution:{...request.execution,state:status}};
 });
 const ids=new Set(requests.map(request=>request.id));
 if(ids.size!==requests.length||current.decisions.length!==requests.length||new Set(current.decisions.map(decision=>decision?.requestId)).size!==requests.length||current.decisions.some(decision=>!ids.has(decision?.requestId)||!['ALLOW','DENY','ESCALATE'].includes(decision.outcome)||typeof decision.reason!=='string'||(decision.nextAction!==null&&(!hash(decision.nextAction?.actionId)||decision.nextAction.requestId!==decision.requestId||decision.nextAction.expectedRevision!==current.revision)))||current.content.grants.some(grant=>typeof grant?.id!=='string'||typeof grant.subject!=='string'||typeof grant.resourcePrefix!=='string'||!Array.isArray(grant.scopes)))invalid();
 // View-only aliases retain the established renderer; the authenticated canonical response is unchanged.
 return {...current,content:{...current.content,requests},projection:current.scope,state:{...current.content,requests},stateHash:current.manifestHash};
}
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
async function api(path,body){const generation=viewScope.generation;try{const value=await requestJson('/api/control/v1/'+path,{headers:body?{'Content-Type':'application/json'}:{},method:body?'POST':'GET',body:body?stable(body):undefined,signal:viewScope.signal});if(!viewScope.isCurrent(generation))throw Object.assign(new Error('Request cancelled.'),{name:'AbortError'});return value;}catch(error){if(!viewScope.isCurrent(generation))throw Object.assign(new Error('Request cancelled.'),{name:'AbortError'});if(error.status===401){clearSession();$('message').textContent='Sign in again to load your current records.';}throw error;}}
const words=s=>String(s||'Connection unavailable.').toLowerCase().replaceAll('_',' ');
const el=(tag,text,className)=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
function clearTreasuryStatement(){clearNativeTreasury();clearTreasuryDocuments();clearStripeTreasury();treasuryGeneration++;}
async function loadTreasuryStatement(){
  if(snapshot?.scope!=='complete')return;
  const generation=treasuryGeneration;
  void loadNativeTreasury();void loadStripeTreasury();
  void loadTreasuryDocuments().catch(()=>{if(generation===treasuryGeneration)$('document-summary').textContent='Documents unavailable. Use Refresh state to try again.';});
}
function controls(){document.querySelectorAll('#workspace button:not([data-document-control])').forEach(b=>b.disabled=busy||!snapshot);$('refresh').disabled=busy;}
function clearWorkspace(resetForms=false){
 snapshot=null;clearTreasuryStatement();clearControlReceipt($('detail'));$('workspace').hidden=true;$('detail').hidden=true;
 for(const id of ['requests','grants','evidence','selected-evidence'])$(id).replaceChildren();
 for(const id of ['resource-detail','payload-detail','who-detail','authority-detail','outcome','reason','state-proof'])$(id).textContent='';
 if(resetForms){selected=null;for(const id of ['request-form','attest-form','resolve-form','delegate-form'])$(id).reset();}
 controls();
}
function clearSession(){viewScope.reset();refreshGeneration++;clearWorkspace(true);$('signin').hidden=false;$('revision').textContent='—';$('health').textContent='Unavailable';$('integrity').textContent='Unavailable';}
document.addEventListener('numina-owner-access-lost',()=>{clearSession();$('message').textContent='Sign in again to refresh your records.';});
window.addEventListener('pagehide',()=>{clearSession();$('message').textContent='';});
window.addEventListener('pageshow',event=>{if(event.persisted){if(busy)refreshOnReturn=true;else run(refresh);}});
async function refresh(){
 const generation=++refreshGeneration;clearWorkspace();$('signin').hidden=true;$('health').textContent='Checking…';$('revision').textContent='—';$('integrity').textContent='Checking…';
 try{
  const health=await api('health');if(generation!==refreshGeneration)return;
  $('health').textContent=health.status==='ready'?'Ready':'Unavailable';$('revision').textContent=health.revision;$('integrity').textContent=health.checks?.manifestIntegrity===true&&health.checks?.evidenceHead===true?'Checked':'Unavailable';
  const current=await api('state');if(generation!==refreshGeneration)return;
  snapshot=controlView(current);$('workspace').hidden=false;render();void loadTreasuryStatement();
 }catch(e){
  if(generation!==refreshGeneration)return;
  clearWorkspace();$('health').textContent='Unavailable';$('revision').textContent='—';$('integrity').textContent='Unavailable';
  if(e.status===401||e.status===403){clearSession();$('message').textContent='Sign in to load your current records.';return;}
  throw e;
 }finally{controls();}
}
function render(){const list=$('requests');list.replaceChildren();for(const r of snapshot.content.requests){const d=snapshot.decisions.find(x=>x.requestId===r.id),b=el('button',r.wants.resource,'request-row');b.type='button';b.setAttribute('aria-pressed',String(selected===r.id));b.append(el('span',words(d.reason)));b.onclick=()=>{selected=r.id;render();};list.append(b);}if(!list.children.length)list.append(el('p','No requests yet. Create an internal record request to begin.','empty'));
  const request=snapshot.content.requests.find(r=>r.id===selected);renderControlReceipt($('detail'),snapshot,request);$('detail').hidden=!request;$('choose').hidden=!!request;if(request){const d=snapshot.decisions.find(x=>x.requestId===request.id);$('resource-detail').textContent=request.wants.resource;$('payload-detail').textContent=request.wants.payload;$('who-detail').textContent=request.who;$('authority-detail').textContent=request.authority;$('outcome').textContent=d.outcome;$('reason').textContent=words(d.reason);$('next').hidden=!d.nextAction;$('next').disabled=busy;$('attest-form').hidden=request.execution.state!=='pending';$('resolve-form').hidden=request.execution.state!=='pending'||!request.evidence.length;
    const evidence=$('evidence');evidence.replaceChildren();for(const node of snapshot.content.evidence.filter(e=>e.requestId===request.id)){const li=el('li',node.kind==='attestation'?node.key+': '+node.value:node.kind==='resolution'?'Resolution: '+node.reason:'Internal record committed');li.append(el('div',node.id+' · '+node.actor));evidence.append(li);}if(!evidence.children.length)evidence.append(el('li','No evidence attached.'));
    $('selected-evidence').replaceChildren();for(const node of snapshot.content.evidence.filter(e=>e.kind==='attestation'&&e.requestId===request.id)){const option=el('option',node.key+': '+node.value);option.value=node.id;$('selected-evidence').append(option);}
  }
  $('grants').replaceChildren();for(const g of snapshot.content.grants){const row=el('div','','grant-row');row.append(el('span',g.subject+' · '+g.resourcePrefix+' · '+(g.revoked?'revoked':g.scopes.join(', '))));if(g.id!=='root'&&!g.revoked){const b=el('button','Revoke','button secondary');b.type='button';b.onclick=()=>run(()=>command('revoke',{grantId:g.id}));row.append(b);}$('grants').append(row);}
  $('state-proof').textContent='Revision '+snapshot.revision+'\nManifest SHA-256 '+snapshot.manifestHash+'\nEvidence head '+snapshot.evidenceHead;
}
async function command(type,data){if(!snapshot)throw new Error('Refresh state before making a change.');const result=await api('commands',{id:crypto.randomUUID(),expectedRevision:snapshot.revision,type,data});$('message').textContent='Saved at revision '+result.event.revision+'.';try{await refresh();}catch{$('message').textContent='Saved at revision '+result.event.revision+'. The latest view is unavailable; use Refresh state.';}return result;}
async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){if(e.name==='AbortError')return;const message=e.name==='TimeoutError'?'The connection timed out. If you submitted a change, its result is unconfirmed. Use Refresh state and review the records before submitting again.':e.status===409?'The shared state changed or this action is no longer valid. Review the refreshed decision.':words(e.message);try{await refresh();}catch{}$('message').textContent=message;}finally{busy=false;controls();if(refreshOnReturn){refreshOnReturn=false;void run(refresh);}}}
$('request-form').onsubmit=e=>{e.preventDefault();run(async()=>{selected=crypto.randomUUID();await command('request',{id:selected,route:'internal.record.v1',wants:{resource:'record:'+$('resource').value,payload:$('payload').value},requiredEvidence:['review']});$('request-form').reset();});};
$('attest-form').onsubmit=e=>{e.preventDefault();run(async()=>{await command('attest',{requestId:selected,key:'review',value:$('attestation').value,expiresAt:Math.floor(Date.now()/1000)+3600,parents:[]});$('attest-form').reset();});};
$('resolve-form').onsubmit=e=>{e.preventDefault();run(()=>command('resolve',{requestId:selected,key:'review',selectedId:$('selected-evidence').value,reason:$('resolution-reason').value}));};
$('next').onclick=()=>run(()=>{const next=snapshot.decisions.find(d=>d.requestId===selected).nextAction;return command('execute',{requestId:selected,actionId:next.actionId});});
$('delegate-form').onsubmit=e=>{e.preventDefault();run(async()=>{await command('delegate',{id:crypto.randomUUID(),parent:'root',subject:'email:'+$('delegate-email').value.trim().toLowerCase(),scopes:['request.create','evidence.attest','record.write'],resourcePrefix:'record:'+$('delegate-prefix').value,expiresAt:Math.floor(Date.now()/1000)+86400});$('delegate-form').reset();});};
$('refresh').onclick=()=>run(refresh);$('reconcile').onclick=()=>run(()=>command('reconcile',{}));if(!resumeWorkspaceSession(location))run(refresh);
