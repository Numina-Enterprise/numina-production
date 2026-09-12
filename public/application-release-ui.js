// The builder pin is reviewed site policy, never taken from a returned bundle.
export const APPLICATION_PROVENANCE_POLICY = Object.freeze({
 sourceRepository:'skott34-dot/numina-production',
 sourceRepositoryId:1367647143,
 signerRepository:'skott34-dot/numina-builder',
 signerRepositoryId:1367645630,
 signerWorkflow:'.github/workflows/numina-site-builder.yml',
 signerSha:'4a7210c10fcfa79436018e8ba337244402661036', // Published immutable builder reviewed in the linked artifact assessment.
 sourceSha:null, // Optional additional approved source pin; never infer it from an unsigned response.
 predicateType:'https://slsa.dev/provenance/v1',
 oidcIssuer:'https://token.actions.githubusercontent.com'
});

const MANIFEST_PATH='/v2/release/manifest';
const MAX_MANIFEST_BYTES=1024*1024;
const all=selector=>document.querySelectorAll(selector);
const set=(selector,value)=>all(selector).forEach(element=>{element.textContent=value;});
let requestGeneration=0,activeController,downloadUrl=null,verificationCommand='';

function clearApplicationEvidence(message='Loading deployed release…'){
 if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}
 verificationCommand='';
 set('[data-application-state]',message);
 set('[data-application-build]','Unavailable');
 set('[data-application-manifest-sha]','Unavailable');
 set('[data-application-provenance-status]','Signature verification has not been performed.');
 set('[data-application-generation-metadata]','Unavailable');
 set('[data-application-verification-command]','Load the current manifest to prepare verification.');
 set('[data-application-copy-message]','');
 set('[data-application-hash-note]','No manifest response is currently loaded.');
 all('[data-application-download]').forEach(button=>{button.disabled=true;});
 all('[data-application-copy-command]').forEach(button=>{button.disabled=true;});
 all('[data-application-attestation-lookup]').forEach(link=>{
  link.removeAttribute('href');link.setAttribute('aria-disabled','true');link.tabIndex=-1;
 });
}

async function readManifestBytes(response){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>MAX_MANIFEST_BYTES)throw Error('Response too large');
 if(!response.body?.getReader){
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.byteLength>MAX_MANIFEST_BYTES)throw Error('Response too large');
  return bytes;
 }
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   length+=value.byteLength;
   if(length>MAX_MANIFEST_BYTES){await reader.cancel();throw Error('Response too large');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes;
}

function commandForPolicy(){
 const policy=APPLICATION_PROVENANCE_POLICY;
 if(!/^[0-9a-f]{40}$/.test(policy.signerSha||''))return '';
 const args=['gh attestation verify application-release-v2.json',
  '--hostname github.com','--repo '+policy.sourceRepository,
  '--signer-workflow '+policy.signerRepository+'/'+policy.signerWorkflow,
  '--signer-digest '+policy.signerSha,
  '--cert-oidc-issuer '+policy.oidcIssuer,'--predicate-type '+policy.predicateType,
  '--deny-self-hosted-runners','--format json'];
 if(/^[0-9a-f]{40}$/.test(policy.sourceSha||''))args.push('--source-digest '+policy.sourceSha);
 return args.join(' ');
}

async function refreshApplicationRelease(){
 const generation=++requestGeneration;
 activeController?.abort();const controller=new AbortController();activeController=controller;
 clearApplicationEvidence();
 set('[data-application-build]','Loading…');
 set('[data-application-manifest-sha]','Loading…');
 let timer;
 try{
  const {data,bytes,digest}=await Promise.race([
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Deadline exceeded'));},12000);}),
   (async()=>{
    const response=await fetch(MANIFEST_PATH,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok||response.redirected)throw Error('Release response unavailable');
    const bytes=await readManifestBytes(response);
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(data.schema!=='numina.application-release.v2'||data.schema_version!==2||data.version!=='2.0.0'||data.product!=='Numina'||data.release!=='numina-v2.0.0'||!/^[a-f0-9]{64}$/.test(data.build_id))throw Error('Release identity mismatch');
    // Hash the response body itself. JSON.stringify(data) would change the signed bytes.
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
    return {data,bytes,digest};
   })()
  ]);
  if(generation!==requestGeneration||controller.signal.aborted)return;
  set('[data-application-version]','2.0.0');
  set('[data-application-build]',data.build_id);
  set('[data-application-manifest-sha]',digest);
  set('[data-application-hash-note]','Calculated from the exact manifest response downloaded during this refresh. This fingerprint alone does not verify a signature.');
  const generated=data.assurance?.builder_signed_provenance;
  set('[data-application-generation-metadata]',generated===false
   ?'The inventory generator did not create builder-signed provenance. A later detached attestation can sign these unchanged bytes.'
   :generated===true?'This inventory reports builder-signed provenance at generation time. That report has not been independently verified here.'
    :'The inventory does not report a generation-time builder-signing result.');
  const lookup='https://api.github.com/repos/'+APPLICATION_PROVENANCE_POLICY.sourceRepository+'/attestations/sha256:'+digest+'?predicate_type=provenance';
  all('[data-application-attestation-lookup]').forEach(link=>{
   link.href=lookup;link.removeAttribute('aria-disabled');link.removeAttribute('tabindex');
  });
  downloadUrl=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));
  all('[data-application-download]').forEach(button=>{button.disabled=false;});
  verificationCommand=commandForPolicy();
  set('[data-application-verification-command]',verificationCommand||'The reviewed builder revision has not been configured yet. A pinned verification command will appear when it is available.');
  all('[data-application-copy-command]').forEach(button=>{button.disabled=!verificationCommand;});
  set('[data-application-provenance-status]','Not verified in this browser. Look up statements for this fingerprint, then verify the signature and builder identity.');
  set('[data-application-state]','Release 2.0.0 manifest received · fingerprint calculated');
 }catch{
  if(generation===requestGeneration)clearApplicationEvidence('Current release response unavailable');
 }finally{clearTimeout(timer);if(activeController===controller)activeController=null;}
}

all('[data-application-download]').forEach(button=>button.addEventListener('click',()=>{
 if(!downloadUrl||button.disabled)return;
 const link=document.createElement('a');link.href=downloadUrl;link.download='application-release-v2.json';
 document.body.append(link);link.click();link.remove();
}));
all('[data-application-copy-command]').forEach(button=>button.addEventListener('click',async()=>{
 if(!verificationCommand||button.disabled)return;
 const generation=requestGeneration,command=verificationCommand;
 try{
  if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
  await navigator.clipboard.writeText(command);
  if(generation===requestGeneration)set('[data-application-copy-message]','Verification command copied.');
 }catch{
  if(generation===requestGeneration)set('[data-application-copy-message]','Select and copy the command shown above.');
 }
}));
window.addEventListener('pagehide',()=>{
 requestGeneration++;activeController?.abort();clearApplicationEvidence('Refresh to load current release');
});
window.addEventListener('pageshow',event=>{if(event.persisted)void refreshApplicationRelease();});
all('[data-refresh-release]').forEach(button=>button.addEventListener('click',()=>void refreshApplicationRelease()));
void refreshApplicationRelease();
