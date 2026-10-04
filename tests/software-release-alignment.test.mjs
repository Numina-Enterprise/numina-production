import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSoftwareRelease, verifySoftwareRelease, checkSoftwareRelease} from '../scripts/check-software-release.mjs';

test('integration download guidance names the exact configured discovery tool count',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const tools=JSON.parse(read('integrations/numina/verification.json')).defaultTools;
  const record=JSON.parse(read('docs/integration-kit-v4.0.0-record.json'));
  assert.equal(new Set(tools).size,tools.length);
  assert.deepEqual(record.defaultTools,tools);
  for(const path of ['public/integrations.html','dist/client/integrations.html'])
    assert.match(read(path),new RegExp('supplies '+tools.length+' read-only discovery tools'),path);
});

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

test('stale native procurement permission claims block publication', () => {
  for (const platform of ['android', 'ios']) {
    const input = loadSoftwareRelease();
    input.nativeGuidance[platform] = input.nativeGuidance[platform].replace('procurement_usage: false', 'procurement_usage: true');
    assert.throws(() => verifySoftwareRelease(input), /must not claim procurement is enabled/);
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
