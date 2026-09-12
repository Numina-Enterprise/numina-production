import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const excluded=new Set(['client/downloads/release.json','client/downloads/application-release-v2.json']);
function collect(base='dist',relative=''){
 return readdirSync(base).flatMap(name=>{
  const path=relative?relative+'/'+name:name,absolute=base+'/'+name;
  if(statSync(absolute).isDirectory())return collect(absolute,path);
  return excluded.has(path)?[]:[{path,sha256:digest(readFileSync(absolute))}];
 });
}
const artifacts=collect().sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
const root=digest(artifacts.map(({path,sha256})=>sha256+'  '+path+'\n').join(''));
const record={
 $schema:'https://numinalabs.xyz/schemas/application-release-v2.schema.json',
 schema:'numina.application-release.v2',schema_version:2,
 product:'Numina',version:JSON.parse(readFileSync('package.json')).version,release:'numina-v2.0.0',
 release_channel:'production',build_id:root,artifact_digest_algorithm:'sha256',
 artifact_digest_method:'SHA-256 of sorted UTF-8 lines: <sha256>  <relative-path>\\n; excludes the two generated release manifests',
 workerSha256:artifacts.find(file=>file.path==='server/index.js').sha256,
 surfaces:['website','Numina OS','installable mobile web app'],
 treasury_records:{view:'/control',access:'owner_authenticated',owner_statement:'/api/control/v1/treasury-attestation',provider_balances:'/api/control/v1/stripe-treasury',supporting_documents:'/api/control/v1/treasury-documents',record_sources_shared_with:'Numina OS',aggregation:'none; preserve source, currency and verification classification'},
 runtime_dependency:{product:'Numina control-plane runtime',version:'1.9.0-rc22',release:'core-v1.8+prod-v1.9.0-rc22',manifest:'/v1/release/manifest',signed_declaration:'/v1/release/attestation'},
 compatibility:{existing_app_api:'/api/app/v1',existing_control_api:'/api/control/v1',runtime_read_api:'/v1',application_release_api:'/v2/release/manifest',data_migration_required:false},
 distribution:{web:'/app',apple_app_store:'not_verified_published',google_play:'not_verified_published',microsoft_store:'not_verified_published'},
 assurance:{slsa_level_claimed:null,slsa_predicate_type:'https://slsa.dev/provenance/v1',record_type:'application_artifact_inventory',provenance_mode:'detached_slsa_attestation',builder_signed_provenance:false,embedded_signature:false,verification:'/provenance',signing_repository:'skott34-dot/numina-builder',source_repository:'skott34-dot/numina-production',signature_status_scope:'inventory_generation_time; verify detached attestation for current signing status',completed_build_assessment:{level:3,type:'producer_self_assessment',scope:'exact signed artifacts from GitHub Actions run 34717406980; not an automatic claim for this generated inventory',record:'/downloads/provenance/run-34717406980/slsa-build-l3-assessment.json'}},
 scope:{financial_execution_activated_by_this_release:false,nusd_issuance_activated_by_this_release:false,reserve_verification_established_by_this_release:false},
 artifacts
};
for(const file of ['release.json','application-release-v2.json'])writeFileSync('dist/client/downloads/'+file,JSON.stringify(record,null,2)+'\n');
console.log('Generated Numina '+record.version+' application release identity: '+record.build_id);
