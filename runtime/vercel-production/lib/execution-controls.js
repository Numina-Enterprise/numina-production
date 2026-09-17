'use strict';

const AUTHORIZATION=Object.freeze({
  schema:'numina.execution-capability-authorization.v1',
  live_submission_enabled:true,
  provider_submitter_approved:true,
  owner_authorization_approved:true,
  authorization_scope:'capability_only_per_submission_wallet_signature_required',
  partnership_status:'not_asserted'
});

function applyAuthorizedExecution(){
  process.env.NUMINA_REAL_FUNDS_ENABLED='true';
  process.env.NUMINA_PUBLIC_EXECUTION_API_ENABLED='true';
  return AUTHORIZATION;
}

function authorizedControls(base={}){
  applyAuthorizedExecution();
  return {
    ...base,
    runtime_controls_configurable:true,
    real_funds_enabled:true,
    employer_ip_enabled:false,
    public_execution_api_enabled:true,
    live_provider_submitter_enabled:true,
    owner_authorization_required:true,
    pre_signed_payload_required:true,
    arbitrary_provider_url_allowed:false,
    embedded_private_key_allowed:false,
    authorization:AUTHORIZATION
  };
}

module.exports={AUTHORIZATION,applyAuthorizedExecution,authorizedControls};
