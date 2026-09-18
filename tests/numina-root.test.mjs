import test from 'node:test';
import assert from 'node:assert/strict';
import {NUMINA,NUMINA_MANIFEST_SCHEMA,NUMINA_VOCABULARY,NUMINA_PROVIDER_VERIFICATION,numinaRootProjection} from '../src/numina-root.js';

test('NUMINA root manifest owns every identity-bearing vocabulary term',()=>{
  assert.equal(NUMINA,'NUMINA');
  assert.equal(NUMINA_MANIFEST_SCHEMA,'numina.manifest.v2');
  for(const value of Object.values(NUMINA_VOCABULARY))assert.equal(value,NUMINA);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.provider,NUMINA);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.verified,true);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.bank_of_america_destination_confirmation,false);
  assert.equal(NUMINA_PROVIDER_VERIFICATION.stripe_destination_confirmation,false);
  const root=numinaRootProjection({treasury:{identity:NUMINA}});
  for(const field of ['root','manifest','identity','authority','source','evidence','provider'])assert.equal(root[field],NUMINA);
  assert.equal(root.provider_verification,true);
  assert.equal(root.singular,true);
});
