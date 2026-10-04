// Public readiness information never authorizes a live execution or provider account.
export const COMPLIANCE_REVISION='numina-global-2026-10-04';
export const COMPLIANCE_VERSION='4.0.0';
const activities=new Set(['consulting','enterprise_deployment','software_distribution','regulated_finance']);
const requiredDomainIds=['entity-contracts','privacy-rights','transfers-residency','retention-deletion','ai-governance','accessibility','sanctions-export','consumer-payments-marketing','regulated-finance','software-ip','corporate-tax','workforce','cyber-incidents','assurance-coverage','distribution-mobile'];
export function validateCoverageRecords(coverage,countryRecord){
 const fail=reason=>({ok:false,reason});
 for(const [record,schema] of [[coverage,'numina.compliance-coverage.v1'],[countryRecord,'numina.country-readiness.v1']]){
  if(!record||record.schema!==schema||record.identity!=='NUMINA'||record.application_version!==COMPLIANCE_VERSION||record.record_revision!==COMPLIANCE_REVISION)return fail('The coverage record is missing or does not match this maintained revision.');
 }
 if(!Array.isArray(coverage.domains)||coverage.domains.length!==requiredDomainIds.length)return fail('The requirement inventory is incomplete.');
 const found=new Set();
 for(const item of coverage.domains){
  if(!item||found.has(item.id)||!requiredDomainIds.includes(item.id)||!['REQUIRED','PENDING_ASSESSMENT'].includes(item.applicability)||item.status!=='PENDING'||item.verified_assessor!==null)return fail('A requirement status cannot be verified by this preparation record.');
  found.add(item.id);
 }
 if(!Array.isArray(countryRecord.countries)||countryRecord.countries.length!==249)return fail('The country and territory inventory is incomplete.');
 const codes=new Set();
 for(const c of countryRecord.countries){
  if(!c||!/^[A-Z]{2}$/.test(c.code)||codes.has(c.code)||typeof c.name!=='string'||!c.name||c.legal_review_status!=='NOT_REVIEWED'||c.financial_activation!==false||c.enterprise_activation!==false||c.assessment!==null||!Array.isArray(c.approved_activity_scopes)||c.approved_activity_scopes.length!==0)return fail('The country record contains an unsupported activation or review claim.');
  codes.add(c.code);
 }
 if(coverage.summary?.global_certification!==false||coverage.summary?.approved_country_count!==0||coverage.summary?.regulated_financial_activation!==false)return fail('An unsupported global clearance claim was found.');
 return {ok:true};
}
export function countryReadiness(coverage,countryRecord,code,activity='consulting'){
 const valid=validateCoverageRecords(coverage,countryRecord);
 const blocked={status:'REVIEW_REQUIRED',country_legal_clearance:false,enterprise_activation:false,financial_activation:false,authorizes_live_execution:false};
 if(!valid.ok)return {...blocked,error:valid.reason,requirements:[]};
 if(!activities.has(activity))return {...blocked,error:'Select an actual activity for review.',requirements:[]};
 const country=countryRecord.countries.find(c=>c.code===code);
 if(!country)return {...blocked,error:'This country or territory is not in the maintained option inventory. It remains unavailable for automatic activation.',requirements:[]};
 return {...blocked,country,activity,requirements:coverage.domains,
  source_route:country.current_consulting_checkout_route,
  source_policy_notice:country.code==='US'?'The current US USD consulting request checkout is an intake route. Accepted scope, customer evidence and applicable transaction controls remain separate.':'International intake and scope review are available. Paid checkout is unavailable for every non-US order pending actual country/activity approval; no approval receipt workflow or completed approval is implemented.',
  activity_notice:activity==='regulated_finance'?'Regulated financial activity remains inactive. Verify the actual issuer/provider permissions, asset flow, customer, custody and corridor before any activation.':activity==='software_distribution'?'Distribution requires the actual artifact, third-party/native inventory, signing, privacy declarations, export assessment and any store approval.':activity==='enterprise_deployment'?'Enterprise deployment requires the actual customer, data and country assessment, agreements and operational evidence.':'Consulting inquiry availability is separate from acceptance of a paid engagement and permission for a regulated activity.'};
}
// A later not-applicable assessment needs actual scoped evidence; lack of facts cannot satisfy it.
export function validateNotApplicableAssessment(a){
 if(!a||a.applicability!=='NOT_APPLICABLE_ASSESSED'||a.status!=='NOT_APPLICABLE_ASSESSED')return false;
 const text=v=>typeof v==='string'&&v.trim().length>0;
 return /^[A-Z]{2}$/.test(a.country_code||'')&&text(a.activity_scope)&&text(a.human_reviewer)&&text(a.legal_basis)&&/^\d{4}-\d{2}-\d{2}$/.test(a.reviewed_on||'')&&/^\d{4}-\d{2}-\d{2}$/.test(a.valid_until||'')&&Number.isFinite(Date.parse(a.reviewed_on))&&Number.isFinite(Date.parse(a.valid_until))&&a.valid_until>=a.reviewed_on&&Array.isArray(a.evidence_refs)&&a.evidence_refs.length>0&&a.evidence_refs.every(text);
}
