#!/usr/bin/env node
import {createInterface} from 'node:readline';
const token=process.env.NUMINA_API_TOKEN;
if(!token){process.stderr.write('NUMINA_API_TOKEN is required.\n');process.exitCode=1;}else{
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
    if(Buffer.byteLength(line)>16384){process.stderr.write('Request exceeds 16384 bytes.\n');break;}
    let m;try{m=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');continue;}
    try{const r=await fetch('https://numinalabs.xyz/api/control/v2/mcp',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:line});if(r.status===202)continue;if(!r.ok)throw Error('HTTP_'+r.status);const body=await r.text();if(body.length>524288)throw Error('RESPONSE_LIMIT');JSON.parse(body);process.stdout.write(body+'\n');}catch{if(Object.hasOwn(m,'id'))process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'Numina production request unavailable'}})+'\n');}
  }
}
