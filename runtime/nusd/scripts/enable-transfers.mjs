import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Interface,getAddress} from 'ethers';
import {resolveRpcAuthorization} from './rpc-auth.mjs';

// Retained six-decimal candidate tooling; it cannot operate the active
// eighteen-decimal artifacts or establish current transfer activation.
throw Error('HISTORICAL_6D_CANDIDATE_TOOL_DISABLED');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const receiptFile=path.resolve(process.argv[2]||path.join(root,'deployment-receipt.json'));
const outputFile=path.resolve(process.argv[3]||path.join(root,'artifacts/activation-receipt.json'));
const endpoint=process.env.NUMINA_RPC_URL;
const authorizationInput=process.env.NUMINA_RPC_AUTHORIZATION;
const expectedChain=process.env.NUMINA_EXPECTED_CHAIN_ID;
const expectedGenesis=process.env.NUMINA_EXPECTED_GENESIS?.toLowerCase();
const requiredConfirmations=12;
if(!endpoint||!expectedChain||!expectedGenesis)throw Error('NUMINA_RPC_CONFIGURATION_REQUIRED');

const deployment=JSON.parse(fs.readFileSync(path.join(root,'deployment.production.json'),'utf8'));
const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
const artifact=JSON.parse(fs.readFileSync(path.join(root,'artifacts/NuminaUSD.json'),'utf8'));
const tokenAddress=getAddress(receipt?.token?.address||'');
const admin=getAddress(deployment?.roles?.admin||'');
const recipient=getAddress(deployment?.initialRecipient||'');
if(receipt?.issuance?.decimals!==6||receipt?.issuance?.amountNusd!=='1500000000000000')throw Error('NUMINA_DEPLOYMENT_RECEIPT_MISMATCH');
if(receipt?.verification?.tokenState!==true||receipt?.verification?.roles!==true)throw Error('NUMINA_DEPLOYMENT_NOT_VERIFIED');

