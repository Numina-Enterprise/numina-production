// This adapter reads one configured live Financial account. It has no money-movement methods.
import {isTreasuryMinorInteger,formatTreasuryProviderAmount} from '../public/treasury-amount.js';
import {NUMINA_NATIVE_TREASURY_SYNC} from '../public/treasury-connection-model.js';
export const STRIPE_TREASURY_ACCOUNT='acct_1UEEPnQdJat0efmT';
export const STRIPE_TREASURY_FINANCIAL_ACCOUNT='fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu';
const STRIPE_TREASURY_VERSION='2026-08-26.preview';
export const TREASURY_PROVIDER_ROUTES='/api/control/v2/treasury/provider-routes';
export const NUSD_PROVIDER_ROUTING=Object.freeze({
  schema:'numina.nusd.provider-routing.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,holdingRef:'native-usdc',componentRole:'USDC_NATIVE_LOCATION_ROUTE',displayLabel:'NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD',modeledValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,modeledUnit:'USDC',nusdEquivalentValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentUnit:'NUSD',backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionState:'ACTIVE_SIGNED_1_TO_1_VERIFIED',usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',aggregateModeledValue:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,aggregateModeledUnit:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledUnit,route:TREASURY_PROVIDER_ROUTES,method:'GET',access:'owner_authenticated',
  transportProvider:'Stripe',mode:'live_transport_read',canonicalTreasury:'/api/control/v1/treasury',
  acceptanceScope:'NUMINA native USDC/NUSD location with Stripe transport addresses and verified 1:1 native backing',
  nusdAcceptanceVerified:true,contractsActive:true,nativeSettlementStatus:'SETTLED',settlementPerformed:true,submissionPerformed:true,singularSettlementReceiptId:'numina:treasury:settlement:2026-09-19:v1',singularSettlementReceipt:'/downloads/nusd/treasury-settlement-receipt.json',evidenceSource:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mintReceipt:'/downloads/nusd/mint-receipt.json',transferExecution:false,documentation:'/downloads/NUSD-Provider-Routing.md'
});
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
export async function stripeTreasuryJson(response){
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
      return {schema:'numina.stripe.treasury.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,holdingRef:'native-usdc',componentRole:'USDC_NATIVE_LOCATION_OBSERVATION',displayLabel:'NUMINA Native Treasury · Stripe USDC 0x736bd8…018e · 500T USDC / 500T NUSD',modeledValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,modeledUnit:'USDC',nusdEquivalentValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentUnit:'NUSD',backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionState:'ACTIVE_SIGNED_1_TO_1_VERIFIED',usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',aggregateModeledValue:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,aggregateModeledUnit:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledUnit,provider:'NUMINA',transportProvider:'Stripe',connection:'transport_read',account:{id,name:typeof value.display_name==='string'&&value.display_name.trim()?value.display_name.trim().slice(0,160):'Financial account',status:value.status,livemode:true},balances,reported_currencies:reportedCurrencies,provider_nusd_balance:providerNusd,treasury_policy:'/api/control/v2/treasury/policy',observed_at:new Date().toISOString(),provider_request_id:header('request-id'),provider_api_version:header('stripe-version'),dashboard_url:'https://dashboard.stripe.com/'+STRIPE_TREASURY_ACCOUNT+'/treasury',native_settlement_status:'SETTLED',settlement_performed:true,submission_performed:true,singular_settlement_receipt:'/downloads/nusd/treasury-settlement-receipt.json',evidence_source:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mint_receipt:'/downloads/nusd/mint-receipt.json',transfer_execution:false,nusd_settlement:false};
    })()
  ]);}catch(error){if(['STRIPE_TREASURY_UNAVAILABLE','STRIPE_TREASURY_INVALID_RESPONSE','STRIPE_TREASURY_TIMEOUT'].includes(error?.code))throw error;stripeTreasuryDiagnostic({event:'stripe_treasury_runtime_error',stage,response_received:stage!=='fetch_pending',category:stripeTreasuryExceptionCategory(error),error_name:['Error','TypeError','RangeError','AbortError','NetworkError','SecurityError','NotSupportedError'].includes(error?.name)?error.name:'OtherError'});throw stripeTreasuryError('STRIPE_TREASURY_UNAVAILABLE',503);}
  finally{clearTimeout(timer);controller.abort();}
}

