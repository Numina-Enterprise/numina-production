// Production read-only provider observation adapter; TEMP placeholder removed; child observations intentionally omit partnership_status.
const CIRCLE_PING_URL='https://api.circle.com/ping';
const ARC_RPC_URL='https://rpc.testnet.arc.network';
const ARC_TESTNET_CHAIN_ID=5042002;
const SUPPORTED_READ_ONLY_PROVIDERS=Object.freeze(['arc','circle']);

function timeoutSignal(ms){return typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(ms):undefined;}
function safeError(error){const name=String(error?.name||'Error').replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80);return name||'Error';}
async function jsonResponse(response){
  const text=await response.text();
  if(Buffer.byteLength(text,'utf8')>65536)throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
  try{return JSON.parse(text);}catch{throw new Error('PROVIDER_RESPONSE_INVALID_JSON');}
}
async function circleObservation(fetchFn){
  const started=Date.now();
  try{
    const response=await fetchFn(CIRCLE_PING_URL,{method:'GET',headers:{accept:'application/json'},redirect:'manual',signal:timeoutSignal(5000)});
    const body=await jsonResponse(response);
    const healthy=response.status===200&&body?.message==='pong';
    return {provider:'circle',service:'circle-api',network:null,endpoint:CIRCLE_PING_URL,healthy,http_status:response.status,latency_ms:Date.now()-started,observed:{message:typeof body?.message==='string'?body.message:null}};
  }catch(error){return {provider:'circle',service:'circle-api',network:null,endpoint:CIRCLE_PING_URL,healthy:false,http_status:null,latency_ms:Date.now()-started,error:safeError(error),observed:null};}
}
async function arcRpc(fetchFn,method,id){
  const response=await fetchFn(ARC_RPC_URL,{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params:[]}),redirect:'manual',signal:timeoutSignal(5000)});
  const body=await jsonResponse(response);
  if(response.status!==200||body?.jsonrpc!=='2.0'||body?.id!==id||body?.error)throw new Error('ARC_RPC_INVALID_RESPONSE');
  return {status:response.status,result:body.result};
}
async function arcObservation(fetchFn){
  const started=Date.now();
  try{
    const chain=await arcRpc(fetchFn,'eth_chainId',1);
    const block=await arcRpc(fetchFn,'eth_blockNumber',2);
    const chainId=typeof chain.result==='string'?Number.parseInt(chain.result,16):NaN;
    const blockNumber=typeof block.result==='string'?Number.parseInt(block.result,16):NaN;
    const healthy=chainId===ARC_TESTNET_CHAIN_ID&&Number.isSafeInteger(blockNumber)&&blockNumber>=0;
    return {provider:'arc',service:'arc-testnet-rpc',network:'Arc Testnet',endpoint:ARC_RPC_URL,healthy,http_status:chain.status,latency_ms:Date.now()-started,observed:{chain_id:chainId,latest_block:blockNumber,currency:'USDC',rpc_methods:['eth_chainId','eth_blockNumber']}};
  }catch(error){return {provider:'arc',service:'arc-testnet-rpc',network:'Arc Testnet',endpoint:ARC_RPC_URL,healthy:false,http_status:null,latency_ms:Date.now()-started,error:safeError(error),observed:{chain_id:ARC_TESTNET_CHAIN_ID,currency:'USDC',rpc_methods:['eth_chainId','eth_blockNumber']}};}
}
async function observeProvider(provider,{fetchFn=globalThis.fetch,now=()=>new Date()}={}){
  const key=String(provider||'').trim().toLowerCase();
  if(!SUPPORTED_READ_ONLY_PROVIDERS.includes(key))throw new Error('READ_ONLY_PROVIDER_OBSERVATION_UNSUPPORTED');
  if(typeof fetchFn!=='function')throw new Error('FETCH_UNAVAILABLE');
  const result=key==='circle'?await circleObservation(fetchFn):await arcObservation(fetchFn);
  return {schema:'numina.provider-observation.v1',provider:key,mode:'public-read-only-health',source_authority:'provider_public_endpoint',credentialed:false,external_execution_performed:false,observed_at:now().toISOString(),...result};
}

module.exports={observeProvider,SUPPORTED_READ_ONLY_PROVIDERS,CIRCLE_PING_URL,ARC_RPC_URL,ARC_TESTNET_CHAIN_ID};
