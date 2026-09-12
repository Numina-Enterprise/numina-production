let requestGeneration=0,activeController;
const set=(selector,value)=>document.querySelectorAll(selector).forEach(element=>{element.textContent=value;});
async function refreshApplicationRelease(){
 const generation=++requestGeneration;
 activeController?.abort();const controller=new AbortController();activeController=controller;
 const timer=setTimeout(()=>controller.abort(),12000);
 set('[data-application-state]','Loading deployed release…');
 set('[data-application-build]','Loading…');
 try{
  const response=await fetch('/v2/release/manifest',{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
  if(!response.ok)throw Error('Release response unavailable');
  const data=await response.json();
  if(data.schema!=='numina.application-release.v2'||data.schema_version!==2||data.version!=='2.0.0'||!/^[a-f0-9]{64}$/.test(data.build_id))throw Error('Release identity mismatch');
  if(generation!==requestGeneration)return;
  set('[data-application-version]','2.0.0');set('[data-application-state]','Production release 2.0.0 · manifest available');set('[data-application-build]',data.build_id);
 }catch{if(generation===requestGeneration){set('[data-application-state]','Current release response unavailable');set('[data-application-build]','Unavailable');}}
 finally{clearTimeout(timer);}
}
window.addEventListener('pagehide',()=>{requestGeneration++;activeController?.abort();set('[data-application-state]','Refresh to load current release');set('[data-application-build]','Unavailable');});
window.addEventListener('pageshow',event=>{if(event.persisted)void refreshApplicationRelease();});
document.querySelectorAll('[data-refresh-release]').forEach(button=>button.addEventListener('click',()=>void refreshApplicationRelease()));
void refreshApplicationRelease();
