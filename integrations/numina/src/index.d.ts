export interface ClientOptions {
  baseUrl: string;
  token?: string;
  expectedAssetId?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
export interface QuoteInput {service_id:string;units:string;unit:string;idempotency_key:string}
export interface RequestInput {quote_id:string;description:string;idempotency_key:string}
export interface StatusInput {request_id:string|null}
export interface ServerResult {
  source:'configured_numina_server';
  verification:'server_reported_not_independently_verified';
  client_capabilities:Array<'release'|'runtimeBuild'|'readTreasury'|'quote'|'request'|'status'|'network'|'catalog'>;
  asset_execution_available:false;
  data:Record<string,unknown>;
}
export class NuminaError extends Error {code:string;status?:number;constructor(code:string,status?:number)}
export class NuminaClient {
  constructor(options:ClientOptions);
  release(input?:Record<string,never>):Promise<ServerResult>;
  runtimeBuild(input?:Record<string,never>):Promise<ServerResult>;
  readTreasury(input?:Record<string,never>):Promise<ServerResult>;
  status(input?:StatusInput):Promise<ServerResult>;
  network(input?:Record<string,never>):Promise<ServerResult>;
  catalog(input?:Record<string,never>):Promise<ServerResult>;
  quote(input:QuoteInput):Promise<ServerResult>;
  request(input:RequestInput):Promise<ServerResult>;
  callTool(name:'numina_nusd_quote',input:QuoteInput):Promise<ServerResult>;
  callTool(name:'numina_nusd_request',input:RequestInput):Promise<ServerResult>;
  callTool(name:'numina_nusd_status',input:StatusInput):Promise<ServerResult>;
  callTool(name:'numina_read_treasury'|'numina_application_release'|'numina_runtime_build'|'numina_nusd_network'|'numina_service_catalog',input:Record<string,never>):Promise<ServerResult>;
}
export function validateArguments(name:string,input:unknown):unknown;
export const NUMINA_TOOLS:Array<{name:string;description:string;inputSchema:Record<string,unknown>;annotations:Record<string,boolean>}>;
export type ToolProfile='discovery'|'workflow';
export type ToolProvider='openai-responses'|'openai-chat-completions'|'anthropic-messages'|'gemini-interactions'|'gemini-generate-content';
export function toolsForProfile(profile?:ToolProfile):typeof NUMINA_TOOLS;
export function openAIChatTools(options?:{profile?:ToolProfile}):Array<Record<string,unknown>>;
export function openAIResponsesTools(options?:{profile?:ToolProfile}):Array<Record<string,unknown>>;
export function anthropicTools(options?:{profile?:ToolProfile;strict?:boolean}):Array<Record<string,unknown>>;
export function geminiInteractionsTools(options?:{profile?:ToolProfile}):Array<Record<string,unknown>>;
export function geminiGenerateContentTools(options?:{profile?:ToolProfile}):Array<Record<string,unknown>>;
export function providerTools(provider:ToolProvider,options?:{profile?:ToolProfile}):Array<Record<string,unknown>>;
export function executeProviderCall(provider:ToolProvider,call:unknown,client:NuminaClient,options?:{profile?:ToolProfile}):Promise<Record<string,unknown>>;
export function executeProviderCalls(provider:ToolProvider,calls:Array<unknown>,client:NuminaClient,options?:{profile?:ToolProfile;maxCalls?:number}):Promise<Array<Record<string,unknown>>>;
