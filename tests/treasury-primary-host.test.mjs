import test from 'node:test';
import assert from 'node:assert/strict';
import {treasuryConnectionHttp} from '../src/treasury-connection-http.js';
test('primary host exposes the same model and protects owner records',async()=>{
  const model=await treasuryConnectionHttp(new Request('https://numinalabs.xyz/api/treasury/v1/model'),{});
  const value=await model.json();
  assert.equal(value.aggregateModeledValue,null);
  assert.equal(value.canonicalTreasuryValues.aggregate.modeledTarget,'1500000000000000');
  assert.equal(value.canonicalTreasuryValues.status,'JOURNAL_SNAPSHOT');
  assert.equal(value.canonicalTreasuryValues.canonical,false);
  const env={NUMINA_CONTROL_OWNER:'owner'};
  for(const name of ['bank-route','submissions']){
    const req=new Request('https://numinalabs.xyz/api/treasury/v1/'+name);
    const denied=await treasuryConnectionHttp(req,env,{authorize:async()=>{throw Object.assign(Error(),{status:401});}});
    assert.equal(denied.status,401);
    const review=await treasuryConnectionHttp(req,{...env,NUMINA_REVIEW_SESSION:true},{authorize:async()=> 'owner'});
    assert.equal(review.status,403);
    const allowed=await treasuryConnectionHttp(req,env,{authorize:async()=> 'owner'});
    assert.equal(allowed.status,200);
    const value=await allowed.json();
    if(name==='bank-route'){assert.equal(value.configurationStatus,'not_configured');assert.equal(value.achSubmissionEnabled,false);}
    else assert.deepEqual(value.settlementRecords,[]);
  }
});
test('primary submission endpoint rejects caller settlement assertions and cross-origin posts',async()=>{
  const url='https://numinalabs.xyz/api/treasury/v1/submissions',env={NUMINA_CONTROL_OWNER:'owner'},opts={authorize:async()=> 'owner'};
  assert.equal((await treasuryConnectionHttp(new Request(url,{method:'POST',headers:{origin:'https://attacker.invalid'}}),env,opts)).status,403);
  const r=await treasuryConnectionHttp(new Request(url,{method:'POST',headers:{origin:'https://numinalabs.xyz'},body:JSON.stringify({settled:true})}),env,opts);
  assert.equal(r.status,503);const body=await r.json();assert.equal(body.settled,false);assert.equal(body.receipt,null);
});
