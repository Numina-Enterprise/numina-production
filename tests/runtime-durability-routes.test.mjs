import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runtimeReadyPayload,bootstrapAttestationPayload,validateAuthoritativeBootstrapResponse} from '../api/application-release.mjs';

const config=JSON.parse(readFileSync(new URL('../config/numina-routing.json',import.meta.url),'utf8'));
const route=source=>config.rewrites.find(entry=>entry.source===source)?.destination;

test('root Numina routing exposes strict runtime readiness and bootstrap routes',()=>{
  assert.equal(route('/readyz'),'/api/application-release?mode=readyz');
  assert.equal(route('/v1/bootstrap/attestation'),'/api/application-release?mode=bootstrap-attestation');
  const ready=runtimeReadyPayload();
  assert.equal(ready.status,'ready');
  assert.equal(ready.identity,'NUMINA');
  assert.equal(ready.release,'1.9.0-rc26');
  const bootstrap=bootstrapAttestationPayload();
  assert.equal(bootstrap.schema,'numina.bootstrap-attestation.v1');
  assert.equal(bootstrap.identity,'NUMINA');
  assert.equal(bootstrap.release,'1.9.0-rc26');
  assert.equal(bootstrap.evidence_store_durable,true);
  assert.equal(bootstrap.external_financial_evidence_verified,false);
});

test('bootstrap mirror requires the pinned production signature',()=>{
  assert.throws(()=>validateAuthoritativeBootstrapResponse({artifact_type:'NUMINA_BOOTSTRAP_ATTESTATION',payload:bootstrapAttestationPayload()}));
  assert.throws(()=>validateAuthoritativeBootstrapResponse({}));
});
