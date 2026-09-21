import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const json=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));

test('active NUMINA evidence persistence is GitHub Release only',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/verify-provider-observations.yml',import.meta.url),'utf8');
  assert.match(workflow,/Publish and read back canonical provider evidence from GitHub Release/);
  assert.match(workflow,/Publish and read back trusted production release from GitHub Release/);
  assert.match(workflow,/publish-github-evidence\.mjs/);
  assert.doesNotMatch(workflow,/NEON|NUMINA_PROVIDER_INGEST_URL|NUMINA_TRUSTED_RELEASE_URL|ACTIONS_ID_TOKEN_REQUEST_URL|numina_ingest_provider_evidence|numina_mark_trusted_production_release/i);
});

test('Vercel no longer exposes provider or trusted-release persistence routes',()=>{
  for(const path of ['vercel.json','runtime/vercel-production/vercel.json']){
    const config=json(path);
    assert.equal((config.rewrites||[]).some(route=>route.source==='/v1/evidence/provider-observation'),false,path+' still exposes retired provider persistence');
  }
  const rootConfig=json('vercel.json');
  assert.equal((rootConfig.headers||[]).some(route=>route.source==='/v1/evidence/provider-observation'),false);
  const wrapper=readFileSync(new URL('../api/evidence-bind.js',import.meta.url),'utf8');
  assert.doesNotMatch(wrapper,/providerEvidenceIngestHandler|trustedProductionReleaseIngestHandler/);
  assert.match(wrapper,/RETIRED_EVIDENCE_INGEST_ROUTE/);
});

test('Neon-specific evidence persistence modules are absent from the active runtime',()=>{
  for(const path of [
    'runtime/vercel-production/api/provider-evidence-ingest.js',
    'runtime/vercel-production/api/trusted-production-release-ingest.js',
    'runtime/vercel-production/lib/provider-evidence-ingest.js',
    'runtime/vercel-production/lib/trusted-release-ingest.js',
    'runtime/vercel-production/lib/neon-evidence-rpc.js',
    'tests/neon-evidence-rpc.test.mjs',
  ])assert.equal(existsSync(new URL('../'+path,import.meta.url)),false,path+' must remain retired');
});
