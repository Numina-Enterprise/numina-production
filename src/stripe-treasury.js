// This adapter reads one configured live Financial account. It has no money-movement methods.
export const STRIPE_TREASURY_ACCOUNT='acct_1UEEPnQdJat0efmT';
export const STRIPE_TREASURY_FINANCIAL_ACCOUNT='fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu';
const STRIPE_TREASURY_VERSION='2026-08-26.preview';
function stripeTreasuryError(code,status){return Object.assign(new Error(code),{code,status});}
function stripeTreasuryDiagnostic(value){try{console.log(JSON.stringify(value));}catch{}}
function stripeTreasuryExceptionCategory(error){
  const message=typeof error?.message==='string'?error.message:'';
  if(/illegal invocation|incorrect receiver|incompatible receiver/i.test(message))return 'invalid_receiver';
  if(/not implemented|not supported|unsupported/i.test(message))return 'unsupported_runtime_option';
  if(/different request|outside.*request|request context/i.test(message))return 'request_context';
  if(/redirect/i.test(message))return 'redirect_rejected';
  if(/permission|denied|blocked|not allowed|disallowed/i.test(message))return 'request_blocked';
  if(/invalid.*header|header.*invalid/i.test(message))return 'invalid_request_header';
  if(/network|connection|fetch failed|failed to fetch|disconnected|dns/i.test(message))return 'network_failure';
  return 'unclassified';
}
function stripeTreasuryAmount(bucket,currency){
  const amount=bucket?.[currency];
  if(amount===undefined||amount===null)return null;
  if(amount.currency!==currency||!Number.isSafeInteger(amount.value))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
  // Keep the provider integer exact. USD uses cents; USDC uses six decimal places.
  const digits=currency==='usd'?2:6,raw=BigInt(amount.value),absolute=raw<0n?-raw:raw;
  const padded=absolute.toString().padStart(digits+1,'0'),whole=padded.slice(0,-digits).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const decimal=whole+'.'+padded.slice(-digits),sign=raw<0n?'-':'';
  return {currency,value:amount.value,formatted:currency==='usd'?sign+'$'+decimal:sign+decimal+' USDC'};
}
async function stripeTreasuryJson(response){
  if(!response.body)throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){void reader.cancel().catch(()=>{});throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);}chunks.push(value);}
    const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(combined);
    // Financial account numbers are integer minor units. Check raw tokens before
    // JSON.parse can round a fractional or out-of-range number into a safe integer.
    // Quoted strings are consumed separately, so account names are not interpreted.
    for(const token of raw.matchAll(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g)){
      if(token[1]===undefined)continue;
      if(!/^-?(?:0|[1-9]\d*)$/.test(token[1]))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
      const integer=BigInt(token[1]);if(integer>9007199254740991n||integer< -9007199254740991n)throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
    }
    return JSON.parse(raw);
  }catch(error){if(error.code==='STRIPE_TREASURY_INVALID_RESPONSE')throw error;throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);}
  finally{reader.releaseLock();}
}
export async function readStripeTreasury(env,{fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=8000}={}){
  const key=env.NUMINA_STRIPE_TREASURY_READ_KEY,id=env.NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT;
  if(typeof key!=='string'||!/^rk_live_[A-Za-z0-9]{16,}$/.test(key)||id!==STRIPE_TREASURY_FINANCIAL_ACCOUNT)throw stripeTreasuryError('STRIPE_TREASURY_NOT_CONNECTED',503);
  const controller=new AbortController();let timer,stage='fetch_pending';
  try{return await Promise.race([
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(stripeTreasuryError('STRIPE_TREASURY_TIMEOUT',504));},timeoutMs);}),
    (async()=>{
      // Managed Workers may not enable RequestInit.cache. HTTP headers avoid that
      // compatibility dependency while private responses also remain no-store.
      // Inspect redirects as failed responses without following them or forwarding credentials.
      const response=await fetcher('https://api.stripe.com/v2/money_management/financial_accounts/'+id,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+key,'Stripe-Version':STRIPE_TREASURY_VERSION,Accept:'application/json','Cache-Control':'no-store',Pragma:'no-cache'}});
      stage='response_received';
      if(!response.ok||response.redirected){const requestId=response.headers.get('request-id');stripeTreasuryDiagnostic({event:'stripe_treasury_provider_error',http_status:response.status,request_id:requestId&&/^[A-Za-z0-9._-]{1,100}$/.test(requestId)?requestId:null});void response.body?.cancel().catch(()=>{});throw stripeTreasuryError('STRIPE_TREASURY_UNAVAILABLE',503);}
      const value=await stripeTreasuryJson(response);
      stage='body_read';
      if(!value||value.object!=='v2.money_management.financial_account'||value.id!==id||value.livemode!==true||value.type!=='storage'||!['open','closed'].includes(value.status)||!value.balance||typeof value.balance!=='object'||Array.isArray(value.balance))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
      const balances={};for(const name of ['available','inbound_pending','outbound_pending']){
        const bucket=value.balance[name];if(bucket!==undefined&&bucket!==null&&(typeof bucket!=='object'||Array.isArray(bucket)))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
        balances[name]={usd:stripeTreasuryAmount(bucket,'usd'),usdc:stripeTreasuryAmount(bucket,'usdc')};
      }
      const header=name=>{const text=response.headers.get(name);return text&&/^[A-Za-z0-9._-]{1,100}$/.test(text)?text:null;};
      return {schema:'numina.stripe.treasury.v1',provider:'Stripe',connection:'read_only',account:{id,name:typeof value.display_name==='string'&&value.display_name.trim()?value.display_name.trim().slice(0,160):'Financial account',status:value.status,livemode:true},balances,observed_at:new Date().toISOString(),provider_request_id:header('request-id'),provider_api_version:header('stripe-version'),dashboard_url:'https://dashboard.stripe.com/'+STRIPE_TREASURY_ACCOUNT+'/treasury',transfer_execution:false,nusd_settlement:false};
    })()
  ]);}catch(error){if(['STRIPE_TREASURY_UNAVAILABLE','STRIPE_TREASURY_INVALID_RESPONSE','STRIPE_TREASURY_TIMEOUT'].includes(error?.code))throw error;stripeTreasuryDiagnostic({event:'stripe_treasury_runtime_error',stage,response_received:stage!=='fetch_pending',category:stripeTreasuryExceptionCategory(error),error_name:['Error','TypeError','RangeError','AbortError','NetworkError','SecurityError','NotSupportedError'].includes(error?.name)?error.name:'OtherError'});throw stripeTreasuryError('STRIPE_TREASURY_UNAVAILABLE',503);}
  finally{clearTimeout(timer);controller.abort();}
}
