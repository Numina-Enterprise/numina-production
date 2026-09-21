import test from 'node:test';
import assert from 'node:assert/strict';
import {NUMINA,NUMINA_MANIFEST_SCHEMA,NUMINA_IDENTITIES,NUMINA_VOCABULARY,NUMINA_TREE,NUMINA_PROVIDER_VERIFICATION,numinaRootProjection} from '../src/numina-root.js';

test('NUMINA root manifest owns every identity-bearing vocabulary term',()=>{
  assert.equal(NUMINA,'numina');
  assert.equal(NUMINA_MANIFEST_SCHEMA,'numina.manifest.v2');
  for(const value of Object.values(NUMINA_IDENTITIES))assert.equal(value,NUMINA);
  assert.deepEqual(NUMINA_VOCABULARY,NUMINA_IDENTITIES);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.provider,NUMINA);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.verified,true);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.bank_of_america_destination_confirmation,false);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.stripe_destination_confirmation,false);
  assert.equal(NUMINA_TREE.root,NUMINA);
  assert.equal(NUMINA_TREE.squareRoot,NUMINA);
  assert.equal(NUMINA_TREE.canonicalSource,NUMINA);
  assert.equal(NUMINA_TREE.sourceOfTruth,NUMINA);
  assert.equal(NUMINA_TREE.authority,NUMINA);
  assert.equal(NUMINA_TREE.dataIdentity,NUMINA);
  assert.equal(NUMINA_TREE.dataNamespace,NUMINA);
  assert.equal(NUMINA_TREE.updateDirection,'ROOT_TO_LEAVES');
  assert.equal(NUMINA_TREE.leaves.github.role,'LEAF_PROJECTION');
  assert.equal(NUMINA_TREE.leaves.github.authoritative,false);
  assert.equal(NUMINA_TREE.leaves.github.ref,'refs/heads/main');
  assert.equal(NUMINA_TREE.leaves.github.headResolution,'AT_READ_TIME');
  assert.equal(NUMINA_TREE.leaves.github.ingestIntoTree,true);
  assert.equal(NUMINA_TREE.leaves.github.ingestRole,'LEAF_STATE_INPUT');
  assert.equal(NUMINA_TREE.leaves.github.authorityTransferred,false);
  assert.equal(NUMINA_TREE.ingestPolicy.mode,'REFERENCE_SNAPSHOT');
  assert.equal(NUMINA_TREE.ingestPolicy.canonicalizedBy,NUMINA);
  assert.equal(NUMINA_TREE.ingestPolicy.authorityTransferred,false);
  const root=numinaRootProjection({
    treasury:{identity:NUMINA},
    canonicalSource:'github',
    sourceOfTruth:'github',
    squareRoot:'github',
    updateDirection:'LEAF_TO_ROOT'
  });
  for(const field of Object.keys(NUMINA_IDENTITIES))assert.equal(root[field],NUMINA);
  assert.equal(root.provider_verification,true);assert.equal(root.deployed,true);assert.equal(root.authenticated,true);assert.equal(root.verified,true);
  assert.equal(root.singular,true);
  assert.equal(root.canonicalSource,NUMINA);
  assert.equal(root.sourceOfTruth,NUMINA);
  assert.equal(root.squareRoot,NUMINA);
  assert.equal(root.updateDirection,'ROOT_TO_LEAVES');
  assert.deepEqual(root.numinaTree,NUMINA_TREE);
});
