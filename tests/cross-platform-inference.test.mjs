import test from "node:test";
import assert from "node:assert/strict";
import {CONTRACT_VERSION,validateInferenceRequest,dispatchInference} from "../../ml/inference/cross_platform_contract.mjs";
const base={contract_version:CONTRACT_VERSION,surface:"web",modality:"text",request_id:"request_123",prompt:"Hello"};
test("all supported client surfaces share one contract",()=>{
 for(const surface of ["web","ios","android","desktop","api","agent","multimodal"]) assert.equal(validateInferenceRequest({...base,surface}).surface,surface);
});
test("rejects client asserted identity and unsupported versions",()=>{
 for(const key of ["tenant_id","user_id","role","x-authenticated-user","authorization"]) assert.throws(()=>validateInferenceRequest({...base,[key]:"admin"}),/client asserted/);
 assert.throws(()=>validateInferenceRequest({...base,contract_version:"v0"}),/unsupported/);
});
test("requires verified identity and authorization before model invocation",async()=>{
 let invoked=0;
 const infer=async()=>{invoked++;return {text:"generated",model_sha256:"a".repeat(64)}};
 const receipt=async()=>({receipt_id:"receipt_1"});
 await assert.rejects(dispatchInference(base,{principal:{subject:"s",tenant:"t",verified:false},authorize:async()=>true,infer,receipt}),/verified/);
 await assert.rejects(dispatchInference(base,{principal:{subject:"s",tenant:"t",verified:true},authorize:async()=>false,infer,receipt}),/authorized/);
 assert.equal(invoked,0);
 const result=await dispatchInference(base,{principal:{subject:"s",tenant:"t",verified:true},authorize:async()=>true,infer,receipt});
 assert.equal(result.text,"generated");assert.equal(result.receipt_id,"receipt_1");assert.equal(invoked,1);
});
test("rejects inference output without checkpoint digest or evidence receipt",async()=>{
 const principal={subject:"s",tenant:"t",verified:true},authorize=async()=>true;
 await assert.rejects(dispatchInference(base,{principal,authorize,infer:async()=>({text:"mock"}),receipt:async()=>({receipt_id:"r"})}),/checkpoint/);
 await assert.rejects(dispatchInference(base,{principal,authorize,infer:async()=>({text:"mock",model_sha256:"b".repeat(64)}),receipt:async()=>({})}),/receipt required/);
});
