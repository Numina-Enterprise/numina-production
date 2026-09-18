import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CONTROL_STORAGE} from '../src/control-store.js';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';

test('NUMINA is the canonical active identity',()=>{
  for(const field of ['root','manifest','identity','database','storage','transactionAuthority','journal']){
    assert.equal(CONTROL_STORAGE[field],'NUMINA');
  }
  for(const field of ['identity','transactionAuthority','journal','storage','revisionModel','evidenceHead']){
    assert.equal(NUMINA_LAYERS.database[field],'NUMINA');
  }
  for(const field of ['identity','repository','build','release','deployment']){
    assert.equal(NUMINA_LAYERS.distribution[field],'NUMINA');
  }
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['release:github'],'node scripts/package-github-release.mjs');
});
