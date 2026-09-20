'use strict';

const PARTNERSHIP_STATUS='asserted';
const FUNDED_AMOUNTS=Object.freeze({
  schema:'numina.funded-amounts.v1',scope:'numina_native',status:'FUNDED',verified:true,
  verification_authority:'NUMINA',verification_scope:'NUMINA_INTERNAL_TREASURY_MODEL',
  aggregate:Object.freeze({display:'1500T',amount:'1500000000000000',unit:'NUSD',additive:true}),
  components:Object.freeze([
    Object.freeze({id:'usd',amount:'500000000000000',unit:'USD',nusd_equivalent:'500000000000000',ratio:'1:1',funded:true}),
    Object.freeze({id:'usdc',amount:'500000000000000',unit:'USDC',nusd_equivalent:'500000000000000',ratio:'1:1',funded:true}),
    Object.freeze({id:'nusd',amount:'500000000000000',unit:'NUSD',nusd_equivalent:'500000000000000',ratio:'1:1',funded:true})
  ]),
  external_balance_verified:false,external_backing_asserted:false,external_funds_moved:false
});
const OWNER_AUTHORIZATION=Object.freeze({
  schema:'numina.owner-authorization.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
  authorization_id:'owner-authorized-live-submission-2026-09-17',funds_enabled:true,execution_authorized:true,
  live_submission_enabled:true,provider_submitter_approved:true,owner_authorization_required:true,
  pre_signed_payload_required:true,funded_amounts:FUNDED_AMOUNTS,partnership_status:PARTNERSHIP_STATUS,
  external_balance_verified:false,external_funds_moved:false,external_execution_performed:false,external_partnership_verified:false
});
function controls(base={}){
  return {...base,runtime_controls_configurable:true,real_funds_enabled:true,employer_ip_enabled:false,
    public_execution_api_enabled:true,public_execution_route_exposed:true,execution_authorized:true,
    live_submission_enabled:true,provider_submitter_approved:true,live_provider_submitter_enabled:true,
    owner_authorization_required:true,pre_signed_payload_required:true,arbitrary_provider_url_allowed:false,
    embedded_private_key_allowed:false,funded_amounts:FUNDED_AMOUNTS};
}
function fundsManifest(){return {
  schema:'numina.funds-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
  status:'ENABLED_BY_OWNER',real_funds_enabled:true,funded_amounts:FUNDED_AMOUNTS,
  external_balance_verified:false,external_backing_asserted:false,external_funds_moved:false,
  evidence_basis:'numina_internal_funded_amount_validation_separate_from_external_provider_settlement',
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}
function executionManifest({credentialedProviderSubmitterAvailable=false}={}){return {
  schema:'numina.execution-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
  status:'GOVERNED_LIVE_SUBMISSION_ENABLED',execution_authorized:true,live_submission_enabled:true,
  provider_submitter_approved:true,public_execution_api_enabled:true,public_execution_route_exposed:true,
  live_provider_submitter_exposed:true,supported_live_providers:['arc'],submit_route:'/v1/execution/submit',
  owner_authorization_required:true,pre_signed_payload_required:true,pre_signed_provider_submitter_available:true,
  credentialed_provider_submitter_available:credentialedProviderSubmitterAvailable,arbitrary_provider_url_allowed:false,
  embedded_private_key_allowed:false,external_execution_performed:false,authorization_id:OWNER_AUTHORIZATION.authorization_id
};}
function partnershipManifest(){return {
  schema:'numina.partnership-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',
  partnership_status:PARTNERSHIP_STATUS,external_evidence_bound:false,external_partnership_verified:false,
  evidence_basis:'numina_owner_assertion_only_no_external_partnership_evidence_bound',
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}
module.exports={PARTNERSHIP_STATUS,FUNDED_AMOUNTS,OWNER_AUTHORIZATION,controls,fundsManifest,executionManifest,partnershipManifest};