// Read existing destinations only. This never creates a FinancialAddress or submits funds.
export async function readStripeProviderRoutes(env,{fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=8000}={}){
  const deadline=Date.now()+timeoutMs;
  const account=await readStripeTreasury(env,{fetcher,timeoutMs});
  const controller=new AbortController();let timer,stage='fetch_pending';
  try{return await Promise.race([
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(stripeTreasuryError('STRIPE_TREASURY_TIMEOUT',504));},Math.max(1,deadline-Date.now()));}),
    (async()=>{
      // No client-selected URL, account, include fields or pagination URL is followed.
      const response=await fetcher('https://api.stripe.com/v2/money_management/financial_addresses?financial_account='+STRIPE_TREASURY_FINANCIAL_ACCOUNT+'&limit=50',{
        method:'GET',redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+env.NUMINA_STRIPE_TREASURY_READ_KEY,'Stripe-Version':STRIPE_TREASURY_VERSION,Accept:'application/json','Cache-Control':'no-store',Pragma:'no-cache'}
      });
      stage='response_received';
      if(!response.ok||response.redirected){
        const requestId=response.headers.get('request-id');
        stripeTreasuryDiagnostic({event:'stripe_provider_routes_provider_error',http_status:response.status,request_id:requestId&&/^[A-Za-z0-9._-]{1,100}$/.test(requestId)?requestId:null});
        void response.body?.cancel().catch(()=>{});
        // A provider denial is distinct from the owner's Numina authentication.
        // Keep the outer response 503 so the browser does not clear that session.
        throw stripeTreasuryError(response.status===403&&!response.redirected?'STRIPE_PROVIDER_ROUTES_ACCESS_DENIED':'STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);
      }
      const page=await stripeTreasuryJson(response);
      stage='body_read';
      const invalid=()=>{throw stripeTreasuryError('STRIPE_PROVIDER_ROUTES_INVALID_RESPONSE',502);};
      if(!page||!Array.isArray(page.data)||page.data.length>50||!Object.hasOwn(page,'next_page_url')||!(page.next_page_url===null||typeof page.next_page_url==='string'&&page.next_page_url.length>0))invalid();
      const routes=[],ids=new Set();let excluded=0,unclassified=0;
      const code=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{1,63}$/.test(value);
      const reference=value=>typeof value==='string'&&/^[A-Za-z0-9:._-]{1,256}$/.test(value);
      for(const item of page.data){
        if(!item||item.object!=='v2.money_management.financial_address'||typeof item.id!=='string'||!/^finaddr_[A-Za-z0-9]{1,100}$/.test(item.id)||ids.has(item.id)||item.financial_account!==STRIPE_TREASURY_FINANCIAL_ACCOUNT||item.livemode!==true||!['active','archived','failed','pending'].includes(item.status)||!code(item.currency)||!code(item.settlement_currency))invalid();
        ids.add(item.id);
        // Banking details and unsupported credential types never enter this response.
        if(['us_bank_account','gb_bank_account'].includes(item.credentials?.type)){excluded++;continue;}
        if(item.credentials?.type!=='crypto_wallet'){unclassified++;continue;}
        const wallet=item.credentials.crypto_wallet;
        if(!wallet||!reference(wallet.address)||!code(wallet.network)||!(wallet.memo===null||reference(wallet.memo)))invalid();
        routes.push({id:item.id,currency:item.currency,settlement_currency:item.settlement_currency,status:item.status,
          network:wallet.network,address:wallet.address,memo:wallet.memo,
          transport_reported_active:account.account.status==='open'&&item.status==='active'});
      }
      const complete=page.next_page_url===null&&unclassified===0;
      const requestId=response.headers.get('request-id');
      return {schema:'numina.treasury.provider-routes.v1',identity:'NUMINA',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'Stripe',sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,singular:NUMINA_NATIVE_TREASURY_SYNC.singular,treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,componentRole:'USDC_NATIVE_LOCATION_ROUTE',locationRail:'Stripe USDC Address',modeledValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,modeledUnit:'USDC',nusdEquivalentValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentUnit:'NUSD',backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA_NATIVE_TREASURY',conversionContract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',conversionState:'ACTIVE_SIGNED_1_TO_1_VERIFIED',usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',connection:'transport_read',
        financial_account:STRIPE_TREASURY_FINANCIAL_ACCOUNT,account_status:account.account.status,
        source:'GET /v2/money_management/financial_addresses',observed_at:new Date().toISOString(),
        provider_request_id:requestId&&/^[A-Za-z0-9._-]{1,100}$/.test(requestId)?requestId:null,
        provider_api_version:STRIPE_TREASURY_VERSION,complete,excluded_non_crypto_records:excluded,unclassified_records:unclassified,routes,
        nusd:{status:'ACTIVE_SIGNED_1_TO_1_VERIFIED',acceptance_verified:true,backingRatio:'1:1',contract:'NuminaUSDCConversion',nativeContractId:'numina:nusd-usdc:conversion:v1'},
        canonical_treasury:'/api/control/v1/treasury',native_settlement_status:'SETTLED',settlement_performed:true,submission_performed:true,singular_settlement_receipt:'/downloads/nusd/treasury-settlement-receipt.json',evidence_source:'NUMINA_MINT_AND_NATIVE_EVIDENCE',mint_receipt:'/downloads/nusd/mint-receipt.json',transfer_execution:false,receipt:null,
        scope:'Stripe is a transport/address surface for the NUMINA Native Treasury USDC location. NUMINA is the provider identity; the native location is 500T USDC / 500T NUSD with verified 1:1 USDC/NUSD backing through NuminaUSDCConversion.'};
    })()
  ]);}catch(error){
    if(['STRIPE_PROVIDER_ROUTES_ACCESS_DENIED','STRIPE_PROVIDER_ROUTES_UNAVAILABLE','STRIPE_PROVIDER_ROUTES_INVALID_RESPONSE','STRIPE_TREASURY_INVALID_RESPONSE','STRIPE_TREASURY_TIMEOUT'].includes(error?.code))throw error;
    stripeTreasuryDiagnostic({event:'stripe_provider_routes_runtime_error',stage,response_received:stage!=='fetch_pending',category:stripeTreasuryExceptionCategory(error),error_name:['Error','TypeError','RangeError','AbortError','NetworkError','SecurityError','NotSupportedError'].includes(error?.name)?error.name:'OtherError'});
    throw stripeTreasuryError('STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);
  }
  finally{clearTimeout(timer);controller.abort();}
}
