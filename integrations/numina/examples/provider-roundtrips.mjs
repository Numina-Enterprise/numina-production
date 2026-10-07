import {providerTools,executeProviderCalls} from '../src/provider-adapters.js';

// The caller supplies its own configured official SDK client and permitted model.
// These examples are inert until called. They perform one bounded discovery-tool
// round trip, never install SDKs, provision accounts or loop automatically.
function modelName(model){if(typeof model!=='string'||!model.trim())throw new Error('MODEL_REQUIRED');return model;}
function selectedTools(provider,toolNames){
 const available=providerTools(provider);
 if(toolNames===undefined)return available;
 if(!Array.isArray(toolNames)||!toolNames.length||new Set(toolNames).size!==toolNames.length)throw new Error('INVALID_TOOL_SELECTION');
 const selected=toolNames.map(name=>available.find(tool=>(tool.function?.name??tool.name)===name));
 if(selected.some(tool=>!tool))throw new Error('TOOL_NOT_ALLOWED');
 return selected;
}
export async function openAIResponsesRoundTrip({provider,numina,model,input,toolNames}){
 const tools=selectedTools('openai-responses',toolNames);
 const first=await provider.responses.create({model:modelName(model),input,tools});
 const calls=(first.output??[]).filter(item=>item.type==='function_call');
 if(!calls.length)return first;
 if(calls.some(call=>!tools.some(tool=>tool.name===call.name)))throw new Error('TOOL_NOT_ALLOWED');
 const results=await executeProviderCalls('openai-responses',calls,numina);
 return provider.responses.create({model,previous_response_id:first.id,tools,input:results});
}
export async function openAIChatRoundTrip({provider,numina,model,messages,toolNames}){
 const tools=selectedTools('openai-chat-completions',toolNames);
 const first=await provider.chat.completions.create({model:modelName(model),messages,tools});
 const assistant=first.choices?.[0]?.message;
 const calls=assistant?.tool_calls??[];
 if(!calls.length)return first;
 if(calls.some(call=>!tools.some(tool=>tool.function.name===call.function?.name)))throw new Error('TOOL_NOT_ALLOWED');
 const results=await executeProviderCalls('openai-chat-completions',calls,numina);
 return provider.chat.completions.create({model,tools,messages:[...messages,assistant,...results]});
}
export async function anthropicRoundTrip({provider,numina,model,messages,maxTokens=1024}){
 const tools=providerTools('anthropic-messages');
 const first=await provider.messages.create({model:modelName(model),messages,tools,max_tokens:maxTokens});
 if(first.stop_reason!=='tool_use')return first;
 const calls=(first.content??[]).filter(block=>block.type==='tool_use');
 if(!calls.length)return first;
 const results=await executeProviderCalls('anthropic-messages',calls,numina);
 return provider.messages.create({model,tools,max_tokens:maxTokens,
  messages:[...messages,{role:'assistant',content:first.content},{role:'user',content:results}]});
}
export async function geminiInteractionsRoundTrip({provider,numina,model,input}){
 const tools=providerTools('gemini-interactions');
 const first=await provider.interactions.create({model:modelName(model),input,tools});
 const calls=(first.steps??[]).filter(step=>step.type==='function_call');
 if(!calls.length)return first;
 const results=await executeProviderCalls('gemini-interactions',calls,numina);
 return provider.interactions.create({model,tools,previous_interaction_id:first.id,input:results});
}
export async function geminiGenerateContentRoundTrip({provider,numina,model,contents}){
 const tools=providerTools('gemini-generate-content');
 const first=await provider.models.generateContent({model:modelName(model),contents,config:{tools}});
 const modelContent=first.candidates?.[0]?.content;
 const calls=(modelContent?.parts??[]).filter(part=>part.functionCall).map(part=>part.functionCall);
 if(!calls.length)return first;
 const results=await executeProviderCalls('gemini-generate-content',calls,numina);
 // Preserve the full model content, including any thoughtSignature fields.
 return provider.models.generateContent({model,config:{tools},contents:[...contents,modelContent,{role:'user',parts:results}]});
}
