import test from 'node:test';
import assert from 'node:assert/strict';
import {treasurySubmissionHttp} from '../src/treasury-submission.js';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};}
test('private owner instructions never become settlement records',async()=>{
  const res=response();await treasurySubmissionHttp({method:'GET',headers:{}},res,{authorize:async()=>{}});
  assert.equal(res.statusCode,200);assert.deepEqual(res.body.settlementRecords,[]);
  assert.equal(res.body.requests.length,2);
  for(const r of res.body.requests){assert.equal(r.amount,'500000000000000');assert.equal(r.status,'BLOCKED_NOT_SUBMITTED');assert.equal(r.submissionPerformed,false);assert.equal(r.settled,false);assert.equal(r.receipt,null);}
});
test('submission boundary cannot turn supplied claims into receipts',async()=>{
  const res=response();await treasurySubmissionHttp({method:'POST',headers:{authorization:'test-only'},body:{status:'SETTLED',receipt:{fake:true}}},res,{authorize:async()=>{}});
  assert.equal(res.statusCode,503);assert.equal(res.body.submissionPerformed,false);assert.equal(res.body.settled,false);assert.equal(res.body.receipt,null);
});
test('authentication, CSRF and methods fail closed',async()=>{
  for(const [req,expected] of [[{method:'GET',headers:{}},401],[{method:'POST',headers:{origin:'https://attacker.invalid'}},403],[{method:'DELETE',headers:{}},405]]){
    const res=response();await treasurySubmissionHttp(req,res,{authorize:async()=>{throw Object.assign(Error('bad'),{status:401});}});assert.equal(res.statusCode,expected);
  }
});
