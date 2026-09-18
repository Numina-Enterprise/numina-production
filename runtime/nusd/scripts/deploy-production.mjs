import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ContractFactory,Interface,getAddress,id} from 'ethers';
import {validateDeployment} from './validate-deployment.mjs';
import {loadTokenArtifact,TOKEN_ARTIFACT_SHA256} from './token-artifact.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const requestFile=path.resolve(process.argv[2]||path.join(root,'deployment.production.json'));
const receiptFile=path.resolve(process.argv[3]||path.join(root,'deployment-receipt.json'));
const endpoint=process.env.NUMINA_RPC_URL;
const authorizationInput=process.env.NUMINA_RPC_AUTHORIZATION;
const expectedChain=process.env.NUMINA_EXPECTED_CHAIN_ID;
const expectedGenesis=process.env.NUMINA_EXPECTED_GENESIS?.toLowerCase();
const sender=getAddress(process.env.NUMINA_SENDER||'');
const REQUIRED_INITIAL_SUPPLY='1500000000000000000000000000000000';
const REQUIRED_DECIMALS=18n;
const REQUIRED_CONFIRMATIONS=12;
if(!endpoint||!authorizationInput||!expectedChain||!expectedGenesis)throw Error('NUMINA_RPC_CONFIGURATION_REQUIRED');

