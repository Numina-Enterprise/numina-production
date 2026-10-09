import {readFileSync} from 'node:fs';
import legacyStatus from '../runtime/vercel-production/api/status.js';
import legacyRuntime from '../runtime/vercel-production/lib/numina.js';
import projectionModule from '../runtime/vercel-production/lib/numina-projection.js';
import {NUSD_POLICY} from '../src/nusd-http.js';
import {readPrivateBankRoute} from '../src/bank-route-config.js';
import {treasurySubmissionHttp} from '../src/treasury-submission.js';
import {NUMINA_TREASURY_CONNECTION,NUSD_OPERATOR_ACTIVATION} from '../public/treasury-connection-model.js';

const deploymentReceipt=JSON.parse(readFileSync(new URL('../runtime/nusd/deployment-receipt.json',import.meta.url),'utf8'));
const deploymentVerification=JSON.parse(readFileSync(new URL('../runtime/nusd/deployment-verification.json',import.meta.url),'utf8'));
const settlementReceipt=JSON.parse(readFileSync(new URL('../runtime/nusd/settlement-receipt.json',import.meta.url),'utf8'));

function writeJson(req,res,value,{immutable=false}={}){
  res.statusCode=200;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control',immutable?'public, max-age=300, immutable':'no-store');
  res.setHeader('x-content-type-options','nosniff');
  res.setHeader('x-numina-identity','NUMINA');
  res.setHeader('allow','GET');
  return res.end(JSON.stringify(value));
}

export default async function handler(req,res){
  const url=new URL(req.url,'https://numinalabs.xyz');
  const mode=url.searchParams.get('mode');
  if(!mode)return legacyStatus(req,res);
  if(mode==='treasury-submissions')return treasurySubmissionHttp(req,res);
  if(mode==='control-manifest'){
    if(req.method!=='GET'){res.statusCode=405;res.setHeader('allow','GET');return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));}
    const credentialedProviderSubmitterAvailable=Boolean(process.env.NUMINA_PROVIDER_SUBMISSION_TOKEN);
    const controls=legacyRuntime.ownerControls(legacyRuntime.controls());
    const manifest=projectionModule.project('control-manifest',{
      schema:'numina.control-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
      release:legacyRuntime.RELEASE_IDENTITY.production_version,controls,
      funds:legacyRuntime.fundsManifest(),
      execution:legacyRuntime.executionManifest({credentialedProviderSubmitterAvailable}),
      partnership:legacyRuntime.partnershipManifest(),
      external_execution_performed:false,external_funds_moved:false
    });
    const receipt=legacyRuntime.sign(manifest,'NUMINA_CONTROL_MANIFEST');
    return writeJson(req,res,{manifest,receipt,compatibility:{route:'/v1/control/state',role:'legacy_route_only'}});
  }
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','no-store');
    res.setHeader('allow','GET');
    return res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));
  }
  if(mode==='bank-route'){
    res.setHeader('content-type','application/json; charset=utf-8');
    res.setHeader('cache-control','private, no-store');
    res.setHeader('x-content-type-options','nosniff');
    try{const route=await readPrivateBankRoute(req);res.statusCode=200;return res.end(JSON.stringify(route));}
    catch(error){res.statusCode=error.status||503;return res.end(JSON.stringify({error:error.message}));}
  }
  if(mode==='treasury-model')return writeJson(req,res,NUMINA_TREASURY_CONNECTION);
  if(mode==='nusd-activation')return writeJson(req,res,NUSD_OPERATOR_ACTIVATION);
  if(mode==='nusd-status')return writeJson(req,res,NUSD_POLICY);
  if(mode==='nusd-contracts')return writeJson(req,res,NUSD_POLICY.contract_record);
  if(mode==='nusd-mint-workflow')return writeJson(req,res,NUSD_POLICY.mint_workflow);
  if(mode==='nusd-conversion-workflow')return writeJson(req,res,NUSD_POLICY.conversion_workflow);
  if(mode==='nusd-deployment-receipt')return writeJson(req,res,deploymentReceipt,{immutable:true});
  if(mode==='nusd-deployment-verification')return writeJson(req,res,deploymentVerification,{immutable:true});
  if(mode==='nusd-settlement-receipt')return writeJson(req,res,settlementReceipt,{immutable:true});
  res.statusCode=404;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  return res.end(JSON.stringify({error:'NOT_FOUND'}));
}
