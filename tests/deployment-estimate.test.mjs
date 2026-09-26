import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ESTIMATE_PINS,observeDeploymentEstimate,validateDeploymentReview} from '../runtime/vercel-production/lib/deployment-estimate.mjs';
import {createEstimateHandler} from '../runtime/vercel-production/api/deployment-estimate.mjs';

test('final deployment observation is receipt-backed and exact',async()=>{
  const result=await observeDeploymentEstimate();
  assert.equal(result.httpStatus,200);
  const body=result.body;
  assert.equal(body.schema,'numina.deployment-estimate.v1');
  assert.equal(body.status,'FINAL');
  assert.equal(body.chainId,'962421430');
  assert.equal(body.decimals,18);
  assert.equal(body.amountNusd,'1500000000000000');
  assert.equal(body.initialSupplyBaseUnits,'1500000000000000000000000000000000');
  assert.equal(body.token.address,'0x491c1DF1b5CA77AF797f052c2310ca17039C931b');
  assert.equal(body.token.transactionHash,'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b');
  assert.equal(body.settlement.address,'0x7F9793d519464103e0c51EDcc5Ca6317c89af3A0');
  assert.equal(body.settlement.transactionHash,'0xe63dec1d443ccb15c87b3fb599bc868ef9b5919b6ef996ddb1c8aade4a6dba9b');
  assert.equal(body.finality.status,'FINAL');
  assert.equal(body.finality.requiredConfirmations,12);
  assert.equal(body.broadcast,true);
  assert.equal(body.minted,true);
  assert.equal(body.signed,true);
  assert.equal(body.productionReady,null);
  assert.equal(body.historicalRecord,true);
  assert.equal(body.currentChainStateVerified,false);
  assert.equal(body.networkChecked,false);
  assert.equal(body.networkIdentityVerified,null);
  assert.equal(body.signingControlVerified,null);
  assert.equal(body.historicalDeploymentChecks.productionReady,true);
  assert.equal(body.historicalDeploymentChecks.observedAt,body.observedAt);
  assert.equal(body.token.blockNumber,'51725');
  assert.equal(body.settlement.blockNumber,'51726');
  assert.equal(body.settlement.scope,'CONTRACT_DEPLOYMENT');
  assert.equal(body.settlement.financialSettlementVerified,false);
  assert.equal(body.reservesVerified,false);
  assert.equal(body.settlementVerified,false);
  assert.equal(body.externalSettlement.usd,false);
  assert.equal(body.externalSettlement.usdc,false);
  assert.equal(body.externalSettlement.reservesVerified,false);
  assert.equal(ESTIMATE_PINS.initialSupplyBaseUnits,body.initialSupplyBaseUnits);
  assert.equal(ESTIMATE_PINS.tokenAddress,body.token.address);
});

test('unsigned-review validation is retired after final deployment',()=>{
  assert.throws(()=>validateDeploymentReview(new Uint8Array([1])),{code:'DEPLOYMENT_ALREADY_FINAL'});
});

class ResponseMock extends EventEmitter{
  constructor(){super();this.headers={};this.statusCode=200;this.body='';this.writableFinished=false;}
  setHeader(name,value){this.headers[name.toLowerCase()]=String(value);}
  end(body){this.body=body??'';this.writableFinished=true;this.emit('finish');}
}
const request=(changes={})=>({method:'GET',url:'/api/deployment-estimate',headers:{},query:{},body:{},...changes});

test('HTTP endpoint serves final status on an empty GET without caller-selected input',async()=>{
  let calls=0;
  const observed={httpStatus:200,body:{schema:'numina.deployment-estimate.v1',status:'FINAL'}};
  const handler=createEstimateHandler({observe:async()=>{calls++;return observed;}});
  const res=new ResponseMock();
  await handler(request(),res);
  assert.equal(calls,1);
  assert.equal(res.statusCode,200);
  assert.deepEqual(JSON.parse(res.body),observed.body);
  for(const h of ['cache-control','cdn-cache-control','vercel-cdn-cache-control'])assert.equal(res.headers[h],'no-store');
});

test('caller input cannot select or alter the fixed read-only observation',async()=>{
  let calls=0;
  const observation={status:'FINAL',source:'pinned_record'};
  const handler=createEstimateHandler({observe:async(...args)=>{assert.deepEqual(args,[]);calls++;return {httpStatus:200,body:observation};}});
  for(const changes of [
    {url:'/api/deployment-estimate?method=eth_sendTransaction'},
    {body:{from:'0x'+'1'.repeat(40)}},
    {headers:{'content-length':'1'}},
    {headers:{'transfer-encoding':'chunked'}}
  ]){
    const res=new ResponseMock();
    await handler(request(changes),res);
    assert.equal(res.statusCode,200);
    assert.deepEqual(JSON.parse(res.body),observation);
  }
  assert.equal(calls,4);
  const rejected=new ResponseMock();
  await handler(request({method:'POST'}),rejected);
  assert.equal(rejected.statusCode,405);
  assert.equal(calls,4);
});
