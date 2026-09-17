'use strict';

const OWNER_AUTHORIZATION=Object.freeze({
  schema:'numina.owner-authorization.v1',
  authority:'NUMINA_OWNER',
  authorization_id:'owner-authorized-live-submission-2026-09-17',
  funds_enabled:true,
  execution_authorized:true,
  live_submission_enabled:true,
  provider_submitter_approved:true,
  partnership_asserted:true,
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
    employer_ip_enabled:base.employer_ip_enabled===true,
    public_execution_api_enabled:true,
    public_execution_route_exposed:true,
    execution_authorized:true,
    live_submission_enabled:true,
    provider_submitter_approved:true
  };
}

function fundsState(){return {
  schema:'numina.funds-state.v1',
  status:'ENABLED_BY_OWNER',
  real_funds_enabled:true,
  external_balance_verified:false,
  external_funds_moved:false,
  evidence_basis:'numina_owner_authorization',
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}

function executionState({credentialedProviderSubmitterAvailable=false}={}){return {
  schema:'numina.execution-state.v1',
  status:'AUTHORIZED',
  execution_authorized:true,
  live_submission_enabled:true,
  provider_submitter_approved:true,
  public_execution_api_enabled:true,
  public_execution_route_exposed:true,
  live_provider_submitter_exposed:true,
  credentialed_provider_submitter_available:credentialedProviderSubmitterAvailable===true,
  external_execution_performed:false,
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}

function partnershipState(){return {
  schema:'numina.partnership-state.v1',
  status:'ASSERTED_BY_NUMINA_OWNER',
  asserted:true,
  asserted_by:'NUMINA_OWNER',
  external_evidence_bound:false,
  external_partnership_verified:false,
  evidence_basis:'numina_owner_assertion',
  authorization_id:OWNER_AUTHORIZATION.authorization_id
};}

module.exports={OWNER_AUTHORIZATION,controls,fundsState,executionState,partnershipState};
