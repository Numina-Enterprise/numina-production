import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {countryOptions} from '../public/app-entry.js';
import {countryReadiness,validateCoverageRecords,validateNotApplicableAssessment} from '../public/compliance-model.js';
const read=name=>JSON.parse(readFileSync(new URL('../public/'+name,import.meta.url),'utf8'));
const coverage=read('compliance-coverage.json'),countries=read('country-readiness.json');
const clone=o=>structuredClone(o);
test('coverage matches 249 maintained options and never asserts market approval',()=>{
 assert.equal(validateCoverageRecords(coverage,countries).ok,true);
 assert.deepEqual(countries.countries.map(c=>c.code).sort(),countryOptions().map(c=>c[0]).sort());
 for(const c of countries.countries){assert.equal(c.legal_review_status,'NOT_REVIEWED');assert.equal(c.financial_activation,false);assert.equal(c.enterprise_activation,false);assert.deepEqual(c.approved_activity_scopes,[]);}
});
test('US consulting route cannot imply enterprise or financial clearance',()=>{
 const r=countryReadiness(coverage,countries,'US','consulting');assert.equal(r.source_route,'US_USD_REQUEST_CHECKOUT');
 for(const activity of ['consulting','enterprise_deployment','software_distribution','regulated_finance']){const state=countryReadiness(coverage,countries,'US',activity);assert.equal(state.country_legal_clearance,false);assert.equal(state.enterprise_activation,false);assert.equal(state.financial_activation,false);assert.equal(state.authorizes_live_execution,false);assert.equal(state.requirements.length,15);}
});
test('unknown, unsupported and malformed inputs require review',()=>{
 for(const code of ['ZZ','us','',null])assert.equal(countryReadiness(coverage,countries,code).status,'REVIEW_REQUIRED');
 assert.ok(countryReadiness(coverage,countries,'GB','custody_now').error);
 for(const mutate of [c=>c.record_revision='old',c=>c.countries[0].financial_activation=true,c=>c.countries[0].legal_review_status='APPROVED',c=>c.countries.pop(),c=>c.countries[1].code=c.countries[0].code]){const changed=clone(countries);mutate(changed);assert.equal(validateCoverageRecords(coverage,changed).ok,false);assert.equal(countryReadiness(coverage,changed,'US').financial_activation,false);}
 const changed=clone(coverage);changed.domains.pop();assert.equal(validateCoverageRecords(changed,countries).ok,false);
});
test('absent evidence is never a not-applicable assessment',()=>{
 assert.equal(validateNotApplicableAssessment({applicability:'NOT_APPLICABLE_ASSESSED',status:'NOT_APPLICABLE_ASSESSED'}),false);
 const a={applicability:'NOT_APPLICABLE_ASSESSED',status:'NOT_APPLICABLE_ASSESSED',country_code:'US',activity_scope:'Synthetic-data source demonstration',human_reviewer:'Example reviewer',reviewed_on:'2026-10-04',valid_until:'2026-12-31',legal_basis:'Example scoped legal assessment reference',evidence_refs:['Example assessment receipt']};
 assert.equal(validateNotApplicableAssessment(a),true);for(const key of ['country_code','activity_scope','human_reviewer','reviewed_on','valid_until','legal_basis','evidence_refs']){const b=clone(a);delete b[key];assert.equal(validateNotApplicableAssessment(b),false);}
});

test('international review has no paid checkout or static activation authority',()=>{
 for(const c of countries.countries.filter(c=>c.code!=='US')){const r=countryReadiness(coverage,countries,c.code,'enterprise_deployment');assert.equal(r.source_route,'INTAKE_AND_SCOPE_REVIEW_ONLY');assert.equal(c.international_paid_checkout,'UNAVAILABLE_PENDING_COUNTRY_ACTIVITY_APPROVAL');assert.equal(r.authorizes_live_execution,false);}
 assert.equal(coverage.existing_source_policy.country_approval_evidence_implemented,false);
});
