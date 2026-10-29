import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {nimEndpoint,nvidiaNimRoundTrip} from './nvidia-nim.mjs';

// A fresh observation of this endpoint/model only. Never edits a provider policy,
// signs evidence, or interprets a Numina build signature as an NVIDIA license.
export async function verifyNvidiaNim({endpoint,model,apiKey,fetchImpl=globalThis.fetch,numinaFetch=globalThis.fetch}){
 const base=nimEndpoint(endpoint);
 if(typeof model!=='string'||!model.trim()||model.length>256||/[\u0000-\u001f]/.test(model))throw Error('NVIDIA_NIM_MODEL_REQUIRED');
 const record={schema:'numina.nvidia.endpoint-observation.v1',observedAt:new Date().toISOString(),endpoint:base,model:model.trim(),checks:[],providerConnectivityVerified:false,modelToolRoundTripVerified:false,publicMultiUserEntitlementVerified:false,publicServiceReady:false,scope:'Endpoint observation; no registry authentication, hardware fleet, NVIDIA license, treasury or financial execution claim.'};
 async function request(path,body){
  let response;
  try{response=await fetchImpl(base+path,{method:body?'POST':'GET',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(apiKey?{Authorization:'Bearer '+apiKey}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{throw Error('NIM_CONNECTION_FAILED');}
  if(!response.ok)throw Error('NIM_HTTP_'+response.status);
  const reader=response.body?.getReader();let size=0;const chunks=[];
  if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576){await reader.cancel();throw Error('NIM_RESPONSE_TOO_LARGE');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const text=Buffer.concat(chunks).toString('utf8');
  if(path.startsWith('/health/'))return {httpStatus:response.status};
  try{return JSON.parse(text);}catch{throw Error('NIM_RESPONSE_INVALID');}
 }
 async function check(name,run){try{const detail=await run();record.checks.push({name,status:'passed',...detail});return true;}catch(error){const code=/^NIM_[A-Z0-9_]+$/.test(error.message)?error.message:'NIM_VALIDATION_FAILED';record.checks.push({name,status:'failed',error:code});return false;}}
 const live=await check('live',()=>request('/health/live'));
 const ready=await check('ready',()=>request('/health/ready'));
 const models=await check('model-listed',async()=>{const data=await request('/models');if(!Array.isArray(data?.data)||!data.data.some(item=>item.id===record.model))throw Error('NIM_MODEL_NOT_LISTED');return {model:record.model};});
 record.providerConnectivityVerified=live&&ready&&models;
 if(record.providerConnectivityVerified){
  record.modelToolRoundTripVerified=await check('numina-discovery-round-trip',async()=>{
   let requests=0,toolResultCount=0;
   const response=await nvidiaNimRoundTrip({endpoint:base,model:record.model,messages:[{role:'user',content:'Call numina_application_release to read the current Numina release, then summarize the returned version.'}],maxTokens:256,numinaFetch,
    createProvider:()=>({chat:{completions:{create:async body=>{
     requests++;
     if(requests===2){const results=body.messages.filter(item=>item.role==='tool');if(results.length!==1)throw Error('NIM_TOOL_RESULT_INVALID');let result;try{result=JSON.parse(results[0].content);}catch{throw Error('NIM_TOOL_RESULT_INVALID');}if(result?.error||result?.execution_succeeded===false)throw Error('NIM_TOOL_RESULT_FAILED');toolResultCount=results.length;}
     const data=await request('/chat/completions',requests===1?{...body,tool_choice:{type:'function',function:{name:'numina_application_release'}}}:body);
     if(data?.model!==record.model)throw Error('NIM_RESPONSE_MODEL_MISMATCH');
     if(requests===1){const calls=data?.choices?.[0]?.message?.tool_calls;if(!Array.isArray(calls)||calls.length!==1||calls[0]?.function?.name!=='numina_application_release')throw Error('NIM_TOOL_CALL_MISSING');}
     return data;
    }}}})});
   const message=response?.choices?.[0]?.message;
   if(requests!==2||toolResultCount!==1||message?.tool_calls?.length||typeof message?.content!=='string'||!message.content.trim())throw Error('NIM_FINAL_RESPONSE_MISSING');
   return {modelRequests:requests,discoveryToolResults:toolResultCount};
  });
 }else record.checks.push({name:'numina-discovery-round-trip',status:'skipped',reason:'Endpoint readiness and model identity required'});
 return record;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const output=process.argv[2];if(!output)throw Error('Usage: node verify-nvidia-nim.mjs OUTPUT.json (NUMINA_NIM_BASE_URL and NUMINA_NIM_MODEL required)');
  const record=await verifyNvidiaNim({endpoint:process.env.NUMINA_NIM_BASE_URL,model:process.env.NUMINA_NIM_MODEL,apiKey:process.env.NVIDIA_API_KEY});
  writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({output,providerConnectivityVerified:record.providerConnectivityVerified,modelToolRoundTripVerified:record.modelToolRoundTripVerified,publicServiceReady:false}));
  process.exitCode=record.providerConnectivityVerified&&record.modelToolRoundTripVerified?0:1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
