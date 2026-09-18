import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const TOKEN_HASH='b11a96c49fb5acc88783af2790e06a714e661ae9b7a6eb5b3508fc0db6f2f37e';
const RPC_URL='https://u0yth28mgh-u0vtj8pzdz-rpc.us0-aws.kaleido.io/';
const CHAIN_ID='962421430';
const GENESIS='0xea95dac2ad854c835bc526d6be70a5a4614ccd47412a4bc710308b41010b53e1';
const SENDER='0x1a45671AE2ee3E52264116151924FAAcb80Fc02E';
const EXPECTED_SUPPLY='1500000000000000000000000000000000';
const POLICY='2134617c4fb7a538271dcf6b3b4bfa10fc71c23631a9cf63c7d0a05ee05294f5';
const REQUIRED_CONFIRMATIONS=12n;
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function response(res,status,body){
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.setHeader('x-content-type-options','nosniff');
  res.end(JSON.stringify(body));
}
function safeToken(value){
  if(typeof value!=='string'||value.length>128)return false;
  const actual=crypto.createHash('sha256').update(value).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(TOKEN_HASH,'hex'));
}

export default async function handler(req,res){
  if(req.method!=='GET')return response(res,405,{error:'METHOD_NOT_ALLOWED'});
  const token=new URL(req.url,'https://numina.invalid').searchParams.get('token');
  if(!safeToken(token))return response(res,404,{error:'NOT_FOUND'});
  const auth=process.env.NUMINA_RPC_AUTHORIZATION;
  if(typeof auth!=='string'||!auth)return response(res,503,{error:'NUMINA_RPC_AUTHORIZATION_UNAVAILABLE'});
  let rpcId=0;
  async function rpc(method,params=[]){
    const id=++rpcId;
    const r=await fetch(RPC_URL,{method:'POST',headers:{accept:'application/json','content-type':'application/json',authorization:auth},
      body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'error',signal:AbortSignal.timeout(15000)});
    const type=(r.headers.get('content-type')||'').toLowerCase();
    if(!r.ok||!/^application\/(?:json|json-rpc)(?:\s*;|$)/i.test(type))throw Error('RPC_HTTP_'+r.status);
    const value=await r.json();
    if(value?.jsonrpc!=='2.0'||value.id!==id||value.error||!Object.hasOwn(value,'result'))throw Error('RPC_'+method+'_FAILED');
    return value.result;
  }
  try{
    const ethers=await import('../public/vendor/ethers-6.15.0.min.js');
    const tokenArtifact=JSON.parse(fs.readFileSync(path.join(ROOT,'runtime/nusd/artifacts/NuminaUSD.json'),'utf8'));
    const settlementArtifact=JSON.parse(fs.readFileSync(path.join(ROOT,'runtime/nusd/artifacts/NuminaSettlement.json'),'utf8'));
    const unsigned=JSON.parse(fs.readFileSync(path.join(ROOT,'runtime/nusd/artifacts/unsigned-production-deployment.json'),'utf8'));
    const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'runtime/nusd/deployment.production.json'),'utf8'));
    if(unsigned.initialSupplyBaseUnits!==EXPECTED_SUPPLY||unsigned.supplyCapBaseUnits!==EXPECTED_SUPPLY||
       unsigned.initialRecipient.toLowerCase()!==SENDER.toLowerCase()||unsigned.issuerPolicySha256!==POLICY||
       cfg.initialSupplyNusd!=='1500000000000000'||cfg.supplyCapNusd!=='1500000000000000'){
      throw Error('PINNED_DEPLOYMENT_MISMATCH');
    }

    const observedChain=BigInt(await rpc('eth_chainId')).toString();
    if(observedChain!==CHAIN_ID)throw Error('CHAIN_MISMATCH');
    const genesis=await rpc('eth_getBlockByNumber',['0x0',false]);
    if(genesis?.hash?.toLowerCase()!==GENESIS)throw Error('GENESIS_MISMATCH');
    const accounts=await rpc('eth_accounts');
    if(!Array.isArray(accounts)||!accounts.some(a=>String(a).toLowerCase()===SENDER.toLowerCase()))throw Error('MANAGED_SIGNER_UNAVAILABLE');

    const tokenIface=new ethers.Interface(tokenArtifact.abi);
    const settlementIface=new ethers.Interface(settlementArtifact.abi);
    async function call(address,iface,name,args=[]){
      const data=iface.encodeFunctionData(name,args);
      const raw=await rpc('eth_call',[{to:address,data},'latest']);
      return iface.decodeFunctionResult(name,raw);
    }
    async function verifyToken(address){
      try{
        const [decimals]=await call(address,tokenIface,'decimals');
        const [supply]=await call(address,tokenIface,'totalSupply');
        const [cap]=await call(address,tokenIface,'cap');
        const [paused]=await call(address,tokenIface,'paused');
        const [balance]=await call(address,tokenIface,'balanceOf',[SENDER]);
        const [policy]=await call(address,tokenIface,'issuerPolicyHash');
        if(decimals!==18n||supply.toString()!==EXPECTED_SUPPLY||cap.toString()!==EXPECTED_SUPPLY||paused!==true||
           balance.toString()!==EXPECTED_SUPPLY||String(policy).toLowerCase()!=='0x'+POLICY)return null;
        for(const [name,address] of [['ISSUER_ROLE',cfg.roles.issuer],['MINTER_ROLE',cfg.roles.minter],['PAUSER_ROLE',cfg.roles.pauser]]){
          const [has]=await call(address?address:address,tokenIface,'hasRole',[ethers.id(name),address]);
          if(!has)return null;
        }
        const [admin]=await call(address,tokenIface,'defaultAdmin');
        if(ethers.getAddress(admin)!==ethers.getAddress(cfg.roles.admin))return null;
        return {decimals:Number(decimals),totalSupply:supply.toString(),cap:cap.toString(),paused,recipientBalance:balance.toString(),issuerPolicySha256:POLICY};
      }catch{return null;}
    }
    async function verifySettlement(address,tokenAddress){
      try{
        const [bound]=await call(address,settlementIface,'nusd');
        return ethers.getAddress(bound)===ethers.getAddress(tokenAddress);
      }catch{return false;}
    }

    // Recent exact creations are reconciled first. Previous attempts in this release did not broadcast,
    // so the bounded scan is sufficient for idempotent retries of this one-shot bridge.
    const latest=BigInt(await rpc('eth_blockNumber'));
    const floor=latest>500n?latest-500n:0n;
    const creations=[];
    for(let h=latest;h>=floor;h--){
      const block=await rpc('eth_getBlockByNumber',['0x'+h.toString(16),true]);
      for(const tx of block?.transactions||[]){
        if(String(tx?.from||'').toLowerCase()===SENDER.toLowerCase()&&tx.to===null){
          const receipt=await rpc('eth_getTransactionReceipt',[tx.hash]);
          if(receipt?.status==='0x1'&&receipt.contractAddress)creations.push({tx,receipt});
        }
      }
      if(h===0n)break;
    }

    let tokenTx=null,tokenState=null,tokenAddress=null;
    for(const c of creations){
      const state=await verifyToken(c.receipt.contractAddress);
      if(state){tokenTx=c;tokenState=state;tokenAddress=ethers.getAddress(c.receipt.contractAddress);break;}
    }

    const hex=n=>'0x'+BigInt(n).toString(16);
    async function sendCreation(data,label){
      const gas=BigInt(await rpc('eth_estimateGas',[{from:SENDER,data,value:'0x0'}]));
      const gasPrice=BigInt(await rpc('eth_gasPrice',[]));
      const balance=BigInt(await rpc('eth_getBalance',[SENDER,'pending']));
      const fee=gas*gasPrice;
      if(balance<fee)throw Error(label+'_INSUFFICIENT_GAS_BALANCE');
      const nonce=BigInt(await rpc('eth_getTransactionCount',[SENDER,'pending']));
      const hash=await rpc('eth_sendTransaction',[{from:SENDER,data,value:'0x0',nonce:hex(nonce),gas:hex(gas),gasPrice:hex(gasPrice)}]);
      if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error(label+'_INVALID_HASH');
      for(let i=0;i<120;i++){
        const receipt=await rpc('eth_getTransactionReceipt',[hash]);
        if(receipt){
          if(receipt.status!=='0x1'||!receipt.contractAddress)throw Error(label+'_REVERTED');
          return {tx:{hash,from:SENDER,nonce:hex(nonce)},receipt,reusedExisting:false,gas:gas.toString(),gasPrice:gasPrice.toString(),maximumFee:fee.toString()};
        }
        await sleep(500);
      }
      throw Error(label+'_RECEIPT_TIMEOUT');
    }

    if(!tokenTx){
      tokenTx=await sendCreation(unsigned.data,'NUSD');
      tokenAddress=ethers.getAddress(tokenTx.receipt.contractAddress);
      tokenState=await verifyToken(tokenAddress);
      if(!tokenState)throw Error('NUSD_POST_DEPLOY_VERIFICATION_FAILED');
    }else tokenTx.reusedExisting=true;

    let settlementTx=null,settlementAddress=null;
    for(const c of creations){
      const address=ethers.getAddress(c.receipt.contractAddress);
      if(address!==tokenAddress&&await verifySettlement(address,tokenAddress)){settlementTx=c;settlementAddress=address;break;}
    }
    if(!settlementTx){
      const constructor=ethers.AbiCoder.defaultAbiCoder().encode(['address'],[tokenAddress]).slice(2);
      settlementTx=await sendCreation(settlementArtifact.bytecode+constructor,'NUSD_SETTLEMENT');
      settlementAddress=ethers.getAddress(settlementTx.receipt.contractAddress);
      if(!await verifySettlement(settlementAddress,tokenAddress))throw Error('SETTLEMENT_BINDING_MISMATCH');
    }else settlementTx.reusedExisting=true;

    const finalBlock=BigInt(await rpc('eth_blockNumber'));
    const conf=receipt=>Number(finalBlock-BigInt(receipt.blockNumber)+1n);
    const result={
      schema:'numina.nusd.final-production-receipt.v1',identity:'NUMINA',status:'DEPLOYED_AND_VERIFIED',
      observedAt:new Date().toISOString(),chainId:observedChain,genesisHash:genesis.hash,sender:SENDER,
      issuance:{amountNusd:'1500000000000000',decimals:18,baseUnits:EXPECTED_SUPPLY,constructorMint:true,externallyBackedClaim:false},
      token:{address:tokenAddress,transactionHash:tokenTx.tx.hash,blockNumber:tokenTx.receipt.blockNumber,
        confirmations:conf(tokenTx.receipt),reusedExisting:tokenTx.reusedExisting===true,...tokenState,
        artifactSha256:unsigned.artifactSha256,sourceSha256:unsigned.sourceSha256},
      settlement:{address:settlementAddress,transactionHash:settlementTx.tx.hash,blockNumber:settlementTx.receipt.blockNumber,
        confirmations:conf(settlementTx.receipt),reusedExisting:settlementTx.reusedExisting===true,nusd:tokenAddress,
        sourceSha256:settlementArtifact.sourceSha256},
      verification:{chain:true,genesis:true,managedSigner:true,tokenState:true,constructorSupply:true,settlementBinding:true},
      finality:{requiredConfirmations:Number(REQUIRED_CONFIRMATIONS),fullyFinalized:conf(tokenTx.receipt)>=Number(REQUIRED_CONFIRMATIONS)&&conf(settlementTx.receipt)>=Number(REQUIRED_CONFIRMATIONS)},
      externalSettlement:{usd:false,usdc:false,bankReceipt:null,providerReceipt:null}
    };
    return response(res,200,result);
  }catch(error){
    return response(res,500,{schema:'numina.nusd.final-production-receipt.v1',status:'FAILED',error:String(error?.message||error),broadcastClaimed:false});
  }
}
