import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import rpcModule from '../runtime/vercel-production/lib/neon-evidence-rpc.js';

const {DEFAULT_NEON_DATA_API_URL,dataApiBase,callEvidenceRpc}=rpcModule;

test('Neon evidence RPC uses the canonical non-secret production Data API endpoint',()=>{
  assert.equal(DEFAULT_NEON_DATA_API_URL,'https://ep-wild-mud-au2cn33z.apirest.c-10.us-east-1.aws.neon.tech/numina/rest/v1');
  assert.equal(dataApiBase({}),DEFAULT_NEON_DATA_API_URL);
  assert.equal(dataApiBase({NUMINA_NEON_DATA_API_URL:'https://example.test/numina/rest/v1/'}),'https://example.test/numina/rest/v1');
  assert.throws(()=>dataApiBase({NUMINA_NEON_DATA_API_URL:'http://example.test/numina/rest/v1'}),/NUMINA_NEON_DATA_API_URL_INVALID/);
});

test('Neon evidence RPC forwards the verified GitHub OIDC bearer and only the manifest',async()=>{
  const calls=[];
  const manifest={record_id:'provider-observation-test'};
  const fetchFn=async(url,options)=>{
    calls.push({url,options});
    return Response.json({committed:true,read_back:true,record_id:manifest.record_id});
  };
  const result=await callEvidenceRpc({
    token:'header.payload.signature',
    rpc:'numina_ingest_provider_evidence',
    manifest,
    fetchFn,
    env:{NUMINA_NEON_DATA_API_URL:'https://example.test/numina/rest/v1'},
  });
  assert.equal(result.committed,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://example.test/numina/rest/v1/rpc/numina_ingest_provider_evidence');
  assert.equal(calls[0].options.headers.authorization,'Bearer header.payload.signature');
  assert.deepEqual(JSON.parse(calls[0].options.body),{manifest});
  assert.equal(calls[0].options.redirect,'error');
});

test('Neon evidence RPC allowlists durable functions and fails closed on HTTP errors',async()=>{
  await assert.rejects(
    callEvidenceRpc({token:'a.b.c',rpc:'show_db_tree',manifest:{},fetchFn:async()=>Response.json({})}),
    /NUMINA_NEON_RPC_NOT_ALLOWED/,
  );
  await assert.rejects(
    callEvidenceRpc({
      token:'a.b.c',
      rpc:'numina_mark_trusted_production_release',
      manifest:{},
      fetchFn:async()=>Response.json({message:'GITHUB_REF_INVALID'},{status:400}),
    }),
    /DURABLE_EVIDENCE_HTTP_400:GITHUB_REF_INVALID/,
  );
});

test('provider and trusted-release persistence no longer require a second static durable token',()=>{
  for(const path of [
    new URL('../runtime/vercel-production/lib/provider-evidence-ingest.js',import.meta.url),
    new URL('../runtime/vercel-production/lib/trusted-release-ingest.js',import.meta.url),
  ]){
    const source=readFileSync(path,'utf8');
    assert.equal(source.includes('NUMINA_DURABLE_EVIDENCE_TOKEN'),false);
    assert.equal(source.includes("requiredEnv('NUMINA_DURABLE_EVIDENCE_URL')"),false);
  }
  const provider=readFileSync(new URL('../runtime/vercel-production/lib/provider-evidence-ingest.js',import.meta.url),'utf8');
  const trusted=readFileSync(new URL('../runtime/vercel-production/lib/trusted-release-ingest.js',import.meta.url),'utf8');
  assert.match(provider,/rpc:'numina_ingest_provider_evidence'/);
  assert.match(trusted,/rpc:'numina_mark_trusted_production_release'/);
});
