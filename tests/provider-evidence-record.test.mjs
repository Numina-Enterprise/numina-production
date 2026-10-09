import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {RUNTIME_VERSION} from '../public/runtime-contract.js';
import {publishEvidence,sha256Hex} from '../scripts/publish-github-evidence.mjs';

const source='a'.repeat(40);
function sorted(value){if(Array.isArray(value))return value.map(sorted);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])]));return value;}
const digest=value=>createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
function fixture(){
  const archive={schema:'numina.provider-evidence-archive.v3',root:'NUMINA',manifest:'NUMINA',source_commit:source,
    integrity_model:'github_commit_plus_release_sha256_readback',credentialed:false,partnership_status:'asserted',external_execution_performed:false,
    transport:{identity:'NUMINA',role:'diagnostic_only',verified:true,observation:{transport:'github',git_commit_sha:source}},
    observation_set:{schema:'numina.provider-observation-set.v1',release:RUNTIME_VERSION,status:'HEALTHY',all_healthy:true,
      providers:['arc','circle'],credentialed:false,partnership_status:'asserted',external_execution_performed:false,
      observed_at:'2026-10-03T20:00:00.000Z',observations:[{provider:'circle',healthy:true,observed:{message:'pong'}},{provider:'arc',healthy:true,observed:{chain_id:5042002,latest_block:42}}]}};
  return {...archive,archive_sha256:digest(archive)};
}
function build(t,{outcome='failure',id='',artifactDigest='',expected=source,mutate=()=>{}}={}){
  const dir=mkdtempSync(join(tmpdir(),'provider-record-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const input=join(dir,'observation.json'),output=join(dir,'record.json');
  const archive=fixture();mutate(archive);writeFileSync(input,JSON.stringify(archive));
  const result=spawnSync(process.execPath,['scripts/build-provider-evidence-record.mjs'],{encoding:'utf8',env:{...process.env,
    NUMINA_PROVIDER_EVIDENCE_PATH:input,NUMINA_PROVIDER_RECORD_PATH:output,NUMINA_EXPECTED_GIT_SHA:expected,
    GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2',NUMINA_ARCHIVE_OUTCOME:outcome,NUMINA_ARCHIVE_ARTIFACT_NAME:'test-archive',
    NUMINA_ARCHIVE_ARTIFACT_ID:id,NUMINA_ARCHIVE_ARTIFACT_DIGEST:artifactDigest}});
  return {result,input,output,record:result.status===0?JSON.parse(readFileSync(output,'utf8')):null};
}

test('quota-failed Actions storage still yields a source-bound canonical record that can be durably published',async t=>{
  const {result,record,input,output}=build(t);
  assert.equal(result.status,0,result.stderr);
  assert.equal(record.artifact_json.archive.available,false);
  assert.equal(record.artifact_json.archive.actions_upload_outcome,'failure');
  assert.equal(record.artifact_json.archive.artifact_id,null);
  assert.equal(record.artifact_json.archive.persistence,'github_release_pending_sha256_readback');
  assert.equal(record.artifact_json.assertions.github_artifact_digest_verified,false);
  assert.equal(record.artifact_root,digest(record.artifact_json));
  const assets=new Map();let nextId=1;
  const release={id:77,tag_name:'numina-evidence-'+source.slice(0,12),target_commitish:source,draft:false,prerelease:false,assets:[],upload_url:'https://uploads.github.test/assets'};
  const fetchFn=async(url,options={})=>{
    if(url.includes('/releases/tags/'))return Response.json(release);
    if(options.method==='POST'){
      const bytes=Buffer.from(options.body),name=new URL(url).searchParams.get('name'),id=nextId++;
      const asset={id,name,size:bytes.length,digest:'sha256:'+sha256Hex(bytes),url:'https://api.github.test/assets/'+id};
      assets.set(asset.url,bytes);return Response.json(asset,{status:201});
    }
    if(assets.has(url))return new Response(assets.get(url));
    throw Error('Unexpected request '+url);
  };
  const receipt=await publishEvidence({token:'test',repository:'skott34-dot/numina-production',sourceCommit:source,files:[input,output],fetchFn,runId:'123',runAttempt:'2'});
  assert.equal(receipt.sha256ReadBackVerified,true);
  assert.equal(receipt.assets.length,2);
  assert.ok(receipt.assets.every(asset=>asset.readBackVerified&&asset.assetId));
});

test('failed upload cannot claim an archive even if partial output fields exist',t=>{
  const {record}=build(t,{id:'12',artifactDigest:'b'.repeat(64)});
  assert.equal(record.artifact_json.archive.available,false);
  assert.equal(record.artifact_json.archive.artifact_id,null);
});

test('only a successful upload with a complete receipt claims an Actions archive',t=>{
  const {record}=build(t,{outcome:'success',id:'12',artifactDigest:'b'.repeat(64)});
  assert.equal(record.artifact_json.archive.available,true);
  assert.equal(record.artifact_json.archive.artifact_id,12);
  const partial=build(t,{outcome:'success',id:'12'}).record;
  assert.equal(partial.artifact_json.archive.available,false);
});

test('record construction rejects a different triggering source and altered archive bytes',t=>{
  const wrongSource=build(t,{expected:'c'.repeat(40)});
  assert.notEqual(wrongSource.result.status,0);
  assert.match(wrongSource.result.stderr,/archive source does not match triggering commit/);
  const altered=build(t,{mutate:archive=>{archive.observation_set.observations[1].observed.latest_block++;}});
  assert.notEqual(altered.result.status,0);
  assert.match(altered.result.stderr,/archive SHA-256 mismatch/);
});

test('failed Release upload or mismatched independent readback produces no success receipt',async t=>{
  const {input}=build(t);
  const release={id:77,tag_name:'numina-evidence-'+source.slice(0,12),target_commitish:source,draft:false,prerelease:false,assets:[],upload_url:'https://uploads.github.test/assets'};
  for(const mode of ['upload-failure','readback-mismatch']){
    const fetchFn=async(url,options={})=>{
      if(url.includes('/releases/tags/'))return Response.json(release);
      if(options.method==='POST')return mode==='upload-failure'?new Response('unavailable',{status:503}):Response.json({id:1,name:'observation.json',url:'https://api.github.test/assets/1'});
      return new Response('corrupt bytes');
    };
    await assert.rejects(publishEvidence({token:'test',repository:'skott34-dot/numina-production',sourceCommit:source,files:[input],fetchFn}),/upload failed 503|read-back (size|SHA-256) mismatch/);
  }
});

test('persistence summary exposes tolerated archive failures and requires publication receipts',t=>{
  const {input}=build(t);
  const result=spawnSync(process.execPath,['scripts/report-provider-evidence.mjs'],{encoding:'utf8',env:{...process.env,
    GITHUB_SHA:source,GITHUB_STEP_SUMMARY:'',NUMINA_PUBLICATION_RECEIPT_PATH:input,
    NUMINA_TRUSTED_PUBLICATION_RECEIPT_PATH:input,
    EVIDENCE_STEPS:JSON.stringify({archive:{outcome:'failure',conclusion:'success',outputs:{}},record:{outcome:'success'},publication:{outcome:'success'}})}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/Actions observation \| failure \| No confirmed Actions archive receipt/);
  assert.match(result.stdout,/No confirmed Release publication receipt/);
  assert.doesNotMatch(result.stdout,/confirmed with byte readback/);
});