function authCandidates(value){
  const candidates=[];
  const basic=(u,p)=>{if(u&&p)candidates.push('Basic '+Buffer.from(u+':'+p,'utf8').toString('base64'));};
  if(typeof value==='string'&&/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(value))candidates.push(value);
  try{if(/^https:\/\//i.test(value||'')){const u=new URL(value);basic(decodeURIComponent(u.username),decodeURIComponent(u.password));}}catch{}
  try{if(/^\s*\{/.test(value||'')){const p=JSON.parse(value);basic(p.username??p.user??p.id??p.appId,p.password??p.pass??p.secret);if(typeof p.authorization==='string')candidates.push(p.authorization);}}catch{}
  if(typeof value==='string'&&value.includes(':')&&!/^https:\/\//i.test(value))candidates.push('Basic '+Buffer.from(value,'utf8').toString('base64'));
  if(value)candidates.push('Bearer '+value,'Basic '+value);
  return [...new Set(candidates)];
}
let rpcId=0;
async function rawRpc(auth,method,params=[]){
  const id=++rpcId;
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','authorization':auth},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'error',signal:AbortSignal.timeout(15000)});
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
  authorization=resolved.authorization;cleanup=resolved.cleanup;
}
const rpc=(method,params=[])=>rawRpc(authorization,method,params);
const hex=value=>'0x'+BigInt(value).toString(16);
async function waitReceipt(hash){
  for(let i=0;i<180;i++){const r=await rpc('eth_getTransactionReceipt',[hash]);if(r)return r;await new Promise(x=>setTimeout(x,1000));}
  throw Error('ACTIVATION_RECEIPT_TIMEOUT');
}
async function waitConfirmations(blockHex){
  const mined=BigInt(blockHex);
  for(let i=0;i<300;i++){const latest=BigInt(await rpc('eth_blockNumber'));const n=latest>=mined?latest-mined+1n:0n;if(n>=BigInt(requiredConfirmations))return Number(n);await new Promise(x=>setTimeout(x,1000));}
  throw Error('ACTIVATION_FINALITY_TIMEOUT');
}
async function call(iface,name,args=[]){
  const data=iface.encodeFunctionData(name,args);
  const raw=await rpc('eth_call',[{to:tokenAddress,data},'latest']);
  return iface.decodeFunctionResult(name,raw);
}

try{
  const chain=BigInt(await rpc('eth_chainId')).toString();
  if(chain!==expectedChain)throw Error('CHAIN_MISMATCH');
  const genesis=await rpc('eth_getBlockByNumber',['0x0',false]);
  if(genesis?.hash?.toLowerCase()!==expectedGenesis)throw Error('GENESIS_MISMATCH');
  const code=await rpc('eth_getCode',[tokenAddress,'latest']);
  if(!code||code==='0x')throw Error('NUSD_NO_RUNTIME_CODE');
  const accounts=await rpc('eth_accounts');
  if(!Array.isArray(accounts)||!accounts.some(a=>a.toLowerCase()===admin.toLowerCase()))throw Error('NUMINA_ADMIN_SIGNER_UNAVAILABLE');

  const iface=new Interface(artifact.abi);
  const [observedAdmin]=await call(iface,'defaultAdmin');
  if(getAddress(observedAdmin)!==admin)throw Error('DEFAULT_ADMIN_MISMATCH');

  const [supplyBefore]=await call(iface,'totalSupply');
  const [capBefore]=await call(iface,'cap');
  const [balanceBefore]=await call(iface,'balanceOf',[recipient]);
  const [authorizedBefore]=await call(iface,'authorizedSupply');
  const [pausedBefore]=await call(iface,'paused');
  if(supplyBefore.toString()!==receipt.token.totalSupply||capBefore.toString()!==receipt.token.cap||balanceBefore.toString()!==receipt.token.recipientBalance)throw Error('NUSD_PRE_ACTIVATION_STATE_MISMATCH');
  if(authorizedBefore!==0n)throw Error('OUTSTANDING_AUTHORIZED_SUPPLY');

  let transactionHash=null,activationReceipt=null,confirmations=0,reusedExisting=false;
  if(pausedBefore===false){
    reusedExisting=true;
  }else{
    const data=iface.encodeFunctionData('unpause');
    const nonce=BigInt(await rpc('eth_getTransactionCount',[admin,'pending']));
    const gas=BigInt(await rpc('eth_estimateGas',[{from:admin,to:tokenAddress,data,value:'0x0'}]));
    const gasPrice=BigInt(await rpc('eth_gasPrice'));
    const balance=BigInt(await rpc('eth_getBalance',[admin,'pending']));
    if(balance<gas*gasPrice)throw Error('NUMINA_ADMIN_INSUFFICIENT_GAS_BALANCE');
    transactionHash=await rpc('eth_sendTransaction',[{from:admin,to:tokenAddress,data,value:'0x0',nonce:hex(nonce),gas:hex(gas),gasPrice:hex(gasPrice)}]);
    if(!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))throw Error('ACTIVATION_INVALID_TRANSACTION_HASH');
    activationReceipt=await waitReceipt(transactionHash);
    if(activationReceipt.status!=='0x1')throw Error('ACTIVATION_REVERTED');
    confirmations=await waitConfirmations(activationReceipt.blockNumber);
  }

  const [pausedAfter]=await call(iface,'paused');
  const [supplyAfter]=await call(iface,'totalSupply');
  const [capAfter]=await call(iface,'cap');
  const [balanceAfter]=await call(iface,'balanceOf',[recipient]);
  const [authorizedAfter]=await call(iface,'authorizedSupply');
  if(pausedAfter!==false)throw Error('NUSD_ACTIVATION_FAILED');
  if(supplyAfter!==supplyBefore||capAfter!==capBefore||balanceAfter!==balanceBefore||authorizedAfter!==authorizedBefore)throw Error('NUSD_ACTIVATION_STATE_DRIFT');

  const result={
    schema:'numina.nusd.transfer-activation-receipt.v1',identity:'NUMINA',chainId:chain,genesisHash:genesis.hash,
    tokenAddress,admin,transactionHash,confirmations,reusedExisting,
    state:{pausedBefore,pausedAfter,totalSupply:supplyAfter.toString(),cap:capAfter.toString(),recipientBalance:balanceAfter.toString(),authorizedSupply:authorizedAfter.toString()},
    verification:{chain:true,genesis:true,tokenCode:true,defaultAdmin:true,managedAdminSigner:true,receipt:reusedExisting?null:true,minimumConfirmations:reusedExisting?null:true,supplyUnchanged:true,capUnchanged:true,balanceUnchanged:true,authorizedSupplyUnchanged:true,transfersEnabled:true},
    externalSettlement:{usd:false,usdc:false,bankReceipt:null,providerReceipt:null}
  };
  fs.mkdirSync(path.dirname(outputFile),{recursive:true});
  fs.writeFileSync(outputFile,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}finally{if(cleanup)await cleanup();}
