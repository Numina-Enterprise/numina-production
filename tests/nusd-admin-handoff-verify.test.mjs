import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Interface,AbiCoder,ZeroAddress,getAddress} from '../runtime/nusd/node_modules/ethers/lib.esm/index.js';
import {verifyAdminHandoff,BASELINE_EXPECTED,ROLE_IDS,TOKEN_ABI,NUSD_TOKEN_ADDRESS,normalizeExpected} from '../runtime/nusd/scripts/verify-admin-handoff.mjs';
import {verifySafeFactory,SAFE_CONTRACTS,SAFE_ABI} from '../runtime/nusd/scripts/verify-safe-factory.mjs';
import {createReadOnlyRpc,READ_ONLY_METHODS} from '../runtime/nusd/scripts/read-only-rpc.mjs';

const scripts=fileURLToPath(new URL('../runtime/nusd/scripts/',import.meta.url));
const ADMIN='0xa7e9FB02495700ccE0d209392C0A30FbE077498e',ISSUER='0xdfEb99a8CbB9d2536EB9CA3D4D38DC5f4D1dE1a0',
  MINTER='0x62dC06f05aF1b9aBA65d7ee4DBaB067249FC5DA6',PAUSER='0x434AB24E613055Fd2598Fd9f0558A06a94D39c81';
const TIMELOCK='0x00000000000000000000000000000000000000A1';
const SAFE='0x00000000000000000000000000000000000000B2';
const OWNERS=[1,2,3,4,5,6].map(n=>getAddress('0x'+n.toString(16).padStart(40,'c')));
const SUPPLY=1500000000000000000000000000000000n;

/** In-memory chain state answering only the read-only methods the scripts may use. */
function chainState(overrides={}){
  return {chainId:962421430n,code:{[NUSD_TOKEN_ADDRESS.toLowerCase()]:'0x6080',[SAFE.toLowerCase()]:'0x6080',
      ...Object.fromEntries(Object.values(SAFE_CONTRACTS).map(a=>[a.toLowerCase(),'0x60806040']))},
    decimals:18n,totalSupply:SUPPLY,cap:SUPPLY,paused:true,defaultAdmin:ADMIN,pending:[ZeroAddress,0n],delay:86400n,
    roles:{DEFAULT_ADMIN_ROLE:[ADMIN],ISSUER_ROLE:[ISSUER],MINTER_ROLE:[MINTER],PAUSER_ROLE:[PAUSER]},
    safeOwners:OWNERS,safeThreshold:3n,calls:[],...overrides};
}
function answer(state,method,params){
  state.calls.push(method);
  if(method==='eth_chainId')return '0x'+state.chainId.toString(16);
  if(method==='eth_getCode')return state.code[params[0].toLowerCase()]||'0x';
  if(method!=='eth_call')throw Object.assign(new Error('method not allowed'),{rpc:-32601});
  const {to,data}=params[0];
  if(to.toLowerCase()===SAFE.toLowerCase()){
    const f=SAFE_ABI.parseTransaction({data});
    return SAFE_ABI.encodeFunctionResult(f.name,[f.name==='getOwners'?state.safeOwners:state.safeThreshold]);
  }
  const f=TOKEN_ABI.parseTransaction({data});
  const roleName=f.name==='hasRole'?Object.keys(ROLE_IDS).find(k=>ROLE_IDS[k]===f.args[0]):null;
  const values={decimals:[state.decimals],totalSupply:[state.totalSupply],cap:[state.cap],paused:[state.paused],defaultAdmin:[state.defaultAdmin],
    pendingDefaultAdmin:state.pending,defaultAdminDelay:[state.delay],
    hasRole:[roleName?state.roles[roleName].map(a=>a.toLowerCase()).includes(f.args[1].toLowerCase()):false]};
  return TOKEN_ABI.encodeFunctionResult(f.name,values[f.name]);
}
const direct=state=>async(method,params=[])=>answer(state,method,params);

