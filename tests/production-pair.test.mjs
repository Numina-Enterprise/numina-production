import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pairSourceHash,verifyProductionPair} from '../scripts/production-pair.mjs';
test('production pair verifies both current sources and all four bindings',()=>{
 assert.equal(verifyProductionPair().bindingsVerified,true);
});
test('production source digest detects software changes while excluding its own bindings',()=>{
 for(const path of ['public/final-build.json','public/final-manifest.json']){
  const original=JSON.parse(readFileSync(path));const changed=structuredClone(original);
  changed.applicationVersion='0.0.0';assert.notEqual(pairSourceHash(changed),pairSourceHash(original));
  changed.applicationVersion=original.applicationVersion;changed.universalPair.sources[0].sha256='0'.repeat(64);
  assert.equal(pairSourceHash(changed),pairSourceHash(original));
 }
});
