import {countryReadiness,validateCoverageRecords} from './compliance-model.js';
const countrySelect=document.querySelector('#compliance-country');
const activitySelect=document.querySelector('#compliance-activity');
const result=document.querySelector('#compliance-country-result');
const intake=document.querySelector('#compliance-intake');
function el(tag,text){const node=document.createElement(tag);node.textContent=text;return node;}
function showFailure(message){if(!result)return;result.replaceChildren(el('strong','Review required'),el('p',message),el('p','Automatic enterprise or financial activation cannot be confirmed. Use the contact route to request an actual scope review.'));}
if(countrySelect&&activitySelect&&result){
 try{
  const responses=await Promise.all(['/compliance-coverage.json','/country-readiness.json'].map(path=>fetch(path,{credentials:'omit',cache:'no-store'})));
  if(responses.some(r=>!r.ok))throw new Error('The current shared records could not be retrieved.');
  const [coverage,countries]=await Promise.all(responses.map(r=>r.json()));
  const valid=validateCoverageRecords(coverage,countries);if(!valid.ok)throw new Error(valid.reason);
  countrySelect.replaceChildren(...countries.countries.map(c=>{const option=el('option',c.name+' ('+c.code+')');option.value=c.code;return option;}));
  countrySelect.disabled=false;countrySelect.value='US';
  function update(){
   const readiness=countryReadiness(coverage,countries,countrySelect.value,activitySelect.value);
   if(readiness.error){showFailure(readiness.error);return;}
   const c=readiness.country;
   result.replaceChildren(el('strong',c.name+' · Review required'),el('p',readiness.source_policy_notice),el('p',readiness.activity_notice),el('p','No completed country review is recorded. Enterprise activation: pending. Regulated financial activation: inactive. Store authorization: not verified.'));
   const list=el('ul','');
   for(const d of readiness.requirements){const li=el('li','');const link=el('a',d.title+' — '+(d.applicability==='REQUIRED'?'required; completion pending':'applicability assessment pending'));link.href='#requirement-'+d.id;li.append(link);list.append(li);}
   result.append(list);
   if(intake){const subject='Numina scope review: '+c.name+' / '+readiness.activity;intake.href='mailto:skott34@numinalabs.xyz?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent('Country/territory: '+c.name+' ('+c.code+')\nActivity: '+readiness.activity+'\nCustomer and contracting entity: \nData, provider locations and requested scope: \nPlease do not include credentials, keys or sensitive personal records in this initial inquiry.');}
  }
  countrySelect.addEventListener('change',update);activitySelect.addEventListener('change',update);update();
 }catch(error){showFailure(error instanceof Error?error.message:'The country review record is unavailable.');}
}
