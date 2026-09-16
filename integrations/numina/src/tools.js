const id={type:'string',minLength:1,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'};
const idempotency={type:'string',minLength:16,maxLength:128,pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$',description:'Unique operation identifier supplied by the application; reuse exactly for retries of the same request.'};
const schema=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const NUMINA_TOOLS=[
 {name:'numina_provider_routes',description:'Read owner-authenticated provider route observations from /api/control/v2/treasury/provider-routes. Preserve each provider currency, network, destination and incomplete-observation status. Results are server-reported; this tool does not independently verify provider acceptance, NUSD identity, funding or transfer readiness, and cannot submit deposits or change balances.',inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'numina_read_treasury',description:'Read the owner-authenticated canonical Numina-native NUSD treasury through readTreasury(). Requires the production application and its owner token. Preserve NUMINA authority, system of record and native model verification scope. This tool does not submit transfers or independently verify bank or chain receipts.',inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'numina_application_release',description:'Read the Numina application release manifest at /v4/release/manifest. Keep the application version, artifact identity and runtime dependencies distinct. The response is server-reported; this tool does not verify signatures, inspect artifact bytes, install software or activate financial capabilities.',inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'numina_runtime_build',description:'Read the application manifest\u2019s execution-runtime build record, source and builder revisions, artifact hashes, evidence links, financial-status source labels and any NUSD receipt/readiness records. All records are server-reported and not independently verified by this tool. It does not verify signatures or receipts, follow links, check live accounts, deploy a host, install a model plugin or establish reserves, transfers or settlement.',inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'numina_nusd_quote',description:'Ask the configured authenticated Numina server for a NUSD-denominated quote. Requires server-verified NUSD identity. No purchase, mint, payment, transfer or USD peg is implied.',inputSchema:schema({service_id:id,units:{type:'string',pattern:'^[1-9][0-9]{0,29}$',description:'Positive integer quantity as text, avoiding floating-point money.'},unit:{type:'string',minLength:1,maxLength:64},idempotency_key:idempotency}),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'numina_nusd_request',description:'Create an authenticated compute-to-value workflow request against a server quote. It records a request only; it does not approve work, claim payment, unlock a result, mint NUSD or transfer assets.',inputSchema:schema({quote_id:id,description:{type:'string',minLength:1,maxLength:4000},idempotency_key:idempotency}),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'numina_nusd_status',description:'Read public server-reported NUSD identity, capability and backing status without a token by passing null. A request ID instead requires server authentication for that caller’s private status. Server statements are not independent proof of reserves or a USD peg.',inputSchema:schema({request_id:{anyOf:[id,{type:'null'}]}}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'numina_nusd_network',description:'Read Numina network policy and NUSD asset identity reported by the public status service. Does not contact blockchain RPC or independently verify network, token, reserves, balances or settlement.',inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}},
 {name:'numina_service_catalog',description:'Read the public Numina service catalog and preserve its currency and request-only labels. USD amounts are cents; NUSD amounts can be null and are not a USD conversion. Does not open checkout, order, pay, unlock a result or activate a service.',inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}}
];
export function toolsForProfile(profile='discovery'){
 if(!['discovery','workflow'].includes(profile))throw new Error('INVALID_TOOL_PROFILE');
 return structuredClone(NUMINA_TOOLS.filter(t=>profile==='workflow'||t.annotations.readOnlyHint));
}
// Existing OpenAI exports retain the full workflow descriptor set by default.
// The distribution adapters and examples explicitly choose discovery unless opted in.
export function openAIChatTools({profile='workflow'}={}){return toolsForProfile(profile).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema,strict:true}}));}
export function openAIResponsesTools({profile='workflow'}={}){return toolsForProfile(profile).map(t=>({type:'function',name:t.name,description:t.description,parameters:t.inputSchema,strict:true}));}
export function anthropicTools({profile='discovery',strict=true}={}){
 if(typeof strict!=='boolean')throw new Error('INVALID_TOOL_PROFILE');
 return toolsForProfile(profile).map(t=>({name:t.name,description:t.description,input_schema:t.inputSchema,...(strict?{strict:true}:{})}));
}
export function geminiInteractionsTools({profile='discovery'}={}){
 return toolsForProfile(profile).map(t=>({type:'function',name:t.name,description:t.description,parameters:t.inputSchema}));
}
export function geminiGenerateContentTools({profile='discovery'}={}){
 return [{functionDeclarations:toolsForProfile(profile).map(t=>({name:t.name,description:t.description,parametersJsonSchema:t.inputSchema}))}];
}
