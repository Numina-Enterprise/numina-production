// The builder pin is reviewed site policy, never taken from a returned bundle.
export const APPLICATION_PROVENANCE_POLICY = Object.freeze({
 sourceRepository:'skott34-dot/numina-production',
 sourceRepositoryId:1367647143,
 signerRepository:'skott34-dot/numina-builder',
 signerRepositoryId:1367645630,
 signerWorkflow:'.github/workflows/numina-site-builder.yml',
 signerSha:'23a223bcbd3818eb2fc685ea2580b6e5a7dfdf03', // Current production workflow pin; no signature result is inferred from this policy.
 sourceSha:null, // Optional additional approved source pin; never infer it from an unsigned response.
 predicateType:'https://slsa.dev/provenance/v1',
 oidcIssuer:'https://token.actions.githubusercontent.com'
});

const MANIFEST_PATH='/v4/release/manifest';
const MAX_MANIFEST_BYTES=1024*1024;
const all=selector=>document.querySelectorAll(selector);
const set=(selector,value)=>all(selector).forEach(element=>{element.textContent=value;});
let requestGeneration=0,activeController,downloadUrl=null,verificationCommand='';

function clearApplicationEvidence(message='Loading application release manifest…'){
 if(downloadUrl){URL.revokeObjectURL(downloadUrl);downloadUrl=null;}
 verificationCommand='';
 set('[data-application-state]',message);
 set('[data-application-build]','Unavailable');
 set('[data-application-manifest-sha]','Unavailable');
 set('[data-application-provenance-status]','Signature verification has not been performed.');
 set('[data-application-generation-metadata]','Unavailable');
 set('[data-application-verification-command]','Load the current manifest to prepare verification.');
 set('[data-application-copy-message]','');
 set('[data-application-readiness]','Release requirements unavailable');
 set('[data-application-deployment-receipt]','Unavailable');
 set('[data-application-settlement-receipt]','Unavailable');
 set('[data-application-native-packages]','Unavailable');
 set('[data-application-production-record]','Historical publication record unavailable');
 set('[data-application-funding-record]','Historical funding-plan record unavailable');
 all('[data-application-requirements]').forEach(list=>list.replaceChildren());
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
 const args=['gh attestation verify application-release-v4.json',
  '--hostname github.com','--repo '+policy.sourceRepository,
  '--signer-workflow '+policy.signerRepository+'/'+policy.signerWorkflow,
  '--signer-digest '+policy.signerSha,
  '--cert-oidc-issuer '+policy.oidcIssuer,'--predicate-type '+policy.predicateType,
  '--deny-self-hosted-runners','--format json'];
 if(/^[0-9a-f]{40}$/.test(policy.sourceSha||''))args.push('--source-digest '+policy.sourceSha);
 return args.join(' ');
}

function renderReleaseRequirements(data){
 const receipts=data.nusd_transaction_receipts,readiness=data.nusd_activation_readiness;
 const evidence=data.recorded_release_evidence;
 const text=value=>typeof value==='string'&&value.length<=800?value.replaceAll('_',' '):'Not reported';
 // This retained record predates the current inventory, including in legacy manifests.
 set('[data-application-production-record]',evidence?.website?.status==='succeeded'?'Historical publication record · Sites version '+evidence.website.version+' · Vercel '+text(evidence.runtime?.status)+' · Source '+text(evidence.sourceCommit)+'. This record does not verify deployment of the current build.':'No historical publication record included');
 set('[data-application-funding-record]',evidence?.fundingPlan?.status==='FUNDING_PLAN_RECORDED'?'Historical funding-plan record · Numina journal revision '+evidence.fundingPlan.revision+' · Event '+text(evidence.fundingPlan.eventId):'No historical funding-plan record included');
 const receiptText=receipt=>{
  if(!receipt||typeof receipt!=='object')return 'Not reported in this release';
  if(receipt.receipt===null&&receipt.transaction_hash===null)return 'No completed transaction recorded';
  return 'Release record: '+text(receipt.status)+'; verification record: '+text(receipt.verification?.status)+'. Check the source receipt independently.';
 };
 set('[data-application-deployment-receipt]',receiptText(receipts?.deployment));
 set('[data-application-settlement-receipt]',receiptText(receipts?.settlement));
 set('[data-application-readiness]',readiness?'NUSD activation: '+text(readiness.status):'No release-time requirements reported');
 const requirements=Array.isArray(readiness?.blockers)?readiness.blockers.slice(0,30):[];
 all('[data-application-requirements]').forEach(list=>{
  const nodes=requirements.map(item=>{
   const row=document.createElement('li');
   row.textContent=text(item?.required_evidence)+' ('+text(item?.status)+')';
   return row;
  });
  list.replaceChildren(...nodes);
 });
 const native=data.distribution?.native_candidates;
 set('[data-application-native-packages]',native
  ?'Android: '+text(native.android?.status)+'. iOS: '+text(native.ios?.status)+'. '+(native.store_publication_verified===false?'Store publication is not verified in this release.':native.store_publication_verified===true?'This release reports verified store publication; confirm the store records.':'Store publication is not reported.')
  :'Native package records are not included in this release.');
}

