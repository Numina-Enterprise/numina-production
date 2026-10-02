// Check maintained Numina source identities without relabeling retained artifacts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkIOSRelease} from './ios-release.mjs';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const softwareReleaseInputs = [
  'package.json', 'src/app-core.js', 'src/frontier.js',
  'runtime/vercel-production/package.json',
  'runtime/nusd/package.json', 'runtime/nusd/package-lock.json',
  'runtime/nusd/development/package.json', 'runtime/nusd/development/package-lock.json',
  'integrations/numina/package.json', 'integrations/numina/distribution.json',
  'integrations/numina/verification.json', 'integrations/numina/file-manifest.json',
  'integrations/codex/numina/.codex-plugin/plugin.json',
  'mobile/android/app/build.gradle', 'mobile/ios/Configuration/Numina.xcconfig',
  'mobile/ios/Signing/signing-inputs.json', 'mobile/signing/release-identities.json'
];

export function loadSoftwareRelease(root = ROOT) {
  const read = path => readFileSync(resolve(root, path), 'utf8');
  const json = path => JSON.parse(read(path));
  const capture = (path, expression) => {
    const value = read(path).match(expression)?.[1];
    assert.ok(value, 'Missing release identity: ' + path);
    return value;
  };
  const version = json('package.json').version;
  const native = json('docs/native-package-record-v' + version.split('.')[0] + '.json');
  const identities = json('mobile/signing/release-identities.json');
  const locks = ['runtime/nusd', 'runtime/nusd/development'].map(path => ({
    path, pkg: json(path + '/package.json'), lock: json(path + '/package-lock.json')
  }));
  return {
    version,
    versions: {
      application: version,
      control: capture('src/frontier.js', /FRONTIER_VERSION='([^']+)'/),
      appApi: capture('src/app-core.js', /APP_VERSION='([^']+)'/),
      productionGateway: json('runtime/vercel-production/package.json').version,
      managedRuntimeSource: locks[0].pkg.version,
      contractDevelopment: locks[1].pkg.version,
      integration: json('integrations/numina/package.json').version,
      integrationDistribution: json('integrations/numina/distribution.json').version,
      integrationControl: json('integrations/numina/distribution.json').frontier.version,
      integrationMcp: capture('integrations/numina/src/mcp.js', /serverInfo:\{name:'numina-nusd-integration',version:'([^']+)'/),
      integrationVerification: json('integrations/numina/verification.json').package.version,
      integrationInventory: json('integrations/numina/file-manifest.json').version,
      codexPlugin: json('integrations/codex/numina/.codex-plugin/plugin.json').version,
      android: capture('mobile/android/app/build.gradle', /versionName '([^']+)'/),
      ios: capture('mobile/ios/Configuration/Numina.xcconfig', /MARKETING_VERSION = ([^\r\n]+)/),
      iosSigningInput: json('mobile/ios/Signing/signing-inputs.json').applicationVersion,
      nativeRecord: native.applicationVersion,
      releaseIdentities: identities.finalBuild.applicationVersion
    },
    locks,
    androidBuild: Number(capture('mobile/android/app/build.gradle', /versionCode (\d+)/)),
    iosBuild: Number(capture('mobile/ios/Configuration/Numina.xcconfig', /CURRENT_PROJECT_VERSION = (\d+)/)),
    native, identities,
    iosSigningBuild: json('mobile/ios/Signing/signing-inputs.json').sourceBuildNumber,
    runtimeVersion: EXPECTED_RELEASE.production_version,
    coreVersion: EXPECTED_RELEASE.core_version
  };
}

export function verifySoftwareRelease(input) {
  assert.equal(input.version, '4.0.0', 'Numina 4 source release');
  for (const [name, version] of Object.entries(input.versions))
    assert.equal(version, input.version, 'Source version mismatch: ' + name);
  for (const {path, pkg, lock} of input.locks) {
    assert.equal(lock.version, pkg.version, path + ' lock version');
    assert.equal(lock.packages[''].version, pkg.version, path + ' lock root version');
    assert.equal(lock.packages[''].name, pkg.name, path + ' lock root name');
  }
  assert.equal(input.androidBuild, input.native.versionCode, 'Android native record counter');
  assert.equal(input.androidBuild, input.identities.finalBuild.androidVersionCode, 'Android signing counter');
  assert.equal(input.iosBuild, input.native.ios.sourceBuildNumber, 'iOS native record counter');
  assert.equal(input.iosBuild, input.identities.finalBuild.iosBuildNumber, 'iOS signing counter');
  assert.equal(input.iosBuild, input.iosSigningBuild, 'iOS signing input counter');
  assert.equal(input.runtimeVersion, '1.9.0-rc26', 'Preserved runtime dependency');
  assert.equal(input.coreVersion, '1.8.0', 'Preserved frozen core');
  return {
    schema: 'numina.software-release-alignment.v1', identity: 'NUMINA',
    version: input.version, scope: 'MAINTAINED_SOURCE_ONLY', versions: input.versions,
    nativeSourceBuildNumbers: {android: input.androidBuild, ios: input.iosBuild},
    preservedDependencies: {runtime: input.runtimeVersion, core: input.coreVersion},
    historicalBinaryBuildNumbers: {android: input.native.android.binaryVersionCode, ios: input.native.ios.binaryVersionCode},
    nativeCompilationPerformed: false, runtimeDeploymentPerformed: false,
    storeSubmissionPerformed: false, providerExecutionPerformed: false
  };
}

export function checkSoftwareRelease(root = ROOT) {
  checkIOSRelease(root);
  return verifySoftwareRelease(loadSoftwareRelease(root));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(checkSoftwareRelease(), null, 2));
}
