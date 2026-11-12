import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';
import {checkIOSRelease} from '../scripts/ios-release.mjs';

const read = file => readFileSync(new URL('../'+file,import.meta.url),'utf8');
const json = file => JSON.parse(read(file));

test('Numina 5 versions stay aligned across packages, core, runtime and native source',()=>{
  const release=json('config/numina-release.v1.json');
  assert.equal(release.applicationVersion,'5.0.0');
  assert.equal(release.coreVersion,'2.0.0');
  assert.equal(release.runtimeVersion,'2.0.0-rc27');
  assert.equal(EXPECTED_RELEASE.production_version,release.runtimeVersion);
  assert.equal(EXPECTED_RELEASE.compatibility.core_version,release.coreVersion);
  for(const path of ['package.json','integrations/numina/package.json','runtime/vercel-production/package.json'])assert.equal(json(path).version,release.applicationVersion,path);
  for(const path of ['package.json','integrations/numina/package.json','runtime/vercel-production/package.json','runtime/nusd/package.json','runtime/nusd/development/package.json'])assert.equal(json(path).engines.node,release.nodeVersion,path);
  assert.equal(json('package-lock.json').version,release.applicationVersion);
  assert.equal(read('.nvmrc').trim(),release.nodeVersion);
  assert.equal(json('config/numina-node26.v1.json').version,release.nodeVersion);
  const ios=checkIOSRelease();
  assert.equal(ios.applicationVersion,release.applicationVersion);
  assert.equal(ios.buildNumber,release.iosBuildNumber);
  assert.match(read('mobile/android/app/build.gradle'),new RegExp('versionCode '+release.androidVersionCode+'\\b'));
  assert.match(read('src/worker.js'),/\/v5\/release\/manifest/);
});

test('all cloud destinations share one release contract and preserve unknown live states',()=>{
  const topology=json('config/numina-topology.v1.json');
  const release=json('config/numina-release.v1.json');
  assert.equal(topology.applicationVersion,release.applicationVersion);
  assert.equal(topology.nodeVersion,release.nodeVersion);
  assert.equal(topology.applicationManifest,release.applicationManifest);
  assert.equal(topology.canonicalRepository,release.canonicalRepository);
  assert.deepEqual(topology.providers.map(provider=>provider.id).sort(),['aws','azure','cloudflare','gcp','ibm_cloud','ibm_quantum','tailscale']);
  assert.equal(topology.replication.enabled,false);
  assert.ok(topology.providers.every(provider=>provider.liveVerification==='unverified'));
  assert.equal(topology.providers.find(provider=>provider.id==='gcp').target,'numina-production');
  assert.equal(topology.providers.find(provider=>provider.id==='gcp').zone,'us-central1-a');
  assert.match(read('Dockerfile'),/FROM node:26\.13\.0/);
  assert.doesNotMatch(read('numinalabs-web/cloudbuild.yaml'),/allow-unauthenticated|:latest/);
});

test('Cloudflare uploads retain existing storage and secrets and use a dedicated deployment credential',()=>{
  const config=json('wrangler.jsonc');
  assert.equal(config.account_id,'3c1fd59ef2ef67f750b4bc23e656d722');
  assert.deepEqual(config.routes.map(route=>route.pattern),['numinalabs.xyz/*','www.numinalabs.xyz/*']);
  for(const type of ['plain_text','json','secret_text','secret_key','d1','r2_bucket'])assert.ok(config.unsafe.metadata.keep_bindings.includes(type));
  assert.equal(config.assets.run_worker_first,true);
  const workflow=read('.github/workflows/deploy-cloudflare.yml');
  assert.match(workflow,/secrets\.CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(workflow,/secrets\.NUMINA_CONTROL_API_KEY/);
  assert.match(workflow,/wrangler@4\.102\.0 deploy/);
});
