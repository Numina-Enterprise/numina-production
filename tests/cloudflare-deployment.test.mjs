import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RUNTIME_READ_PATHS} from '../src/runtime-http.js';

test('Cloudflare deployment binds the canonical static asset collection',()=>{
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.name,'numina-production');
  assert.equal(config.main,'./dist/server/index.js');
  assert.equal(config.assets?.directory,'./dist/client');
  assert.equal(config.assets?.binding,'ASSETS');
});

test('Cloudflare runtime mirrors the canonical readiness and provenance routes',()=>{
  assert.equal(RUNTIME_READ_PATHS.has('/v1/frontier/readiness'),true);
  assert.equal(RUNTIME_READ_PATHS.has('/v1/deployment/provenance'),true);
});
