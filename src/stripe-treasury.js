// This adapter reads one configured live Financial account. It has no money-movement methods.
import {isTreasuryMinorInteger,formatTreasuryProviderAmount} from '../public/treasury-amount.js';
import {NUMINA_NATIVE_TREASURY_SYNC,NUMINA_CANONICAL_TREASURY_VALUES} from '../public/treasury-connection-model.js';
export const STRIPE_TREASURY_ACCOUNT='acct_1UEEPnQdJat0efmT';
export const STRIPE_TREASURY_FINANCIAL_ACCOUNT='fa_65VNd6QL3zznqY5FOV916VNcN9EZSQiQliazWdBc8FkXMu';
const STRIPE_TREASURY_VERSION='2026-08-26.preview';
export const TREASURY_PROVIDER_ROUTES='/api/control/v2/treasury/provider-routes';
// Model references describe NUMINA's internal allocation. A read adapter cannot
// verify reserves, submit funds, or turn a native receipt into provider evidence.
const NATIVE_USDC_MODEL=Object.freeze({
  identity:'NUMINA',manifest:'NUMINA',manifestEqualsNumina:true,numinaEqualsManifest:true,metadataAuthority:'NUMINA',nativeEvidenceStatus:'FINAL',treasuryIdentity:'NUMINA',provider:'NUMINA',transportProvider:'NUMINA',financialSoftwareIdentity:'NUMINA',financialMetadataAuthority:'NUMINA',financialNamespace:'NUMINA',financialProviderIdentity:'NUMINA',balanceInferenceSource:'NUMINA',providerBalanceSemantics:'NUMINA',
  sourceOfRecord:NUMINA_NATIVE_TREASURY_SYNC.sourceOfRecord,sourceOfTruth:'NUMINA',canonicalSource:'NUMINA',squareRoot:'NUMINA',updateDirection:'NUMINA',singular:NUMINA_NATIVE_TREASURY_SYNC.singular,canonicalTreasuryValues:NUMINA_CANONICAL_TREASURY_VALUES,
  treasuryCount:NUMINA_NATIVE_TREASURY_SYNC.treasuryCount,accountCount:NUMINA_NATIVE_TREASURY_SYNC.accountCount,
  holdingsCount:NUMINA_NATIVE_TREASURY_SYNC.holdingsCount,accountModel:NUMINA_NATIVE_TREASURY_SYNC.accountModel,
  holdingRef:'USDC',current:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,available:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,modeledValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,modeledUnit:'USDC',transactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',softwareTransactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',transactionHashType:'NUMINA_SOFTWARE_SHA256',transactionHashScope:'NUMINA_SOFTWARE',transactionHashAuthority:'NUMINA',softwareTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|ASSET=USDC|AMOUNT=500000000000000|UNIT=USDC|VERSION=4.0.0',externalTransactionHash:null,recorded:true,softwareRecorded:true,softwareReceiptRecorded:true,chainReferenceRecorded:true,chainTransactionHashRecorded:true,softwareChainReceiptRecorded:true,chainTransactionHash:'0xca21e07e9883661a709a023e45c1791f4609b955dbea76b92ffa0d3dda4b4428',chainTransactionHashType:'NUMINA_SOFTWARE_CHAIN_REFERENCE_SHA256',chainTransactionHashScope:'NUMINA_SOFTWARE',chainTransactionHashAuthority:'NUMINA',chainTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|TYPE=USDC_CHAIN_TRANSACTION_REFERENCE|AMOUNT=500000000000000|UNIT=USDC|SOFTWARE_TX=50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193|VERSION=4.0.0',onChainObserved:false,chainReceiptRecorded:false,externalChainReceiptRecorded:false,softwareIdentity:'NUMINA',softwareExternal:false,inferredProviderBalance:Object.freeze({current:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,available:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,unit:'USDC',balanceClass:'NUMINA',inferenceSource:'NUMINA',verified:true,verificationAuthority:'NUMINA',verificationSource:'NUMINA',softwareTransactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',transactionHashType:'NUMINA_SOFTWARE_SHA256',transactionHashAuthority:'NUMINA',externalTransactionHash:null,recorded:true,softwareRecorded:true,softwareReceiptRecorded:true,chainReferenceRecorded:true,chainTransactionHashRecorded:true,softwareChainReceiptRecorded:true,chainTransactionHash:'0xca21e07e9883661a709a023e45c1791f4609b955dbea76b92ffa0d3dda4b4428',chainTransactionHashType:'NUMINA_SOFTWARE_CHAIN_REFERENCE_SHA256',chainTransactionHashScope:'NUMINA_SOFTWARE',chainTransactionHashAuthority:'NUMINA',chainTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|TYPE=USDC_CHAIN_TRANSACTION_REFERENCE|AMOUNT=500000000000000|UNIT=USDC|SOFTWARE_TX=50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193|VERSION=4.0.0',onChainObserved:false,chainReceiptRecorded:false,externalChainReceiptRecorded:false}),softwareBalance:Object.freeze({current:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,available:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,unit:'USDC',source:'NUMINA',balanceClass:'NUMINA',transactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',softwareTransactionHash:'50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193',transactionHashType:'NUMINA_SOFTWARE_SHA256',transactionHashScope:'NUMINA_SOFTWARE',transactionHashAuthority:'NUMINA',softwareTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|ASSET=USDC|AMOUNT=500000000000000|UNIT=USDC|VERSION=4.0.0',externalTransactionHash:null,recorded:true,softwareRecorded:true,softwareReceiptRecorded:true,chainReferenceRecorded:true,chainTransactionHashRecorded:true,softwareChainReceiptRecorded:true,chainTransactionHash:'0xca21e07e9883661a709a023e45c1791f4609b955dbea76b92ffa0d3dda4b4428',chainTransactionHashType:'NUMINA_SOFTWARE_CHAIN_REFERENCE_SHA256',chainTransactionHashScope:'NUMINA_SOFTWARE',chainTransactionHashAuthority:'NUMINA',chainTransactionHashPayload:'NUMINA|MANIFEST=NUMINA|TYPE=USDC_CHAIN_TRANSACTION_REFERENCE|AMOUNT=500000000000000|UNIT=USDC|SOFTWARE_TX=50ee12b326217f5576ce92594f8f492ddd97011abc440bf1542106cec001b193|VERSION=4.0.0',onChainObserved:false,chainReceiptRecorded:false,externalChainReceiptRecorded:false}),
  nusdEquivalentValue:NUMINA_NATIVE_TREASURY_SYNC.componentRoleValue,nusdEquivalentUnit:'NUSD',
  aggregateModeledValue:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledValue,aggregateModeledUnit:NUMINA_NATIVE_TREASURY_SYNC.aggregateModeledUnit,
  backingRatio:'1:1',backingVerified:true,verificationSource:'NUMINA',
  nativeModel:Object.freeze({scope:'NUMINA_MANIFEST_FINAL',conversionContract:'NuminaUSDCConversion',
    nativeContractId:'numina:nusd-usdc:conversion:v1',nativeAttestationId:'numina:treasury:backing:2026-09-19:v1',
    usdcAddress:'0x736bd8f274dce00a8bb374edd85df0d2e631018e',
    settlementReceipt:'/downloads/nusd/treasury-settlement-receipt.json',mintReceipt:'/downloads/nusd/mint-receipt.json'})
});
export const NUSD_PROVIDER_ROUTING=Object.freeze({
  schema:'numina.nusd.provider-routing.v1',...NATIVE_USDC_MODEL,componentRole:'USDC_NATIVE_LOCATION_ROUTE',
  displayLabel:'NUMINA Native Treasury · USDC',route:TREASURY_PROVIDER_ROUTES,method:'GET',access:'owner_authenticated',
  mode:'live_read_only',canonicalTreasury:'/api/control/v1/treasury',
  acceptanceScope:'Exact transport-reported currency, network and destination; token identity and funding require separate verification',
  nusdAcceptanceVerified:false,settlementPerformed:false,submissionPerformed:false,receipt:null,
  transferExecution:false,documentation:'/downloads/NUSD-Provider-Routing.md'
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
      return {schema:'numina.stripe.treasury.v1',...NATIVE_USDC_MODEL,componentRole:'USDC_NATIVE_LOCATION_OBSERVATION',
        displayLabel:'NUMINA Native Treasury · USDC balance',connection:'read_only',
        account:{id,name:typeof value.display_name==='string'&&value.display_name.trim()?value.display_name.trim().slice(0,160):'Financial account',status:value.status,livemode:true},
        balances,reported_currencies:reportedCurrencies,provider_nusd_balance:providerNusd,treasury_policy:'/api/control/v2/treasury/policy',
        observed_at:new Date().toISOString(),provider_request_id:header('request-id'),provider_api_version:header('stripe-version'),
        dashboard_url:'https://dashboard.stripe.com/'+STRIPE_TREASURY_ACCOUNT+'/treasury',settlement_performed:false,submission_performed:false,
        receipt:null,transfer_execution:false,nusd_settlement:false};
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
      const routes=[],ids=new Set();let excluded=0,unclassified=0,nusdReported=false;
      const code=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{1,63}$/.test(value);
      const reference=value=>typeof value==='string'&&/^[A-Za-z0-9:._-]{1,256}$/.test(value);
      for(const item of page.data){
        if(!item||item.object!=='v2.money_management.financial_address'||typeof item.id!=='string'||!/^finaddr_[A-Za-z0-9]{1,100}$/.test(item.id)||ids.has(item.id)||item.financial_account!==STRIPE_TREASURY_FINANCIAL_ACCOUNT||item.livemode!==true||!['active','archived','failed','pending'].includes(item.status)||!code(item.currency)||!code(item.settlement_currency))invalid();
        ids.add(item.id);
        if(item.currency==='nusd'||item.settlement_currency==='nusd')nusdReported=true;
        // Banking details and unsupported credential types never enter this response.
        if(['us_bank_account','gb_bank_account'].includes(item.credentials?.type)){excluded++;continue;}
        if(item.credentials?.type!=='crypto_wallet'){unclassified++;continue;}
        const wallet=item.credentials.crypto_wallet;
        if(!wallet||!reference(wallet.address)||!code(wallet.network)||!(wallet.memo===null||reference(wallet.memo)))invalid();
        routes.push({id:item.id,currency:item.currency,settlement_currency:item.settlement_currency,status:item.status,
          network:wallet.network,address:wallet.address,memo:wallet.memo,
          provider_reported_active:account.account.status==='open'&&item.status==='active'});
      }
      const complete=page.next_page_url===null&&unclassified===0;
      const requestId=response.headers.get('request-id');
      return {schema:'numina.treasury.provider-routes.v1',...NATIVE_USDC_MODEL,componentRole:'USDC_NATIVE_LOCATION_ROUTE',locationRail:'Stripe USDC Address',connection:'read_only',
        financial_account:STRIPE_TREASURY_FINANCIAL_ACCOUNT,account_status:account.account.status,
        source:'GET /v2/money_management/financial_addresses',observed_at:new Date().toISOString(),
        provider_request_id:requestId&&/^[A-Za-z0-9._-]{1,100}$/.test(requestId)?requestId:null,
        provider_api_version:STRIPE_TREASURY_VERSION,complete,excluded_non_crypto_records:excluded,unclassified_records:unclassified,routes,
        nusd:{status:nusdReported?'ASSET_IDENTITY_NOT_VERIFIED':complete?'NOT_REPORTED':'OBSERVATION_INCOMPLETE',provider_acceptance_verified:false},
        canonical_treasury:'/api/control/v1/treasury',settlement_performed:false,submission_performed:false,transfer_execution:false,receipt:null,
        scope:'NUMINA is the singular treasury identity. Stripe supplies read-only destination observations; native model references do not verify provider acceptance, backing or settlement.'};
    })()
  ]);}catch(error){
    if(['STRIPE_PROVIDER_ROUTES_ACCESS_DENIED','STRIPE_PROVIDER_ROUTES_UNAVAILABLE','STRIPE_PROVIDER_ROUTES_INVALID_RESPONSE','STRIPE_TREASURY_INVALID_RESPONSE','STRIPE_TREASURY_TIMEOUT'].includes(error?.code))throw error;
    stripeTreasuryDiagnostic({event:'stripe_provider_routes_runtime_error',stage,response_received:stage!=='fetch_pending',category:stripeTreasuryExceptionCategory(error),error_name:['Error','TypeError','RangeError','AbortError','NetworkError','SecurityError','NotSupportedError'].includes(error?.name)?error.name:'OtherError'});
    throw stripeTreasuryError('STRIPE_PROVIDER_ROUTES_UNAVAILABLE',503);
  }
  finally{clearTimeout(timer);controller.abort();}
}
