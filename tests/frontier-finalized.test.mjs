import test from 'node:test';
import assert from 'node:assert/strict';
import {frontierHttp} from '../src/frontier-http.js';

const env={NUMINA_LIVEMODE:'true'};

test('public frontier head is a deterministic finalized-build projection',async()=>{
  const res=await frontierHttp(new Request('https://numina.test/api/control/v2/head'),env);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.schema,'numina.public-head.v2');
  assert.equal(body.identity,'NUMINA');
  assert.equal(Object.hasOwn(body,'stateModel'),false);
  assert.equal(Object.hasOwn(body,'stateful'),false);
  assert.equal(body.finalized,true);
  assert.equal(body.applicationVersion,'4.0.0');
  assert.equal(body.revision,null);
  assert.equal(body.eventCount,null);
  assert.equal(body.journalContinuity,null);
  assert.match(body.head,/^[a-f0-9]{64}$/);
  assert.equal(body.head,body.manifestHash);
});

test('public MCP discovery initializes without a database binding',async()=>{
  const req=new Request('https://numina.test/api/control/v2/discovery-mcp',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}})
  });
  const res=await frontierHttp(req,env);
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.result.protocolVersion,'2025-11-25');
  assert.equal(body.result.serverInfo.name,'numina-discovery');
  assert.equal(body.result.serverInfo.version,'4.0.0');
});

test('public MCP numina_head returns the finalized build head',async()=>{
  const req=new Request('https://numina.test/api/control/v2/discovery-mcp',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'numina_head',arguments:{}}})
  });
  const res=await frontierHttp(req,env);
  assert.equal(res.status,200);
  const body=await res.json();
  const head=JSON.parse(body.result.content[0].text);
  assert.equal(head.schema,'numina.public-head.v2');
  assert.equal(Object.hasOwn(head,'stateModel'),false);
  assert.equal(Object.hasOwn(head,'stateful'),false);
  assert.equal(head.finalized,true);
});
