import {MANIFEST_ROUTES,alignedApplication} from './manifest-surface.js';
import {workspaceSignInUrl,resumeWorkspaceSession} from './workspace-session.js';
import {requestJson,createViewScope} from './http-client.js';
import {verifyTreasuryAccountView} from './treasury-proof.js';
import {refreshControlRoom} from './control-room.js';
import {renderFundingPlan} from './funding-plan.js';
import {renderTreasuryBalances,renderNativeAccountReference} from './treasury-balances.js';
import {mountTreasuryAdjustment} from './treasury-adjustment-ui.js';
import {mountTreasuryPreparation} from './treasury-preparation-ui.js';
const $=s=>document.querySelector(s);
import {NUMINA_LAYERS} from './architecture-layers.js';
import {PUBLIC_LAYER_LABELS} from './architecture-labels.js';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const frontierScope=createViewScope();
const privatePanels=['#treasury-actions','#treasury-policy','#accounts','#requests','#treasury-balances','#funding-plan'];
function clearPrivateRecords(){frontierScope.reset();for(const selector of privatePanels)$(selector)?.replaceChildren();}
function ownerAccessLost(){clearPrivateRecords();const link=node('a','Sign in to Numina');link.href=workspaceSignInUrl(location.href,'/frontier'+new URL(location.href).hash);link.className='text-link';$('#account-status').replaceChildren(link);$('#treasury-status').textContent='Owner access is required.';$('#refresh').disabled=false;}
document.addEventListener('numina-owner-access-lost',ownerAccessLost);
window.addEventListener('pagehide',clearPrivateRecords);
window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
async function api(path,body,options={}){
  const generation=frontierScope.generation;
  const cancelled=()=>Object.assign(new Error('Request cancelled.'),{name:'AbortError'});
  try{const value=await requestJson('/api/control/v2/'+path,{signal:frontierScope.signal,...options,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:canonical(body)}:{})});if(!frontierScope.isCurrent(generation))throw cancelled();return value;}
  catch(error){if(!frontierScope.isCurrent(generation))throw cancelled();if(error.status===401||error.status===403)document.dispatchEvent(new CustomEvent('numina-owner-access-lost'));throw error;}
}
function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
function treasuryActions(t,readApi,isCurrent){
  const target=$('#treasury-actions');if(!target)return;target.replaceChildren();
  if(t.treasury.status==='READY'){
    mountTreasuryAdjustment(target,{root:t.treasury.principal,isCurrent,onCommitted:refresh,onAccessLost:ownerAccessLost});
    mountTreasuryPreparation(target,{root:t.treasury.principal,accounts:t.accounts,isCurrent,onCommitted:refresh,onAccessLost:ownerAccessLost});
  }
  if(t.treasury.status==='NOT_INITIALIZED'){
    const b=node('button','Initialize canonical NUSD projection');b.className='button secondary';
    b.onclick=async()=>{b.disabled=true;try{
      const current=await api('treasury/accounts');
      if(!isCurrent())return;
      if(!await verifyTreasuryAccountView(current))throw Error('Treasury record could not be verified.');
      if(!isCurrent())return;
      if(current.treasury.status==='READY'){await refresh();return;}
      if(!isCurrent())return;
      const state=current.treasury;
      const result=await requestJson('/api/control/v1/treasury',{method:'POST',signal:frontierScope.signal,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:canonical({id:crypto.randomUUID(),expectedRevision:state.revision,expectedHead:state.head,Principal:state.principal,Authority:'NUMINA',Objective:'treasury.initialize',Intent:{operation:'INITIALIZE',reason:'Owner initializes the singular Numina-native treasury projection in the existing journal'}})});
      if(!isCurrent())return;await refresh();
    }catch(e){if(!isCurrent())return;if(e.status===401||e.status===403){ownerAccessLost();return;}$('#treasury-status').textContent=e.message;b.disabled=false;}};
    target.append(node('p','Initialize the authorized Numina-native model: 500,000,000,000,000 NUSD in the existing journal. Provider balances remain their own observations.'),b);
  }
  const identities=t.accounts.map(a=>canonical({provider:a.provider,legalEntity:a.legalEntity,accountLabel:a.accountLabel,providerAccountReference:a.providerAccountReference}));
  for(const account of t.accounts.filter(a=>a.labelConflict))target.append(node('p',account.accountLabel+' groups '+account.sourceReferences.length+' references to the same provider account. Conflicting original labels are retained in the account record; the native balance is counted once.'));
  if(new Set(identities).size<identities.length){const b=node('button','Consolidate duplicate references');b.className='button secondary';b.onclick=async()=>{b.disabled=true;try{const latest=await api('state');if(!isCurrent())return;await api('treasury/consolidate',{id:crypto.randomUUID(),expectedRevision:latest.revision,data:{}});if(!isCurrent())return;await refresh();}catch(e){if(isCurrent()){$('#treasury-status').textContent=e.message;b.disabled=false;}}};target.append(b);}
  const policyTarget=$('#treasury-policy');if(policyTarget){policyTarget.replaceChildren();
    readApi('treasury/policy').then(record=>{
      if(!isCurrent())return;
      policyTarget.append(node('h3','Treasury policy catalog'),node('p','The retained policy lists Stripe Treasury and Bank of America Savings. Its allocation and settlement statements do not establish current funding or provider submission.'));
      if(record.currentJournal){const j=record.currentJournal;policyTarget.append(node('p','Current Numina journal · revision '+j.revision+' · '+(j.balance??'unavailable')+' '+(j.unit??'NUSD')+' · internal settlement '+j.settlementStatus+' · provider submission '+j.externalProviderSubmissionStatus+'.'));}
      const link=node('a','Read retained policy and current journal status ↗');link.href='/api/control/v2/treasury/policy';policyTarget.append(link);
      if(record.activation.policyHash===record.policyHash){policyTarget.append(node('p','Owner policy catalog entry recorded · '+record.policy.id));return;}
      policyTarget.append(node('p','This retained policy is not recorded in the current owner journal. The current journal must confirm matching aggregate settlement before any new policy recording is considered.'));
    }).catch(()=>{if(isCurrent())policyTarget.append(node('p','Treasury policy status is unavailable.'));});
  }
  const form=node('form','');form.className='account-link-form';
  function field(label,name,required=true){const l=node('label',label);const input=document.createElement('input');input.name=name;input.required=required;input.maxLength=256;l.append(input);form.append(l);return input;}
  const selectLabel=node('label','Provider');const select=document.createElement('select');select.name='provider';for(const [value,label]of [['stripe','Stripe Treasury'],['bank-of-america','Bank of America']]){const o=node('option',label);o.value=value;select.append(o);}selectLabel.append(select);form.append(selectLabel);
  field('Legal entity','legalEntity');field('Account label','accountLabel');field('Provider reference (optional; no bank account numbers)','providerAccountReference',false);
  const submit=node('button','Link account reference');submit.className='button secondary';submit.type='submit';form.append(submit);
  form.onsubmit=async event=>{event.preventDefault();if(submit.disabled)return;submit.disabled=true;try{const latest=await api('state');if(!isCurrent())return;const data=Object.fromEntries(new FormData(form));data.id=crypto.randomUUID();data.providerAccountReference=data.providerAccountReference.trim()||null;await api('treasury/accounts',{id:crypto.randomUUID(),expectedRevision:latest.revision,data});if(!isCurrent())return;await refresh();}catch(e){if(isCurrent()){$('#treasury-status').textContent=e.message;submit.disabled=false;}}};
  target.append(node('h3','Designate a business account'),node('p','Record its relationship to Numina. Provider ownership, balances and submission permissions keep their verified status.'),form);
}
async function refresh(){
  clearPrivateRecords();
  const generation=frontierScope.generation,signal=frontierScope.signal;
  const isCurrent=()=>frontierScope.isCurrent(generation);
  const readApi=(path,body)=>api(path,body,{signal});
  void refreshApplicationIdentity(signal,isCurrent);
  $('#refresh').disabled=true;
  $('#treasury-status').textContent='Reading the canonical treasury…';
  try{
    await refreshControlRoom({signal,isCurrent});if(!isCurrent())return;
    try{
      const m=await readApi('manifest');if(!isCurrent())return;
      $('#frontier-status').textContent=m.livemode?'Production · Live mode · '+m.version+(m.procurement_usage===true?' · Procurement request evidence required':''):'Production configuration unavailable';
      $('#providers').replaceChildren(...m.providers.map(p=>{const n=node('article','');n.append(node('h3',p.id),node('p',p.submission?'Internal records available':'Handoff preparation available; provider submission not connected'));return n;}));
    }catch{if(!isCurrent())return;$('#frontier-status').textContent='Production status unavailable';}
    try{
      const s=await readApi('state');if(!isCurrent())return;
      const requests=s.content.requests;
      const batch=requests.length?await readApi('decisions/batch',{requestIds:requests.map(r=>r.id)}):{decisions:[]};if(!isCurrent())return;
      const byId=new Map(batch.decisions.map(d=>[d.requestId,d]));
      $('#account-status').textContent='Connected · Journal revision '+s.revision;
      for(const r of requests){
        const box=node('article','');box.className='request-row';box.append(node('h3',r.Objective),node('p',r.Principal+' · '+r.Intent.provider));
        const d=byId.get(r.id);box.append(node('p',r.execution?'FINAL':d?d.decision+' · '+d.reason.replaceAll('_',' '):'Decision unavailable'));
        if(!r.execution&&d?.reason==='HUMAN_APPROVAL_REQUIRED'){
          for(const choice of ['ALLOW','DENY']){
            const b=node('button',choice==='ALLOW'?'Approve request':'Deny request');b.className='button secondary';
            b.onclick=async()=>{b.disabled=true;try{const latest=await api('state');if(!isCurrent())return;await api('approvals',{id:crypto.randomUUID(),expectedRevision:latest.revision,data:{requestId:r.id,decision:choice,expiresAt:Math.floor(Date.now()/1000)+900,reason:'Owner decision in Numina control workspace'}});if(!isCurrent())return;await refresh();}catch(e){if(isCurrent())$('#account-status').textContent=e.message;b.disabled=false;}};box.append(b);
          }
        }
        $('#requests').append(box);
      }
      if(!requests.length)$('#requests').append(node('p','No agent requests are recorded yet.'));
    }catch{if(!isCurrent())return;$('#account-status').textContent='Current requests are unavailable. Refresh to try again.';}
    try{
      const t=await readApi('treasury/accounts');if(!isCurrent())return;
      if(!await verifyTreasuryAccountView(t))throw Error('Treasury records are inconsistent.');
      if(!isCurrent())return;
      treasuryActions(t,readApi,isCurrent);
      $('#treasury-status').textContent=t.treasury.projection?'Native journal verified · Revision '+t.treasury.revision:'Canonical treasury is not initialized';
      $('#accounts').replaceChildren(...t.accounts.map(a=>{const row=node('article','');row.append(node('p',a.legalEntity+' · '+a.provider+' · '+a.accountLabel+' · '+(a.providerOwnershipVerified?'Provider verified':'Owner designated')));if(a.sharedNativeTreasury){row.append(renderNativeAccountReference(t));const link=node('a','View the canonical native treasury ↗');link.href='/api/control/v1/treasury';row.append(link);}return row;}));
      await Promise.all([renderTreasuryBalances($('#treasury-balances'),t,{signal}),renderFundingPlan($('#funding-plan'),t,api,refresh,{signal})]);
    }catch{if(!isCurrent())return;for(const selector of privatePanels.filter(s=>s!=='#requests'))$(selector)?.replaceChildren();$('#treasury-status').textContent='Treasury records could not be verified. Refresh to read the current canonical record.';}
  }finally{if(isCurrent())$('#refresh').disabled=false;}
}
const layers=$('#architecture-layers');if(layers)layers.replaceChildren(...NUMINA_LAYERS.layers.map(layer=>{const display=PUBLIC_LAYER_LABELS[layer.id]||{title:'Related records',description:'Browse the published records for this layer.'};const card=node('article','');card.append(node('h3',layer.id+' · '+display.title),node('p',display.description));return card;}));
$('#refresh').onclick=refresh;if(!resumeWorkspaceSession(location))refresh();
async function refreshApplicationIdentity(signal,isCurrent){
  $('#core-release-status').textContent='Checking the current Numina build…';
  try{
    const [manifest,release]=await Promise.all([MANIFEST_ROUTES.manifest,MANIFEST_ROUTES.release].map(path=>requestJson(path,{cache:'no-store',credentials:'omit',redirect:'error',signal})));
    if(!isCurrent())return;
    const r=alignedApplication(manifest,release);
    $('#core-release-status').textContent='Numina OS '+r.version+' · Control room '+r.frontier.version+' · Plugin '+r.distribution.codex_plugin.version+' · Build '+r.build_id;
  }catch{if(isCurrent())$('#core-release-status').textContent='Current release information is unavailable. Refresh to load the current build.';}
}
