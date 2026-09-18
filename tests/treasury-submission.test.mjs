import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
test('owner execution declaration is separate from provider or blockchain evidence',async()=>{
  const res=response();await treasurySubmissionHttp({method:'GET',headers:{}},res,{authorize:async()=>{}});
  const claim=res.body.ownerReportedExecution;
  assert.equal(claim.statement,'NUMINA EXECUTED');
  assert.equal(claim.evidenceType,'owner_statement');
  assert.equal(claim.status,'OWNER_REPORTED_EXECUTED_UNVERIFIED');
  assert.equal(claim.independentlyVerified,false);
  assert.equal(claim.providerReferenceSupplied,false);
  assert.equal(claim.transactionHashSupplied,false);
  assert.deepEqual(claim.appliesToRequestIds,res.body.requests.map(request=>request.id));
  assert.equal(res.body.updatedAt,claim.recordedAt);
  assert.ok(Number.isFinite(Date.parse(claim.recordedAt)));
  assert.equal(res.body.financialExecution,false);
  for(const request of res.body.requests){
    assert.equal(request.submissionPerformed,false);assert.equal(request.settled,false);
    assert.equal(request.providerReference,null);assert.equal(request.receipt,null);
  }
  const usdc=res.body.requests.find(request=>request.rail==='USDC');
  assert.equal(usdc.transactionHash,null);assert.equal(usdc.network,null);
  assert.deepEqual(res.body.settlementRecords,[]);
});
test('treasury page labels the execution claim without implying confirmed settlement',()=>{
  const page=readFileSync(new URL('../public/treasury.html',import.meta.url),'utf8');
  assert.match(page,/owner-reported execution—not independently verified settlement/);
  assert.match(page,/The NUMINA application has not submitted either transfer/);
  assert.match(page,/No ACH confirmation, USDC transaction hash or settlement receipt is recorded/);
});
test('authentication, CSRF and methods fail closed',async()=>{
  for(const [req,expected] of [[{method:'GET',headers:{}},401],[{method:'POST',headers:{origin:'https://attacker.invalid'}},403],[{method:'DELETE',headers:{}},405]]){
    const res=response();await treasurySubmissionHttp(req,res,{authorize:async()=>{throw Object.assign(Error('bad'),{status:401});}});assert.equal(res.statusCode,expected);
  }
});
