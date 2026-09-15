// This adapter reads one configured live Financial account. It has no money-movement methods.
import {isTreasuryMinorInteger,formatTreasuryProviderAmount} from '../public/treasury-amount.js';
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
function stripeTreasuryInteger(value){
  const exact=typeof value==='bigint'?value.toString():value;
  if(!['number','bigint'].includes(typeof value)||!isTreasuryMinorInteger(exact))throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
  return exact;
}
function stripeTreasuryAmount(bucket,currency){
  const amount=bucket?.[currency];
  if(amount===undefined||amount===null)return null;
  if(amount.currency!==currency)throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
  // Keep the provider integer exact. USD uses cents; USDC uses six decimal places.
  const value=stripeTreasuryInteger(amount.value);
  return {currency,value,formatted:formatTreasuryProviderAmount(value,currency)};
}
async function stripeTreasuryJson(response){
  if(!response.body)throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536){void reader.cancel().catch(()=>{});throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);}chunks.push(value);}
    const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength;}
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(combined);
    // Validate syntax first, discarding the rounded parse. This prevents replacing
    // invalid unquoted numeric keys with strings from repairing malformed JSON.
    JSON.parse(raw);
    const originalStrings=new Set([...raw.matchAll(/"(?:\\.|[^"\\])*"/g)].map(match=>JSON.parse(match[0])));
    const integers=new Map();let next=0;
    // Replace only unsafe numeric tokens with placeholders absent from every
    // original decoded string. Revive as BigInt; quoted amount strings stay invalid.
    const lossless=raw.replace(/"(?:\\.|[^"\\])*"|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,(token,numeric)=>{
      if(numeric===undefined)return token;
      if(!/^-?(?:0|[1-9]\d*)$/.test(numeric)||numeric.replace(/^-/,'').length>78)throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);
      const integer=BigInt(numeric);
      if(integer<=9007199254740991n&&integer>= -9007199254740991n)return numeric;
      let marker;do{marker='__numina_exact_integer_'+next+++'__';}while(originalStrings.has(marker));
      integers.set(marker,integer);return JSON.stringify(marker);
    });
    return JSON.parse(lossless,(_key,value)=>typeof value==='string'&&integers.has(value)?integers.get(value):value);
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
      const reportedCurrencies=[...new Set(['available','inbound_pending','outbound_pending'].flatMap(name=>Object.keys(value.balance[name]||{})))].sort();
      const providerNusd={status:reportedCurrencies.includes('nusd')?'reported_currency_requires_asset_verification':'not_reported',precision:null,tokenIdentityVerified:false,buckets:{}};
      for(const name of ['available','inbound_pending','outbound_pending']){const amount=value.balance[name]?.nusd;if(amount!=null){if(amount.currency!=='nusd')throw stripeTreasuryError('STRIPE_TREASURY_INVALID_RESPONSE',502);providerNusd.buckets[name]={currency:'nusd',value:stripeTreasuryInteger(amount.value)};}}
      const header=name=>{const text=response.headers.get(name);return text&&/^[A-Za-z0-9._-]{1,100}$/.test(text)?text:null;};
      return {schema:'numina.stripe.treasury.v1',provider:'Stripe',connection:'read_only',account:{id,name:typeof value.display_name==='string'&&value.display_name.trim()?value.display_name.trim().slice(0,160):'Financial account',status:value.status,livemode:true},balances,reported_currencies:reportedCurrencies,provider_nusd_balance:providerNusd,treasury_policy:'/api/control/v2/treasury/policy',observed_at:new Date().toISOString(),provider_request_id:header('request-id'),provider_api_version:header('stripe-version'),dashboard_url:'https://dashboard.stripe.com/'+STRIPE_TREASURY_ACCOUNT+'/treasury',transfer_execution:false,nusd_settlement:false};
    })()
  ]);}catch(error){if(['STRIPE_TREASURY_UNAVAILABLE','STRIPE_TREASURY_INVALID_RESPONSE','STRIPE_TREASURY_TIMEOUT'].includes(error?.code))throw error;stripeTreasuryDiagnostic({event:'stripe_treasury_runtime_error',stage,response_received:stage!=='fetch_pending',category:stripeTreasuryExceptionCategory(error),error_name:['Error','TypeError','RangeError','AbortError','NetworkError','SecurityError','NotSupportedError'].includes(error?.name)?error.name:'OtherError'});throw stripeTreasuryError('STRIPE_TREASURY_UNAVAILABLE',503);}
  finally{clearTimeout(timer);controller.abort();}
}
