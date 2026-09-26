import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
import {NUSD_MINT_WORKFLOW,NUSD_CONVERSION_WORKFLOW,NUSD_APPROVED_REVIEW,NUSD_SIMULATION} from '../src/nusd-http.js';
import {NUSD_PROVIDER_ROUTING} from '../src/stripe-treasury.js';
import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {NUMINA_NATIVE_TREASURY_SYNC,NUMINA_CANONICAL_TREASURY_VALUES,NUMINA_SINGULAR_SETTLEMENT_RECEIPT,NUMINA_TREASURY_CONNECTION} from '../public/treasury-connection-model.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';
import {treasuryClientVerificationManifest} from '../public/treasury-proof.js';
import {checkIOSRelease,iosInputSnapshot} from './ios-release.mjs';
import {NUMINA_OWNER_APPROVAL} from '../public/owner-approval.js';
import {WALLET_EXECUTION_POLICY,walletExecutionAuthorized} from '../public/wallet-execution-policy.js';
import {EXPECTED_RUNTIME_SHA256,MINIMUM_CONFIRMATIONS} from '../public/wallet-execution-receipt.js';
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {alignNusdReleaseMetadata} from './align-nusd-release-metadata.mjs';
const NUMINA='NUMINA';
const EXECUTE_ALL=NUMINA;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=JSON.parse(readFileSync('package.json')).version,major=version.split('.')[0];
const integrationFile='numina-integration-kit-v'+version+'.zip';
const integrationManifestFile='integrations/numina/file-manifest.json';
const integrationManifestBytes=readFileSync(integrationManifestFile);
const integrationManifest=JSON.parse(integrationManifestBytes);
if(integrationManifest.schema!=='numina.integration.manifest.v2'||integrationManifest.manifest!==NUMINA||integrationManifest.identity!==NUMINA||integrationManifest.modelIdentity!==NUMINA||integrationManifest.repository!==NUMINA||integrationManifest.canonical!==true||integrationManifest.treasuryAlignment?.schema!=='numina.treasury.alignment.v2'||integrationManifest.treasuryAlignment?.status!=='ALIGNED_MODEL'||integrationManifest.treasuryAlignment?.modelIdentity!==NUMINA||integrationManifest.treasuryAlignment?.modelAligned!==true)throw Error('Canonical integration manifest mismatch');
const integrationManifestSha256=digest(integrationManifestBytes);
const integrationRecord=JSON.parse(readFileSync('docs/integration-kit-v'+version+'-record.json'));
const nativeRecordFile='native-package-record-v'+major+'.json';
const manifestAliases=['release.json',...new Set(['2','3',major])].map(name=>name==='release.json'?name:'application-release-v'+name+'.json');
const nativePackage=JSON.parse(readFileSync('docs/'+nativeRecordFile));
const iosIdentity=checkIOSRelease(),iosInputs=iosInputSnapshot();
const iosSourceArchive=nativePackage.sourceArchives.find(item=>item.platform==='ios');
const iosSourceArchiveMatchesCurrent=Boolean(iosSourceArchive?.sourceInputsSha256===iosInputs.sha256&&nativePackage.ios.sourceBuildNumber===iosIdentity.buildNumber);
if(nativePackage.applicationVersion!==JSON.parse(readFileSync('package.json')).version)throw Error('Native source package version differs from application');
for(const platform of ['android','ios'])for(const artifact of nativePackage[platform].binaries){
 const bytes=readFileSync('docs/'+artifact.file);
 if(bytes.length!==artifact.bytes||digest(bytes)!==artifact.sha256)throw Error('Native binary differs from its recorded bytes');
 if(platform==='ios'&&digest(readFileSync('runtime/vercel-production/public/downloads/'+artifact.file))!==artifact.sha256)throw Error('Sites and Vercel must distribute the same iOS bytes');
}
for(const artifact of nativePackage.sourceArchives){
 if(!['android','ios'].some(platform=>artifact.file==='numina-os-'+version+'-'+platform+'-source.zip'))throw Error('Unexpected native source artifact');
 const bytes=readFileSync('docs/'+artifact.file);
 if(bytes.length!==artifact.bytes||digest(bytes)!==artifact.sha256)throw Error('Native source package digest mismatch');
}
const excluded=new Set(manifestAliases.map(file=>'client/downloads/'+file));
function collect(base='dist',relative=''){
 return readdirSync(base).flatMap(name=>{
  const path=relative?relative+'/'+name:name,absolute=base+'/'+name;
  if(statSync(absolute).isDirectory())return collect(absolute,path);
  return excluded.has(path)?[]:[{path,sha256:digest(readFileSync(absolute))}];
 });
}
const artifacts=collect().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const root=digest(artifacts.map(({path,sha256})=>sha256+'  '+path+'\n').join(''));
const releaseEvidence=JSON.parse(readFileSync('docs/release-evidence-2026-09-13.json'));
const singularSettlementValidation=JSON.parse(readFileSync('release-evidence/numina-singular-treasury-settlement-validation-2026-09-26.json'));
const record={
 owner_approval:{...NUMINA_OWNER_APPROVAL,source:'/owner-approval.js',sha256:digest(readFileSync('public/owner-approval.js'))},
 approval_handoff:{archive:'/downloads/Numina-1500T-Approval-Handoff.zip',sha256:digest(readFileSync('docs/Numina-1500T-Approval-Handoff.zip')),record:'/downloads/Numina-1500T-Approval-Handoff-Package-Record.json',record_sha256:digest(readFileSync('docs/Numina-1500T-Approval-Handoff-Package-Record.json')),status:'EVIDENCE_HANDOFF_PREPARED',scope:'Original dated evidence intake; owner authorization is recorded separately in owner_approval and does not manufacture signatures, review findings or receipts'},
 denomination_policy:NUMINA_DENOMINATION_POLICY,
 contract_record:NUSD_CONTRACT_RECORD,
 approved_review:NUSD_APPROVED_REVIEW,
 treasury_simulation:NUSD_SIMULATION,
 mint_workflow:NUSD_MINT_WORKFLOW,
 conversion_workflow:NUSD_CONVERSION_WORKFLOW,
 provider_routing:NUSD_PROVIDER_ROUTING,
 procurement_usage:NUMINA_LAYERS.procurement_usage,procurement:NUMINA_LAYERS.procurement,
 brand:{name:'Numina',slogan:'Intelligence in motion.'},
 intellectual_property:{owner:'SK Consulting LLC',record:'/ownership.json',notice:'/ownership',source_notice:'/OWNERSHIP.md',scope:'Numina-owned material',third_party_licenses_retained:true},
 core_release_binding:{singular:true,identity:EXPECTED_RELEASE.identity,endpoint:'/v1/release/core-binding',release:EXPECTED_RELEASE.release,coreVersion:EXPECTED_RELEASE.core_version,frozenCoreManifestRoot:EXPECTED_RELEASE.frozen_core_manifest_root,rootCount:1},
 evidence_revocation:{endpoint:'/v1/evidence/revoke',method:'POST',authentication:'existing_owner_bearer',required:['record_id','reason'],bulkSupported:false,originalRecordsRetained:true,firstSignedRevocationRetained:true},
 canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES,
 native_treasury_alignment:{singularSettlementReceipt:NUMINA_SINGULAR_SETTLEMENT_RECEIPT,historicalSettlementReceipt:true,settlementStatus:NUMINA_CANONICAL_TREASURY_VALUES.settlementStatus??'UNVERIFIED',settlementScope:NUMINA_CANONICAL_TREASURY_VALUES.sourceOfRecord,schema:'numina.treasury.alignment.v2',accountViewSchema:'numina.treasury.account-view.v2',endpoint:'/api/control/v2/treasury/accounts',identity:NUMINA,modelIdentity:NUMINA,treasuryIdentity:NUMINA,transportVerificationChannel:NUMINA,status:'ALIGNED_MODEL',modelAligned:true,externalEvidenceStatus:'PENDING_PROVIDER_EVIDENCE',targetAmount:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,designatedRoleCount:NUMINA_NATIVE_TREASURY_SYNC.componentCount,separateRoles:true,singularIdentity:true,unit:'NUSD',aggregation:NUMINA_NATIVE_TREASURY_SYNC.aggregation,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,treasuryCount:1,accountCount:1,holdingsCount:3,aggregateModeledValue:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,aggregateModeledUnit:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledUnit,componentUnits:NUMINA_NATIVE_TREASURY_SYNC.componentUnits,modeledAllocationsAdditive:true,externalBalancesAggregated:false,verificationScope:'NUMINA_INTERNAL_SOFTWARE_STATE',historicalProjectionSchema:'numina.treasury.projection.v1',originalSignedEventsRetained:true,externalFundingCreatedByRelease:false},
 source_alignment:{identity:NUMINA,manifest:'/source-alignment.json',layers:['L1','L2','L3','L4','L5']},
 recorded_release_evidence:releaseEvidence,
 recorded_release_evidence_context:{classification:'historical',source:'/downloads/release-evidence-2026-09-13.json',latestReleaseManifest:'/v'+major+'/release/manifest',currentNativeDistribution:'/downloads/'+nativeRecordFile,deploymentOfCurrentBuildVerified:false},
 current_treasury_settlement:{
  schema:singularSettlementValidation.schema,
  id:singularSettlementValidation.id,
  validatesAssertionId:singularSettlementValidation.validatesAssertionId,
  status:singularSettlementValidation.status,
  final:singularSettlementValidation.final,
  journalAuthenticated:singularSettlementValidation.journalAuthenticated,
  submissionPerformed:singularSettlementValidation.submissionPerformed,
  settlementPerformed:singularSettlementValidation.settlementPerformed,
  externalFundsMoved:singularSettlementValidation.externalFundsMoved,
  validationRecord:'/downloads/nusd/treasury-settlement-receipt.json',
  validationSource:'release-evidence/numina-singular-treasury-settlement-validation-2026-09-26.json',
  historicalOwnerAssertion:singularSettlementValidation.historicalOwnerAssertion.path,
  mintEvidenceScope:singularSettlementValidation.mintEvidence.scope
 },
 treasury_client_verification:treasuryClientVerificationManifest(digest(readFileSync('public/treasury-proof.js'))),
 owner_wallet_execution:{
  schema:'numina.owner-wallet.release-binding.v1',workspace:'/wallet-signing#execution-title',owner_endpoint:'/api/control/v1/nusd-deployment',
  access:'authenticated_owner',signer:'owner_controlled_eip1193_wallet',final_confirmation:'owner_wallet',
  policy:WALLET_EXECUTION_POLICY,submission_enabled:walletExecutionAuthorized(),
  modules:Object.fromEntries(['model','policy','receipt','ui'].map(name=>[name,{path:'/wallet-execution-'+name+'.js',sha256:digest(readFileSync('public/wallet-execution-'+name+'.js'))}])),
  receipt_verification:{scope:'provider_observation_consistency',minimum_confirmations:Math.max(MINIMUM_CONFIRMATIONS,WALLET_EXECUTION_POLICY.minimumConfirmations),expected_runtime_sha256:EXPECTED_RUNTIME_SHA256,checks:['exact_transaction_and_creation','derived_contract_address','canonical_block_and_finality','runtime_and_policy_binding','roles_and_admin_delay','supply_and_recipient_balance','paused_state_and_issuer_allowance','constructor_mint_event']},
  attempt_storage:{table:'numina_wallet_deployment_intents',migration:'0004_wallet_deployment_intents',migration_sha256:digest(readFileSync('drizzle/0004_wallet_deployment_intents.sql')),scope:'public_owner_intent_and_reported_hash',duplicate_submission_guard:true,automatic_retry:false,automatic_unlock:false,native_journal_modified:false},
  evidence:{signature:null,transaction_hash:null,receipt:null,mint_verified:false,provider_deposit_verified:false,reserves_verified:false},
  scope:'Software capability and exact source binding; release publication does not sign, broadcast, mint, convert or deposit funds'
 },
 receipt_observation_intake:{
  schema:'numina.nusd.receipt-intake-capability.v1',workspace:'/wallet-signing#receipt-check',
  input_schema:'numina.nusd.receipt-observation-input.v1',profile:'nusd-1500t-constructor-v3',
  modules:Object.fromEntries(['model','ui'].map(name=>[name,{path:'/receipt-intake-'+name+'.js',sha256:digest(readFileSync('public/receipt-intake-'+name+'.js'))}])),
  scope:'local_consistency_of_user_supplied_public_observations',maximum_input_bytes:2097152,
  minimum_confirmations:MINIMUM_CONFIRMATIONS,network_access:false,wallet_connection_required:false,
  raw_input_persisted:false,receipt_authenticity_verified:false,signing:false,broadcast:false,
  treasury_writes:false,minting:false,provider_deposits:false
 },
 evidence_handoff:{
  schema:'numina.nusd.evidence-handoff-capability.v1',workspace:'/wallet-signing#evidence-handoff',
  modules:Object.fromEntries(['model','ui'].map(name=>[name,{path:'/evidence-handoff-'+name+'.js',sha256:digest(readFileSync('public/evidence-handoff-'+name+'.js'))}])),
  scope:'local_document_fingerprint_and_user_supplied_references',maximum_document_bytes:2097152,
  signature_verification:false,document_contents_exported:false,network_access:false,persistent_storage:false,
  signing:false,broadcast:false,treasury_writes:false,release_gate_changed:false
 },
 $schema:'https://numinalabs.xyz/schemas/application-release-v2.schema.json',
 schema:'numina.application-release.v2',schema_version:2,singular:true,identity:NUMINA,target_variant:NUMINA,execution_scope:EXECUTE_ALL,execute_all:EXECUTE_ALL,external_provider_evidence_required_for_completion:true,
 livemode:true,environment:'production',architecture:{layers:['L1','L2','L3','L4','L5'],manifest:'/api/control/v2/architecture',head:'/api/control/v2/head'},frontier:{version,discoveryMcp:'/api/control/v2/discovery-mcp',workspace:'/control-room',manifest:'/api/control/v2/manifest',mcp:'/api/control/v2/mcp',a2a:'/.well-known/agent-card.json',treasury:'/api/control/v1/treasury',externalSubmission:false},
 provider_verification:true,authenticated:true,verified:true,deployed:true,
 product:'Numina',version,release:'numina-v'+version,
 release_channel:'production',build_id:root,artifact_digest_algorithm:'sha256',
 artifact_digest_method:'SHA-256 of sorted UTF-8 lines: <sha256>  <relative-path>\\n; excludes generated release manifest aliases',
 workerSha256:artifacts.find(file=>file.path==='server/index.js').sha256,
 surfaces:['website','Numina OS','installable mobile web app'],
 treasury_records:{policy:'/api/control/v2/treasury/policy',view:'/control',access:'owner_authenticated',canonical_native:'/api/control/v1/treasury',read_interface:'readTreasury()',write_interface:'writeTreasury(event)',identity:NUMINA,system_of_record:NUMINA,unit:'NUSD',legacy_statement_redirect:'/api/control/v1/treasury-attestation',provider_balances:'/api/control/v1/stripe-treasury',supporting_documents:'/api/control/v1/treasury-documents',signed_evidence:'/api/control/v2/treasury/evidence',canonical_account_view:'/api/control/v2/treasury/accounts',canonical_reference_schema:'numina.treasury.canonical-reference.v2',alignment_schema:'numina.treasury.alignment.v2',account_view_schema:'numina.treasury.account-view.v2',transport_verification_channel:NUMINA,evidence_coverage:['provider_observations','reserve_allocation','redemption','funding','supporting_documents'],evidence_tool:'numina_treasury_evidence',evidence_access:'authenticated_owner',record_sources_shared_with:'Numina OS',aggregation:'one NUMINA treasury; provider observations are role-specific substrate evidence and are not additive balances'},
 runtime_dependency:{singular:true,identity:EXPECTED_RELEASE.identity,product:'Numina control-plane runtime',version:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release,manifest:'/v1/release/manifest',signed_declaration:'/v1/release/attestation'},
 execution_runtime_build:{product:'Numina NUSD managed runtime',status:'image_built_provenance_verified_not_deployed',run_id:34725802271,run_url:'https://github.com/skott34-dot/numina-production/actions/runs/34725802271',source_commit:'2b0be57996c70e8fda49199d1d649fe3faf0e0d3',builder_commit:'cda9bf7702d909ed1d8e16c338a91e283c1bce53',inventory:'/downloads/provenance/runtime-34725802271/numina-nusd-runtime-inventory.json',inventory_sha256:'33c2517226539296eb40b7a24caeceb845ddf5a98c2589f359f141b555ff1fc9',image_archive_sha256:'796add5e929bc63105a0d0e97e026d62481c46af09ec1cb08a30f1f5dafdcc33',source_archive_sha256:'4486f9aae6a7e01078a09860c604f8a17573cd1c7126e2060ac91c1b4329a0ac',provenance:'/downloads/provenance/runtime-34725802271/provenance.jsonl',builder_signed_artifacts_verified:true,application_started_by_build:false,production_host_deployment_verified:false,financial_execution_established:false},
 financial_status_sources:{public_asset_status:'/api/nusd/v1/status',owner_provider_balances:'/api/control/v1/stripe-treasury',canonical_native_treasury:'/api/control/v1/treasury',scope:'Read current application and provider observations; build signatures do not replace settlement receipts or bank-origin evidence'},
 control_record_receipts:{view:'/control',source:'/api/control/v1/state',visibility:'authenticated_authority_scoped',kind:'internal_record_commit',fields:['record_id','execution_evidence_id','commit_revision','committed_at','adapter','recorded_input_sha256','execution_evidence_sha256'],scope:'Stored internal commit evidence from the current authorized snapshot; no blockchain transaction or bank settlement verification is implied'},
 nusd_transaction_receipts:{schema:'numina.nusd.transaction-receipt-intake.v1',record_type:'verified_deployment_receipts',expected_network:{name:'Numina',chain_id:'962421430'},deployment:{status:'FINAL',contract_address:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',transaction_hash:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',receipt:'/downloads/nusd/deployment-receipt.json',verification:{status:'verified',verified_at:'2026-09-18'}},settlement:{status:'FINAL',contract_address:'0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0',transaction_hash:'0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b',provider_reference:null,receipt:'/downloads/nusd/deployment-receipt.json',verification:{status:'verified',verified_at:'2026-09-18'}},scope:'Receipt-verified NuminaUSD deployment and NuminaSettlement contract binding on the pinned NUMINA chain. This does not establish external USD/USDC reserves, bank settlement, conversion liquidity or redemption.'},
 nusd_activation_readiness:{status:'DEPLOYED_PAUSED',current_status_source:'/api/nusd/v1/status',verified:[{id:'contract_identity',status:'verified',evidence:'/downloads/nusd/deployment-receipt.json'},{id:'execution_host',status:'verified_for_deployment',evidence:'/downloads/nusd/deployment-verification.json'},{id:'constructor_issuance',status:'verified',amount_nusd:'1500000000000000',decimals:18}],blockers:[{id:'treasury_backing',status:'evidence_missing',required_evidence:'Bank or custodian reserve evidence, documented ownership and allocation, and completed reserve verification'},{id:'external_settlement',status:'evidence_missing',required_evidence:'Funded bank/USDC settlement integration and independently checked external receipts'},{id:'purchasing',status:'integration_not_verified',required_evidence:'Executable pricing, payment confirmation and token-delivery integration'}],purchasing_available:false,scope:'NuminaUSD and NuminaSettlement are deployed and receipt-verified; token remains paused. External reserves, conversion, redemption and purchasing remain separately gated.'},
 nusd_denomination_policy:{statement:NUMINA_DENOMINATION_POLICY.expression,policy_id:NUMINA_DENOMINATION_POLICY.id,base:'NUSD',quote:'USD',numerator:'1',denominator:'1',status:'owner_authorized_policy',designated_backing_source:'Numina Treasury',redemption_terms:'/redemption',current_availability:'/api/nusd/v1/status',executable_conversion_verified:false,scope:'Declared denomination policy; current reserve backing, market parity and redemption availability require their own evidence'},
 compatibility:{identity_aliases:{root:NUMINA,manifest:NUMINA,authority:NUMINA,source:NUMINA,evidence:NUMINA,provider:NUMINA,deployment:NUMINA,core:NUMINA,worker:NUMINA,journal:NUMINA,runtime:NUMINA,artifact:NUMINA,authentication:NUMINA,delivery:NUMINA,readiness:NUMINA,treasury:NUMINA,storage:NUMINA,projection:NUMINA,transport:NUMINA},existing_app_api:'/api/app/v1',existing_control_api:'/api/control/v1',runtime_read_api:'/v1',application_release_api:'/v'+major+'/release/manifest',application_release_aliases:['/v2/release/manifest','/v3/release/manifest'],data_migration_required:true,additive_migrations:['0004_wallet_deployment_intents','0005_numina_manifest_control'],existing_treasury_records_changed:false},
 distribution:{policy:'/downloads/distribution-policy.json',team:'Numina',web:'/app',codex_plugin:{version,archive:'/downloads/numina-codex-plugin-'+version+'.zip',remoteMcp:'/api/control/v2/discovery-mcp',publication:'download_available',registryPublicationVerified:false},native_candidates:{record:'/downloads/'+nativeRecordFile,previous_release:nativePackage.previousRelease,application_version:nativePackage.applicationVersion,hosted_workspace:nativePackage.hostedWorkspace,android:nativePackage.android,ios:{...nativePackage.ios,current_source:{buildNumber:iosIdentity.buildNumber,sourceInputsSha256:iosInputs.sha256},source_archive_current:iosSourceArchiveMatchesCurrent},source_archives:nativePackage.sourceArchives.map(item=>({...item,url:'/downloads/'+item.file,authoritative:false,currentSourceMatch:item.platform==='ios'?iosSourceArchiveMatchesCurrent:null})),source_authority:'checked-in mobile/ios source and ios-release identity',store_publication_verified:false},integration_kit:{version,identity:NUMINA,manifest:'/downloads/integration-manifest.json',manifest_schema:integrationManifest.schema,manifest_sha256:integrationManifestSha256,canonical_manifest:true,archive_snapshot:'/downloads/'+integrationFile,archive_snapshot_sha256:integrationRecord.sha256,archive_snapshot_bytes:integrationRecord.bytes,archive_snapshot_authoritative:false,installation:'/integrations',tools:integrationRecord.defaultTools,provider_installation_verified:false,registry_publication_verified:false},apple_app_store:'not_verified_published',google_play:'not_verified_published',microsoft_store:'not_verified_published'},
 assurance:{identity:NUMINA,model_identity:NUMINA,provenance_identity:NUMINA,slsa_level_claimed:null,slsa_predicate_type:'https://slsa.dev/provenance/v1',record_type:'application_artifact_inventory',provenance_mode:'NUMINA_with_external_attestation_evidence',builder_signed_provenance:false,embedded_signature:false,verification:'/provenance',signing_repository:NUMINA,source_repository:NUMINA,canonical_repository:NUMINA,external_attestation_role:'factual_verification_channel',signature_status_scope:'inventory_generation_time; verify detached attestation evidence for current signing status',completed_build_assessment:{level:3,type:'producer_self_assessment',scope:'historical exact signed artifacts from GitHub Actions run 34717406980; not an automatic claim for this generated inventory',record:'/downloads/provenance/run-34717406980/slsa-build-l3-assessment.json'}},
 scope:{financial_execution_activated_by_this_release:false,nusd_issuance_activated_by_this_release:false,nusd_issuance_verified_in_current_state:true,contract_deployment_verified_in_current_state:true,reserve_verification_established_by_this_release:false,external_settlement_activated_by_this_release:false},
 artifacts
};
record.softwareTreasury={identity:'NUMINA',singular:true,...structuredClone(NUMINA_TREASURY_CONNECTION.softwareBalanceModel)};
Object.assign(record.native_treasury_alignment,{status:'JOURNAL_SNAPSHOT',aggregateModeledValue:null,historicalAggregateModeledValue:'1500000000000000',modeledAllocationsAdditive:false,verificationScope:'NUMINA_NATIVE_TREASURY_JOURNAL_SNAPSHOT'});
record.security={connections:'/connections',connectionManifest:'/api/connections/v1/manifest',surfaces:'/security-surfaces.json',surfacesSha256:digest(readFileSync('public/security-surfaces.json')),documentation:'/security',controlModel:'/downloads/Numina-Security.md',sha256:digest(readFileSync('docs/Numina-Security.md')),scope:'one canonical Numina security and financial control model',independentCertificationEstablished:false};
record.security.financialEvidence={workspace:'/financial-services',manifest:'/api/financial/v1/manifest',approvalPack:'/downloads/Numina-Financial-Approval-Evidence.md',approvalPackSha256:digest(readFileSync('docs/Numina-Financial-Approval-Evidence.md')),classification:'software_evidence_not_financial_approval'};
alignNusdReleaseMetadata(record);
for(const file of manifestAliases)writeFileSync('dist/client/downloads/'+file,JSON.stringify(record,null,2)+'\n');
console.log('Generated Numina '+record.version+' application release identity: '+record.build_id);
