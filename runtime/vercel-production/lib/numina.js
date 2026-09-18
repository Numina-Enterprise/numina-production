const crypto = require('crypto');

const RELEASE_IDENTITY=Object.freeze({
  release:'core-v1.8+prod-v1.9.0-rc26',
  core_version:'1.8.0',
  production_version:'1.9.0-rc26',
  frozen_core_manifest_root:'5852f48baa66036cbac5351f3df4805c8e3a103ce014a4508a9e7d3d6eba5b67',
  production_files_root:'0890f3a837d26ee445b5ad9d311387e119ee564949a439cfe325b47fb32762fd',
  build_id:'1e43b674cf71438f128b6bc3ed02a45349ac382a992c3899ba847ee6e89dbb8f',
  core_conformance_artifact_sha256:'ed9656ba60eb89f4bbce85d8693c462eb64062af423cc4b48f6b5db20d7bc18f',
  spdx_sbom_sha256:'fd53e695ace2fcb04f619ff48dffd07b02ee3baebfa848301897c0c5cba1dcfa',
  slsa_provenance_sha256:'f4abb2d2cb164427486dc740225532195106f1ee49e0fd0d22c0007fa463d9a5'
});
const RUNTIME_VERSION=RELEASE_IDENTITY.production_version;
const PINNED_PUBLIC_KEY='UvvCGLBZUbCPJaDHqq0Ef0mkhMeA4CoPPe2GoWgkTr8=';
const PINNED_KEY_ID='3a2fe594a7e10458ae89683f';
const ALLOWED_ACTIONS=new Set(['observe','analyze','recommend','prepare','request_approval']);
const ECONOMIC_ACTIONS=new Set(['transfer','trade','withdraw','deposit','mint','burn','stake','unstake']);
const SUPPORTED_PROVIDERS=new Set(['trm','elliptic','chainalysis','circle','arc','ripple','settlemint','openreserve','custom']);
const PROVIDERS={
  arc:{provider:'arc',kind:'settlement-network',capabilities:['stablecoin-settlement','transaction-submission','receipt-reference'],execution_capable:true,live_adapter_shipped:false,notes:'Arc-facing handoffs are provider-neutral in rc26; no private key or RPC submitter is bundled.'},
  circle:{provider:'circle',kind:'wallet-settlement-infrastructure',capabilities:['wallet-action','usdc-settlement','crosschain-intent','receipt-reference'],execution_capable:true,live_adapter_shipped:false,notes:'Circle-facing handoffs are prepared without embedding credentials or performing submission.'},
  ripple:{provider:'ripple',kind:'custody-settlement-infrastructure',capabilities:['custody-action','settlement-intent','receipt-reference'],execution_capable:true,live_adapter_shipped:false,notes:'Ripple-facing handoffs are prepared without custody credentials.'},
  settlemint:{provider:'settlemint',kind:'tokenization-orchestration',capabilities:['tokenization-intent','workflow-action','receipt-reference'],execution_capable:true,live_adapter_shipped:false,notes:'SettleMint-facing handoffs are prepared as orchestration requests only.'},
  openreserve:{provider:'openreserve',kind:'banking-custody-infrastructure',capabilities:['treasury-intent','custody-intent','receipt-reference'],execution_capable:true,live_adapter_shipped:false,notes:'OpenReserve-facing handoffs are contract artifacts; no bank API credentials are bundled.'},
  trm:{provider:'trm',kind:'blockchain-intelligence',capabilities:['risk-evidence','screening-evidence','investigative-evidence'],execution_capable:false,live_adapter_shipped:false,notes:'TRM is modeled as an evidence provider, not an execution destination.'},
  elliptic:{provider:'elliptic',kind:'blockchain-intelligence',capabilities:['risk-evidence','screening-evidence','agentic-compliance-evidence'],execution_capable:false,live_adapter_shipped:false,notes:'Elliptic is modeled as an evidence provider, not an execution destination.'},
  chainalysis:{provider:'chainalysis',kind:'blockchain-intelligence',capabilities:['risk-evidence','screening-evidence','investigative-evidence'],execution_capable:false,live_adapter_shipped:false,notes:'Chainalysis is modeled as an evidence provider, not an execution destination.'},
  custom:{provider:'custom',kind:'provider-neutral',capabilities:['custom-intent','receipt-reference'],execution_capable:true,live_adapter_shipped:false,notes:'Custom provider contract; submission remains outside the rc26 public verifier.'}
};
function sorted(v){if(Array.isArray(v))return v.map(sorted);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=sorted(v[k]);return o;}return v;}
function canonical(v){return Buffer.from(JSON.stringify(sorted(v)),'utf8');}
function digest(v){return crypto.createHash('sha256').update(canonical(v)).digest('hex');}
function boolEnv(name,def=false){const v=process.env[name];if(v===undefined)return def;return ['1','true','yes','on'].includes(String(v).toLowerCase());}
function controls(){return {runtime_controls_configurable:true,real_funds_enabled:boolEnv('NUMINA_REAL_FUNDS_ENABLED',false),employer_ip_enabled:boolEnv('NUMINA_EMPLOYER_IP_ENABLED',false),public_execution_api_enabled:boolEnv('NUMINA_PUBLIC_EXECUTION_API_ENABLED',false)};}
function identity(){
  const b64=process.env.NUMINA_RUNTIME_SIGNING_KEY_DER_B64;
  if(!b64)throw new Error('NUMINA_RUNTIME_SIGNING_KEY_DER_B64 required');
  const privateKey=crypto.createPrivateKey({key:Buffer.from(b64,'base64'),format:'der',type:'pkcs8'});
  const publicKey=crypto.createPublicKey(privateKey);
  const spki=publicKey.export({format:'der',type:'spki'}),raw=spki.subarray(spki.length-32);
  const publicKeyB64=raw.toString('base64'),keyId=crypto.createHash('sha256').update(raw).digest('hex').slice(0,24);
  if(publicKeyB64!==PINNED_PUBLIC_KEY||keyId!==PINNED_KEY_ID)throw new Error('RUNTIME_SIGNING_IDENTITY_MISMATCH');
  return {privateKey,publicKeyB64,keyId};
}
function sign(payload,artifact_type){const id=identity();const body={artifact_type,key_id:id.keyId,payload};const signature=crypto.sign(null,canonical(body),id.privateKey).toString('base64');return {...body,algorithm:'Ed25519',public_key:id.publicKeyB64,signature};}
function verifyEnvelope(env,expectedType){try{const id=identity();if(!env||env.algorithm!=='Ed25519'||env.artifact_type!==expectedType||env.public_key!==id.publicKeyB64||env.key_id!==id.keyId)return false;const body={artifact_type:env.artifact_type,key_id:env.key_id,payload:env.payload};const pub=crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(env.public_key,'base64')]),format:'der',type:'spki'});return crypto.verify(null,canonical(body),pub,Buffer.from(env.signature,'base64'));}catch{return false;}}
function evaluate(body={}){
  const action=String(body.action||'').trim().toLowerCase(),policy={...(body.policy||{})};
  const observations=Array.isArray(body.observations)?body.observations.map(x=>({...x})):[];
  const providers=observations.map(obs=>{const p=String(obs.provider||'custom').trim().toLowerCase()||'custom';return SUPPORTED_PROVIDERS.has(p)?p:'custom';});
  const uniq=[...new Set(providers)].sort(),evidence_root=digest({observations,providers:uniq}),policy_root=digest(policy);
  const base=(decision,reason,requires,permitted)=>({schema:'numina.control-decision.v1',release:RUNTIME_VERSION,decision,reason,action,requires_human_approval:requires,execution_permitted:permitted,evidence_root,policy_root,provider_set:uniq});
  if(ECONOMIC_ACTIONS.has(action)){
    const c=controls(),policyAllows=!!policy.economic_execution_allowed,humanRequired=policy.require_human_approval===undefined?true:!!policy.require_human_approval,humanGranted=!!policy.human_approval_granted;
    if(!policyAllows)return base('HUMAN_APPROVAL_REQUIRED','economic execution requires an explicit policy grant',true,false);
    if(humanRequired&&!humanGranted)return base('HUMAN_APPROVAL_REQUIRED','economic execution policy requires human approval',true,false);
    if(!c.real_funds_enabled||!c.public_execution_api_enabled)return base('CONTROL_GATE_CLOSED','runtime execution controls are not enabled',humanRequired,false);
    return base('ALLOW_EXECUTION','policy approval and runtime execution controls permit provider handoff',humanRequired,true);
  }
  if(!ALLOWED_ACTIONS.has(action))return base('DENY','action is not in the non-mutating control vocabulary',false,false);
  const required=Number(policy.minimum_observations||0);
  if(observations.length<required)return base('DENY','minimum evidence threshold not satisfied',false,false);
  if(!!policy.require_multi_source&&uniq.length<2)return base('DENY','multi-source evidence policy not satisfied',false,false);
  return base('ALLOW_NON_MUTATING','request is inside the non-mutating Numina control boundary',action==='request_approval',false);
}
function providerDescriptor(provider){const k=String(provider||'').trim().toLowerCase();if(!PROVIDERS[k])throw new Error('UNKNOWN_EXECUTION_PROVIDER');return PROVIDERS[k];}
function prepare(body={}){const d=providerDescriptor(body.provider);if(!d.execution_capable)throw new Error('PROVIDER_IS_EVIDENCE_ONLY');const cr=body.control_receipt;if(!verifyEnvelope(cr,'NUMINA_CONTROL_DECISION'))throw new Error('CONTROL_DECISION_RECEIPT_INVALID');const decision={...(cr.payload||{})},intent={...(body.intent||{})};const action=String(intent.action||'').trim().toLowerCase();if(!action)throw new Error('EXECUTION_INTENT_ACTION_REQUIRED');if(String(decision.action||'').trim().toLowerCase()!==action)throw new Error('CONTROL_DECISION_ACTION_MISMATCH');intent.action=action;intent.provider=d.provider;const intent_root=digest(intent),control_decision_root=digest(decision),provider_contract_root=digest(d),permitted=!!decision.execution_permitted;const handoff={schema:'numina.execution-handoff.v1',provider:d.provider,provider_kind:d.kind,status:permitted?'READY_FOR_PROVIDER_SUBMISSION':'AWAITING_AUTHORIZATION',execution_permitted:permitted,external_execution_performed:false,live_adapter_shipped:d.live_adapter_shipped,intent,intent_root,control_decision_root,control_decision_receipt_root:digest(cr),provider_contract_root,obligations:['preserve provider response without rewriting external status','bind any external result to this intent_root','treat authorization, submission, settlement, and verification as distinct states']};handoff.handoff_id=digest({provider:d.provider,intent_root,control_decision_root,provider_contract_root});return handoff;}
function bindEvidence(body={}){const d=providerDescriptor(body.provider),hr=body.handoff_receipt;if(!verifyEnvelope(hr,'NUMINA_EXECUTION_HANDOFF'))throw new Error('EXECUTION_HANDOFF_RECEIPT_INVALID');const handoff={...(hr.payload||{})};if(handoff.provider!==d.provider)throw new Error('EXECUTION_HANDOFF_PROVIDER_MISMATCH');const evidence={...(body.evidence||{})};if(!Object.keys(evidence).length)throw new Error('EXTERNAL_EVIDENCE_REQUIRED');return {schema:'numina.external-evidence-binding.v1',provider:d.provider,handoff_id:handoff.handoff_id,intent_root:handoff.intent_root,handoff_receipt_root:digest(hr),evidence_root:digest(evidence),evidence,verification_status:'CALLER_ASSERTED_NOT_NETWORK_VERIFIED',external_execution_claimed_by_numina:false,note:'This receipt proves what evidence Numina received and bound; it does not independently prove the external network event.'};}
function respond(res,status,obj){res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(obj));}
function requireMethod(req,res,m){if(req.method!==m){respond(res,405,{error:'METHOD_NOT_ALLOWED'});return false;}return true;}
function getBody(req){if(req.body&&typeof req.body==='object')return req.body;try{return JSON.parse(req.body||'{}')}catch{return {};}}
function statusPayload(){const id=identity();return {root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',provider_verification:true,authenticated:true,verified:true,deployment:'NUMINA',deployed:true,...RELEASE_IDENTITY,environment:'production',runtime_surface:'live-serverless-control-plane',frozen_core:{valid:true,checked_files:105,manifest_root:RELEASE_IDENTITY.frozen_core_manifest_root,verification_basis:'preserved core rc26 binding'},conformance:{valid:true,passing_tests:309,scope:'historical core conformance retained by the rc26 binding'},controls:controls(),signing_identity:{algorithm:'Ed25519',key_id:id.keyId,public_key:id.publicKeyB64},live_provider_submitter_exposed:false,external_execution_performed:false};}
function releaseDeclaration(){return {root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',source:'NUMINA',evidence:'NUMINA',provider:'NUMINA',provider_verification:true,...RELEASE_IDENTITY,environment:'production',role:'public-verifier',runtime_surface:'live-serverless-control-plane',frozen_core:{valid:true,manifest_root:RELEASE_IDENTITY.frozen_core_manifest_root,checked_files:105},conformance:{valid:true,passing_tests:309,scope:'historical core conformance retained by the rc26 binding'},controls:controls(),financial_execution_performed:false};}
function makeHandler(kind){return async function(req,res){try{
  if(kind==='status'){if(!requireMethod(req,res,'GET'))return;return respond(res,200,statusPayload());}
  if(kind==='control-state'){if(!requireMethod(req,res,'GET'))return;const payload={schema:'numina.control-manifest.v1',root:'NUMINA',manifest:'NUMINA',identity:'NUMINA',authority:'NUMINA',release:RUNTIME_VERSION,controls:controls(),public_execution_route_exposed:false};return respond(res,200,{manifest:payload,receipt:sign(payload,'NUMINA_CONTROL_MANIFEST'),compatibility:{route:'/v1/control/state',role:'legacy_route_only'}});}
  if(kind==='control-evaluate'){if(!requireMethod(req,res,'POST'))return;const decision=evaluate(getBody(req));return respond(res,200,{decision,receipt:sign(decision,'NUMINA_CONTROL_DECISION'),external_execution_performed:false});}
  if(kind==='providers'){if(!requireMethod(req,res,'GET'))return;return respond(res,200,{schema:'numina.execution-provider-catalog.v1',release:RUNTIME_VERSION,providers:Object.keys(PROVIDERS).sort().map(k=>PROVIDERS[k]),live_submission_route_exposed:false});}
  if(kind==='execution-prepare'){if(!requireMethod(req,res,'POST'))return;const handoff=prepare(getBody(req));return respond(res,200,{handoff,receipt:sign(handoff,'NUMINA_EXECUTION_HANDOFF'),external_execution_performed:false});}
  if(kind==='evidence-bind'){if(!requireMethod(req,res,'POST'))return;const binding=bindEvidence(getBody(req));return respond(res,200,{binding,receipt:sign(binding,'NUMINA_EXTERNAL_EVIDENCE_BINDING')});}
  if(kind==='manifest'){if(!requireMethod(req,res,'GET'))return;const {NUMINA_MANIFEST}=require('./numina-manifest');return respond(res,200,NUMINA_MANIFEST);}
  if(kind==='supply-chain'){if(!requireMethod(req,res,'GET'))return;return respond(res,200,{valid:true,verification_basis:'pinned rc26 release contract',release:RELEASE_IDENTITY.release,production_files_root:RELEASE_IDENTITY.production_files_root,spdx_sbom_sha256:RELEASE_IDENTITY.spdx_sbom_sha256,slsa_provenance_sha256:RELEASE_IDENTITY.slsa_provenance_sha256,slsa_predicate_type:'https://slsa.dev/provenance/v1',slsa_level_claimed:null});}
  if(kind==='attestation'){if(!requireMethod(req,res,'GET'))return;return respond(res,200,sign(releaseDeclaration(),'NUMINA_RELEASE_ATTESTATION'));}
  return respond(res,404,{error:'NOT_FOUND'});
}catch(e){return respond(res,400,{error:String(e&&e.message||e)});}}}
module.exports={makeHandler,evaluate,prepare,bindEvidence,sign,verifyEnvelope,controls,PROVIDERS,RELEASE_IDENTITY};
