#!/usr/bin/env node
import {NuminaClient,NuminaError} from '../src/client.js';
import {runStdio} from '../src/mcp.js';
try{
  const client=new NuminaClient({baseUrl:process.env.NUMINA_BASE_URL,token:process.env.NUMINA_API_TOKEN,expectedAssetId:process.env.NUMINA_NUSD_ASSET_ID});
  if(!await runStdio(client,{profile:process.env.NUMINA_TOOL_PROFILE??'discovery'}))process.exitCode=2;
}catch(e){
  process.stderr.write((e instanceof NuminaError?e.code:'MCP_START_FAILED')+'\n');
  process.exitCode=1;
}
