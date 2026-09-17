'use strict';

const {sign,PROVIDERS,RELEASE_IDENTITY}=require('../lib/numina');
const authority=require('../lib/owner-authority');
const {NUMINA_MANIFEST}=require('../lib/numina-manifest');
const {project}=require('../lib/numina-projection');
const {observeProvider,SUPPORTED_READ_ONLY_PROVIDERS}=require('../lib/provider-observations');

function respond(res,status,value){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(value));}
function catalog(){
  const executionState=authority.executionState();
  const payload={
    schema:'numina.execution-provider-catalog.v1',
    release:RELEASE_IDENTITY.production_version,
    manifest:NUMINA_MANIFEST.schema,
    providers:Object.keys(PROVIDERS).sort().map(key=>({
      ...PROVIDERS[key],
      live_adapter_shipped:key==='arc',
      partnership_state:authority.partnershipState(),
      execution_state:executionState,
      live_submission:key==='arc'?{available:true,route:'/v1/execution/submit',method:'POST',network:'Arc Testnet',chain_id:5042002,payload:'pre-signed-raw-transaction',owner_authorization:'EIP-191 wallet signature bound to handoff, transaction hash, idempotency key, and expiry',arbitrary_provider_url_allowed:false,embedded_private_key_allowed:false}:{available:false},
      read_only_observation:SUPPORTED_READ_ONLY_PROVIDERS.includes(key)?{available:true,mode:'public-read-only-health',route:`/v1/execution/providers?mode=health&provider=${key}`,credentialed:false,external_execution_performed:false}:{available:false}
    })),
    observation_set:{available:true,route:'/v1/execution/providers?mode=health-all',providers:SUPPORTED_READ_ONLY_PROVIDERS,credentialed:false,partnership_status:'not_asserted',partnership_state:authority.partnershipState(),external_execution_performed:false},
    live_submission_route:'/v1/execution/submit',
    live_submission_route_exposed:true,
    live_submission_provider:'arc',
    provider_submitter_approved:true,
    pre_signed_payload_required:true,
    owner_authorization_required:true,
    credentialed_provider_submitter_available:false,
    partnership_status:'not_asserted',
    external_execution_performed:false
  };
  return project('providers',payload);
}
async function observationSet(){
  const observations=await Promise.all(SUPPORTED_READ_ONLY_PROVIDERS.map(provider=>observeProvider(provider)));
  const allHealthy=observations.every(item=>item.healthy===true);
  return project('provider-observations',{
    schema:'numina.provider-observation-set.v1',
    release:RELEASE_IDENTITY.production_version,
    manifest:NUMINA_MANIFEST.schema,
    mode:'public-read-only-health',
    source_authority:'provider_public_endpoints',
    credentialed:false,
    partnership_status:'not_asserted',
    partnership_state:authority.partnershipState(),
    external_execution_performed:false,
    observed_at:new Date().toISOString(),
    providers:SUPPORTED_READ_ONLY_PROVIDERS,
    observation_count:observations.length,
    all_healthy:allHealthy,
    status:allHealthy?'HEALTHY':'DEGRADED',
    observations
  });
}

module.exports=async function(req,res){
  if(req.method!=='GET'){res.setHeader('allow','GET');return respond(res,405,{error:'METHOD_NOT_ALLOWED'});}
  const url=new URL(req.url,'https://numina-production.vercel.app');
  const mode=String(url.searchParams.get('mode')||'catalog').trim().toLowerCase();
  if(mode==='catalog')return respond(res,200,catalog());
  try{
    if(mode==='health-all'){
      const observation_set=await observationSet();
      return respond(res,200,{observation_set,receipt:sign(observation_set,'NUMINA_PROVIDER_OBSERVATION_SET')});
    }
    if(mode!=='health')return respond(res,400,{error:'UNKNOWN_PROVIDER_MODE'});
    const provider=String(url.searchParams.get('provider')||'').trim().toLowerCase();
    const observation=await observeProvider(provider);
    const projection=project('provider-observation',{manifest:NUMINA_MANIFEST.schema,partnership_status:'not_asserted',partnership_state:authority.partnershipState(),observation});
    const receipt=sign(projection,'NUMINA_PROVIDER_OBSERVATION');
    return respond(res,observation.healthy?200:503,{observation:projection,receipt});
  }catch(error){
    return respond(res,400,{error:String(error?.message||error)});
  }
};
