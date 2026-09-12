import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyReleaseAttestation,releaseChecks} from '../public/release-model.js';
const fixture=JSON.parse(readFileSync(new URL('../fixtures/public-release-evidence.json',import.meta.url),'utf8'));

test('browser verification accepts the captured production signature and rejects tampering',async()=>{
  assert.equal(await verifyReleaseAttestation(fixture.attestation),true);
  const changed=structuredClone(fixture.attestation);changed.payload.production_version='tampered';
  assert.equal(await verifyReleaseAttestation(changed),false);
  assert.equal(await verifyReleaseAttestation(fixture.attestation,'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='),false);
  assert.equal(await verifyReleaseAttestation({}),false);
});

test('release status requires signed identity, a matching pinned key, and healthy checks',()=>{
  assert.equal(releaseChecks(fixture,true),true);
  const mutations=[
    d=>d.manifest.spdx_sbom_sha256='mismatch',
    d=>d.manifest.frozen_core_manifest_root='mismatch',
    d=>d.manifest.core_version='mismatch',
    d=>d.status.production_files_root='mismatch',
    d=>d.key.public_key='mismatch',
    d=>d.key.key_id='mismatch',
    d=>d.attestation.payload.frozen_core.valid=false,
    d=>d.status.conformance.passing_tests++,
    d=>d.preflight.valid=false,
    d=>d.preflight.role='mismatch',
    d=>d.preflight.production_version='mismatch',
    d=>d.supply.valid=false,
    d=>d.supply.spdx_sbom_sha256='mismatch',
    d=>d.ready.status='unavailable',
    d=>delete d.attestation,
  ];
  for(const mutate of mutations){const d=structuredClone(fixture);mutate(d);assert.equal(releaseChecks(d,true),false);}
  assert.equal(releaseChecks(fixture,false),false);
  assert.equal(releaseChecks({},false),false);
});
