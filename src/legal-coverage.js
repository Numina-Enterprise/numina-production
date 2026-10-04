import {COUNTRY_CODES} from '../public/country-codes.js';
import {NUMINA_LEGAL_DISCOVERY} from '../public/legal-discovery.js';

// A public evidence readback. It does not evaluate a transaction or grant access.
export async function legalCoverageHttp(req,env){
 const path=new URL(req.url).pathname;
 const records={
  '/api/app/v1/legal-manifest':{asset:'/compliance-coverage.json',schema:'numina.compliance-coverage.v1'},
  '/api/app/v1/country-readiness':{asset:'/country-readiness.json',schema:'numina.country-readiness.v1'}
 };
 const record=records[path];if(!record)return null;
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Numina-Legal-Revision':NUMINA_LEGAL_DISCOVERY.recordRevision};
 if(!['GET','HEAD'].includes(req.method))return new Response(JSON.stringify({error:'METHOD_NOT_ALLOWED'}),{status:405,headers:{...headers,Allow:'GET, HEAD'}});
 if(new URL(req.url).search)return new Response(req.method==='HEAD'?null:JSON.stringify({error:'UNEXPECTED_PARAMETERS'}),{status:400,headers});
 try{
  // Fetch GET for both methods so HEAD cannot skip validation of the evidence.
  const asset=await env.ASSETS.fetch(new Request(new URL(record.asset,req.url),{method:'GET'}));
  if(asset.status!==200)throw Error('Missing record');
  const text=await asset.text(),value=JSON.parse(text);
  if(value.schema!==record.schema||value.identity!==NUMINA_LEGAL_DISCOVERY.identity||value.application_version!==NUMINA_LEGAL_DISCOVERY.applicationVersion||value.record_revision!==NUMINA_LEGAL_DISCOVERY.recordRevision)throw Error('Record identity mismatch');
  if(record.schema==='numina.compliance-coverage.v1'&&(value.summary?.global_certification!==false||value.summary?.approved_country_count!==0||value.summary?.regulated_financial_activation!==false))throw Error('Coverage evidence bounds mismatch');
  if(record.schema==='numina.country-readiness.v1'){
   if(!Array.isArray(value.countries)||value.countries.length!==COUNTRY_CODES.length)throw Error('Country inventory mismatch');
   const codes=value.countries.map(row=>row.code);
   if(new Set(codes).size!==COUNTRY_CODES.length||COUNTRY_CODES.some(code=>!codes.includes(code))||value.countries.some(row=>row.financial_activation!==false||row.enterprise_activation!==false))throw Error('Country evidence bounds mismatch');
  }
  return new Response(req.method==='HEAD'?null:text,{status:200,headers});
 }catch{
  return new Response(req.method==='HEAD'?null:JSON.stringify({error:'LEGAL_COVERAGE_UNAVAILABLE'}),{status:503,headers});
 }
}
