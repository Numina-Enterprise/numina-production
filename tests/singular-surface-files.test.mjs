import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const absent=[
  'api/control-state.js',
  'config/numina-production-bound-state.v1.json',
  'public/authority.css',
  'public/authority.html',
  'runtime/vercel-production/api/control-state.js',
  'runtime/vercel-production/lib/owner-authority.js',
  'scripts/align-site.mjs',
  'scripts/link-authority.mjs',
  'src/legacy-authority-worker.js',
  'tests/authority.test.mjs'
];

test('standalone authority and state files remain removed',()=>{
  for(const path of absent)assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path);
});

test('v1 compatibility read no longer depends on a control-state file',()=>{
  const routing=JSON.parse(readFileSync(new URL('../config/numina-routing.json',import.meta.url)));
  const route=routing.rewrites.find(item=>item.source==='/v1/control/state');
  assert.equal(route?.destination,'/api/status?mode=control-manifest');
});
