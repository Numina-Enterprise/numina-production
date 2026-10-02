import test from 'node:test';
import assert from 'node:assert/strict';
import {treasurySubmissionHttp} from '../src/treasury-submission.js';
import {STRIPE_TREASURY_FINANCIAL_ACCOUNT} from '../src/stripe-treasury.js';
import {stable} from '../src/control.js';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=JSON.parse(body);}};}
test('private owner instructions never become settlement records',async()=>{
  const res=response();await treasurySubmissionHttp({method:'GET',headers:{}},res,{authorize:async()=>{}});
  assert.equal(res.statusCode,200);assert.deepEqual(res.body.settlementRecords,[]);
  assert.equal(res.body.requests.length,2);
  for(const r of res.body.requests){assert.equal(r.amount,'500000000000000');assert.equal(r.status,'BLOCKED_NOT_SUBMITTED');assert.equal(r.submissionPerformed,false);assert.equal(r.settled,false);assert.equal(r.receipt,null);}
});
test('submission boundary cannot turn supplied claims into receipts',async()=>{
  const res=response();await treasurySubmissionHttp({method:'POST',headers:{authorization:'test-only'},body:{status:'SETTLED',receipt:{fake:true}}},res,{authorize:async()=>{}});
  assert.equal(res.statusCode,400);assert.equal(res.body.submissionPerformed,false);assert.equal(res.body.settled,false);assert.equal(res.body.receipt,null);
});
test('authentication, CSRF and methods fail closed',async()=>{
  for(const [req,expected] of [[{method:'GET',headers:{}},401],[{method:'POST',headers:{origin:'https://attacker.invalid'}},403],[{method:'DELETE',headers:{}},405]]){
    const res=response();await treasurySubmissionHttp(req,res,{authorize:async()=>{throw Object.assign(Error('bad'),{status:401});}});assert.equal(res.statusCode,expected);
  }
});
test('legacy funding forwarding uses the canonical Worker and preserves one authority/store',async()=>{
  const intent={source:{currency:'NUSD',amount:'10'},settlement:{currency:'USD',amount:'10.00'},financialAccount:STRIPE_TREASURY_FINANCIAL_ACCOUNT};
  const payload={action:'prepare_external_funding',idempotencyKey:'offline-forward-key-1',intent};payload.authorization={...payload,confirmed:true};
  let calls=0;const res=response();
  await treasurySubmissionHttp({method:'POST',url:'/api/status?mode=treasury-submissions',headers:{origin:'https://numinalabs.xyz',cookie:'fixture'},body:payload},res,{authorize:async()=>{},fetcher:async(url,options)=>{
    calls++;assert.equal(url,'https://personal-space-m7q9.skott34.chatgpt.site/api/treasury/v1/submissions');assert.equal(options.headers.origin,'https://personal-space-m7q9.skott34.chatgpt.site');
    assert.equal(options.body,stable(payload));assert.equal(options.headers.cookie,'fixture');return Response.json({record:{submissionPerformed:false,settled:false}},{status:201});
  }});assert.equal(calls,1);assert.equal(res.statusCode,201);assert.equal(res.body.record.submissionPerformed,false);
});
