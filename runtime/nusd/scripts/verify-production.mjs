import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Interface,getAddress,id} from 'ethers';
import {loadTokenArtifact,TOKEN_ARTIFACT_SHA256} from './token-artifact.mjs';
import {resolveRpcAuthorization} from './rpc-auth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]||path.join(root,'deployment-verification.json'));
const endpoint=process.env.NUMINA_RPC_URL;
const authorizationInput=process.env.NUMINA_RPC_AUTHORIZATION;
const expectedChain=process.env.NUMINA_EXPECTED_CHAIN_ID;
const expectedGenesis=process.env.NUMINA_EXPECTED_GENESIS?.toLowerCase();
const sender=getAddress(process.env.NUMINA_SENDER||'');
const recipient=getAddress(process.env.NUMINA_RECIPIENT||sender);
const expectedSupply='1500000000000000000000000000000000';
const expectedPolicy=(process.env.NUMINA_ISSUER_POLICY_SHA256||'').toLowerCase();
if(!endpoint||!authorizationInput||!expectedChain||!expectedGenesis||!expectedPolicy)throw Error('NUMINA_VERIFICATION_CONFIGURATION_REQUIRED');

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
let rpcCleanup=null;
if(!authorization){
  const resolved=await resolveRpcAuthorization({
    endpoint,
    directInputs:[
      authorizationInput,
      process.env.NUMINA_RPC_APP_CREDENTIAL,
      process.env.NUMINA_KALEIDO_APP_CREDENTIAL,
      process.env.KALEIDO_APP_CREDENTIAL
    ],
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
  rpcCleanup=resolved.cleanup;
}
async function rpc(method,params=[]){return rawRpc(authorization,method,params);}
try {
async function call(address,iface,name,args=[]){
  const raw=await rpc('eth_call',[{to:address,data:iface.encodeFunctionData(name,args)},'latest']);
  return iface.decodeFunctionResult(name,raw);
}
const chain=BigInt(await rpc('eth_chainId')).toString();
if(chain!==expectedChain)throw Error('CHAIN_MISMATCH');
const genesis=await rpc('eth_getBlockByNumber',['0x0',false]);
if(genesis?.hash?.toLowerCase()!==expectedGenesis)throw Error('GENESIS_MISMATCH');

const latest=BigInt(await rpc('eth_blockNumber'));
const floor=latest>2000n?latest-2000n:0n;
const creations=[];
for(let block=latest;block>=floor;block--){
  const value=await rpc('eth_getBlockByNumber',['0x'+block.toString(16),true]);
  for(const tx of value?.transactions||[]){
    if(tx?.from?.toLowerCase()!==sender.toLowerCase()||tx.to!==null)continue;
    const receipt=await rpc('eth_getTransactionReceipt',[tx.hash]);
    if(receipt?.status==='0x1'&&receipt.contractAddress)creations.push({tx,receipt});
  }
  if(block===0n)break;
}

const tokenArtifact=loadTokenArtifact();
const tokenIface=new Interface(tokenArtifact.abi);
let token=null;
for(const candidate of creations){
  const address=getAddress(candidate.receipt.contractAddress);
  try{
    const [decimals]=await call(address,tokenIface,'decimals');
    const [supply]=await call(address,tokenIface,'totalSupply');
    const [cap]=await call(address,tokenIface,'cap');
    const [paused]=await call(address,tokenIface,'paused');
    const [balance]=await call(address,tokenIface,'balanceOf',[recipient]);
    const [policy]=await call(address,tokenIface,'issuerPolicyHash');
    if(decimals===18n&&supply.toString()===expectedSupply&&cap.toString()===expectedSupply&&paused===true&&
       balance.toString()===expectedSupply&&policy.toLowerCase()==='0x'+expectedPolicy){
      token={address,transactionHash:candidate.tx.hash,blockNumber:candidate.receipt.blockNumber,
        decimals:Number(decimals),totalSupply:supply.toString(),cap:cap.toString(),recipientBalance:balance.toString(),
        paused,issuerPolicySha256:expectedPolicy};
      break;
    }
  }catch{}
}
if(!token)throw Error('VERIFIED_NUSD_DEPLOYMENT_NOT_FOUND');

const settlementArtifact=JSON.parse(fs.readFileSync(path.join(root,'artifacts/NuminaSettlement.json'),'utf8'));
const settlementIface=new Interface(settlementArtifact.abi);
let settlement=null;
for(const candidate of creations){
  const address=getAddress(candidate.receipt.contractAddress);
  if(address===token.address)continue;
  try{
    const [bound]=await call(address,settlementIface,'nusd');
    if(getAddress(bound)===token.address){
      settlement={address,transactionHash:candidate.tx.hash,blockNumber:candidate.receipt.blockNumber,nusd:token.address};
      break;
    }
  }catch{}
}
if(!settlement)throw Error('VERIFIED_NUSD_SETTLEMENT_NOT_FOUND');

const confirmations=block=>Number(latest-BigInt(block)+1n);
const result={
  schema:'numina.nusd.production-verification.v1',identity:'NUMINA',verifiedAt:new Date().toISOString(),
  chainId:chain,genesisHash:genesis.hash,sender,recipient,
  issuance:{amountNusd:'1500000000000000',decimals:18,baseUnits:expectedSupply,constructorMint:true,externallyBackedClaim:false},
  token:{...token,confirmations:confirmations(token.blockNumber),artifactSha256:TOKEN_ARTIFACT_SHA256,sourceSha256:tokenArtifact.sourceSha256},
  settlement:{...settlement,confirmations:confirmations(settlement.blockNumber)},
  externalSettlement:{usd:false,usdc:false,bankReceipt:null,providerReceipt:null},
  verification:{chain:true,genesis:true,tokenState:true,constructorSupply:true,paused:true,settlementBinding:true}
};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
} finally {
  if(rpcCleanup)await rpcCleanup();
}
