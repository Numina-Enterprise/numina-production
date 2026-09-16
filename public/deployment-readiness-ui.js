import {requestJson,createViewScope} from './http-client.js';
import {DRAFT_FIELDS,assessInputs,validateReadinessSource,createLocalDraft,importLocalDraft,createConstructorRequest} from './deployment-readiness-model.js';
const $=id=>document.getElementById(id),scope=createViewScope();let seed=null,draftGeneration=0;
const inputs=()=>Object.fromEntries(DRAFT_FIELDS.map(key=>[key,$(key).value]));
const node=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;return element;};
const notice=text=>{$('readiness-notice').textContent=text;};
function renderInputs(){
  const state=assessInputs(inputs());
  for(const field of DRAFT_FIELDS){const invalid=state.invalid.includes(field);$(field).setAttribute('aria-invalid',String(invalid));$(field+'-error').textContent=invalid?'Use the public address, hash or exact integer requested by this field.':'';}
  $('draft-progress').textContent=state.entered+' of 6 working inputs entered · none verified';
  $('export-request').disabled=!seed||!state.values.recipient||state.invalid.length>0;
  $('export-draft').disabled=!seed||state.invalid.length>0;
}
const reviewNames={independentSecurityAudit:'Independent security audit',authorizedIssuerAndJurisdictions:'Issuer and supported jurisdictions',custodianAndReserveEvidence:'Custody and reserve evidence',redeemabilityTermsAndOperations:'Redemption terms and operations',financialCrimeAndSanctionsControls:'Financial-crime and sanctions controls',independentRoleKeyCustody:'Independent custody of role keys',incidentAndPauseRecovery:'Incident and pause recovery',applicationSettlementAndFulfillmentReview:'Settlement and fulfillment integration'};
function renderRequirements(items){
  const groups=[['Recipient',item=>item.id==='native_recipient'],['Network and fees',item=>item.phase==='before_token_signing'],['Independent reviews',item=>item.phase==='before_production_signing'],['After deployment and settlement',item=>!['before_token_preparation','before_token_signing','before_production_signing'].includes(item.phase)]];
  $('readiness-requirements').replaceChildren();
  for(const [title,filter] of groups){const entries=items.filter(filter),details=node('details',''),summary=node('summary',title),list=node('ol','');summary.append(node('span',entries.length+' pending'));details.append(summary);details.open=title==='Recipient'||title==='Independent reviews';
    for(const item of entries){const row=node('li','');if(reviewNames[item.id])row.append(node('strong',reviewNames[item.id]));row.append(node('span',item.description),node('code',item.file));list.append(row);}details.append(list);$('readiness-requirements').append(details);
  }
  $('requirements-count').textContent=items.length+' package requirements pending';
}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const link=node('a','');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function refresh(){
  scope.reset();const generation=scope.generation;seed=null;$('readiness-fields').disabled=true;for(const name of ['export-draft','export-request','import-draft','clear-draft'])$(name).disabled=true;
  $('readiness-requirements').replaceChildren();$('requirements-count').textContent='Checking requirements…';$('execution-state').textContent='Checking the current status…';$('readiness-source-status').textContent='Checking the published preparation package…';$('refresh-readiness').disabled=true;
  try{
    const [candidate,descriptor,review]=await Promise.all(['/deployment-readiness-inputs.json','/api/nusd/v1/simulation','/api/nusd/v1/approved-review'].map(path=>requestJson(path,{credentials:'omit',redirect:'error',signal:scope.signal})));
    if(!scope.isCurrent(generation))return;
    const pinned=await validateReadinessSource(candidate,descriptor);
    if(!scope.isCurrent(generation))return;
    seed=pinned;
    $('readiness-source-status').textContent='Published package matched · '+seed.package.files+' files · owner-approved software review';
    renderRequirements(seed.requirements.items);
    const pending=review.deployment?.status==='not_deployed'&&review.execution?.minted===false&&review.execution?.deposited===false;
    $('execution-state').textContent=pending?'No production deployment, mint or deposit recorded in the approved review.':'Published execution status has changed. Inspect the production record before continuing.';
    if(!pending){seed=null;notice('The execution record changed. Draft editing is paused until the preparation package is updated.');return;}
    $('readiness-fields').disabled=false;$('import-draft').disabled=false;$('clear-draft').disabled=false;renderInputs();
  }catch{if(scope.isCurrent(generation)){$('readiness-source-status').textContent='Current preparation sources could not be confirmed. Refresh to try again.';$('execution-state').textContent='Current execution status unavailable.';notice('Draft export is paused. Existing inputs remain in this tab.');}}
  finally{if(scope.isCurrent(generation))$('refresh-readiness').disabled=false;}
}
$('readiness-form').addEventListener('submit',event=>event.preventDefault());$('readiness-form').addEventListener('input',()=>{draftGeneration++;renderInputs();});
$('export-draft').addEventListener('click',()=>{if(!seed||assessInputs(inputs()).invalid.length)return;download('Numina-readiness-local-draft.json',createLocalDraft(inputs()));notice('Local draft downloaded. Inputs remain unverified and were not uploaded.');});
$('export-request').addEventListener('click',()=>{if(!seed||assessInputs(inputs()).invalid.length)return;try{download('NuminaUSD.constructor-review.json',createConstructorRequest(seed,inputs()));notice('Recipient request downloaded. Replace the matching file in the extracted tools package, then follow its README.');}catch{notice('A valid public NUSD recipient is required.');}});
$('import-draft').addEventListener('click',()=>{if(seed)$('draft-file').click();});
$('draft-file').addEventListener('change',async()=>{const importGeneration=++draftGeneration,file=$('draft-file').files[0];$('draft-file').value='';if(!file||!seed)return;const generation=scope.generation;try{if(file.size>32768)throw Error('Choose a readiness draft smaller than 32 KB.');const draft=importLocalDraft(await file.text());if(!scope.isCurrent(generation)||!seed||importGeneration!==draftGeneration)return;for(const key of DRAFT_FIELDS)$(key).value=draft.inputs[key]??'';renderInputs();notice(draft.invalidFields.length?'Draft opened; invalid input values were removed. No approvals were imported.':'Local draft opened. Its inputs still require verification.');}catch(error){if(scope.isCurrent(generation)&&importGeneration===draftGeneration)notice(error.message);}});
$('clear-draft').addEventListener('click',()=>{draftGeneration++;for(const key of DRAFT_FIELDS)$(key).value='';renderInputs();notice('Working inputs cleared. Downloaded files are unchanged.');});
$('refresh-readiness').addEventListener('click',refresh);
window.addEventListener('pagehide',()=>{scope.reset();seed=null;for(const key of DRAFT_FIELDS)$(key).value='';});
window.addEventListener('pageshow',event=>{if(event.persisted){renderInputs();refresh();}});
refresh();
