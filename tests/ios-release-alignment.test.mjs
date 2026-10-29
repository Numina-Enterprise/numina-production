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
test('iOS release binds the shared application, core and rc27 runtime',()=>{
  const identity=checkIOSRelease();
  assert.equal(identity.applicationVersion,json('package.json').version);
  assert.equal(identity.runtimeVersion,'1.9.0-rc27');
  assert.equal(identity.coreVersion,'1.8.0');
  assert.equal(identity.applicationManifest,'/v4/release/manifest');
  assert.equal(identity.nativeCompilationEstablished,false);
  assert.equal(identity.signed,false);
});
test('current platform source counters remain distinct from historical binaries',()=>{
  const identity=deriveIOSIdentity(input());
  assert.equal(identity.buildNumber,6);
  assert.equal(identity.historicalBinaryBuild,5);
  assert.match(read('mobile/android/app/build.gradle'),/versionCode 4/);
  assert.equal(input().native.android.binaryVersionCode,3);
});
test('application version drift fails rather than relabeling an artifact',()=>{
  const value=input(); value.pkg.version='5.0.0';
  assert.throws(()=>deriveIOSIdentity(value),/APPLICATION_VERSION_MISMATCH/);
});
test('unapproved runtime migrations fail',()=>{
  const value=input(); value.architecture.runtime='1.9.0-rc28';
  assert.throws(()=>deriveIOSIdentity(value),/RUNTIME_PIN_MISMATCH/);
});
test('bundle identity mismatch and build regression fail',()=>{
  const value=input(); value.policy.packageIdentity='other.app';
  assert.throws(()=>deriveIOSIdentity(value),/BUNDLE_IDENTITY_MISMATCH/);
  const earlier=input(); earlier.settings=earlier.settings.replace(/CURRENT_PROJECT_VERSION = \d+/,'CURRENT_PROJECT_VERSION = 1');
  assert.throws(()=>deriveIOSIdentity(earlier),/IOS_BUILD_SEQUENCE_INVALID/);
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
test('iOS source archive retains its packaged identity while current source may advance',()=>{
  const record=input().native,archive=record.sourceArchives.find(item=>item.platform==='ios');
  assert.equal(record.ios.sourceBuildNumber,6);
  assert.equal(record.ios.binaryVersionCode,5);
  assert.equal(record.ios.currentSourceCompiled,false);
  assert.equal(record.ios.signingInputMatchesCurrentSource,false);
  assert.notEqual(record.ios.compiledSourceInputsSha256,iosInputSnapshot().sha256);
  assert.equal(record.ios.signed,false);
  assert.equal(record.ios.storeSubmitted,false);
  const evidence=json('docs/ios-build-verification-2026-09-16-c6ffbb5.json');
  assert.equal(evidence.sourceCommit,record.ios.sourceCommit);
  assert.equal(evidence.sourceTree,record.ios.sourceTree);
  assert.equal(evidence.sourceInputs.sha256,record.ios.compiledSourceInputsSha256);
  assert.equal(evidence.compiledArtifact.sha256,record.ios.binaries[0].sha256);
  assert.equal(evidence.compiledInfoPlist.CFBundleIdentifier,record.proposedPackageIdentity);
  assert.equal(evidence.compiledInfoPlist.CFBundleVersion,String(record.ios.binaryVersionCode));
  assert.equal(evidence.compiledInfoPlist.NuminaRuntimeVersion,'1.9.0-rc26');
  assert.notEqual(evidence.compiledInfoPlist.NuminaRuntimeVersion,checkIOSRelease().runtimeVersion);
  assert.equal(evidence.compiledInfoPlist.NuminaFrozenCoreRoot,checkIOSRelease().frozenCoreRoot);
  assert.ok(Object.values(evidence.checks).every(value=>value===true));
  assert.ok(record.ios.binaries.length>0);
  for(const file of record.ios.binaries)assert.equal(createHash('sha256').update(readFileSync(new URL('../docs/'+file.file,import.meta.url))).digest('hex'),file.sha256);
  const prior=record.ios.previousCompiledBuild;
  assert.notEqual(prior.compiledSourceInputsSha256,iosInputSnapshot().sha256);
  assert.notEqual(prior.sha256,record.ios.binaries[0].sha256);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../docs/'+prior.file,import.meta.url))).digest('hex'),prior.sha256);
  const historical=json('docs/native-package-record-v4-pre-build5.json');
  assert.equal(historical.ios.binaryVersionCode,3);
  assert.equal(historical.ios.currentSourceCompiled,false);
  for(const file of historical.ios.binaries)assert.equal(createHash('sha256').update(readFileSync(new URL('../docs/'+file.file,import.meta.url))).digest('hex'),file.sha256);
  assert.equal(record.ios.sourceInputsSha256,archive.sourceInputsSha256);
  assert.match(iosInputSnapshot().sha256,/^[a-f0-9]{64}$/);
  assert.equal(archive.installable,false);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../docs/'+archive.file,import.meta.url))).digest('hex'),archive.sha256);
});

test("core version capture cannot consume following runtime manifest fields",()=>{
  const identity=deriveIOSIdentity(input());
  assert.equal(identity.coreVersion,"1.8.0");
  assert.doesNotMatch(renderIOSRelease(identity),/production_files_root|spdx_sbom_sha256/);
});