async function server(t,state,{status=200,body=null}={}){
  const seen=[];
  const srv=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
    seen.push({authorization:req.headers.authorization||null});
    const msg=JSON.parse(raw);
    if(status!==200){res.writeHead(status,{'content-type':'application/json'});res.end(body||JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32001,message:'No Kaleido environment is available'}}));return;}
    let reply;try{reply={jsonrpc:'2.0',id:msg.id,result:answer(state,msg.method,msg.params)};}catch(e){reply={jsonrpc:'2.0',id:msg.id,error:{code:e.rpc||-32000,message:'x'}};}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(reply));
  });});
  await new Promise(r=>srv.listen(0,'127.0.0.1',r));t.after(()=>srv.close());
  return {url:`http://127.0.0.1:${srv.address().port}/rpc/secret-path-token`,seen};
}
function run(script,args,env){
  return new Promise(resolve=>execFile(process.execPath,[path.join(scripts,script),...args],
    {env:{PATH:process.env.PATH,...env},cwd:scripts},(error,stdout,stderr)=>resolve({code:error?error.code:0,stdout,stderr,json:(()=>{try{return JSON.parse(stdout);}catch{return null;}})()})));
}

test('read-only RPC client refuses every non-read method and non-HTTPS remote endpoints',async()=>{
  assert.deepEqual([...READ_ONLY_METHODS].sort(),['eth_blockNumber','eth_call','eth_chainId','eth_getCode']);
  const rpc=createReadOnlyRpc({endpoint:'https://example.invalid/',fetchImpl:async()=>{throw new Error('must not be called');}});
  for(const method of ['eth_sendTransaction','eth_sendRawTransaction','eth_sign','personal_sign','eth_accounts','eth_signTypedData_v4']){
    await assert.rejects(rpc(method,[]),e=>e.code==='configuration_error'&&e.reason==='rpc_method_not_read_only');
  }
  assert.throws(()=>createReadOnlyRpc({endpoint:'http://rpc.example.com/'}),e=>e.reason==='rpc_url_must_be_https');
  assert.throws(()=>createReadOnlyRpc({endpoint:undefined}),e=>e.reason==='rpc_url_missing');
  assert.throws(()=>createReadOnlyRpc({endpoint:'https://x.example/',authorization:'bad\nheader'}),e=>e.reason==='rpc_authorization_invalid');
});

test('baseline admin and role state matches the recorded deployment state',async()=>{
  const state=chainState(),result=await verifyAdminHandoff({rpc:direct(state)});
  assert.equal(result.ok,true,JSON.stringify(result.mismatches));assert.equal(result.readOnly,true);
  assert.equal(result.observed.decimals,18);assert.equal(result.observed.totalSupply,SUPPLY.toString());assert.equal(result.observed.cap,SUPPLY.toString());
  assert.equal(result.observed.defaultAdmin,ADMIN);assert.equal(result.observed.pendingDefaultAdmin,ZeroAddress);assert.equal(result.observed.defaultAdminDelay,'86400');
  assert.equal(result.observed.roles.ISSUER_ROLE[ISSUER],true);assert.equal(result.observed.roles.MINTER_ROLE[ISSUER],false);
  assert.ok(state.calls.every(m=>READ_ONLY_METHODS.includes(m)));
});

test('mismatches are reported field by field: pending transfer, extra grant, wrong decimals, missing token',async()=>{
  const state=chainState({pending:[TIMELOCK,1700000000n],decimals:6n});state.roles.MINTER_ROLE.push(PAUSER);
  const result=await verifyAdminHandoff({rpc:direct(state),expected:{roles:{...BASELINE_EXPECTED.roles,MINTER_ROLE:{[MINTER]:true,[PAUSER]:false}}}});
  assert.equal(result.ok,false);
  const fields=result.mismatches.map(m=>m.field);
  assert.ok(fields.includes('pendingDefaultAdmin'));assert.ok(fields.includes('decimals'));assert.ok(fields.includes(`roles.MINTER_ROLE.${PAUSER}`));
  assert.equal(result.observed.pendingDefaultAdminSchedule,'1700000000');
  const empty=chainState();delete empty.code[NUSD_TOKEN_ADDRESS.toLowerCase()];
  const missing=await verifyAdminHandoff({rpc:direct(empty)});
  assert.equal(missing.ok,false);assert.deepEqual(missing.mismatches.map(m=>m.field),['tokenCode']);
  const wrongChain=await verifyAdminHandoff({rpc:direct(chainState({chainId:8453n}))});
  assert.ok(wrongChain.mismatches.some(m=>m.field==='chainId'&&m.observed==='8453'));
});

