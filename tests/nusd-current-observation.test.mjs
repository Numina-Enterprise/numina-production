import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Interface} from '../runtime/nusd/node_modules/ethers/lib.esm/index.js';
import {observeNusdCurrentState,createReadOnlyRpc,runCurrentObservation,NUSD_OBSERVATION_IDENTITY} from '../runtime/nusd/scripts/observe-current.mjs';

const abi=new Interface(['function decimals() view returns(uint8)','function totalSupply() view returns(uint256)','function cap() view returns(uint256)','function paused() view returns(bool)','function balanceOf(address) view returns(uint256)']);
const identity={chainId:'962421430',tokenAddress:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',recipient:'0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',genesisHash:'0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1'};
const block={number:'0xca20',hash:'0x'+'a'.repeat(64)};
const historicalSupply=1500000000000000n*10n**18n;
const fixedNow=()=>new Date('2026-10-09T15:30:00.000Z');
function syntheticRpc({paused=false,decimals=18n,supply=historicalSupply,balance=123n*10n**18n+1n,chain=identity.chainId,genesis=identity.genesisHash,code='0x6000',reorg=false}={}){
  const calls=[];
  const rpc=async(method,params=[])=>{
    calls.push({method,params:structuredClone(params)});
    if(method==='eth_chainId')return '0x'+BigInt(chain).toString(16);
    if(method==='eth_getBlockByNumber'){
      if(params[0]==='0x0')return {number:'0x0',hash:genesis};
      if(params[0]==='latest')return block;
      assert.equal(params[0],block.number);return {...block,...(reorg?{hash:'0x'+'b'.repeat(64)}:{})};
    }
    if(method==='eth_getCode'){assert.deepEqual(params,[identity.tokenAddress,block.number]);return code;}
    assert.equal(method,'eth_call','only read RPC methods are permitted');
    assert.equal(params[0].to,identity.tokenAddress);assert.equal(params[1],block.number);
    const call=abi.parseTransaction({data:params[0].data});
    if(call.name==='balanceOf')assert.equal(call.args[0],identity.recipient);
    const values={decimals,totalSupply:supply,cap:historicalSupply,paused,balanceOf:balance};
    return abi.encodeFunctionResult(call.name,[values[call.name]]);
  };
  return {rpc,calls};
}

test('current observer binds exact retained identity and reports both paused states at one block',async()=>{
  assert.equal(NUSD_OBSERVATION_IDENTITY.chainId,identity.chainId);
  assert.equal(NUSD_OBSERVATION_IDENTITY.tokenAddress,identity.tokenAddress);
  assert.equal(NUSD_OBSERVATION_IDENTITY.recipient,identity.recipient);
  for(const paused of [false,true]){
    const {rpc,calls}=syntheticRpc({paused}),result=await observeNusdCurrentState({rpc,now:fixedNow});
    assert.equal(result.schema,'numina.nusd.current-observation.v1');
    assert.equal(result.observedAt,'2026-10-09T15:30:00.000Z');
    assert.equal(result.chainId,identity.chainId);assert.equal(result.genesisHash,identity.genesisHash);
    assert.equal(result.token.address,identity.tokenAddress);assert.equal(result.recipient,identity.recipient);
    assert.equal(result.token.decimals,18);assert.equal(result.token.paused,paused);
    assert.equal(result.token.totalSupplyBaseUnits,historicalSupply.toString());
    assert.equal(result.token.totalSupplyNusd,'1500000000000000.0');
    assert.equal(result.token.recipientBalanceNusd,'123.000000000000000001');
    assert.equal(result.token.recipientBalanceBaseUnits,'123000000000000000001');
    assert.deepEqual(result.observedBlock,{number:BigInt(block.number).toString(),hash:block.hash});
    assert.equal(result.readOnly,true);assert.equal(result.writesPerformed,false);
    assert.equal(result.verification.consistentBlock,true);
    assert.equal(result.verification.bytecodeMatchesDeployment,null);
    assert.equal(result.externalSettlement.usd,null);assert.equal(result.externalSettlement.usdc,null);
    assert.ok(calls.every(call=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(call.method)));
  }
});

test('observer reports changed supply and holdings without requiring the historical mint balance',async()=>{
  const {rpc}=syntheticRpc({supply:historicalSupply-10n**18n,balance:0n});
  const result=await observeNusdCurrentState({rpc,now:fixedNow});
  assert.equal(result.token.totalSupplyNusd,'1499999999999999.0');
  assert.equal(result.token.recipientBalanceBaseUnits,'0');
  assert.equal(result.sourceIdentity.historicalIssuance.baseUnits,historicalSupply.toString());
  assert.equal(result.verification.historicalSupplyMatchesCurrent,false);
});

test('observer fails closed on wrong chain, genesis, six decimal token, absent code or block reorganization',async()=>{
  for(const [options,code]of [
    [{chain:'8453'},'NUSD_CHAIN_MISMATCH'],
    [{genesis:'0x'+'f'.repeat(64)},'NUSD_GENESIS_MISMATCH'],
    [{decimals:6n},'NUSD_SOURCE_PRECISION_MISMATCH'],
    [{code:'0x'},'NUSD_TOKEN_CODE_NOT_FOUND'],
    [{reorg:true},'NUSD_BLOCK_CHANGED']
  ]){
    const {rpc}=syntheticRpc(options);
    await assert.rejects(observeNusdCurrentState({rpc,now:fixedNow}),{message:code});
  }
});

test('read RPC transport rejects mutation methods and malformed envelopes before accepting results',async()=>{
  let fetches=0;
  const rpc=createReadOnlyRpc({endpoint:'https://rpc.example.test',authorization:'Basic synthetic',fetcher:async(_url,options)=>{
    fetches++;const body=JSON.parse(options.body);
    return Response.json({jsonrpc:'2.0',id:body.id+1,result:'0x1'});
  }});
  await assert.rejects(rpc('eth_sendRawTransaction',['0x00']),{message:'NUSD_RPC_WRITE_METHOD_FORBIDDEN'});
  assert.equal(fetches,0);
  await assert.rejects(rpc('eth_chainId'),{message:'NUSD_RPC_INVALID_ENVELOPE'});
});

test('configured app authorization only queries the pinned RPC and never bootstraps an admin credential',async()=>{
  const {rpc}=syntheticRpc(),requests=[],output=[];
  const fetcher=async(url,options)=>{
    requests.push({url,method:options.method,rpc:JSON.parse(options.body)});
    const body=JSON.parse(options.body);
    return Response.json({jsonrpc:'2.0',id:body.id,result:await rpc(body.method,body.params)});
  };
  const exitCode=await runCurrentObservation({args:[],env:{NUMINA_RPC_URL:'https://rpc.example.test',NUMINA_RPC_AUTHORIZATION:'Basic synthetic',NUMINA_KALEIDO_API_KEY:'must-not-be-used'},fetcher,now:fixedNow,writeOutput:value=>output.push(value)});
  assert.equal(exitCode,0);assert.equal(output.length,1);
  assert.equal(JSON.parse(output[0]).writesPerformed,false);
  assert.ok(requests.every(request=>request.url==='https://rpc.example.test/'&&request.method==='POST'));
  assert.ok(requests.every(request=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(request.rpc.method)));
  assert.doesNotMatch(output[0],/Basic synthetic|must-not-be-used|rpc\.example/);
});

test('missing RPC and legacy output arguments return explicit blockers without network or receipt writes',async()=>{
  for(const [args,env,reason]of [
    [[],{},'NUMINA_RPC_URL_REQUIRED'],
    [[],{NUMINA_RPC_URL:'https://rpc.example.test'},'NUMINA_RPC_APP_CREDENTIAL_REQUIRED'],
    [['deployment-verification.json'],{NUMINA_RPC_URL:'https://rpc.example.test',NUMINA_RPC_AUTHORIZATION:'Basic synthetic'},'NUSD_OBSERVATION_OUTPUT_PATH_DISABLED']
  ]){
    const output=[];
    const exitCode=await runCurrentObservation({args,env,fetcher:()=>{throw Error('network must not run');},writeOutput:value=>output.push(value)});
    assert.equal(exitCode,1);assert.equal(JSON.parse(output[0]).status,'BLOCKED');assert.equal(JSON.parse(output[0]).blocker,reason);
  }
  const receipt=new URL('../runtime/nusd/deployment-verification.json',import.meta.url),before=readFileSync(receipt);
  const legacy=fileURLToPath(new URL('../runtime/nusd/scripts/verify-production.mjs',import.meta.url));
  const run=spawnSync(process.execPath,[legacy,fileURLToPath(receipt)],{encoding:'utf8',env:{}});
  assert.equal(run.status,1);assert.equal(JSON.parse(run.stdout).blocker,'NUSD_OBSERVATION_OUTPUT_PATH_DISABLED');
  assert.deepEqual(readFileSync(receipt),before);
  assert.equal(run.stderr,'');
});


test('observation source identity stays bound to the retained eighteen decimal deployment receipt',()=>{
  const retained=JSON.parse(readFileSync(new URL('../runtime/nusd/deployment-receipt.json',import.meta.url),'utf8'));
  const source=NUSD_OBSERVATION_IDENTITY;
  assert.equal(source.chainId,retained.chainId);
  assert.equal(source.genesisHash,retained.genesisHash);
  assert.equal(source.tokenAddress,retained.token.address);
  assert.equal(source.recipient,retained.issuance.recipient);
  assert.equal(source.decimals,retained.issuance.decimals);
  assert.equal(source.deploymentTransactionHash,retained.token.transactionHash);
  assert.equal(source.historicalIssuance.baseUnits,retained.issuance.baseUnits);
  assert.equal(source.historicalIssuance.observedAt,retained.finality.observedAt);
});

test('unknown or malformed RPC state and a changed final chain cannot produce an observation',async()=>{
  for(const [mutation,reason]of [
    [(method,params)=>method==='eth_getBlockByNumber'&&params[0]==='latest'?null:undefined,'NUSD_RPC_RESPONSE_INVALID'],
    [(method,params)=>method==='eth_call'&&abi.parseTransaction({data:params[0].data}).name==='paused'?'0x'+2n.toString(16).padStart(64,'0'):undefined,'NUSD_RPC_RESPONSE_INVALID'],
    [(method,params)=>method==='eth_call'&&abi.parseTransaction({data:params[0].data}).name==='totalSupply'?'0x01':undefined,'NUSD_RPC_RESPONSE_INVALID']
  ]){
    const {rpc:base}=syntheticRpc();
    const rpc=async(method,params=[])=>{
      const changed=mutation(method,params);
      return changed===undefined?base(method,params):changed;
    };
    await assert.rejects(observeNusdCurrentState({rpc,now:fixedNow}),{message:reason});
  }
  const {rpc:base}=syntheticRpc();let chainReads=0;
  const rpc=async(method,params=[])=>method==='eth_chainId'&&++chainReads===2?'0x2105':base(method,params);
  await assert.rejects(observeNusdCurrentState({rpc,now:fixedNow}),{message:'NUSD_CHAIN_MISMATCH'});
});

test('verification workflow only uploads a current observation and cannot rewrite receipts or bootstrap credentials',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/verify-nusd-production.yml',import.meta.url),'utf8');
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/node scripts\/verify-production\.mjs > "\$RUNNER_TEMP\/nusd-current-observation\.json"/);
  assert.match(workflow,/actions\/upload-artifact@/);
  assert.doesNotMatch(workflow,/git\s+(?:add|commit|push)|deployment-verification\.json|NUMINA_KALEIDO_API_KEY|NUMINA_ISSUER_POLICY_HASH|contents:\s*write/);
});
