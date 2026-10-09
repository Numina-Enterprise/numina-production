import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Interface,formatUnits,keccak256} from 'ethers';
import {resolveRpcAuthorization} from './rpc-auth.mjs';

// Retained deployment identity, not a claim that the September state is current.
export const NUSD_OBSERVATION_IDENTITY=Object.freeze({
  chainId:'962421430',
  genesisHash:'0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1',
  tokenAddress:'0x491c1DF1b5CA77AF797f052c2310ca17039C931b',
  recipient:'0x1a45671AE2ee3E52264116151924FAAcb80Fc02E',
  decimals:18,
  deploymentReceipt:'runtime/nusd/deployment-receipt.json',
  deploymentTransactionHash:'0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b',
  historicalIssuance:Object.freeze({
    amountNusd:'1500000000000000',decimals:18,
    baseUnits:'1500000000000000000000000000000000',
    observedAt:'2026-09-18T15:35:24.884Z'
  })
});
const abi=new Interface(['function decimals() view returns(uint8)','function totalSupply() view returns(uint256)','function cap() view returns(uint256)','function paused() view returns(bool)','function balanceOf(address) view returns(uint256)']);
const READ_METHODS=new Set(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call']);
const SAFE_CODES=new Set([
  'NUMINA_RPC_URL_REQUIRED','NUMINA_RPC_APP_CREDENTIAL_REQUIRED','NUMINA_RPC_AUTHENTICATION_FAILED',
  'NUSD_OBSERVATION_OUTPUT_PATH_DISABLED','NUSD_RPC_URL_INVALID','NUSD_RPC_AUTHORIZATION_INVALID',
  'NUSD_RPC_WRITE_METHOD_FORBIDDEN','NUSD_RPC_HTTP_REJECTED','NUSD_RPC_INVALID_ENVELOPE',
  'NUSD_RPC_RESPONSE_INVALID','NUSD_CHAIN_MISMATCH','NUSD_GENESIS_MISMATCH',
  'NUSD_SOURCE_PRECISION_MISMATCH','NUSD_TOKEN_CODE_NOT_FOUND','NUSD_BLOCK_CHANGED',
  'NUSD_OBSERVATION_OPTIONS_INVALID','NUSD_READ_ONLY_OBSERVATION_FAILED'
]);
const fail=code=>{throw Error(code);};
function quantity(value){
  if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))fail('NUSD_RPC_RESPONSE_INVALID');
  return BigInt(value);
}
function hash(value){
  if(typeof value!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(value)||/^0x0{64}$/.test(value))fail('NUSD_RPC_RESPONSE_INVALID');
  return value.toLowerCase();
}
function block(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('NUSD_RPC_RESPONSE_INVALID');
  return {number:quantity(value.number),hash:hash(value.hash)};
}
function rpcEndpoint(value){
  let endpoint;
  try{endpoint=new URL(value);}catch{fail('NUSD_RPC_URL_INVALID');}
  if(typeof value!=='string'||value!==value.trim()||value.length>8192||endpoint.protocol!=='https:'||!endpoint.hostname||endpoint.username||endpoint.password||endpoint.hash)fail('NUSD_RPC_URL_INVALID');
  return endpoint.href;
}

/** A transport whitelist makes transaction, wallet and admin operations unavailable. */
export function createReadOnlyRpc({endpoint,authorization,fetcher=globalThis.fetch}={}){
  const url=rpcEndpoint(endpoint);
  if(typeof authorization!=='string'||!/^(?:Basic|Bearer) [\x21-\x7e]{1,8192}$/.test(authorization))fail('NUSD_RPC_AUTHORIZATION_INVALID');
  if(typeof fetcher!=='function')fail('NUSD_OBSERVATION_OPTIONS_INVALID');
  let rpcId=0;
  return async(method,params=[])=>{
    if(!READ_METHODS.has(method))fail('NUSD_RPC_WRITE_METHOD_FORBIDDEN');
    const id=++rpcId;
    const response=await fetcher(url,{
      method:'POST',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000),
      headers:{'content-type':'application/json',accept:'application/json',authorization},
      body:JSON.stringify({jsonrpc:'2.0',id,method,params})
    });
    const type=(response.headers.get('content-type')||'').toLowerCase();
    if(!response.ok||response.redirected||!/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(type))fail('NUSD_RPC_HTTP_REJECTED');
    let value;
    try{value=await response.json();}catch{fail('NUSD_RPC_INVALID_ENVELOPE');}
    if(!value||value.jsonrpc!=='2.0'||value.id!==id||Object.hasOwn(value,'error')||!Object.hasOwn(value,'result'))fail('NUSD_RPC_INVALID_ENVELOPE');
    return value.result;
  };
}

