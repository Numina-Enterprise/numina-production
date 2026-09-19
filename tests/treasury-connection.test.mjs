import test from 'node:test';
import assert from 'node:assert/strict';
import {NUMINA_TREASURY_CONNECTION as model,NUSD_OPERATOR_ACTIVATION} from '../public/treasury-connection-model.js';
import {readConnectedTreasury,verifiedUsdcRoutes} from '../public/treasury-connection.js';
import {readPrivateBankRoute} from '../src/bank-route-config.js';
import handler from '../api/status.js';
const routes={schema:'numina.treasury.provider-routes.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'Stripe',connection:'read_only',transfer_execution:false,submission_performed:false,receipt:null,canonical_treasury:model.nativeJournal,observed_at:'2026-09-18T00:00:00Z',routes:[{currency:'usdc',settlement_currency:'usdc',status:'active',provider_reported_active:true,network:'base',address:'0x'+'1'.repeat(40),memo:null}]};
test('one singular 1500T treasury has three additive 500T holdings and no provider funding claims',()=>{
 assert.equal(model.singular,true);assert.equal(model.balanceCount,1);
 assert.equal(model.aggregateModeledValue,'1500000000000000');
 assert.equal(model.modeledAllocationsAdditive,true);
 assert.ok(model.allocations.every(value=>value.amount==='500000000000000'));
 assert.ok(model.allocations.every(value=>value.providerBalanceVerified===false));assert.equal(model.externalBalancesAggregated,false);
 assert.equal(NUSD_OPERATOR_ACTIVATION.evidenceType,'owner_statement');assert.equal(NUSD_OPERATOR_ACTIVATION.paymentCompletionVerified,false);
});
test('provider route display preserves exact USDC destination and rejects invalid network/address',()=>{
 assert.equal(verifiedUsdcRoutes(routes)[0].address,routes.routes[0].address);
 for(const mutate of [r=>r.routes[0].network='bitcoin',r=>r.routes[0].address='0x1',r=>r.provider='unknown']){
  const changed=structuredClone(routes);mutate(changed);assert.throws(()=>verifiedUsdcRoutes(changed));
 }
 const other=structuredClone(routes);other.routes[0].currency='nusd';assert.deepEqual(verifiedUsdcRoutes(other),[]);
});
test('private reads stop on owner denial or failed native proof',async()=>{
 const calls=[];await assert.rejects(readConnectedTreasury({request:async(path)=>{calls.push(path);throw Object.assign(Error('Denied'),{status:401});}}));
 assert.deepEqual(calls,[model.nativeJournal]);
 await assert.rejects(readConnectedTreasury({request:async()=>({}),verify:async()=>false}));
});
test('failed providers do not invent balances and late owner denial clears the view',async()=>{
 const result=await readConnectedTreasury({verify:async()=>true,request:async path=>{if(path===model.nativeJournal)return {projection:null};throw Error('Unavailable');}});
 assert.equal(result.stripe,null);assert.equal(result.routes,null);assert.equal(result.bank,null);
 await assert.rejects(readConnectedTreasury({verify:async()=>true,request:async path=>{if(path===model.nativeJournal)return {};throw Object.assign(Error('Denied'),{status:403});}}),error=>error.status===403);
});
test('bank configuration requires authentication and returns only masked owner-provided data',async()=>{
 const env={NUMINA_BOFA_SAVINGS_ACCOUNT:'12345678901',NUMINA_BOFA_ACH_ROUTING_NUMBER:'021000021'};
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://personal-space-m7q9.skott34.chatgpt.site/api/control/v1/treasury');assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return Response.json({});};
 await assert.rejects(readPrivateBankRoute({headers:{}},{env,fetcher}),error=>error.status===401);assert.equal(calls,0);
 const result=await readPrivateBankRoute({headers:{cookie:'fixture'}},{env,fetcher,verify:async()=>true});
 assert.equal(result.accountLast4,'8901');assert.equal(result.ownershipVerified,false);assert.equal(result.ownerDeclaration.ownershipVerified,true);
 assert.equal(result.achSubmissionEnabled,false);assert.equal(result.providerBalance,null);assert.equal(result.receipt,null);
 assert.ok(!JSON.stringify(result).includes(env.NUMINA_BOFA_SAVINGS_ACCOUNT));assert.ok(!JSON.stringify(result).includes(env.NUMINA_BOFA_ACH_ROUTING_NUMBER));
 const short=await readPrivateBankRoute({headers:{cookie:'fixture'}},{env:{...env,NUMINA_BOFA_SAVINGS_ACCOUNT:'1234'},fetcher,verify:async()=>true});assert.equal(short.accountLast4,null);
 await assert.rejects(readPrivateBankRoute({headers:{cookie:'fixture'}},{env,fetcher,verify:async()=>false}),error=>error.status===503);
 await assert.rejects(readPrivateBankRoute({headers:{cookie:'fixture'}},{env,verify:async()=>true,fetcher:async()=>new Response(null,{status:302,headers:{Location:'https://example.test'}})}));
});
test('public model and activation API are GET-only; bank route denies anonymous reads',async()=>{
 for(const [mode,expected] of [['treasury-model',200],['nusd-activation',200],['bank-route',401]]){
  const response={setHeader(){},end(body){this.body=JSON.parse(body);}};
  await handler({url:'/api/status?mode='+mode,method:'GET',headers:{}},response);assert.equal(response.statusCode,expected);
  await handler({url:'/api/status?mode='+mode,method:'POST',headers:{}},response);assert.equal(response.statusCode,405);
 }
});
