import {createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import {EXPECTED_RELEASE,PINNED_RUNTIME_KEY_ID,PINNED_RUNTIME_PUBLIC_KEY} from '../public/runtime-contract.js';
import {validateDeploymentProvenance} from '../api/application-release.mjs';

const assert=(condition,message)=>{if(!condition)throw new Error(message);};
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));return value;}
export const evidenceCanonical=value=>Buffer.from(JSON.stringify(sorted(value)),'utf8');
const equal=(left,right)=>left!==undefined&&right!==undefined&&evidenceCanonical(left).equals(evidenceCanonical(right));
const identity=value=>['root','manifest','identity','authority','source','evidence','provider'].every(key=>value?.[key]==='NUMINA');

// Test keys are supplied explicitly by isolated tests; production always uses
// the pinned release identity. No environment variable can replace that pin.
export function verifyReleaseEnvelope(envelope,type,{pinnedKey=PINNED_RUNTIME_PUBLIC_KEY,keyId=PINNED_RUNTIME_KEY_ID}={}){
  assert(envelope?.artifact_type===type&&envelope.algorithm==='Ed25519'&&envelope.public_key===pinnedKey&&envelope.key_id===keyId,'runtime signing identity drift');
  const raw=Buffer.from(pinnedKey,'base64');
  assert(raw.length===32&&createHash('sha256').update(raw).digest('hex').slice(0,24)===keyId,'pinned key invalid');
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),raw]),format:'der',type:'spki'});
  assert(verifySignature(null,evidenceCanonical({artifact_type:envelope.artifact_type,key_id:envelope.key_id,payload:envelope.payload}),key,Buffer.from(envelope.signature||'','base64')),'signature verification failed');
  return envelope.payload;
}

export function readSignedTransport(response,{verifyEnvelope=verifyReleaseEnvelope,expectedGitSha}={}){
  const transport=response?.transport,substrate=transport?.substrate_observation;
  assert(['root','manifest','identity','authority','source','evidence','host','provenance','deployment'].every(key=>response?.[key]==='NUMINA')&&response.deployed===true,'transport wrapper altered NUMINA');
  assert(transport?.identity==='NUMINA'&&transport.role==='factual_transport_verification_channel'&&transport.separate_roles===true&&transport.singular_identity===true&&substrate?.identity==='NUMINA'&&substrate.service==='NUMINA'&&substrate.substrate==='Vercel'&&substrate.verified===true,'transport verification channel invalid');
  const observation=verifyEnvelope(response.receipt,'NUMINA_TRANSPORT_OBSERVATION');
  assert(equal(observation,substrate.observation),'transport receipt mismatch');
  assert(validateDeploymentProvenance(observation),'production transport provenance invalid');
  if(expectedGitSha)assert(observation.git_commit_sha.toLowerCase()===expectedGitSha.toLowerCase(),'transport source commit mismatch');
  return {observation,verified:true};
}