async function refreshApplicationRelease(){
 const generation=++requestGeneration;
 activeController?.abort();const controller=new AbortController();activeController=controller;
 clearApplicationEvidence();
 set('[data-application-build]','Loading…');
 set('[data-application-manifest-sha]','Loading…');
 let timer,manifestReceived=false;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Deadline exceeded'));},12000);});
 try{
  const {data,bytes}=await Promise.race([
   deadline,
   (async()=>{
    const response=await fetch(MANIFEST_PATH,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok||response.redirected)throw Error('Release response unavailable');
    const bytes=await readManifestBytes(response);
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(data.schema!=='numina.application-release.v2'||data.schema_version!==2||data.version!=='4.0.0'||data.product!=='Numina'||data.release!=='numina-v4.0.0'||!/^[a-f0-9]{64}$/.test(data.build_id))throw Error('Release identity mismatch');
    return {data,bytes};
   })()
  ]);
  if(generation!==requestGeneration||controller.signal.aborted)return;
  manifestReceived=true;
  set('[data-application-state]','Application release 4.0.0 manifest received · calculating fingerprint…');
  set('[data-application-version]','4.0.0');
  renderReleaseRequirements(data);
  set('[data-application-build]',data.build_id);
  set('[data-application-hash-note]','Manifest received; fingerprint calculation is in progress.');
  const generated=data.assurance?.builder_signed_provenance;
  set('[data-application-generation-metadata]',generated===false
   ?'The inventory generator did not create builder-signed provenance. A later detached attestation can sign these unchanged bytes.'
   :generated===true?'This inventory reports builder-signed provenance at generation time. That report has not been independently verified here.'
    :'The inventory does not report a generation-time builder-signing result.');
  downloadUrl=URL.createObjectURL(new Blob([bytes],{type:'application/json'}));
  all('[data-application-download]').forEach(button=>{button.disabled=false;});
  verificationCommand=commandForPolicy();
  set('[data-application-verification-command]',verificationCommand||'The reviewed builder revision has not been configured yet. A pinned verification command will appear when it is available.');
  all('[data-application-copy-command]').forEach(button=>{button.disabled=!verificationCommand;});
  set('[data-application-provenance-status]','Not verified in this browser. Look up statements for this fingerprint, then verify the signature and builder identity.');
  // Fingerprinting is a separate check; failure does not erase a received manifest.
  // Hash the response body itself. JSON.stringify(data) would change the signed bytes.
  const digestBytes=await Promise.race([crypto.subtle.digest('SHA-256',bytes),deadline]);
  if(generation!==requestGeneration||controller.signal.aborted)return;
  const digest=Array.from(new Uint8Array(digestBytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  set('[data-application-manifest-sha]',digest);
  set('[data-application-hash-note]','Calculated from the exact manifest response downloaded during this refresh. This fingerprint alone does not verify a signature.');
  const lookup='https://api.github.com/repos/'+APPLICATION_PROVENANCE_POLICY.sourceRepository+'/attestations/sha256:'+digest+'?predicate_type=provenance';
  all('[data-application-attestation-lookup]').forEach(link=>{
   link.href=lookup;link.removeAttribute('aria-disabled');link.removeAttribute('tabindex');
  });
  set('[data-application-state]','Application release 4.0.0 manifest received · fingerprint calculated');
 }catch{
  if(generation!==requestGeneration)return;
  if(manifestReceived){
   set('[data-application-state]','Application release 4.0.0 manifest received · fingerprint unavailable');
   set('[data-application-manifest-sha]','Unavailable');
   set('[data-application-hash-note]','The manifest was received, but its fingerprint could not be calculated during this refresh.');
   set('[data-application-provenance-status]','Not verified in this browser. Download the received manifest to verify its signature and builder identity independently.');
  }else clearApplicationEvidence('Application release manifest could not be loaded');
 }finally{clearTimeout(timer);if(activeController===controller)activeController=null;}
}

all('[data-application-download]').forEach(button=>button.addEventListener('click',()=>{
 if(!downloadUrl||button.disabled)return;
 const link=document.createElement('a');link.href=downloadUrl;link.download='application-release-v4.json';
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