function authorizationCandidates(value){
  if(/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(value))return [value];
  const candidates=[];
  const addBasic=(username,password)=>{if(username&&password)candidates.push('Basic '+Buffer.from(username+':'+password,'utf8').toString('base64'));};
  try{
    if(/^https:\/\//i.test(value)){
      const credentialUrl=new URL(value);
      addBasic(decodeURIComponent(credentialUrl.username),decodeURIComponent(credentialUrl.password));
    }
  }catch{}
  try{
    if(/^\s*\{/.test(value)){
      const parsed=JSON.parse(value);
      addBasic(parsed.username??parsed.user??parsed.id??parsed.appId,parsed.password??parsed.pass??parsed.secret);
      if(typeof parsed.authorization==='string'&&/^(?:Basic|Bearer) [\x21-\x7e]+$/.test(parsed.authorization))candidates.push(parsed.authorization);
    }
  }catch{}
  if(value.includes(':')&&!/^https:\/\//i.test(value))candidates.push('Basic '+Buffer.from(value,'utf8').toString('base64'));
  candidates.push('Bearer '+value,'Basic '+value);
  return [...new Set(candidates)];
}
let authorization=null,rpcId=0;
async function rawRpc(auth,method,params=[]){
  const id=++rpcId;
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','authorization':auth},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const type=(response.headers.get('content-type')||'').toLowerCase();
  if(!response.ok||!/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(type))throw Error('RPC_HTTP_OR_CONTENT_TYPE');
  let value;try{value=await response.json();}catch{throw Error('RPC_INVALID_JSON');}
  if(value?.jsonrpc!=='2.0'||value.id!==id||value.error||!Object.hasOwn(value,'result'))throw Error('RPC_INVALID_ENVELOPE');
  return value.result;
}
for(const candidate of authorizationCandidates(authorizationInput)){
  try{
    const probe=await rawRpc(candidate,'eth_chainId',[]);
    if(typeof probe==='string'){authorization=candidate;break;}
  }catch{}
}
async function kaleidoAdminApiKeyDetected(value){
  const tokens=[];
  if(/^Bearer [\x21-\x7e]+$/.test(value))tokens.push(value.slice(7));
  try{
    if(/^\s*\{/.test(value)){
      const parsed=JSON.parse(value);
      for(const item of [parsed.apiKey,parsed.api_key,parsed.token,parsed.accessToken]){
        if(typeof item==='string'&&item)tokens.push(item);
      }
      if(typeof parsed.authorization==='string'&&/^Bearer [\x21-\x7e]+$/.test(parsed.authorization))tokens.push(parsed.authorization.slice(7));
    }
  }catch{}
  if(!/^https:\/\//i.test(value)&&!value.includes(':')&&!/^(?:Basic|Bearer) /.test(value))tokens.push(value);
  for(const token of [...new Set(tokens)]){
    try{
      const response=await fetch('https://console.kaleido.io/api/v1/consortia?limit=1',{
        method:'GET',headers:{accept:'application/json',authorization:'Bearer '+token},
        redirect:'error',signal:AbortSignal.timeout(15000)
      });
      const type=(response.headers.get('content-type')||'').toLowerCase();
      if(response.ok&&/^application\/json(?:\s*;|$)/i.test(type)){
        const body=await response.json();
        if(Array.isArray(body))return true;
      }
    }catch{}
  }
  return false;
}
if(!authorization){
  if(await kaleidoAdminApiKeyDetected(authorizationInput))throw Error('NUMINA_RPC_APP_CREDENTIAL_REQUIRED_ADMIN_KEY_DETECTED');
  throw Error('NUMINA_RPC_AUTHENTICATION_FAILED');
}
async function rpc(method,params=[]){return rawRpc(authorization,method,params);}
const hex=value=>'0x'+BigInt(value).toString(16);
async function waitReceipt(hash){
  for(let attempt=0;attempt<180;attempt++){
    const receipt=await rpc('eth_getTransactionReceipt',[hash]);
    if(receipt)return receipt;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('RECEIPT_TIMEOUT');
}
async function waitConfirmations(blockHex,count=REQUIRED_CONFIRMATIONS){
  const mined=BigInt(blockHex);
  for(let attempt=0;attempt<300;attempt++){
    const latest=BigInt(await rpc('eth_blockNumber'));
    const confirmations=latest>=mined?latest-mined+1n:0n;
    if(confirmations>=BigInt(count))return Number(confirmations);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('FINALITY_TIMEOUT');
}
async function sendCreation(data,label){
  const nonce=BigInt(await rpc('eth_getTransactionCount',[sender,'pending']));
  const gas=BigInt(await rpc('eth_estimateGas',[{from:sender,data,value:'0x0'}]));
  const gasPrice=BigInt(await rpc('eth_gasPrice'));
  const balance=BigInt(await rpc('eth_getBalance',[sender,'pending']));
  const maximumFee=gas*gasPrice;
  if(balance<maximumFee)throw Error(label+'_INSUFFICIENT_GAS_BALANCE');
  const transaction={from:sender,data,value:'0x0',nonce:hex(nonce),gas:hex(gas),gasPrice:hex(gasPrice)};
  const hash=await rpc('eth_sendTransaction',[transaction]);
  if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error(label+'_INVALID_TRANSACTION_HASH');
  const receipt=await waitReceipt(hash);
  if(receipt.status!=='0x1'||!receipt.contractAddress)throw Error(label+'_DEPLOYMENT_REVERTED');
  const code=await rpc('eth_getCode',[receipt.contractAddress,'latest']);
  if(!code||code==='0x')throw Error(label+'_NO_RUNTIME_CODE');
  return {hash,receipt,gas:gas.toString(),gasPrice:gasPrice.toString(),maximumFee:maximumFee.toString(),reusedExisting:false};
}
async function contractCall(address,iface,name,args=[]){
  const data=iface.encodeFunctionData(name,args);
  const raw=await rpc('eth_call',[{to:address,data},'latest']);
  return iface.decodeFunctionResult(name,raw);
}
async function creationTransactions(){
  const latest=BigInt(await rpc('eth_blockNumber'));
  const creations=[];
  for(let height=latest;height>=0n;height--){
    const block=await rpc('eth_getBlockByNumber',[hex(height),true]);
    if(Array.isArray(block?.transactions)){
      for(const tx of block.transactions){
        if(tx?.from?.toLowerCase()===sender.toLowerCase()&&!tx.to&&/^0x[0-9a-fA-F]{64}$/.test(tx.hash)){
          const receipt=await rpc('eth_getTransactionReceipt',[tx.hash]);
          if(receipt?.status==='0x1'&&receipt.contractAddress){
            creations.push({hash:tx.hash,receipt,reusedExisting:true});
          }
        }
      }
    }
    if(height===0n)break;
  }
  return creations;
}

const chain=BigInt(await rpc('eth_chainId')).toString();
if(chain!==expectedChain)throw Error('CHAIN_MISMATCH');
const genesis=await rpc('eth_getBlockByNumber',['0x0',false]);
if(genesis?.hash?.toLowerCase()!==expectedGenesis)throw Error('GENESIS_MISMATCH');
const accounts=await rpc('eth_accounts');
if(!Array.isArray(accounts)||!accounts.some(account=>account.toLowerCase()===sender.toLowerCase()))throw Error('MANAGED_SIGNER_UNAVAILABLE');

const checked=validateDeployment(requestFile);
if(checked.errors.length)throw Error('DEPLOYMENT_REQUEST_INVALID: '+checked.errors.join('; '));
if(checked.initialSupply.toString()!==REQUIRED_INITIAL_SUPPLY||checked.cap.toString()!==REQUIRED_INITIAL_SUPPLY)throw Error('SUPPLY_NOT_1500T_18D');
if(getAddress(checked.initialRecipient)!==sender)throw Error('RECIPIENT_SIGNER_MISMATCH');

const tokenArtifact=loadTokenArtifact();
const tokenInterface=new Interface(tokenArtifact.abi);
async function verifyToken(address){
  try{
    const [decimals]=await contractCall(address,tokenInterface,'decimals');
    const [totalSupply]=await contractCall(address,tokenInterface,'totalSupply');
    const [cap]=await contractCall(address,tokenInterface,'cap');
    const [paused]=await contractCall(address,tokenInterface,'paused');
    const [recipientBalance]=await contractCall(address,tokenInterface,'balanceOf',[checked.initialRecipient]);
    const [policyHash]=await contractCall(address,tokenInterface,'issuerPolicyHash');
    if(decimals!==REQUIRED_DECIMALS||totalSupply.toString()!==REQUIRED_INITIAL_SUPPLY||cap.toString()!==REQUIRED_INITIAL_SUPPLY||
       recipientBalance.toString()!==REQUIRED_INITIAL_SUPPLY||paused!==true||
       policyHash.toLowerCase()!==`0x${checked.policyHash}`.toLowerCase())return null;
    for(const [roleName,roleAddress] of [['ISSUER_ROLE',checked.roles.issuer],['MINTER_ROLE',checked.roles.minter],['PAUSER_ROLE',checked.roles.pauser]]){
      const [has]=await contractCall(address,tokenInterface,'hasRole',[id(roleName),roleAddress]);
      if(!has)return null;
    }
    const [admin]=await contractCall(address,tokenInterface,'defaultAdmin');
    if(getAddress(admin)!==getAddress(checked.roles.admin))return null;
    return {decimals,totalSupply,cap,paused,recipientBalance,policyHash};
  }catch{return null;}
}

const priorCreations=await creationTransactions();
let tokenTx=null,tokenState=null,tokenAddress=null;
for(const candidate of priorCreations){
  const address=getAddress(candidate.receipt.contractAddress);
  const state=await verifyToken(address);
  if(state){tokenTx=candidate;tokenState=state;tokenAddress=address;break;}
}
if(!tokenTx){
  const tokenData=(await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode).getDeployTransaction(
    checked.cap,checked.initialSupply,checked.initialRecipient,
    checked.roles.admin,checked.roles.issuer,checked.roles.minter,checked.roles.pauser,
    checked.config.adminDelaySeconds,`0x${checked.policyHash}`
  )).data;
  tokenTx=await sendCreation(tokenData,'NUSD');
  tokenAddress=getAddress(tokenTx.receipt.contractAddress);
  tokenState=await verifyToken(tokenAddress);
  if(!tokenState)throw Error('NUSD_POST_DEPLOY_VERIFICATION_FAILED');
}

const settlementArtifact=JSON.parse(fs.readFileSync(path.join(root,'artifacts/NuminaSettlement.json'),'utf8'));
const settlementInterface=new Interface(settlementArtifact.abi);
async function verifySettlement(address){
  try{
    const [boundNusd]=await contractCall(address,settlementInterface,'nusd');
    return getAddress(boundNusd)===tokenAddress;
  }catch{return false;}
}
let settlementTx=null,settlementAddress=null;
for(const candidate of priorCreations){
  const address=getAddress(candidate.receipt.contractAddress);
  if(address!==tokenAddress&&await verifySettlement(address)){settlementTx=candidate;settlementAddress=address;break;}
}
if(!settlementTx){
  const settlementData=(await new ContractFactory(settlementArtifact.abi,settlementArtifact.bytecode).getDeployTransaction(tokenAddress)).data;
  settlementTx=await sendCreation(settlementData,'NUSD_SETTLEMENT');
  settlementAddress=getAddress(settlementTx.receipt.contractAddress);
  if(!await verifySettlement(settlementAddress))throw Error('SETTLEMENT_TOKEN_BINDING_MISMATCH');
}

const tokenConfirmations=await waitConfirmations(tokenTx.receipt.blockNumber);
const settlementConfirmations=await waitConfirmations(settlementTx.receipt.blockNumber);
const result={
  schema:'numina.nusd.production-deployment-receipt.v1',identity:'NUMINA',
  observedAt:new Date().toISOString(),chainId:chain,genesisHash:genesis.hash,sender,
  deploymentMode:'idempotent_reconcile_or_create',
  issuance:{amountNusd:'1500000000000000',decimals:18,baseUnits:REQUIRED_INITIAL_SUPPLY,
    constructorMint:true,recipient:checked.initialRecipient,externallyBackedClaim:false},
  token:{address:tokenAddress,transactionHash:tokenTx.hash,blockNumber:tokenTx.receipt.blockNumber,
    confirmations:tokenConfirmations,reusedExisting:tokenTx.reusedExisting===true,
    artifactSha256:TOKEN_ARTIFACT_SHA256,sourceSha256:tokenArtifact.sourceSha256,
    decimals:Number(tokenState.decimals),totalSupply:tokenState.totalSupply.toString(),cap:tokenState.cap.toString(),
    recipientBalance:tokenState.recipientBalance.toString(),paused:tokenState.paused,issuerPolicySha256:checked.policyHash},
  settlement:{address:settlementAddress,transactionHash:settlementTx.hash,blockNumber:settlementTx.receipt.blockNumber,
    confirmations:settlementConfirmations,reusedExisting:settlementTx.reusedExisting===true,nusd:tokenAddress},
  externalSettlement:{usd:false,usdc:false,bankReceipt:null,providerReceipt:null},
  verification:{chain:true,genesis:true,managedSigner:true,tokenCode:true,tokenState:true,roles:true,settlementCode:true,settlementBinding:true}
};
fs.writeFileSync(receiptFile,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
