import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Interface,getAddress} from 'ethers';
import {resolveRpcAuthorization} from './rpc-auth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const receiptFile=path.resolve(process.argv[2]||path.join(root,'deployment-receipt.json'));
const outputFile=path.resolve(process.argv[3]||path.join(root,'artifacts/transfer-activation-receipt.json'));
const endpoint=process.env.NUMINA_RPC_URL;
const authorizationInput=process.env.NUMINA_RPC_AUTHORIZATION;
const expectedChain=process.env.NUMINA_EXPECTED_CHAIN_ID;
const expectedGenesis=process.env.NUMINA_EXPECTED_GENESIS?.toLowerCase();
const REQUIRED_CONFIRMATIONS=12;
const EXPECTED_ADMIN=getAddress('0xa7e9FB02495700ccE0d209392C0A30FbE077498e');

if(!endpoint||!expectedChain||!expectedGenesis)throw Error('NUMINA_RPC_CONFIGURATION_REQUIRED');

const deploymentReceipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
const artifact=JSON.parse(fs.readFileSync(path.join(root,'history/18d/artifacts/NuminaUSD.json'),'utf8'));
if(deploymentReceipt?.finality?.status!=='FINAL'||deploymentReceipt?.broadcastPerformed!==true)throw Error('NUSD_FINAL_DEPLOYMENT_RECEIPT_REQUIRED');
if(deploymentReceipt?.issuance?.decimals!==18)throw Error('NUSD_EXISTING_DEPLOYMENT_DECIMALS_MISMATCH');
if(deploymentReceipt?.token?.finalConfirmations<REQUIRED_CONFIRMATIONS)throw Error('NUSD_EXISTING_DEPLOYMENT_NOT_FINAL');
if(artifact?.sourceSha256!==deploymentReceipt?.sourceSha256)throw Error('NUSD_EXISTING_ARTIFACT_SOURCE_MISMATCH');

const tokenAddress=getAddress(deploymentReceipt.token.address);
const recipient=getAddress(deploymentReceipt.issuance.recipient);
const iface=new Interface(artifact.abi);
let rpcId=0;

