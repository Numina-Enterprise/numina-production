import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {privateBankRouteConfiguration} from '../src/bank-route-model.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const json=p=>JSON.parse(read(p));
const buildBytes=read('public/final-build.json');
const manifestBytes=read('public/final-manifest.json');
const build=json('public/final-build.json');
const pkg=json('package.json');
const buildSha256=createHash('sha256').update(buildBytes).digest('hex');
const manifestSha256=createHash('sha256').update(manifestBytes).digest('hex');
const ids=build.universalPair.sourceIds;
const artifacts=['public/final-build.json','public/final-manifest.json'];
const routes=['/final-build.json','/final-manifest.json'];
const frontierIds=['L1','L2','L3','L4','L5','L6','L7'];
assert.equal(ids.length,1);
assert.equal(pkg.numina.finalBuildManifest.sha256,'996f0ce7cc8cc5809969c6aaf5188d5c3a9a6332dbe5fd231cca974152a115fa');
assert.equal(pkg.numina.finalBuildManifest.sha256Semantics,'IMMUTABLE_RELEASE_REFERENCE');
assert.equal(pkg.numina.finalBuildManifest.currentContentSha256,buildSha256);
assert.deepEqual(build.immutableReleaseHashes,{finalBuildSha256:'996f0ce7cc8cc5809969c6aaf5188d5c3a9a6332dbe5fd231cca974152a115fa',finalManifestSha256:'c9300f87f0ccfe1f2e2e132ecfa9e5de9a23f144dcdfa682849fe6f7bcc09b63'});
assert.deepEqual(json('docs/NUMINA-FINAL-BUILD.json'),build);
assert.equal(build.identity,'NUMINA');
assert.equal(build.status,'FINAL');
assert.equal(build.universalPair.matrix,'1x2');
assert.equal(build.universalPair.environmentCount,1);
assert.equal(build.universalPair.bindingCount,2);
assert.deepEqual(build.universalPair.environments,['FRONTIER']);
assert.equal(build.environmentCount,1);
assert.deepEqual(build.currentEnvironments,['FRONTIER']);
assert.equal(build.environmentBindings.length,2);
assert.deepEqual(build.currentPush,{environment:'FRONTIER',status:'FINAL',gate:'CLOSED',futureAdvancementAllowed:true});

const frontier=build.architectureFrontier;
assert.equal(frontier.schema,'numina.architecture-frontier.v3');
assert.equal(frontier.frontierLayerCount,7);
assert.deepEqual(frontier.frontierLayers.map(x=>x.id),frontierIds);
assert.equal(frontier.gate,'CLOSED');
assert.equal(frontier.advancement,false);
assert.equal(frontier.currentPushEnvironment,'FRONTIER');
assert.equal(frontier.futureAdvancementAllowed,true);
const finalManifest=json('public/final-manifest.json');
assert.equal(finalManifest.identity,'NUMINA');
assert.equal(finalManifest.canonicalSha256,'996f0ce7cc8cc5809969c6aaf5188d5c3a9a6332dbe5fd231cca974152a115fa');
assert.equal(finalManifest.finalBuild.sha256,'996f0ce7cc8cc5809969c6aaf5188d5c3a9a6332dbe5fd231cca974152a115fa');
assert.equal(finalManifest.finalBuild.currentContentSha256,buildSha256);
assert.deepEqual(finalManifest.universalPair.sourceIds,ids);
assert.deepEqual(finalManifest.environmentBindings,build.environmentBindings);
assert.equal(pkg.numina.finalManifest.sha256,'c9300f87f0ccfe1f2e2e132ecfa9e5de9a23f144dcdfa682849fe6f7bcc09b63');
assert.equal(pkg.numina.finalManifest.currentContentSha256,manifestSha256);

assert.equal(build.runtimeInventory.liveRuntimeCount,2);
assert.equal(build.runtimeInventory.liveRuntimes.length,2);
assert.equal(build.runtimeInventory.frontierRuntimeCount,2);
assert.equal(build.runtimeInventory.frontierRuntimes.length,2);
assert.equal(build.runtimeInventory.totalRuntimeRecords,4);
assert.equal(build.runtimeModel.liveRuntimeCount,2);
assert.equal(build.runtimeModel.frontierRuntimeCount,2);
for(const holder of [build.runtimeInventory]){
  assert.equal(Object.hasOwn(holder,'frontierFinalRuntimeCount'),false);
  assert.equal(Object.hasOwn(holder,'frontierFinalRuntimes'),false);
}
assert.deepEqual(build.runtimeInventory.liveRuntimes.map(x=>x.runtimeId),[
  '35c9ac86fb9bef46579bf2201cc48094d663d925d9af8bf6aa304a797be0c064',
  '424f660e35e6f48f72cb53d6c0241702c35358dac48322477343b9103178113e'
]);
assert.deepEqual(build.runtimeInventory.liveRuntimes.map(x=>x.role),['LIVE_APPLICATION_RUNTIME','LIVE_RC27_RUNTIME']);
assert.deepEqual(build.runtimeInventory.liveRuntimes.map(x=>x.version),['4.0.0','1.9.0-rc27']);
assert.deepEqual(build.environmentBindings.map(x=>x.runtimeTargetId),build.runtimeInventory.frontierRuntimes.map(x=>x.runtimeId));
assert.deepEqual(build.runtimeInventory.frontierRuntimes.map(x=>x.mergedRuntimeId),[
  '35c9ac86fb9bef46579bf2201cc48094d663d925d9af8bf6aa304a797be0c064',
  '424f660e35e6f48f72cb53d6c0241702c35358dac48322477343b9103178113e'
]);
assert.deepEqual(build.runtimeInventory.frontierRuntimes.map(x=>x.mergedVersion),['4.0.0','1.9.0-rc27']);

const recordPath='release-evidence/numina-bofa-ach-instruction-2026-09-19.json';
const instruction=json(recordPath),projection=build.treasury.achTransferInstruction;
assert.equal(projection.record,recordPath);
for(const key of ['amountNusd','targetAmountUsd','ratio','contract','nativeContractId'])assert.equal(projection[key],instruction[key]);
const bank=privateBankRouteConfiguration({});
assert.equal(bank.achSubmissionEnabled,false);
assert.equal(bank.settlementPerformed,false);
assert.equal(bank.bankSettlementVerified,false);
console.log('NUMINA FINAL build: 1 source ID = 2 FRONTIER bindings; runtime inventories preserved.');
