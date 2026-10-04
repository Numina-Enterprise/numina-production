import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
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

function renderApplicationRequirements(data){
  const nodes=new Map();
  const element=()=>({textContent:'',children:[],replaceChildren(...children){this.children=children;}});
  const document={querySelectorAll(selector){if(!nodes.has(selector))nodes.set(selector,element());return [nodes.get(selector)];},createElement:element};
  const script=readFileSync(new URL('../public/application-release-ui.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const context=vm.createContext({document});
  vm.runInContext(script.slice(0,script.indexOf('async function refreshApplicationRelease(){'))+'\nglobalThis.render=renderReleaseRequirements;',context);
  context.render(data);
  return selector=>nodes.get(selector)?.textContent;
}

test('application release UI labels retained publication and funding records historical with or without context',()=>{
  const evidence=JSON.parse(readFileSync(new URL('../docs/release-evidence-2026-09-13.json',import.meta.url),'utf8'));
  const before=structuredClone(evidence);
  for(const context of [undefined,{classification:'historical',deploymentOfCurrentBuildVerified:false},{classification:'current',deploymentOfCurrentBuildVerified:true}]){
    const data={recorded_release_evidence:evidence,distribution:{native_candidates:{android:{status:'signed_v4_binaries'},ios:{status:'compiled_unsigned_v4_build5'},store_publication_verified:false}}};
    if(context)data.recorded_release_evidence_context=context;
    const text=renderApplicationRequirements(data);
    const publication=text('[data-application-production-record]');
    assert.match(publication,/^Historical publication record · Sites version 42/);
    assert.match(publication,/does not verify deployment of the current build/);
    assert.doesNotMatch(publication,/latest deployment|current deployment verified/i);
    assert.match(text('[data-application-funding-record]'),/^Historical funding-plan record · Numina journal revision 134/);
    assert.match(text('[data-application-native-packages]'),/Android: signed v4 binaries\. iOS: compiled unsigned v4 build5/);
    assert.deepEqual(evidence,before);
  }
});

test('application release UI handles absent and partial historical publication evidence',()=>{
  const absent=renderApplicationRequirements({});
  assert.equal(absent('[data-application-production-record]'),'No historical publication record included');
  assert.equal(absent('[data-application-funding-record]'),'No historical funding-plan record included');
  const partial=renderApplicationRequirements({recorded_release_evidence:{website:{status:'succeeded',version:42}}});
  assert.match(partial('[data-application-production-record]'),/^Historical publication record/);
  assert.match(partial('[data-application-production-record]'),/Vercel Not reported/);
  assert.doesNotMatch(partial('[data-application-production-record]'),/undefined/);
});
