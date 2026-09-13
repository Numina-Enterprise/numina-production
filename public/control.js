import {clearTreasuryDocuments,loadTreasuryDocuments} from './treasury-documents.js';
import {clearStripeTreasury,loadStripeTreasury} from './stripe-treasury.js';
import {requestJson,createViewScope} from './http-client.js';
import {clearControlReceipt,renderControlReceipt} from './control-receipts.js';
const $=id=>document.getElementById(id);let snapshot=null,selected=null,busy=false,treasuryGeneration=0,refreshGeneration=0,refreshOnReturn=false;
const viewScope=createViewScope();
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
async function api(path,body){const generation=viewScope.generation;try{const value=await requestJson('/api/control/v1/'+path,{headers:body?{'Content-Type':'application/json'}:{},method:body?'POST':'GET',body:body?stable(body):undefined,signal:viewScope.signal});if(!viewScope.isCurrent(generation))throw Object.assign(new Error('Request cancelled.'),{name:'AbortError'});return value;}catch(error){if(!viewScope.isCurrent(generation))throw Object.assign(new Error('Request cancelled.'),{name:'AbortError'});if(error.status===401){clearSession();$('message').textContent='Sign in again to load your current records.';}throw error;}}
const words=s=>String(s||'Connection unavailable.').toLowerCase().replaceAll('_',' ');
const el=(tag,text,className)=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
function clearTreasuryStatement(){clearTreasuryDocuments();clearStripeTreasury();treasuryGeneration++;$('treasury-owner-panel').hidden=true;$('treasury-owner-details').replaceChildren();}
async function loadTreasuryStatement(){
  if(snapshot?.projection!=='complete')return;
  const generation=treasuryGeneration;
  try{const statement=await api('treasury-attestation');
    if(generation!==treasuryGeneration||snapshot?.projection!=='complete')return;
    if(statement.schema!=='numina.treasury.owner_statement.v1'||statement.classification!=='owner_reported_not_independently_verified')throw new Error('Invalid owner statement');
    const rows=[['Reported owner',statement.reported_owner],['Reported institution',statement.reported_institution],['Reported account',statement.reported_account_type],['Reported date',statement.reported_as_of],['Owner-reported amount',new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(BigInt(statement.reported_amount_usd))],['Reported custodian',statement.reported_custodian],['Source',statement.source],['Owner evidence statement',statement.owner_reports_evidence_supplied?'Owner reports evidence supplied':'No owner evidence-supply statement recorded'],['Owner-reported financial activity',statement.owner_financial_activity_statement||'No owner activity statement recorded'],['Bank-origin verification','Not completed'],['Independent verification','Not completed'],['Verified reserve amount','Not established'],['Verified allocation','Not established'],['Financial execution','Inactive']];
    const details=$('treasury-owner-details');details.replaceChildren();for(const [label,value]of rows){details.append(el('dt',label),el('dd',value));}$('treasury-owner-panel').hidden=false;void loadStripeTreasury();void loadTreasuryDocuments().catch(()=>{if(generation===treasuryGeneration)$('document-summary').textContent='Documents unavailable. Use Refresh state to try again.';});
  }catch{if(generation===treasuryGeneration)clearTreasuryStatement();}
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
  $('health').textContent=health.status==='ready'?'Ready':'Unavailable';$('revision').textContent=health.revision;$('integrity').textContent=health.checks.stateIntegrity&&health.checks.evidenceHead?'Checked':'Unavailable';
  const current=await api('state');if(generation!==refreshGeneration)return;
  snapshot=current;$('workspace').hidden=false;render();void loadTreasuryStatement();
 }catch(e){
  if(generation!==refreshGeneration)return;
  clearWorkspace();$('health').textContent='Unavailable';$('revision').textContent='—';$('integrity').textContent='Unavailable';
  if(e.status===401||e.status===403){clearSession();$('message').textContent='Sign in to load your current records.';return;}
  throw e;
 }finally{controls();}
}
function render(){const list=$('requests');list.replaceChildren();for(const r of snapshot.state.requests){const d=snapshot.decisions.find(x=>x.requestId===r.id),b=el('button',r.wants.resource,'request-row');b.type='button';b.setAttribute('aria-pressed',String(selected===r.id));b.append(el('span',words(d.reason)));b.onclick=()=>{selected=r.id;render();};list.append(b);}if(!list.children.length)list.append(el('p','No requests yet. Create an internal record request to begin.','empty'));
  const request=snapshot.state.requests.find(r=>r.id===selected);renderControlReceipt($('detail'),snapshot,request);$('detail').hidden=!request;$('choose').hidden=!!request;if(request){const d=snapshot.decisions.find(x=>x.requestId===request.id);$('resource-detail').textContent=request.wants.resource;$('payload-detail').textContent=request.wants.payload;$('who-detail').textContent=request.who;$('authority-detail').textContent=request.authority;$('outcome').textContent=d.outcome;$('reason').textContent=words(d.reason);$('next').hidden=!d.nextAction;$('next').disabled=busy;$('attest-form').hidden=request.execution.state!=='pending';$('resolve-form').hidden=request.execution.state!=='pending'||!request.evidence.length;
    const evidence=$('evidence');evidence.replaceChildren();for(const node of snapshot.state.evidence.filter(e=>e.requestId===request.id)){const li=el('li',node.kind==='attestation'?node.key+': '+node.value:node.kind==='resolution'?'Resolution: '+node.reason:'Internal record committed');li.append(el('div',node.id+' · '+node.actor));evidence.append(li);}if(!evidence.children.length)evidence.append(el('li','No evidence attached.'));
    $('selected-evidence').replaceChildren();for(const node of snapshot.state.evidence.filter(e=>e.kind==='attestation'&&e.requestId===request.id)){const option=el('option',node.key+': '+node.value);option.value=node.id;$('selected-evidence').append(option);}
  }
  $('grants').replaceChildren();for(const g of snapshot.state.grants){const row=el('div','','grant-row');row.append(el('span',g.subject+' · '+g.resourcePrefix+' · '+(g.revoked?'revoked':g.scopes.join(', '))));if(g.id!=='root'&&!g.revoked){const b=el('button','Revoke','button secondary');b.type='button';b.onclick=()=>run(()=>command('revoke',{grantId:g.id}));row.append(b);}$('grants').append(row);}
  $('state-proof').textContent='Revision '+snapshot.revision+'\nState SHA-256 '+snapshot.stateHash+'\nEvidence head '+snapshot.evidenceHead;
}
async function command(type,data){if(!snapshot)throw new Error('Refresh state before making a change.');const result=await api('commands',{id:crypto.randomUUID(),expectedRevision:snapshot.revision,type,data});$('message').textContent='Saved at revision '+result.event.revision+'.';try{await refresh();}catch{$('message').textContent='Saved at revision '+result.event.revision+'. The latest view is unavailable; use Refresh state.';}return result;}
async function run(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){if(e.name==='AbortError')return;const message=e.name==='TimeoutError'?'The connection timed out. If you submitted a change, its result is unconfirmed. Use Refresh state and review the records before submitting again.':e.status===409?'The shared state changed or this action is no longer valid. Review the refreshed decision.':words(e.message);try{await refresh();}catch{}$('message').textContent=message;}finally{busy=false;controls();if(refreshOnReturn){refreshOnReturn=false;void run(refresh);}}}
$('request-form').onsubmit=e=>{e.preventDefault();run(async()=>{selected=crypto.randomUUID();await command('request',{id:selected,route:'internal.record.v1',wants:{resource:'record:'+$('resource').value,payload:$('payload').value},requiredEvidence:['review']});$('request-form').reset();});};
$('attest-form').onsubmit=e=>{e.preventDefault();run(async()=>{await command('attest',{requestId:selected,key:'review',value:$('attestation').value,expiresAt:Math.floor(Date.now()/1000)+3600,parents:[]});$('attest-form').reset();});};
$('resolve-form').onsubmit=e=>{e.preventDefault();run(()=>command('resolve',{requestId:selected,key:'review',selectedId:$('selected-evidence').value,reason:$('resolution-reason').value}));};
$('next').onclick=()=>run(()=>{const next=snapshot.decisions.find(d=>d.requestId===selected).nextAction;return command('execute',{requestId:selected,actionId:next.actionId});});
$('delegate-form').onsubmit=e=>{e.preventDefault();run(async()=>{await command('delegate',{id:crypto.randomUUID(),parent:'root',subject:'email:'+$('delegate-email').value.trim().toLowerCase(),scopes:['request.create','evidence.attest','record.write'],resourcePrefix:'record:'+$('delegate-prefix').value,expiresAt:Math.floor(Date.now()/1000)+86400});$('delegate-form').reset();});};
$('refresh').onclick=()=>run(refresh);$('reconcile').onclick=()=>run(()=>command('reconcile',{}));run(refresh);