export function readSignedControl(response,{verifyEnvelope=verifyReleaseEnvelope}={}){
  const signed=verifyEnvelope(response?.receipt,'NUMINA_CONTROL_MANIFEST');
  assert(equal(signed,response.manifest),'control manifest receipt mismatch');
  assert(identity(signed)&&signed.surface==='control-manifest'&&signed.productionSource==='NUMINA'&&signed.authenticated===true&&signed.verified===true&&signed.provider_verification===true&&signed.deployment==='NUMINA'&&signed.deployed===true,'control projection invalid');
  const control=signed.payload,controls=control?.controls,funds=control?.funds,execution=control?.execution,partnership=control?.partnership;
  assert(['root','manifest','identity','authority'].every(key=>control?.[key]==='NUMINA')&&control.schema==='numina.control-manifest.v1'&&control.release===EXPECTED_RELEASE.production_version,'control release invalid');
  assert(control.external_execution_performed===false&&control.external_funds_moved===false,'control external execution boundary drift');
  for(const key of ['runtime_controls_configurable','real_funds_enabled','public_execution_api_enabled','public_execution_route_exposed','execution_authorized','live_submission_enabled','provider_submitter_approved','live_provider_submitter_enabled','owner_authorization_required','pre_signed_payload_required'])assert(controls?.[key]===true,'control authorization missing: '+key);
  for(const key of ['employer_ip_enabled','arbitrary_provider_url_allowed','embedded_private_key_allowed'])assert(controls?.[key]===false,'unsafe control: '+key);
  for(const [record,schema] of [[funds,'numina.funds-manifest.v1'],[execution,'numina.execution-manifest.v1'],[partnership,'numina.partnership-manifest.v1']])assert(record?.schema===schema&&['root','manifest','identity','authority'].every(key=>record[key]==='NUMINA'),'control component identity drift');
  assert(funds.status==='ENABLED_BY_OWNER'&&funds.real_funds_enabled===true&&funds.external_balance_verified===false&&funds.external_backing_asserted===false&&funds.external_funds_moved===false,'funding evidence boundary drift');
  const fundedAmounts={
    schema:'numina.funded-amounts.v1',scope:'numina_native',status:'FUNDED',verified:true,
    verification_authority:'NUMINA',verification_scope:'NUMINA_INTERNAL_TREASURY_MODEL',
    aggregate:{display:'1500T',amount:'1500000000000000',unit:'NUSD',additive:true},
    components:[
      {id:'usd',amount:'500000000000000',unit:'USD',nusd_equivalent:'500000000000000',ratio:'1:1',funded:true},
      {id:'usdc',amount:'500000000000000',unit:'USDC',nusd_equivalent:'500000000000000',ratio:'1:1',funded:true},
      {id:'nusd',amount:'500000000000000',unit:'NUSD',nusd_equivalent:'500000000000000',ratio:'1:1',funded:true}
    ],
    external_balance_verified:false,external_backing_asserted:false,external_funds_moved:false
  };
  assert(equal(funds.funded_amounts,fundedAmounts)&&equal(controls.funded_amounts,fundedAmounts),'funded amount boundary drift');
  assert(execution.status==='GOVERNED_LIVE_SUBMISSION_ENABLED'&&equal(execution.supported_live_providers,['arc'])&&execution.submit_route==='/v1/execution/submit','execution provider boundary drift');
  for(const key of ['execution_authorized','live_submission_enabled','provider_submitter_approved','public_execution_api_enabled','public_execution_route_exposed','live_provider_submitter_exposed','owner_authorization_required','pre_signed_payload_required','pre_signed_provider_submitter_available'])assert(execution[key]===true,'execution authorization missing: '+key);
  for(const key of ['arbitrary_provider_url_allowed','embedded_private_key_allowed','external_execution_performed'])assert(execution[key]===false,'unsafe execution: '+key);
  assert(execution.credentialed_provider_submitter_available===false,'credentialed submission is outside the pre-signed release boundary');
  assert(typeof execution.authorization_id==='string'&&execution.authorization_id.length>0&&funds.authorization_id===execution.authorization_id&&partnership.authorization_id===execution.authorization_id,'owner authorization binding mismatch');
  assert(partnership.partnership_status==='asserted'&&partnership.external_evidence_bound===false&&partnership.external_partnership_verified===false,'partnership evidence boundary drift');
  return {control,fundedAmounts};
}

export function readTrustedReleaseEvidence({frontier,transportResponse,controlResponse,expectedGitSha},{verifyEnvelope=verifyReleaseEnvelope,now=Date.now()}={}){
  assert(/^[0-9a-f]{40}$/i.test(expectedGitSha||''),'expected release source commit missing');
  const readiness=verifyEnvelope(frontier?.receipt,'NUMINA_FRONTIER_READINESS');
  assert(equal(readiness,frontier.readiness),'readiness receipt mismatch');
  assert(readiness?.schema==='numina.frontier-readiness.v2'&&identity(readiness)&&readiness.deployment==='NUMINA'&&readiness.deployed===true&&readiness.ready===true&&readiness.mode==='NUMINA','NUMINA readiness invalid');
  const required=['application_release_valid','application_runtime_binding','runtime_manifest_identity','release_attestation_signature','supply_chain_identity','control_manifest_signature','execution_authorization_bounded','numina_deployment'];
  assert(equal(Object.keys(readiness.checks||{}).sort(),required.sort())&&Object.values(readiness.checks).every(value=>value===true),'NUMINA readiness checks incomplete');
  assert(readiness.runtime?.root==='NUMINA'&&readiness.runtime?.deployment==='NUMINA'&&Object.entries(EXPECTED_RELEASE).every(([key,value])=>readiness.runtime[key]===value),'frontier runtime manifest mismatch');
  const observed=Date.parse(readiness.observed_at);assert(Number.isFinite(observed)&&now-observed<=300000&&observed-now<=60000,'readiness timestamp invalid or stale');
  const transport=readSignedTransport(transportResponse,{verifyEnvelope,expectedGitSha});
  assert(readiness.transport?.identity==='NUMINA'&&readiness.transport.role==='factual_transport_verification_channel'&&readiness.transport.separate_roles===true&&readiness.transport.singular_identity===true&&equal(readiness.transport.substrate_observation,transportResponse.transport.substrate_observation),'readiness transport binding mismatch');
  const authorization=readSignedControl(controlResponse,{verifyEnvelope});
  assert(equal(readiness.funded_amounts,authorization.fundedAmounts),'readiness funded amount binding mismatch');
  return {readiness,transportObservation:transport.observation,transportVerified:transport.verified,control:authorization.control,fundedAmounts:authorization.fundedAmounts};
}
