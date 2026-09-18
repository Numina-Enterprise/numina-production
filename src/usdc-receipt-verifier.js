// Read-only RPC observations, not a signer, payment adapter, or reserve attestation.
// Network/chain: https://docs.base.org/get-started/connect-to-base
// Finality: https://docs.base.org/base-chain/specs/protocol/consensus/derivation
// Native USDC: https://developers.circle.com/stablecoins/usdc-contract-addresses
// Six decimals: https://github.com/circlefin/stablecoin-evm/blob/master/.env.example
// RPC: https://ethereum.org/developers/docs/apis/json-rpc/
// ERC-20 log/decimals: https://eips.ethereum.org/EIPS/eip-20
// Canonical historical eth_call: https://eips.ethereum.org/EIPS/eip-1898
const USDC_RECEIPT_RPC='https://mainnet.base.org';
const USDC_RECEIPT_TOKEN='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const USDC_RECEIPT_TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDC_RECEIPT_SCOPE='Read-only Base public RPC verification of one finalized native USDC Transfer event. Not an independent light-client proof, wallet ownership verification, NUSD conversion/backing attestation, ACH settlement, or provider deposit-credit confirmation.';
const USDC_RECEIPT_MAX_BYTES=524288;
const USDC_RECEIPT_MAX_ITEMS=4096;
const USDC_RECEIPT_TIMEOUT_MS=8000;
const usdcReceiptHash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
const usdcReceiptAddress=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const usdcReceiptQuantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/.test(value);
const usdcReceiptEqual=(left,right)=>typeof left==='string'&&typeof right==='string'&&left.toLowerCase()===right.toLowerCase();
function usdcReceiptError(reason,status='NOT_VERIFIED'){return Object.assign(new Error(reason),{usdcReceiptReason:reason,usdcReceiptStatus:status});}
function usdcReceiptRequire(condition,reason){if(!condition)throw usdcReceiptError(reason);}
function usdcReceiptAmount(value){
  if(typeof value!=='string'||value.length>79||!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value))return null;
  const [whole,fraction='']=value.split('.');
  const amount=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
  return amount>0n&&amount<(1n<<256n)?amount:null;
}
async function usdcReceiptJson(response){
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||BigInt(declared)>BigInt(USDC_RECEIPT_MAX_BYTES))){void response.body?.cancel().catch(()=>{});throw usdcReceiptError('RPC_RESPONSE_TOO_LARGE');}
  if(!response.body)throw usdcReceiptError('RPC_RESPONSE_INVALID');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>USDC_RECEIPT_MAX_BYTES){void reader.cancel().catch(()=>{});throw usdcReceiptError('RPC_RESPONSE_TOO_LARGE');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw usdcReceiptError('RPC_RESPONSE_INVALID');}
  }finally{reader.releaseLock();}
}
function usdcReceiptBlock(block){
  return block&&typeof block==='object'&&!Array.isArray(block)&&usdcReceiptHash(block.hash)&&usdcReceiptQuantity(block.number)&&usdcReceiptQuantity(block.timestamp);
}

