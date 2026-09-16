import {readFileSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {publicAddress,exactInteger,sha256} from './prepare.mjs';

// Only these read methods are callable. No signer, key generation or broadcast method exists here.
const METHODS=new Set(['eth_chainId','eth_getBlockByNumber','eth_getBalance','eth_getTransactionCount','eth_gasPrice','eth_estimateGas']);
export async function collectNetwork({rpcUrl,authorization,sender,constructorData=null,expectedChainId='962421430',expectedGenesisHash=null},fetcher=fetch){
 const url=new URL(rpcUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Use a credential-free HTTPS RPC URL and keep authentication in the environment');
 sender=publicAddress(sender);exactInteger(expectedChainId);
 if(expectedGenesisHash!==null&&!/^0x[0-9a-fA-F]{64}$/.test(expectedGenesisHash))throw Error('Invalid expected genesis hash');
 if(constructorData!==null&&!/^0x(?:[0-9a-fA-F]{2})+$/.test(constructorData))throw Error('Invalid constructor data');
 const observations=[];let id=0;
 async function read(method,params){if(!METHODS.has(method))throw Error('Read method not allowed');const requestId=++id;let response;
  try{response=await fetcher(url.href,{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('RPC request failed; credentials and provider response were not recorded');}
  if(!response.ok)throw Error('RPC HTTP '+response.status);let body;try{body=await response.json();}catch{throw Error('RPC returned invalid JSON');}
  if(body.jsonrpc!=='2.0'||body.id!==requestId||body.error||!Object.hasOwn(body,'result'))throw Error('RPC result unavailable for '+method);
  observations.push({method,params,result:body.result});return body.result;
 }
 const quantity=value=>{if(typeof value!=='string'||!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))throw Error('Invalid RPC quantity');return BigInt(value).toString();};
 const chainId=quantity(await read('eth_chainId',[])),genesis=await read('eth_getBlockByNumber',['0x0',false]),block=await read('eth_getBlockByNumber',['latest',false]);
 if(chainId!==expectedChainId)throw Error('Observed chain does not match the selected chain');
 for(const record of [genesis,block])if(!record||!/^0x[0-9a-fA-F]{64}$/.test(record.hash))throw Error('RPC block identity unavailable');
 if(quantity(genesis.number)!=='0')throw Error('RPC genesis is not block zero');
 if(expectedGenesisHash!==null&&genesis.hash.toLowerCase()!==expectedGenesisHash.toLowerCase())throw Error('Observed genesis does not match the reviewed pin');
 const balance=quantity(await read('eth_getBalance',[sender,block.number])),nonce=quantity(await read('eth_getTransactionCount',[sender,'pending'])),gasPrice=quantity(await read('eth_gasPrice',[]));
 const gasLimit=constructorData===null?null:quantity(await read('eth_estimateGas',[{from:sender,data:constructorData,value:'0x0'}]));
 const reread=await read('eth_getBlockByNumber',[block.number,false]);if(reread?.hash?.toLowerCase()!==block.hash.toLowerCase())throw Error('Observed block changed during collection');
 return {schema:'numina.nusd.network-observation.v1',observedAt:new Date().toISOString(),rpcOrigin:url.origin,chainId,genesisHash:genesis.hash,block:{number:quantity(block.number),hash:block.hash},expectedGenesisMatched:expectedGenesisHash!==null,sender,senderControlVerified:false,pendingNonce:nonce,feeBalanceBaseUnits:balance,suggestedLegacyGasPrice:gasPrice,estimatedGasLimit:gasLimit,estimatedLegacyFeeBaseUnits:gasLimit===null?null:(BigInt(gasLimit)*BigInt(gasPrice)).toString(),feeAsset:null,maximumFeeBudget:null,feeBudgetApproved:false,constructorDataSha256:constructorData?sha256(Buffer.from(constructorData.slice(2),'hex')):null,observations,scope:'single_provider_read_only_observation_not_wallet_authority_or_final_fee_approval',signed:false,broadcast:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(Number(process.versions.node.split('.')[0])!==24)throw Error('Node 24 is required');const args=process.argv.slice(2),output=args[args.indexOf('--output')+1];if(!args.includes('--output')||!output)throw Error('Usage: node tool/collect-network.mjs INPUT.json --output OUTPUT.json');
 const input=JSON.parse(readFileSync(args[0]));if(Object.hasOwn(input,'authorization'))throw Error('Keep credentials out of configuration; use NUMINA_RPC_AUTHORIZATION');
 const report=await collectNetwork({...input,authorization:process.env.NUMINA_RPC_AUTHORIZATION});writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({chainId:report.chainId,block:report.block,expectedGenesisMatched:report.expectedGenesisMatched,signed:false,broadcast:false}));
}
