'use strict';

const {ARC_RPC_URL,ARC_TESTNET_CHAIN_ID}=require('./provider-observations');

function timeoutSignal(ms){return typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(ms):undefined;}
async function rpc(fetchFn,method,params,id){
  const response=await fetchFn(ARC_RPC_URL,{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),redirect:'manual',signal:timeoutSignal(7000)});
  const text=await response.text();if(Buffer.byteLength(text,'utf8')>131072)throw new Error('NETWORK_RESPONSE_TOO_LARGE');
  const body=JSON.parse(text);if(response.status!==200||body?.jsonrpc!=='2.0'||body?.id!==id||body?.error)throw new Error('ARC_RPC_INVALID_RESPONSE');return body.result;
}
async function readArcTransaction(txHash,{fetchFn=globalThis.fetch,now=()=>new Date()}={}){
  if(typeof fetchFn!=='function')throw new Error('FETCH_UNAVAILABLE');
  const hash=String(txHash||'').trim();if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error('ARC_TRANSACTION_HASH_INVALID');
  const [chainHex,tx,receipt]=await Promise.all([rpc(fetchFn,'eth_chainId',[],1),rpc(fetchFn,'eth_getTransactionByHash',[hash],2),rpc(fetchFn,'eth_getTransactionReceipt',[hash],3)]);
  const chainId=Number.parseInt(chainHex,16);if(chainId!==ARC_TESTNET_CHAIN_ID)throw new Error('ARC_CHAIN_ID_MISMATCH');
  if(!tx||!receipt)return {provider:'arc',event_id:hash,status:'PENDING',provider_timestamp:now().toISOString(),ledger_reference:null,network:'Arc Testnet',chain_id:chainId};
  const blockNumber=Number.parseInt(receipt.blockNumber,16);const success=receipt.status==='0x1';
  return {provider:'arc',event_id:hash,transaction_id:hash,status:success?'CONFIRMED':'FAILED',provider_timestamp:now().toISOString(),ledger_reference:String(blockNumber),block_number:blockNumber,network:'Arc Testnet',chain_id:chainId,destination:tx.to||null,amount_wei:tx.value?BigInt(tx.value).toString():null,raw:{transaction:tx,receipt}};
}
module.exports={readArcTransaction};
