import {CONNECTION_TARGETS,validateConnectionManifest,checkConnection,connectionReport} from './connection-model.js';
import {requestJson} from './http-client.js';
const grid=document.querySelector('#connection-grid'),summary=document.querySelector('#connection-summary'),check=document.querySelector('#check-connections'),cancel=document.querySelector('#cancel-connections'),download=document.querySelector('#download-connections');
const cards=new Map(),results=new Map();let controller=null;
const node=(tag,text,className)=>{const item=document.createElement(tag);item.textContent=text;if(className)item.className=className;return item;};
function showResult(value){
  results.set(value.id,value);const card=cards.get(value.id);card.badge.textContent=value.label;card.badge.dataset.state=value.state;card.detail.textContent=value.message;card.time.textContent=value.state==='cancelled'?'Not checked':'Checked '+new Date(value.checkedAt).toLocaleTimeString()+' · '+value.durationMs+' ms';
}
function showSummary(){const values=[...results.values()],available=values.filter(v=>v.state==='available').length,attention=values.filter(v=>!['available','cancelled'].includes(v.state)).length;const completed=values.filter(v=>v.state!=='cancelled').length;summary.textContent=completed+' of '+cards.size+' checked · '+available+' responding · '+attention+' need attention';}
async function runChecks(){
  if(controller)return;controller=new AbortController();const signal=controller.signal;results.clear();check.disabled=true;cancel.hidden=false;download.disabled=true;summary.textContent='Checking Numina connections…';
  for(const card of cards.values()){card.badge.textContent='Waiting';card.badge.dataset.state='pending';card.detail.textContent='Waiting for this check.';card.time.textContent='';}
  const pending=[...cards.keys()];
  try{await Promise.all(Array.from({length:4},async()=>{while(pending.length&&!signal.aborted){const id=pending.shift();cards.get(id).badge.textContent='Checking…';const value=await checkConnection(id,{origin:location.origin,signal});showResult(value);showSummary();}}));}
  finally{for(const id of pending)showResult({id,name:CONNECTION_TARGETS[id].name,path:CONNECTION_TARGETS[id].path,state:'cancelled',label:'Not checked',message:'The check was cancelled before this interface was contacted.',checkedAt:new Date().toISOString(),durationMs:0,httpStatus:null});showSummary();controller=null;check.disabled=false;cancel.hidden=true;download.disabled=results.size===0;}
}
check.addEventListener('click',runChecks);cancel.addEventListener('click',()=>controller?.abort());
download.addEventListener('click',()=>{const report=connectionReport([...results.values()],location.origin),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='numina-connection-observations.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
try{
  const manifest=validateConnectionManifest(await requestJson('/api/connections/v1/manifest'));
  for(const surface of manifest.surfaces){const target=CONNECTION_TARGETS[surface.id],article=node('article','','connection-card'),heading=node('h3',target.name),badge=node('span','Not checked','connection-badge'),detail=node('p','Run a check to read this interface’s current response.'),time=node('small',''),link=node('a','Open interface ↗','text-link');link.href=target.entry==='/api/app/v1'?'/app':target.kind==='mcp'?'/frontier':target.entry;article.append(heading,badge,detail,time,link);grid.append(article);cards.set(surface.id,{badge,detail,time});}
  summary.textContent=cards.size+' Numina surfaces ready to check.';check.disabled=false;
}catch{summary.textContent='The connection inventory is unavailable. Reload this page to try again.';}
window.addEventListener('pagehide',()=>controller?.abort());
