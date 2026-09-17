import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {observeProvider,ARC_TESTNET_CHAIN_ID}=require('../runtime/vercel-production/lib/provider-observations.js');
const {project}=require('../runtime/vercel-production/lib/numina-projection.js');
const fixedNow=()=>new Date('2026-09-16T07:00:00.000Z');

function response(status,value){return {status,text:async()=>JSON.stringify(value)};}

test('Circle observation validates public ping without credentials',async()=>{
  const calls=[];
  const fetchFn=async(url,options)=>{calls.push({url,options});return response(200,{message:'pong'});};
  const observation=await observeProvider('circle',{fetchFn,now:fixedNow});
  assert.equal(observation.schema,'numina.provider-observation.v1');
  assert.equal(observation.provider,'circle');
  assert.equal(observation.healthy,true);
  assert.equal(observation.credentialed,false);
  assert.equal(observation.partnership_status,undefined);
  assert.equal(observation.external_execution_performed,false);
  assert.equal(observation.observed.message,'pong');
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,'GET');
});

test('Arc observation validates chain id and latest block using read-only RPC',async()=>{
  const methods=[];
  const fetchFn=async(_url,options)=>{
    const body=JSON.parse(options.body);methods.push(body.method);
    if(body.method==='eth_chainId')return response(200,{jsonrpc:'2.0',id:body.id,result:'0x4cef52'});
    if(body.method==='eth_blockNumber')return response(200,{jsonrpc:'2.0',id:body.id,result:'0x1234'});
    throw new Error('unexpected method');
  };
  const observation=await observeProvider('arc',{fetchFn,now:fixedNow});
  assert.equal(observation.provider,'arc');
  assert.equal(observation.healthy,true);
  assert.equal(observation.observed.chain_id,ARC_TESTNET_CHAIN_ID);
  assert.equal(observation.observed.latest_block,0x1234);
  assert.deepEqual(methods,['eth_chainId','eth_blockNumber']);
  assert.equal(observation.partnership_status,undefined);
  assert.equal(observation.external_execution_performed,false);
});

test('Arc observation fails closed on the wrong chain',async()=>{
  const fetchFn=async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.method==='eth_chainId')return response(200,{jsonrpc:'2.0',id:body.id,result:'0x1'});
    return response(200,{jsonrpc:'2.0',id:body.id,result:'0x10'});
  };
  const observation=await observeProvider('arc',{fetchFn,now:fixedNow});
  assert.equal(observation.healthy,false);
  assert.equal(observation.observed.chain_id,1);
});

test('provider observation set schema keeps one aggregate partnership assertion inside the signed projection payload',()=>{
  const inner={
    schema:'numina.provider-observation-set.v1',
    release:'1.9.0-rc26',
    mode:'public-read-only-health',
    providers:['arc','circle'],
    credentialed:false,
    partnership_status:'asserted',
    external_execution_performed:false
  };
  const projection=project('provider-observations',inner);
  assert.equal(projection.surface,'provider-observations');
  assert.equal(projection.schema,undefined);
  assert.equal(projection.payload.schema,'numina.provider-observation-set.v1');
  assert.deepEqual(projection.payload.providers,['arc','circle']);
  assert.equal(projection.payload.credentialed,false);
  assert.equal(projection.payload.partnership_status,'asserted');
  assert.equal(projection.payload.external_execution_performed,false);
});

test('unsupported providers cannot be treated as read-only health adapters',async()=>{
  await assert.rejects(()=>observeProvider('custom',{fetchFn:async()=>response(200,{})}),/READ_ONLY_PROVIDER_OBSERVATION_UNSUPPORTED/);
});
