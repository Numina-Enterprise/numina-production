import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSoftwareRelease, verifySoftwareRelease, checkSoftwareRelease} from '../scripts/check-software-release.mjs';

test('all maintained software uses Numina 4 while native binary provenance and runtime pins remain separate', () => {
  const record = checkSoftwareRelease();
  assert.equal(record.scope, 'MAINTAINED_SOURCE_ONLY');
  assert.deepEqual(record.nativeSourceBuildNumbers, {android: 4, ios: 6});
  assert.deepEqual(record.historicalBinaryBuildNumbers, {android: 3, ios: 5});
  assert.deepEqual(record.preservedDependencies, {runtime: '1.9.0-rc26', core: '1.8.0'});
});

test('any active package drift blocks publication', () => {
  for (const name of Object.keys(loadSoftwareRelease().versions)) {
    const input = loadSoftwareRelease();
    input.versions[name] = '3.0.0';
    assert.throws(() => verifySoftwareRelease(input), /Source version mismatch/, name);
  }
});

test('stale dependency lock identities block publication without changing dependencies', () => {
  for (const index of [0, 1]) {
    const input = loadSoftwareRelease();
    input.locks[index].lock.packages[''].version = '0.0.0';
    assert.throws(() => verifySoftwareRelease(input), /lock root version/);
  }
});

test('native signing metadata cannot select a historical binary counter as current source', () => {
  const android = loadSoftwareRelease();
  android.identities.finalBuild.androidVersionCode = android.native.android.binaryVersionCode;
  assert.throws(() => verifySoftwareRelease(android), /Android signing counter/);
  const ios = loadSoftwareRelease();
  ios.iosSigningBuild = ios.native.ios.binaryVersionCode;
  assert.throws(() => verifySoftwareRelease(ios), /iOS signing input counter/);
});
