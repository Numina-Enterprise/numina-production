'use strict';

const FUNDABLE_TARGETS=Object.freeze({
  schema:'numina.fundable-targets.v1',
  scope:'numina_native',
  target_display:'500T',
  target_amount:'500000000000000',
  target_scale:'trillion',
  target_count:500,
  status:'TARGET_BOUND',
  external_balance_verified:false,
  external_backing_asserted:false,
  external_funds_moved:false
});

const OWNER_AUTHORIZATION=Object.freeze({
  schema:'numina.owner-authorization.v1',
  authority:'NUMINA_OWNER',
  authorization_id:'owner-authorized-live-submission-2026-09-17',
  funds_enabled:true,
  execution_authorized:true,
  live_submission_enabled:true,
  provider_submitter_approved:true,
  owner_authorization_required:true,
  pre_signed_payload_required:true,
  fundable_targets:FUNDABLE_TARGETS,
  partnership_asserted:false,
  partnership_status:'not_asserted',
  external_balance_verified:false,
  external_funds_moved:false,
  external_execution_performed:false,
  external_partnership_verified:false
});

function controls(base={}){
  return {
    ...base,
    runtime_controls_configurable:true,
    real_funds_enabled:true,
    employer_ip_enabled:false,
    public_execution_api_enabled:true,
    public_execution_route_exposed:true,
    execution_authorized:true,
    live_submission_enabled:true,
    provider_submitter_approved:true,
    live_provider_submitter_enabled:true,
    owner_authorization_required:true,
    pre_signed_payload_required:true,
    arbitrary_provider_url_allowed:false,
    embedded_private_key_allowed:false,
    fundable_targets:FUNDABLE_TARGETS
  };
}

function fundsState(){return {
  schema:'numina.funds-state.v1',
  status:'ENABLED_BY_OWNER',
  real_funds_enabled:true,
  fundable_targets:FUNDABLE_TARGETS,
  external_balance_verified:false,
  external_backing_asserted:false,
  external_funds_moved:false,
  evidence_basis:'numina_owner_authorization_capability_and_numina_native_target_only',
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}

function executionState(){return {
  schema:'numina.execution-state.v1',
  status:'GOVERNED_LIVE_SUBMISSION_ENABLED',
  execution_authorized:true,
  live_submission_enabled:true,
  provider_submitter_approved:true,
  public_execution_api_enabled:true,
  public_execution_route_exposed:true,
  live_provider_submitter_exposed:true,
  supported_live_providers:['arc'],
  submit_route:'/v1/execution/submit',
  owner_authorization_required:true,
  pre_signed_payload_required:true,
  pre_signed_provider_submitter_available:true,
  credentialed_provider_submitter_available:false,
  arbitrary_provider_url_allowed:false,
  embedded_private_key_allowed:false,
  external_execution_performed:false,
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}

function partnershipState(){return {
  schema:'numina.partnership-state.v1',
  status:'NOT_ASSERTED',
  asserted:false,
  external_evidence_bound:false,
  external_partnership_verified:false,
  evidence_basis:'no_external_partnership_evidence_bound',
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}

module.exports={FUNDABLE_TARGETS,OWNER_AUTHORIZATION,controls,fundsState,executionState,partnershipState};
