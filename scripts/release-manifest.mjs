import {NUSD_CONTRACT_RECORD} from '../public/nusd-contract-record.js';
import {NUMINA_DENOMINATION_POLICY} from '../public/treasury-valuation.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';
import {checkIOSRelease,iosInputSnapshot} from './ios-release.mjs';
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const version=JSON.parse(readFileSync('package.json')).version,major=version.split('.')[0];
const integrationFile='numina-integration-kit-v'+version+'.zip';
const nativeRecordFile='native-package-record-v'+major+'.json';
const manifestAliases=['release.json',...new Set(['2','3',major])].map(name=>name==='release.json'?name:'application-release-v'+name+'.json');
const integrationArchive=readFileSync('docs/'+integrationFile);
const integrationRecord=JSON.parse(readFileSync('docs/integration-kit-v'+version+'-record.json'));
if(integrationRecord.sha256!==digest(integrationArchive)||integrationRecord.bytes!==integrationArchive.length)throw Error('Integration archive does not match its inventory');
const nativePackage=JSON.parse(readFileSync('docs/'+nativeRecordFile));
const iosIdentity=checkIOSRelease(),iosInputs=iosInputSnapshot();
const iosSourceArchive=nativePackage.sourceArchives.find(item=>item.platform==='ios');
if(iosSourceArchive?.sourceInputsSha256!==iosInputs.sha256||nativePackage.ios.sourceBuildNumber!==iosIdentity.buildNumber)throw Error('iOS source archive is stale; repackage the current iOS sources before generating a release');
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
const record={
 denomination_policy:NUMINA_DENOMINATION_POLICY,
 contract_record:NUSD_CONTRACT_RECORD,
 procurement_usage:NUMINA_LAYERS.procurement_usage,procurement:NUMINA_LAYERS.procurement,
 brand:{name:'Numina',slogan:'Intelligence in motion.'},
 intellectual_property:{owner:'SK Consulting LLC',record:'/ownership.json',notice:'/ownership',source_notice:'/OWNERSHIP.md',scope:'Numina-owned material',third_party_licenses_retained:true},
 core_release_binding:{endpoint:'/v1/release/core-binding',release:EXPECTED_RELEASE.release,coreVersion:EXPECTED_RELEASE.core_version,frozenCoreManifestRoot:EXPECTED_RELEASE.frozen_core_manifest_root,rootCount:1},
 evidence_revocation:{endpoint:'/v1/evidence/revoke',method:'POST',authentication:'existing_owner_bearer',required:['record_id','reason'],bulkSupported:false,originalRecordsRetained:true,firstSignedRevocationRetained:true},
 native_treasury_alignment:{endpoint:'/api/control/v2/treasury/accounts',access:'owner_authenticated',unit:'NUSD',aggregation:'one native projection shared across account views',originalSignedEventsRetained:true,externalFundingCreatedByRelease:false},
 source_alignment:{manifest:'/source-alignment.json',root:'NUMINA',layers:['L1','L2','L3','L4','L5']},
 recorded_release_evidence:releaseEvidence,
 $schema:'https://numinalabs.xyz/schemas/application-release-v2.schema.json',
 schema:'numina.application-release.v2',schema_version:2,
 livemode:true,environment:'production',architecture:{layers:['L1','L2','L3','L4','L5'],manifest:'/api/control/v2/architecture',head:'/api/control/v2/head'},frontier:{version,discoveryMcp:'/api/control/v2/discovery-mcp',workspace:'/control-room',manifest:'/api/control/v2/manifest',mcp:'/api/control/v2/mcp',a2a:'/.well-known/agent-card.json',treasury:'/api/control/v1/treasury',externalSubmission:false},
 product:'Numina',version,release:'numina-v'+version,
 release_channel:'production',build_id:root,artifact_digest_algorithm:'sha256',
 artifact_digest_method:'SHA-256 of sorted UTF-8 lines: <sha256>  <relative-path>\\n; excludes generated release manifest aliases',
 workerSha256:artifacts.find(file=>file.path==='server/index.js').sha256,
 surfaces:['website','Numina OS','installable mobile web app'],
 treasury_records:{policy:'/api/control/v2/treasury/policy',view:'/control',access:'owner_authenticated',canonical_native:'/api/control/v1/treasury',read_interface:'readTreasury()',write_interface:'writeTreasury(event)',authority:'NUMINA',system_of_record:'NUMINA',unit:'NUSD',legacy_statement_redirect:'/api/control/v1/treasury-attestation',provider_balances:'/api/control/v1/stripe-treasury',supporting_documents:'/api/control/v1/treasury-documents',signed_evidence:'/api/control/v2/treasury/evidence',canonical_account_view:'/api/control/v2/treasury/accounts',canonical_reference_schema:'numina.treasury.canonical-reference.v1',evidence_coverage:['provider_observations','reserve_allocation','redemption','funding','supporting_documents'],evidence_tool:'numina_treasury_evidence',evidence_access:'authenticated_owner',record_sources_shared_with:'Numina OS',aggregation:'one canonical Numina-native projection; provider observations are reference records'},
 runtime_dependency:{product:'Numina control-plane runtime',version:EXPECTED_RELEASE.production_version,release:EXPECTED_RELEASE.release,manifest:'/v1/release/manifest',signed_declaration:'/v1/release/attestation'},
 execution_runtime_build:{product:'Numina NUSD managed runtime',status:'image_built_provenance_verified_not_deployed',run_id:34725802271,run_url:'https://github.com/skott34-dot/numina-production/actions/runs/34725802271',source_commit:'2b0be57996c70e8fda49199d1d649fe3faf0e0d3',builder_commit:'cda9bf7702d909ed1d8e16c338a91e283c1bce53',inventory:'/downloads/provenance/runtime-34725802271/numina-nusd-runtime-inventory.json',inventory_sha256:'33c2517226539296eb40b7a24caeceb845ddf5a98c2589f359f141b555ff1fc9',image_archive_sha256:'796add5e929bc63105a0d0e97e026d62481c46af09ec1cb08a30f1f5dafdcc33',source_archive_sha256:'4486f9aae6a7e01078a09860c604f8a17573cd1c7126e2060ac91c1b4329a0ac',provenance:'/downloads/provenance/runtime-34725802271/provenance.jsonl',builder_signed_artifacts_verified:true,application_started_by_build:false,production_host_deployment_verified:false,financial_execution_established:false},
 financial_status_sources:{public_asset_status:'/api/nusd/v1/status',owner_provider_balances:'/api/control/v1/stripe-treasury',canonical_native_treasury:'/api/control/v1/treasury',scope:'Read current application and provider observations; build signatures do not replace settlement receipts or bank-origin evidence'},
 control_record_receipts:{view:'/control',source:'/api/control/v1/state',visibility:'authenticated_authority_scoped',kind:'internal_record_commit',fields:['record_id','execution_evidence_id','commit_revision','committed_at','adapter','recorded_input_sha256','execution_evidence_sha256'],scope:'Stored internal commit evidence from the current authorized snapshot; no blockchain transaction or bank settlement verification is implied'},
 nusd_transaction_receipts:{schema:'numina.nusd.transaction-receipt-intake.v1',record_type:'unfilled_receipt_records',expected_network:{name:'Numina',chain_id:'962421430'},deployment:{status:'awaiting_provider_receipt',contract_address:null,transaction_hash:null,receipt:null,verification:{status:'not_verified',verified_at:null}},settlement:{status:'awaiting_provider_receipt',contract_address:null,transaction_hash:null,provider_reference:null,receipt:null,verification:{status:'not_verified',verified_at:null}},scope:'Record slots only. No transaction was created, broadcast or verified by creating this inventory. Populate from actual provider receipts and verify against the intended chain, contract and operation before changing capability status'},
 nusd_activation_readiness:{status:'not_established',current_status_source:'/api/nusd/v1/status',blockers:[{id:'contract_identity',status:'evidence_missing',required_evidence:'Successful deployment receipt on the intended Numina chain, deployed contract address and matching deployed bytecode'},{id:'execution_host',status:'evidence_missing',required_evidence:'Provisioned signing host with retained journal state and confirmed transaction-submission capability'},{id:'issuance_and_transfers',status:'evidence_missing',required_evidence:'Confirmed token supply, role assignments, pause state and successful issuance or transfer receipts for the requested operations'},{id:'treasury_backing',status:'evidence_missing',required_evidence:'Bank or custodian reserve evidence, documented ownership and allocation, and completed reserve verification'},{id:'settlement',status:'evidence_missing',required_evidence:'Funded settlement integration and independently checked receipts identifying the asset, amount, destination and final outcome'},{id:'purchasing',status:'integration_not_verified',required_evidence:'Configured token identity, agreed executable pricing, payment confirmation and token-delivery integration'}],purchasing_available:false,scope:'Outstanding requirements in the available records. These entries do not create evidence, authorize a transaction, or change live financial capabilities'},
 nusd_denomination_policy:{statement:NUMINA_DENOMINATION_POLICY.expression,policy_id:NUMINA_DENOMINATION_POLICY.id,base:'NUSD',quote:'USD',numerator:'1',denominator:'1',status:'owner_authorized_policy',designated_backing_source:'Numina Treasury',redemption_terms:'/redemption',current_availability:'/api/nusd/v1/status',executable_conversion_verified:false,scope:'Declared denomination policy; current reserve backing, market parity and redemption availability require their own evidence'},
 compatibility:{existing_app_api:'/api/app/v1',existing_control_api:'/api/control/v1',runtime_read_api:'/v1',application_release_api:'/v'+major+'/release/manifest',application_release_aliases:['/v2/release/manifest','/v3/release/manifest'],data_migration_required:false},
 distribution:{policy:'/downloads/distribution-policy.json',team:'Numina',web:'/app',codex_plugin:{version,archive:'/downloads/numina-codex-plugin-'+version+'.zip',remoteMcp:'/api/control/v2/discovery-mcp',publication:'download_available',registryPublicationVerified:false},native_candidates:{record:'/downloads/'+nativeRecordFile,previous_release:nativePackage.previousRelease,application_version:nativePackage.applicationVersion,hosted_workspace:nativePackage.hostedWorkspace,android:nativePackage.android,ios:nativePackage.ios,source_archives:nativePackage.sourceArchives.map(item=>({...item,url:'/downloads/'+item.file})),store_publication_verified:false},integration_kit:{version:integrationRecord.version,revision:integrationRecord.revision,archive:'/downloads/'+integrationFile,sha256:integrationRecord.sha256,bytes:integrationRecord.bytes,installation:'/integrations',tools:integrationRecord.defaultTools,provider_installation_verified:false,registry_publication_verified:false},apple_app_store:'not_verified_published',google_play:'not_verified_published',microsoft_store:'not_verified_published'},
 assurance:{slsa_level_claimed:null,slsa_predicate_type:'https://slsa.dev/provenance/v1',record_type:'application_artifact_inventory',provenance_mode:'detached_slsa_attestation',builder_signed_provenance:false,embedded_signature:false,verification:'/provenance',signing_repository:'skott34-dot/numina-builder',source_repository:'skott34-dot/numina-production',signature_status_scope:'inventory_generation_time; verify detached attestation for current signing status',completed_build_assessment:{level:3,type:'producer_self_assessment',scope:'exact signed artifacts from GitHub Actions run 34717406980; not an automatic claim for this generated inventory',record:'/downloads/provenance/run-34717406980/slsa-build-l3-assessment.json'}},
 scope:{financial_execution_activated_by_this_release:false,nusd_issuance_activated_by_this_release:false,reserve_verification_established_by_this_release:false},
 artifacts
};
record.security={connections:'/connections',connectionManifest:'/api/connections/v1/manifest',surfaces:'/security-surfaces.json',surfacesSha256:digest(readFileSync('public/security-surfaces.json')),documentation:'/security',controlModel:'/downloads/Numina-Security.md',sha256:digest(readFileSync('docs/Numina-Security.md')),scope:'one canonical Numina security and financial control model',independentCertificationEstablished:false};
for(const file of manifestAliases)writeFileSync('dist/client/downloads/'+file,JSON.stringify(record,null,2)+'\n');
console.log('Generated Numina '+record.version+' application release identity: '+record.build_id);
