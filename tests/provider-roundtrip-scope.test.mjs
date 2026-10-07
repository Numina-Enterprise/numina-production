import test from 'node:test';
import assert from 'node:assert/strict';
import {openAIResponsesRoundTrip,openAIChatRoundTrip} from '../integrations/numina/examples/provider-roundtrips.mjs';

test('Responses release example exposes and executes only the selected discovery tool',async()=>{
 const requests=[],executed=[];
 const provider={responses:{create:async request=>{
  requests.push(request);
  return requests.length===1
   ?{id:'response-1',output:[{type:'function_call',call_id:'call-1',name:'numina_application_release',arguments:'{}'}]}
   :{id:'response-2',output:[]};
 }}};
 await openAIResponsesRoundTrip({provider,numina:{callTool:async name=>{executed.push(name);return {version:'4.0.0'};}},model:'fixture-model',input:'Read the release',toolNames:['numina_application_release']});
 assert.deepEqual(requests.map(request=>request.tools.map(tool=>tool.name)),[['numina_application_release'],['numina_application_release']]);
 assert.deepEqual(executed,['numina_application_release']);
});

test('Chat example rejects a call to a tool absent from its selected menu',async()=>{
 let executed=0;
 const provider={chat:{completions:{create:async()=>({choices:[{message:{role:'assistant',tool_calls:[{id:'call-1',type:'function',function:{name:'numina_nusd_network',arguments:'{}'}}]}}]})}}};
 await assert.rejects(openAIChatRoundTrip({provider,numina:{callTool:async()=>{executed++;}},model:'fixture-model',messages:[{role:'user',content:'Read the release'}],toolNames:['numina_application_release']}),/TOOL_NOT_ALLOWED/);
 assert.equal(executed,0);
});
