import {NuminaError,validateArguments} from './client.js';
import {toolsForProfile,openAIResponsesTools,openAIChatTools,anthropicTools,geminiInteractionsTools,geminiGenerateContentTools} from './tools.js';

const PROVIDERS=new Set(['openai-responses','openai-chat-completions','anthropic-messages','gemini-interactions','gemini-generate-content']);
const SAFE_ERRORS=new Set(['INVALID_ARGUMENTS','UNKNOWN_TOOL','SERVER_AUTH_REQUIRED','SERVER_AUTH_REJECTED','NUSD_ASSET_PIN_REQUIRED',
 'NUSD_NOT_VERIFIED','NUSD_ASSET_MISMATCH','CAPABILITY_UNAVAILABLE','REQUEST_TIMEOUT','CONNECTION_FAILED','SERVER_REQUEST_REJECTED',
 'INVALID_SERVER_RESPONSE','INVALID_SERVER_QUOTE','REQUEST_ID_MISMATCH','RESPONSE_TOO_LARGE','REDIRECT_REFUSED','RUNTIME_BUILD_UNAVAILABLE']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw new NuminaError(code);};
function profileTools(profile){try{return toolsForProfile(profile);}catch{fail('INVALID_TOOL_PROFILE');}}
function providerName(provider){if(!PROVIDERS.has(provider))fail('UNSUPPORTED_PROVIDER');}
export function providerTools(provider,{profile='discovery'}={}){
 providerName(provider);profileTools(profile);
 switch(provider){
  case 'openai-responses':return openAIResponsesTools({profile});
  case 'openai-chat-completions':return openAIChatTools({profile});
  case 'anthropic-messages':return anthropicTools({profile});
  case 'gemini-interactions':return geminiInteractionsTools({profile});
  case 'gemini-generate-content':return geminiGenerateContentTools({profile});
 }
}
function callIdentifier(id){if(typeof id!=='string'||!id.length||id.length>256||/[\u0000-\u0020\u007f]/.test(id))fail('INVALID_PROVIDER_CALL');return id;}
function parseArguments(value){
 if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>65536)fail('INVALID_PROVIDER_CALL');
 try{return JSON.parse(value);}catch{fail('INVALID_PROVIDER_CALL');}
}
function normalize(provider,call,profile){
 providerName(provider);const allowed=profileTools(profile);
 if(!object(call))fail('INVALID_PROVIDER_CALL');
 let id,name,input;
 if(provider==='openai-responses'){
  if(call.type!=='function_call')fail('INVALID_PROVIDER_CALL');
  id=callIdentifier(call.call_id);name=call.name;input=parseArguments(call.arguments);
 }else if(provider==='openai-chat-completions'){
  if(call.type!=='function'||!object(call.function))fail('INVALID_PROVIDER_CALL');
  id=callIdentifier(call.id);name=call.function.name;input=parseArguments(call.function.arguments);
 }else if(provider==='anthropic-messages'){
  if(call.type!=='tool_use')fail('INVALID_PROVIDER_CALL');
  id=callIdentifier(call.id);name=call.name;input=call.input;
 }else if(provider==='gemini-interactions'){
  if(call.type!=='function_call')fail('INVALID_PROVIDER_CALL');
  id=callIdentifier(call.id);name=call.name;input=call.arguments;
 }else{
  // Pass the FunctionCall object from a preserved model content part, not the
  // entire part: its sibling thoughtSignature must remain in conversation history.
  if(Object.hasOwn(call,'id'))id=callIdentifier(call.id);
  name=call.name;input=call.args??{};
 }
 if(typeof name!=='string'||!allowed.some(tool=>tool.name===name))fail('TOOL_NOT_ALLOWED');
 validateArguments(name,input);
 return {id,name,input:structuredClone(input)};
}
function format(provider,call,data,isError){
 const payload=isError?{error:{code:data},execution_succeeded:false}:data;
 const text=JSON.stringify(payload);
 switch(provider){
  case 'openai-responses':return {type:'function_call_output',call_id:call.id,output:text};
  case 'openai-chat-completions':return {role:'tool',tool_call_id:call.id,content:text};
  case 'anthropic-messages':return {type:'tool_result',tool_use_id:call.id,content:text,is_error:isError};
  case 'gemini-interactions':return {type:'function_result',name:call.name,call_id:call.id,result:[{type:'text',text}]};
  case 'gemini-generate-content':return {functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:payload}};
 }
}
async function execute(provider,call,client){
 try{return format(provider,call,await client.callTool(call.name,call.input),false);}
 catch(error){return format(provider,call,error instanceof NuminaError&&SAFE_ERRORS.has(error.code)?error.code:'TOOL_EXECUTION_FAILED',true);}
}
/** Convert and execute one host-authorized call; discovery is the default profile. */
export async function executeProviderCall(provider,call,client,{profile='discovery'}={}){
 if(!client||typeof client.callTool!=='function')fail('INVALID_CLIENT');
 return execute(provider,normalize(provider,call,profile),client);
}
/** Validate the entire bounded batch before executing anything, then retain order. */
export async function executeProviderCalls(provider,calls,client,{profile='discovery',maxCalls=8}={}){
 providerName(provider);profileTools(profile);
 if(!client||typeof client.callTool!=='function')fail('INVALID_CLIENT');
 if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>16||!Array.isArray(calls)||calls.length>maxCalls)fail('INVALID_PROVIDER_BATCH');
 const normalized=calls.map(call=>normalize(provider,call,profile));
 const ids=normalized.filter(call=>call.id!==undefined).map(call=>call.id);
 if(new Set(ids).size!==ids.length)fail('DUPLICATE_PROVIDER_CALL');
 const results=[];for(const call of normalized)results.push(await execute(provider,call,client));
 return results;
}