test('post-handoff expectations from the record template pass only after revocation and timelock acceptance',async()=>{
  const template=JSON.parse(fs.readFileSync(new URL('../runtime/nusd/records/admin-handoff.template.json',import.meta.url),'utf8'));
  const record=structuredClone(template);record.expected.defaultAdmin=TIMELOCK;record.expected.roles.DEFAULT_ADMIN_ROLE[TIMELOCK]=true;
  assert.equal(normalizeExpected(record).defaultAdmin,getAddress(TIMELOCK));
  const before=await verifyAdminHandoff({rpc:direct(chainState()),expected:record});
  assert.equal(before.ok,false);
  const after=chainState({defaultAdmin:TIMELOCK,roles:{DEFAULT_ADMIN_ROLE:[TIMELOCK],ISSUER_ROLE:[],MINTER_ROLE:[],PAUSER_ROLE:[PAUSER]}});
  const result=await verifyAdminHandoff({rpc:direct(after),expected:record});
  assert.equal(result.ok,true,JSON.stringify(result.mismatches));
  assert.equal(result.observed.roles.DEFAULT_ADMIN_ROLE[ADMIN],false);assert.equal(result.observed.roles.PAUSER_ROLE[PAUSER],true);
  assert.throws(()=>normalizeExpected({roles:{UNKNOWN_ROLE:{}}}),e=>e.code==='configuration_error');
  assert.throws(()=>normalizeExpected({defaultAdmin:'not-an-address'}),e=>e.code==='configuration_error');
});

test('Safe factory check reports missing contracts and enforces a 3-of-6 Safe',async()=>{
  const ok=await verifySafeFactory({rpc:direct(chainState()),chain:'numina',safe:SAFE,expectedOwners:OWNERS});
  assert.equal(ok.ok,true,JSON.stringify(ok.mismatches));assert.equal(ok.safe.threshold,3);assert.equal(ok.safe.owners.length,6);
  assert.equal(ok.contracts.safeSingletonFactory.address,'0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7');
  const bare=chainState();delete bare.code[SAFE_CONTRACTS.safeSingletonFactory.toLowerCase()];
  const missing=await verifySafeFactory({rpc:direct(bare)});
  assert.equal(missing.ok,false);assert.deepEqual(missing.mismatches.map(m=>m.field),['code.safeSingletonFactory']);
  const weak=await verifySafeFactory({rpc:direct(chainState({safeThreshold:2n,safeOwners:OWNERS.slice(0,5)})),safe:SAFE});
  assert.deepEqual(weak.mismatches.map(m=>m.field).sort(),['safe.ownerCount','safe.threshold']);
  const base=await verifySafeFactory({rpc:direct(chainState()),chain:'base'});
  assert.ok(base.mismatches.some(m=>m.field==='chainId'&&m.expected==='8453'));
  const noSafe=await verifySafeFactory({rpc:direct(chainState()),safe:'0x00000000000000000000000000000000000000D4'});
  assert.ok(noSafe.mismatches.some(m=>m.field==='safe.code'));
});

test('CLIs print JSON, use the env RPC and optional authorization header, and never echo either',async t=>{
  const state=chainState(),{url,seen}=await server(t,state);
  const auth='Bearer test-only-header-value';
  const pass=await run('verify-admin-handoff.mjs',[],{NUMINA_RPC_URL:url,NUMINA_RPC_AUTHORIZATION:auth});
  assert.equal(pass.code,0,pass.stdout+pass.stderr);assert.equal(pass.json.ok,true);
  assert.ok(seen.length>0&&seen.every(s=>s.authorization===auth));
  for(const output of [pass.stdout,pass.stderr]){assert.ok(!output.includes('secret-path-token'));assert.ok(!output.includes('test-only-header-value'));}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nusd-handoff-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const expectedFile=path.join(dir,'expected.json');fs.writeFileSync(expectedFile,JSON.stringify({defaultAdmin:TIMELOCK}));
  const mismatch=await run('verify-admin-handoff.mjs',['--expected',expectedFile],{NUMINA_RPC_URL:url});
  assert.equal(mismatch.code,1);assert.equal(mismatch.json.ok,false);assert.ok(mismatch.json.mismatches.some(m=>m.field==='defaultAdmin'));
  const safe=await run('verify-safe-factory.mjs',['--chain','numina','--safe',SAFE,'--threshold','3','--owners','6'],{NUMINA_RPC_URL:url});
  assert.equal(safe.code,0,safe.stdout);assert.equal(safe.json.safe.threshold,3);
  const bad=await run('verify-safe-factory.mjs',['--chain','ethereum'],{NUMINA_RPC_URL:url});
  assert.equal(bad.code,3);assert.equal(bad.json.error,'configuration_error');
  const noUrl=await run('verify-admin-handoff.mjs',[],{});
  assert.equal(noUrl.code,3);assert.equal(noUrl.json.reason,'rpc_url_missing');
  assert.ok(state.calls.every(m=>READ_ONLY_METHODS.includes(m)));
});

