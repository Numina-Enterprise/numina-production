import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deriveIOSIdentity,checkIOSRelease,iosInputSnapshot,renderIOSRelease} from '../scripts/ios-release.mjs';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const json = path => JSON.parse(read(path));
function input() {
  const pkg=json('package.json');
  return {pkg,architecture:json('config/numina-architecture.json'),runtimeText:read('public/runtime-contract.js'),
    native:json('docs/native-package-record-v'+pkg.version.split('.')[0]+'.json'),
    policy:json('mobile/signing/distribution-policy.json'),settings:read('mobile/ios/Configuration/Numina.xcconfig')};
}
test('iOS release binds the shared application, core and rc26 runtime',()=>{
  const identity=checkIOSRelease();
  assert.equal(identity.applicationVersion,json('package.json').version);
  assert.equal(identity.runtimeVersion,'1.9.0-rc26');
  assert.equal(identity.coreVersion,'1.8.0');
  assert.equal(identity.applicationManifest,'/v4/release/manifest');
  assert.equal(identity.nativeCompilationEstablished,false);
  assert.equal(identity.signed,false);
});
test('platform source counters match the newly compiled iOS build',()=>{
  const identity=deriveIOSIdentity(input());
  assert.equal(identity.buildNumber,5);
  assert.equal(identity.historicalBinaryBuild,5);
  assert.match(read('mobile/android/app/build.gradle'),/versionCode 3/);
});
test('application version drift fails rather than relabeling an artifact',()=>{
  const value=input(); value.pkg.version='5.0.0';
  assert.throws(()=>deriveIOSIdentity(value),/APPLICATION_VERSION_MISMATCH/);
});
test('unapproved runtime migrations fail',()=>{
  const value=input(); value.architecture.runtime='1.9.0-rc27';
  assert.throws(()=>deriveIOSIdentity(value),/RUNTIME_PIN_MISMATCH/);
});
test('bundle identity mismatch and build regression fail',()=>{
  const value=input(); value.policy.packageIdentity='other.app';
  assert.throws(()=>deriveIOSIdentity(value),/BUNDLE_IDENTITY_MISMATCH/);
  const earlier=input(); earlier.settings=earlier.settings.replace(/CURRENT_PROJECT_VERSION = \d+/,'CURRENT_PROJECT_VERSION = 1');
  assert.throws(()=>deriveIOSIdentity(earlier),/IOS_BUILD_REGRESSION/);
});
test('generated xcconfig matches current dependency identities without signing secrets',()=>{
  const rendered=renderIOSRelease(checkIOSRelease());
  assert.equal(read('mobile/ios/Configuration/NuminaRelease.xcconfig').replaceAll('\r\n','\n'),rendered);
  assert.doesNotMatch(rendered,/PRIVATE KEY|API_KEY|PASSWORD|DEVELOPMENT_TEAM|CODE_SIGN/);
  assert.match(read('mobile/ios/Numina/ContentView.swift'),/detail\("Runtime dependency", AppConfiguration.runtimeVersion\)/);
});
test('input fingerprint covers the actual native source, assets and current build definitions',()=>{
  const snapshot=iosInputSnapshot();
  assert.equal(snapshot.sha256,createHash('sha256').update(JSON.stringify(snapshot.inputs)).digest('hex'));
  for(const path of ['mobile/ios/Numina/HostedAppModel.swift','mobile/ios/Numina/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png',
    'mobile/ios/Numina.xcodeproj/project.pbxproj','.github/workflows/numina-ios-branch-build.yml'])
    assert.ok(snapshot.inputs.some(item=>item.path===path),path);
});
test('compiled build 5 matches the source while preserving historical build 3 evidence',()=>{
  const record=input().native,archive=record.sourceArchives.find(item=>item.platform==='ios');
  assert.equal(record.ios.sourceBuildNumber,5);
  assert.equal(record.ios.binaryVersionCode,5);
  assert.equal(record.ios.currentSourceCompiled,true);
  assert.equal(record.ios.signingInputMatchesCurrentSource,true);
  assert.equal(record.ios.compiledSourceInputsSha256,iosInputSnapshot().sha256);
  const historical=json('docs/native-package-record-v4-pre-build5.json');
  assert.equal(historical.ios.binaryVersionCode,3);
  assert.equal(historical.ios.currentSourceCompiled,false);
  for(const file of historical.ios.binaries)assert.equal(createHash('sha256').update(readFileSync(new URL('../docs/'+file.file,import.meta.url))).digest('hex'),file.sha256);
  assert.equal(archive.sourceInputsSha256,iosInputSnapshot().sha256);
});

test("core version capture cannot consume following runtime manifest fields",()=>{
  const identity=deriveIOSIdentity(input());
  assert.equal(identity.coreVersion,"1.8.0");
  assert.doesNotMatch(renderIOSRelease(identity),/production_files_root|spdx_sbom_sha256/);
});
