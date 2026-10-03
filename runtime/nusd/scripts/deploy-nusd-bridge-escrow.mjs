import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {ContractFactory,Interface,getAddress} from 'ethers';
import {resolveRpcAuthorization} from './rpc-auth.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const endpoint=process.env.NUMINA_RPC_URL;
const expectedChain=process.env.NUMINA_EXPECTED_CHAIN_ID;
const expectedGenesis=(process.env.NUMINA_EXPECTED_GENESIS||'').toLowerCase();
const sender=getAddress(process.env.NUMINA_SENDER||'');
const token=getAddress(process.env.NUMINA_NUSD_TOKEN||'0x491c1DF1b5CA77AF797f052c2310ca17039C931b');
const receiptFile=path.join(root,'artifacts','nusd-bridge-escrow-production-receipt.json');
const REQUIRED_DECIMALS=18n;
const REQUIRED_SUPPLY=1500000000000000000000000000000000n;
const REQUIRED_LOCK=500000000000000000000000000n;
const REQUIRED_CONFIRMATIONS=12n;
if(!endpoint||!expectedChain||!expectedGenesis)throw Error('NUMINA_RPC_CONFIGURATION_REQUIRED');

const resolved=await resolveRpcAuthorization({
  endpoint,
  directInputs:[
    process.env.NUMINA_RPC_AUTHORIZATION,
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
  adminInputs:[process.env.NUMINA_RPC_AUTHORIZATION,process.env.NUMINA_KALEIDO_API_KEY,process.env.KALEIDO_API_KEY],
  allowAdminBootstrap:true
});

let rpcId=0;
async function rpc(method,params=[]){
  const id=++rpcId;
  const response=await fetch(endpoint,{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json','authorization':resolved.authorization},
    body:JSON.stringify({jsonrpc:'2.0',id,method,params}),
    redirect:'error',
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error('RPC_HTTP_'+response.status);
  const body=await response.json();
  if(body?.jsonrpc!=='2.0'||body.id!==id||body.error||!Object.hasOwn(body,'result'))throw Error('RPC_INVALID_RESPONSE');
  return body.result;
}
const hex=value=>'0x'+BigInt(value).toString(16);
async function call(to,iface,name,args=[]){
  const data=iface.encodeFunctionData(name,args);
  const raw=await rpc('eth_call',[{to,data},'latest']);
  return iface.decodeFunctionResult(name,raw);
}
async function waitReceipt(hash){
  for(let i=0;i<180;i++){
    const receipt=await rpc('eth_getTransactionReceipt',[hash]);
    if(receipt)return receipt;
    await new Promise(r=>setTimeout(r,1000));
  }
  throw Error('RECEIPT_TIMEOUT');
}
async function waitConfirmations(blockHex){
  const mined=BigInt(blockHex);
  for(let i=0;i<300;i++){
    const latest=BigInt(await rpc('eth_blockNumber'));
    const confirmations=latest>=mined?latest-mined+1n:0n;
    if(confirmations>=REQUIRED_CONFIRMATIONS)return confirmations;
    await new Promise(r=>setTimeout(r,1000));
  }
  throw Error('FINALITY_TIMEOUT');
}
try{
  const chain=BigInt(await rpc('eth_chainId')).toString();
  if(chain!==expectedChain)throw Error('CHAIN_MISMATCH');
  const genesis=await rpc('eth_getBlockByNumber',['0x0',false]);
  if((genesis?.hash||'').toLowerCase()!==expectedGenesis)throw Error('GENESIS_MISMATCH');
  const accounts=await rpc('eth_accounts');
  if(!Array.isArray(accounts)||!accounts.some(a=>a.toLowerCase()===sender.toLowerCase()))throw Error('MANAGED_SIGNER_UNAVAILABLE');

  const tokenIface=new Interface([
    'function decimals() view returns(uint8)',
    'function totalSupply() view returns(uint256)',
    'function balanceOf(address) view returns(uint256)',
    'function paused() view returns(bool)'
  ]);
  const [decimals]=await call(token,tokenIface,'decimals');
  const [supply]=await call(token,tokenIface,'totalSupply');
  const [balance]=await call(token,tokenIface,'balanceOf',[sender]);
  const [paused]=await call(token,tokenIface,'paused');
  if(decimals!==REQUIRED_DECIMALS)throw Error('NUSD_DECIMALS_NOT_18');
  if(supply!==REQUIRED_SUPPLY)throw Error('NUSD_SUPPLY_NOT_1500T');
  if(balance<REQUIRED_LOCK)throw Error('NUSD_500M_BALANCE_UNAVAILABLE');
  if(paused)throw Error('NUSD_TRANSFERS_PAUSED');

  const artifactPath=path.join(root,'artifacts','NusdBridgeEscrow.json');
  const sourcePath=path.join(root,'contracts','NusdBridgeEscrow.sol');
  const artifact=JSON.parse(fs.readFileSync(artifactPath,'utf8'));
  const source=fs.readFileSync(sourcePath);
  const sourceSha=crypto.createHash('sha256').update(source).digest('hex');
  if(artifact.schema!=='numina.nusd.bridge-escrow-candidate.v1'||artifact.contractName!=='NusdBridgeEscrow'||artifact.sourceSha256!==sourceSha)throw Error('BRIDGE_ARTIFACT_MISMATCH');

  const escrowIface=new Interface(artifact.abi);
  async function verifyEscrow(address){
    try{
      const code=await rpc('eth_getCode',[address,'latest']);
      if(!code||code==='0x')return false;
      const [bound]=await call(address,escrowIface,'nusd');
      const [nonce]=await call(address,escrowIface,'nextNonce');
      return getAddress(bound)===token&&nonce>=1n;
    }catch{return false;}
  }

  let escrowAddress=null,transactionHash=null,blockNumber=null,reusedExisting=false;
  const latest=BigInt(await rpc('eth_blockNumber'));
  const floor=51725n;
  outer: for(let height=latest;height>=floor;height--){
    const block=await rpc('eth_getBlockByNumber',[hex(height),true]);
    for(const tx of block?.transactions||[]){
      if(tx?.from?.toLowerCase()!==sender.toLowerCase()||tx.to)continue;
      const receipt=await rpc('eth_getTransactionReceipt',[tx.hash]);
      if(receipt?.status!=='0x1'||!receipt.contractAddress)continue;
      if(await verifyEscrow(receipt.contractAddress)){
        escrowAddress=getAddress(receipt.contractAddress);
        transactionHash=tx.hash;
        blockNumber=receipt.blockNumber;
        reusedExisting=true;
        break outer;
      }
    }
    if(height===floor)break;
  }

  if(!escrowAddress){
    const data=(await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(token)).data;
    const nonce=BigInt(await rpc('eth_getTransactionCount',[sender,'pending']));
    const gas=BigInt(await rpc('eth_estimateGas',[{from:sender,data,value:'0x0'}]));
    const gasPrice=BigInt(await rpc('eth_gasPrice'));
    const nativeBalance=BigInt(await rpc('eth_getBalance',[sender,'pending']));
    if(nativeBalance<gas*gasPrice)throw Error('ESCROW_DEPLOY_GAS_UNAVAILABLE');
    const tx={from:sender,data,value:'0x0',nonce:hex(nonce),gas:hex(gas),gasPrice:hex(gasPrice)};
    transactionHash=await rpc('eth_sendTransaction',[tx]);
    if(!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))throw Error('ESCROW_INVALID_TX_HASH');
    const receipt=await waitReceipt(transactionHash);
    if(receipt.status!=='0x1'||!receipt.contractAddress)throw Error('ESCROW_DEPLOY_REVERTED');
    escrowAddress=getAddress(receipt.contractAddress);
    blockNumber=receipt.blockNumber;
    if(!await verifyEscrow(escrowAddress))throw Error('ESCROW_POST_DEPLOY_VERIFY_FAILED');
  }
  const confirmations=await waitConfirmations(blockNumber);
  const result={
    schema:'numina.nusd.bridge-escrow-production-receipt.v1',
    status:'DEPLOYED_VERIFIED',
    observedAt:new Date().toISOString(),
    chainId:chain,
    genesisHash:genesis.hash,
    sender,
    nusd:{address:token,decimals:Number(decimals),totalSupplyBaseUnits:supply.toString(),senderBalanceBaseUnits:balance.toString(),paused},
    requestedLock:{wholeNusd:'500000000',baseUnits:REQUIRED_LOCK.toString(),authorized:true,locked:false},
    escrow:{address:escrowAddress,transactionHash,blockNumber,confirmations:Number(confirmations),reusedExisting,sourceSha256:sourceSha},
    baseLeg:{chainId:'8453',canonicalUsdc:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',stripeRecipient:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',vaultDeployed:false,liquidityVerified:false},
    executionBoundary:'Escrow deployment only. No NUSD lock until Base vault deployment, canonical USDC liquidity >= 500000000000000 base units, operator control, and gas are independently verified.'
  };
  fs.writeFileSync(receiptFile,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
} finally {
  if(resolved.cleanup)await resolved.cleanup();
}