// The caller must bind these evidence fields to its intended treasury request.
// env intentionally cannot select URLs, credentials, chain, token, or decimals.
export async function verifyUsdcReceipt(evidence,env,{fetcher=(...args)=>globalThis.fetch(...args)}={}){
  const supported=evidence?.network==='base';
  const source={provider:supported?'Base public JSON-RPC':null,network:typeof evidence?.network==='string'&&/^[a-z0-9_-]{1,32}$/.test(evidence.network)?evidence.network:null,chainId:supported?8453:null,transactionHash:usdcReceiptHash(evidence?.transactionHash)?evidence.transactionHash.toLowerCase():null};
  const result=(status,reason,extra={})=>({status,verified:status==='VERIFIED_ONCHAIN_TRANSFER',scope:USDC_RECEIPT_SCOPE,observedAt:new Date().toISOString(),reason,source:{...source,...extra}});
  if(!supported)return result('NOT_VERIFIED','NETWORK_NOT_SUPPORTED');
  const amount=usdcReceiptAmount(evidence?.amount);
  if(evidence?.rail!=='USDC'||typeof evidence.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(evidence.requestId)||amount===null||!source.transactionHash||!usdcReceiptAddress(evidence.from)||!usdcReceiptAddress(evidence.to)||!Number.isSafeInteger(evidence.logIndex)||evidence.logIndex<0||evidence.logIndex>4294967295)return result('NOT_VERIFIED','EVIDENCE_INVALID');
  const controller=new AbortController();let timer,id=0;
  // POST is only the JSON-RPC transport. Every allowlisted method below is read-only.
  const rpc=async(method,params)=>{
    if(controller.signal.aborted)throw usdcReceiptError('RPC_TIMEOUT','UNAVAILABLE');
    if(!['eth_chainId','eth_getTransactionReceipt','eth_getBlockByNumber','eth_call'].includes(method))throw usdcReceiptError('RPC_METHOD_NOT_ALLOWED');
    const requestId=++id;
    const response=await fetcher(USDC_RECEIPT_RPC,{method:'POST',redirect:'manual',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/json','Cache-Control':'no-store'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})});
    if(!response.ok||response.redirected){void response.body?.cancel().catch(()=>{});throw usdcReceiptError('RPC_UNAVAILABLE','UNAVAILABLE');}
    const body=await usdcReceiptJson(response);
    usdcReceiptRequire(body&&typeof body==='object'&&!Array.isArray(body)&&body.jsonrpc==='2.0'&&body.id===requestId,'RPC_RESPONSE_INVALID');
    if(Object.hasOwn(body,'error'))throw usdcReceiptError('RPC_ERROR','UNAVAILABLE');
    usdcReceiptRequire(Object.hasOwn(body,'result'),'RPC_RESPONSE_INVALID');
    return body.result;
  };
  try{return await Promise.race([
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(usdcReceiptError('RPC_TIMEOUT','UNAVAILABLE'));},USDC_RECEIPT_TIMEOUT_MS);}),
    (async()=>{
      usdcReceiptRequire(await rpc('eth_chainId',[])==='0x2105','CHAIN_ID_MISMATCH');
      const receipt=await rpc('eth_getTransactionReceipt',[source.transactionHash]);
      // null means not found or not mined; it does not establish submission.
      if(receipt===null)return result('PENDING','RECEIPT_NOT_FOUND');
      usdcReceiptRequire(receipt&&typeof receipt==='object'&&!Array.isArray(receipt)&&usdcReceiptEqual(receipt.transactionHash,source.transactionHash)&&usdcReceiptHash(receipt.blockHash)&&usdcReceiptQuantity(receipt.blockNumber)&&usdcReceiptQuantity(receipt.transactionIndex),'RECEIPT_INVALID');
      usdcReceiptRequire(receipt.status==='0x1',receipt.status==='0x0'?'TRANSACTION_REVERTED':'RECEIPT_STATUS_INVALID');
      usdcReceiptRequire(Array.isArray(receipt.logs)&&receipt.logs.length>0&&receipt.logs.length<=USDC_RECEIPT_MAX_ITEMS,'RECEIPT_LOGS_INVALID');
      const indices=new Set();let matched;
      for(const log of receipt.logs){
        usdcReceiptRequire(log&&typeof log==='object'&&usdcReceiptQuantity(log.logIndex)&&!indices.has(log.logIndex),'RECEIPT_LOGS_INVALID');
        indices.add(log.logIndex);
        if(BigInt(log.logIndex)===BigInt(evidence.logIndex))matched=log;
      }
      usdcReceiptRequire(matched&&matched.removed===false&&usdcReceiptEqual(matched.transactionHash,source.transactionHash)&&usdcReceiptEqual(matched.blockHash,receipt.blockHash)&&matched.blockNumber===receipt.blockNumber&&matched.transactionIndex===receipt.transactionIndex,'TRANSFER_LOG_NOT_FOUND_OR_INCONSISTENT');
      const topic=address=>'0x'+'0'.repeat(24)+address.slice(2).toLowerCase();
      usdcReceiptRequire(usdcReceiptEqual(matched.address,USDC_RECEIPT_TOKEN)&&Array.isArray(matched.topics)&&matched.topics.length===3&&usdcReceiptEqual(matched.topics[0],USDC_RECEIPT_TRANSFER_TOPIC)&&usdcReceiptEqual(matched.topics[1],topic(evidence.from))&&usdcReceiptEqual(matched.topics[2],topic(evidence.to))&&usdcReceiptHash(matched.data)&&BigInt(matched.data)===amount,'USDC_TRANSFER_MISMATCH');
      const finalized=await rpc('eth_getBlockByNumber',['finalized',false]);
      if(finalized===null)return result('PENDING','FINALITY_NOT_AVAILABLE');
      usdcReceiptRequire(usdcReceiptBlock(finalized),'FINALITY_RESPONSE_INVALID');
      if(BigInt(receipt.blockNumber)>BigInt(finalized.number))return result('PENDING','AWAITING_FINALITY');
      // A canonical block at/below this provider's finalized head is finalized
      // under Base's derivation rules. This is RPC trust, not a locally checked
      // Merkle proof or independently walked/validated L1/L2 header chain.
      const canonical=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
      usdcReceiptRequire(usdcReceiptBlock(canonical)&&canonical.number===receipt.blockNumber&&usdcReceiptEqual(canonical.hash,receipt.blockHash),'RECEIPT_BLOCK_NOT_CANONICAL');
      usdcReceiptRequire(Array.isArray(canonical.transactions)&&canonical.transactions.length<=USDC_RECEIPT_MAX_ITEMS&&canonical.transactions.every(usdcReceiptHash)&&BigInt(receipt.transactionIndex)<BigInt(canonical.transactions.length)&&usdcReceiptEqual(canonical.transactions[Number(BigInt(receipt.transactionIndex))],source.transactionHash),'TRANSACTION_NOT_IN_CANONICAL_BLOCK');
      const canonicalFinalized=finalized.number===canonical.number?canonical:await rpc('eth_getBlockByNumber',[finalized.number,false]);
      usdcReceiptRequire(usdcReceiptBlock(canonicalFinalized)&&canonicalFinalized.number===finalized.number&&usdcReceiptEqual(canonicalFinalized.hash,finalized.hash),'FINALIZED_BLOCK_NOT_CANONICAL');
      const decimals=await rpc('eth_call',[{to:USDC_RECEIPT_TOKEN,data:'0x313ce567'},{blockHash:receipt.blockHash.toLowerCase(),requireCanonical:true}]);
      usdcReceiptRequire(usdcReceiptHash(decimals)&&BigInt(decimals)===6n,'USDC_DECIMALS_MISMATCH');
      return result('VERIFIED_ONCHAIN_TRANSFER','FINALIZED_USDC_TRANSFER_MATCHED',{
        rpcUrl:USDC_RECEIPT_RPC,tokenContract:USDC_RECEIPT_TOKEN,tokenDecimals:6,amount:evidence.amount,amountBaseUnits:amount.toString(),from:evidence.from.toLowerCase(),to:evidence.to.toLowerCase(),logIndex:evidence.logIndex,
        blockHash:receipt.blockHash.toLowerCase(),blockNumber:BigInt(receipt.blockNumber).toString(),blockTimestamp:BigInt(canonical.timestamp).toString(),transactionIndex:Number(BigInt(receipt.transactionIndex)),
        finalizedBlockHash:finalized.hash.toLowerCase(),finalizedBlockNumber:BigInt(finalized.number).toString(),finality:'finalized',verificationBasis:'pinned_public_rpc_canonical_finalized_observation'
      });
    })()
  ]);}catch(error){return result(error?.usdcReceiptStatus||'UNAVAILABLE',error?.usdcReceiptReason||'RPC_UNAVAILABLE');}
  finally{clearTimeout(timer);controller.abort();}
}