test('an unavailable RPC (Kaleido 404 / -32001) yields a clean rpc_unavailable error and exit code 2',async t=>{
  const {url}=await server(t,chainState(),{status:404});
  for(const [script,env] of [['verify-admin-handoff.mjs',{NUMINA_RPC_URL:url}],['verify-safe-factory.mjs',{NUMINA_RPC_URL:url}]]){
    const result=await run(script,[],env);
    assert.equal(result.code,2,result.stdout);assert.equal(result.json.ok,false);assert.equal(result.json.error,'rpc_unavailable');assert.equal(result.json.reason,'http_404');
    assert.ok(!result.stdout.includes('secret-path-token'));assert.equal(result.stderr,'');
  }
  const closed=await run('verify-admin-handoff.mjs',[],{NUMINA_RPC_URL:'http://127.0.0.1:9/'});
  assert.equal(closed.code,2);assert.equal(closed.json.error,'rpc_unavailable');
});

test('runbooks state the required warnings and records hold no secrets',()=>{
  const handoff=fs.readFileSync(new URL('../docs/nusd/runbooks/nusd-admin-safe-handoff.md',import.meta.url),'utf8');
  const vault=fs.readFileSync(new URL('../docs/nusd/runbooks/nusd-base-vault-safe.md',import.meta.url),'utf8');
  for(const phrase of ['Never renounce admin','must be on the Numina chain (962421430), not Base','The owner signs every step',
    'revokeRole(ISSUER_ROLE','revokeRole(MINTER_ROLE','Do **not** revoke `PAUSER_ROLE`','172800','beginDefaultAdminTransfer(TIMELOCK)',
    'cancelDefaultAdminTransfer()','RoleGranted','RoleRevoked','DefaultAdminTransferScheduled','0x914d7Fec6aaC8cd542e72Bca78B30650d45643d7'])assert.ok(handoff.includes(phrase),phrase);
  for(const phrase of ['8453','**not deployed**','starts paused','There is no withdraw path','0x736BD8F274DCE00a8bB374EDd85DF0d2e631018e'])assert.ok(vault.includes(phrase),phrase);
  for(const name of ['safe-numina.template.json','safe-base.template.json','admin-handoff.template.json','README.md']){
    const text=fs.readFileSync(new URL('../runtime/nusd/records/'+name,import.meta.url),'utf8');
    assert.doesNotMatch(text,/https?:\/\/|kaleido\.io|privateKey|mnemonic|"authorization"/i,name);
    if(name.endsWith('.json'))JSON.parse(text);
  }
  const numina=JSON.parse(fs.readFileSync(new URL('../runtime/nusd/records/safe-numina.template.json',import.meta.url),'utf8'));
  const baseSafe=JSON.parse(fs.readFileSync(new URL('../runtime/nusd/records/safe-base.template.json',import.meta.url),'utf8'));
  assert.equal(numina.network.chainId,'962421430');assert.equal(baseSafe.network.chainId,'8453');
  assert.equal(numina.safe.threshold,3);assert.equal(numina.safe.owners.length,6);assert.equal(baseSafe.vault.deployed,false);
  for(const script of ['verify-admin-handoff.mjs','verify-safe-factory.mjs','read-only-rpc.mjs']){
    const source=fs.readFileSync(path.join(scripts,script),'utf8');
    assert.doesNotMatch(source,/https:\/\/[a-z0-9.-]+\.(?:kaleido|alchemy|infura|quiknode)|eth_sendTransaction'|eth_sendRawTransaction'|Wallet\(|privateKey/i,script);
  }
});