/** Pure injected observation: no environment, filesystem, signer or provider writes. */
export async function observeNusdCurrentState({rpc,now=()=>new Date()}={}){
  if(typeof rpc!=='function'||typeof now!=='function')fail('NUSD_OBSERVATION_OPTIONS_INVALID');
  const identity=NUSD_OBSERVATION_IDENTITY;
  const read=(method,params=[])=>{
    if(!READ_METHODS.has(method))fail('NUSD_RPC_WRITE_METHOD_FORBIDDEN');
    return rpc(method,params);
  };
  const chain=quantity(await read('eth_chainId')).toString();
  if(chain!==identity.chainId)fail('NUSD_CHAIN_MISMATCH');
  const genesis=block(await read('eth_getBlockByNumber',['0x0',false]));
  if(genesis.number!==0n||genesis.hash!==identity.genesisHash)fail('NUSD_GENESIS_MISMATCH');
  const observed=block(await read('eth_getBlockByNumber',['latest',false]));
  const blockTag='0x'+observed.number.toString(16);
  const code=await read('eth_getCode',[identity.tokenAddress,blockTag]);
  if(typeof code!=='string'||code.length>1024*1024||!/^0x(?:[0-9a-fA-F]{2})*$/.test(code))fail('NUSD_RPC_RESPONSE_INVALID');
  if(code==='0x')fail('NUSD_TOKEN_CODE_NOT_FOUND');
  async function uintCall(name,args=[]){
    const value=await read('eth_call',[{to:identity.tokenAddress,data:abi.encodeFunctionData(name,args)},blockTag]);
    if(typeof value!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(value))fail('NUSD_RPC_RESPONSE_INVALID');
    return BigInt(value);
  }
  const decimals=await uintCall('decimals');
  if(decimals!==BigInt(identity.decimals))fail('NUSD_SOURCE_PRECISION_MISMATCH');
  const supply=await uintCall('totalSupply');
  const cap=await uintCall('cap');
  const pauseValue=await uintCall('paused');
  if(pauseValue>1n)fail('NUSD_RPC_RESPONSE_INVALID');
  const balance=await uintCall('balanceOf',[identity.recipient]);
  const finalBlock=block(await read('eth_getBlockByNumber',[blockTag,false]));
  if(finalBlock.number!==observed.number||finalBlock.hash!==observed.hash)fail('NUSD_BLOCK_CHANGED');
  if(quantity(await read('eth_chainId')).toString()!==identity.chainId)fail('NUSD_CHAIN_MISMATCH');
  const observedAt=now();
  if(!(observedAt instanceof Date)||!Number.isFinite(observedAt.getTime()))fail('NUSD_OBSERVATION_OPTIONS_INVALID');
  return {
    schema:'numina.nusd.current-observation.v1',identity:'NUMINA',status:'OBSERVED',
    observedAt:observedAt.toISOString(),evidenceSource:'single_configured_rpc_provider',
    verificationScope:'provider_reported_current_chain_observation',readOnly:true,writesPerformed:false,
    chainId:chain,genesisHash:genesis.hash,recipient:identity.recipient,
    sourceIdentity:structuredClone(identity),
    observedBlock:{number:observed.number.toString(),hash:observed.hash},
    token:{address:identity.tokenAddress,decimals:Number(decimals),paused:pauseValue===1n,
      totalSupplyBaseUnits:supply.toString(),totalSupplyNusd:formatUnits(supply,Number(decimals)),
      capBaseUnits:cap.toString(),capNusd:formatUnits(cap,Number(decimals)),
      recipientBalanceBaseUnits:balance.toString(),recipientBalanceNusd:formatUnits(balance,Number(decimals)),
      runtimeCodeKeccak256:keccak256(code)},
    verification:{chain:true,genesis:true,tokenAddress:true,sourceDecimals:true,codePresent:true,
      consistentBlock:true,bytecodeMatchesDeployment:null,finalityAssessed:false,
      historicalSupplyMatchesCurrent:supply.toString()===identity.historicalIssuance.baseUnits,
      independentConsensusVerified:false,operationalReadinessAssessed:false},
    externalSettlement:{usd:null,usdc:null,bankReceipt:null,providerReceipt:null,reservesVerified:null}
  };
}

/** CLI adapter emits one observation or blocker to stdout and never writes a receipt. */
export async function runCurrentObservation({args=[],env=process.env,fetcher=globalThis.fetch,now=()=>new Date(),writeOutput=value=>console.log(value)}={}){
  try{
    if(!Array.isArray(args)||args.length)fail('NUSD_OBSERVATION_OUTPUT_PATH_DISABLED');
    if(!env.NUMINA_RPC_URL)fail('NUMINA_RPC_URL_REQUIRED');
    const endpoint=rpcEndpoint(env.NUMINA_RPC_URL);
    const directInputs=[env.NUMINA_RPC_AUTHORIZATION,env.NUMINA_RPC_APP_CREDENTIAL,env.NUMINA_KALEIDO_APP_CREDENTIAL,env.KALEIDO_APP_CREDENTIAL];
    const pairs=[
      [env.NUMINA_RPC_USERNAME,env.NUMINA_RPC_PASSWORD],[env.NUMINA_RPC_APP_USERNAME,env.NUMINA_RPC_APP_PASSWORD],
      [env.KALEIDO_APP_CRED_USERNAME,env.KALEIDO_APP_CRED_PASSWORD],[env.KALEIDO_APP_USERNAME,env.KALEIDO_APP_PASSWORD],
      [env.KALEIDO_USERNAME,env.KALEIDO_PASSWORD]
    ];
    const hasDirect=directInputs.some(value=>typeof value==='string'&&value);
    const hasPair=pairs.some(pair=>pair.every(value=>typeof value==='string'&&value));
    if(!hasDirect&&!hasPair)fail('NUMINA_RPC_APP_CREDENTIAL_REQUIRED');
    // Authentication may probe configured app credentials; admin bootstrap is disabled.
    const auth=await resolveRpcAuthorization({endpoint,directInputs,pairs,adminInputs:[],fetcher,allowAdminBootstrap:false});
    const result=await observeNusdCurrentState({rpc:createReadOnlyRpc({endpoint,authorization:auth.authorization,fetcher}),now});
    writeOutput(JSON.stringify(result));return 0;
  }catch(error){
    const blocker=SAFE_CODES.has(error?.message)?error.message:'NUSD_READ_ONLY_OBSERVATION_FAILED';
    writeOutput(JSON.stringify({schema:'numina.nusd.current-observation.v1',identity:'NUMINA',status:'BLOCKED',readOnly:true,writesPerformed:false,blocker}));
    return 1;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.exitCode=await runCurrentObservation({args:process.argv.slice(2)});
}
