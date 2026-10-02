import test from 'node:test';
import assert from 'node:assert/strict';
import {NUMINA_BASE_USDC_PREPARED_REQUEST_SCHEMA,NUMINA_AGGREGATE_MODEL_PREPARED_REQUEST_SCHEMA} from '../public/treasury-connection-model.js';
import {createTreasuryPreparation} from '../public/treasury-preparation.js';

test('archive does not advertise production-only preparation schemas as its preserved reducer capability',async()=>{
  let reads=0,writes=0;
  const client=createTreasuryPreparation({read:async()=>{reads++;throw Error('unexpected read');},write:async()=>{writes++;throw Error('unexpected write');}});
  for(const schema of [NUMINA_BASE_USDC_PREPARED_REQUEST_SCHEMA,NUMINA_AGGREGATE_MODEL_PREPARED_REQUEST_SCHEMA]){
    assert.equal(schema.implementationStatus,'AUTHORITATIVE_PRODUCTION_ONLY');
    assert.equal(schema.archiveRuntimeImplemented,false);
    assert.equal(schema.authoritativeImplementationRoute,'https://numinalabs.xyz/api/control/v1/treasury');
    await assert.rejects(client.prepare({operation:schema.operation}),error=>error.code==='INVALID_TREASURY_FIELDS');
    assert.equal(schema.output.submission_performed,false);
    assert.equal(schema.output.receipt,null);
  }
  assert.equal(reads,0);assert.equal(writes,0);
});