function authCandidates(value){
  const out=[];
  const addBasic=(username,password)=>{if(username&&password)out.push('Basic '+Buffer.from(username+':'+password,'utf8').toString('base64'));};
  if(typeof value==='string'&&/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(value))out.push(value);
  try{if(/^https:\/\//i.test(value||'')){const u=new URL(value);addBasic(decodeURIComponent(u.username),decodeURIComponent(u.password));}}catch{}
  try{if(/^\s*\{/.test(value||'')){const p=JSON.parse(value);addBasic(p.username??p.user??p.id??p.appId,p.password??p.pass??p.secret);if(typeof p.authorization==='string')out.push(p.authorization);}}catch{}
  if(typeof value==='string'&&value.includes(':')&&!/^https:\/\//i.test(value))out.push('Basic '+Buffer.from(value,'utf8').toString('base64'));
  if(value)out.push('Bearer '+value,'Basic '+value);
  return [...new Set(out)];
}

async function rawRpc(auth,method,params=[]){
  const id=++rpcId;
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json','authorization':auth},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
    redirect:'error',
    signal:AbortSignal.timeout(15000)
  });
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!response.ok||!/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(type))throw Error('RPC_HTTP_OR_CONTENT_TYPE');
  const value=await response.json();
  if(value?.jsonrpc!=='2.0'||value.id!==id||value.error||!Object.hasOwn(value,'result'))throw Error('RPC_INVALID_ENVELOPE');
  return value.result;
}

let authorization=null;
for(const candidate of authCandidates(authorizationInput)){
  try{if(typeof await rawRpc(candidate,'eth_chainId',[])==='string'){authorization=candidate;break;}}catch{}
}
let cleanup=null;
if(!authorization){
  const resolved=await resolveRpcAuthorization({
    endpoint,
    directInputs:[authorizationInput,process.env.NUMINA_RPC_APP_CREDENTIAL,process.env.NUMINA_KALEIDO_APP_CREDENTIAL,process.env.KALEIDO_APP_CREDENTIAL],
    pairs:[
      [process.env.NUMINA_RPC_USERNAME,process.env.NUMINA_RPC_PASSWORD],
      [process.env.NUMINA_RPC_APP_USERNAME,process.env.NUMINA_RPC_APP_PASSWORD],
      [process.env.KALEIDO_APP_CRED_USERNAME,process.env.KALEIDO_APP_CRED_PASSWORD],
      [process.env.KALEIDO_APP_USERNAME,process.env.KALEIDO_APP_PASSWORD],
      [process.env.KALEIDO_USERNAME,process.env.KALEIDO_PASSWORD]
    ],
    adminInputs:[authorizationInput,process.env.NUMINA_KALEIDO_API_KEY,process.env.KALEIDO_API_KEY],
    allowAdminBootstrap:true
  });
  authorization=resolved.authorization;
  cleanup=resolved.cleanup;
}

const rpc=(method,params=[])=>rawRpc(authorization,method,params);
const hex=value=>'0x'+BigInt(value).toString(16);

async function call(name,args=[]){
  const data=iface.encodeFunctionData(name,args);
  const raw=await rpc('eth_call',[{to:tokenAddress,data},'latest']);
  return iface.decodeFunctionResult(name,raw);
}
async function waitReceipt(hash){
  for(let i=0;i<180;i++){
    const receipt=await rpc('eth_getTransactionReceipt',[hash]);
    if(receipt)return receipt;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('NUSD_UNPAUSE_RECEIPT_TIMEOUT');
}
async function waitConfirmations(blockHex){
  const mined=BigInt(blockHex);
  for(let i=0;i<300;i++){
    const latest=BigInt(await rpc('eth_blockNumber'));
    const confirmations=latest>=mined?latest-mined+1n:0n;
    if(confirmations>=BigInt(REQUIRED_CONFIRMATIONS))return Number(confirmations);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('NUSD_UNPAUSE_FINALITY_TIMEOUT');
}

try{
  const chain=BigInt(await rpc('eth_chainId')).toString();
  if(chain!==expectedChain||chain!==String(deploymentReceipt.chainId))throw Error('CHAIN_MISMATCH');
  const genesis=await rpc('eth_getBlockByNumber',['0x0',false]);
  if(genesis?.hash?.toLowerCase()!==expectedGenesis||genesis.hash.toLowerCase()!==String(deploymentReceipt.genesisHash).toLowerCase())throw Error('GENESIS_MISMATCH');
  const code=await rpc('eth_getCode',[tokenAddress,'latest']);
  if(!code||code==='0x')throw Error('NUSD_RUNTIME_CODE_MISSING');

  const [decimals]=await call('decimals');
  const [admin]=await call('defaultAdmin');
  const [pausedBefore]=await call('paused');
  const [supplyBefore]=await call('totalSupply');
  const [capBefore]=await call('cap');
  const [recipientBalanceBefore]=await call('balanceOf',[recipient]);
  const [policyHash]=await call('issuerPolicyHash');
  const [authorizedSupplyBefore]=await call('authorizedSupply');

  if(decimals!==18n)throw Error('NUSD_LIVE_DECIMALS_MISMATCH');
  if(getAddress(admin)!==EXPECTED_ADMIN)throw Error('NUSD_DEFAULT_ADMIN_MISMATCH');
  if(supplyBefore.toString()!==deploymentReceipt.token.state.totalSupply)throw Error('NUSD_SUPPLY_MISMATCH');
  if(capBefore.toString()!==deploymentReceipt.token.state.cap)throw Error('NUSD_CAP_MISMATCH');
  if(recipientBalanceBefore.toString()!==deploymentReceipt.token.state.recipientBalance)throw Error('NUSD_RECIPIENT_BALANCE_MISMATCH');
  if(String(policyHash).toLowerCase()!==String(deploymentReceipt.token.state.issuerPolicyHash).toLowerCase())throw Error('NUSD_POLICY_HASH_MISMATCH');
  if(authorizedSupplyBefore!==0n)throw Error('NUSD_OUTSTANDING_AUTHORIZED_SUPPLY');

  let transactionHash=null;
  let activationReceipt=null;
  let confirmations=0;
  let reusedExisting=false;

  if(pausedBefore===false){
    reusedExisting=true;
  }else{
    const accounts=await rpc('eth_accounts');
    if(!Array.isArray(accounts)||!accounts.some(account=>account.toLowerCase()===EXPECTED_ADMIN.toLowerCase()))throw Error('NUSD_DEFAULT_ADMIN_SIGNER_UNAVAILABLE');

    const data=iface.encodeFunctionData('unpause');
    const nonce=BigInt(await rpc('eth_getTransactionCount',[EXPECTED_ADMIN,'pending']));
    const gas=BigInt(await rpc('eth_estimateGas',[{from:EXPECTED_ADMIN,to:tokenAddress,data,value:'0x0'}]));
    const gasPrice=BigInt(await rpc('eth_gasPrice'));
    const balance=BigInt(await rpc('eth_getBalance',[EXPECTED_ADMIN,'pending']));
    if(balance<gas*gasPrice)throw Error('NUSD_DEFAULT_ADMIN_INSUFFICIENT_GAS');

    transactionHash=await rpc('eth_sendTransaction',[{
      from:EXPECTED_ADMIN,to:tokenAddress,data,value:'0x0',
      nonce:hex(nonce),gas:hex(gas),gasPrice:hex(gasPrice)
    }]);
    if(!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))throw Error('NUSD_UNPAUSE_TRANSACTION_HASH_INVALID');
    activationReceipt=await waitReceipt(transactionHash);
    if(activationReceipt.status!=='0x1')throw Error('NUSD_UNPAUSE_REVERTED');
    confirmations=await waitConfirmations(activationReceipt.blockNumber);
  }

  const [pausedAfter]=await call('paused');
  const [supplyAfter]=await call('totalSupply');
  const [capAfter]=await call('cap');
  const [recipientBalanceAfter]=await call('balanceOf',[recipient]);
  const [authorizedSupplyAfter]=await call('authorizedSupply');

  if(pausedAfter!==false)throw Error('NUSD_TRANSFERS_NOT_ENABLED');
  if(supplyAfter!==supplyBefore||capAfter!==capBefore||recipientBalanceAfter!==recipientBalanceBefore||authorizedSupplyAfter!==authorizedSupplyBefore)throw Error('NUSD_STATE_DRIFT_DURING_ACTIVATION');

  const result={
    schema:'numina.nusd.transfer-activation-receipt.v1',
    identity:'NUMINA',
    observedAt:new Date().toISOString(),
    chainId:chain,
    genesisHash:genesis.hash,
    tokenAddress,
    defaultAdmin:EXPECTED_ADMIN,
    mintTransactionHash:deploymentReceipt.token.transactionHash,
    transactionHash,
    reusedExisting,
    confirmations,
    receipt:activationReceipt,
    state:{
      decimals:Number(decimals),
      pausedBefore,
      pausedAfter,
      totalSupply:supplyAfter.toString(),
      cap:capAfter.toString(),
      recipientBalance:recipientBalanceAfter.toString(),
      authorizedSupply:authorizedSupplyAfter.toString()
    },
    verification:{
      chain:true,genesis:true,runtimeCode:true,finalMintReceipt:true,defaultAdmin:true,
      outstandingAuthorizedSupply:false,unpauseReceipt:reusedExisting?null:true,
      minimumConfirmations:reusedExisting?null:true,supplyUnchanged:true,capUnchanged:true,
      recipientBalanceUnchanged:true,transfersEnabled:true
    },
    externalSettlement:{usd:false,usdc:false,bankReceipt:null,providerReceipt:null}
  };
  fs.mkdirSync(path.dirname(outputFile),{recursive:true});
  fs.writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{
  if(cleanup)await cleanup();
}
