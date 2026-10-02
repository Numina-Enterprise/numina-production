import {STRIPE_TREASURY_ACCOUNT,STRIPE_TREASURY_FINANCIAL_ACCOUNT,stripeTreasuryJson} from './stripe-treasury.js';

// Existing Money Management integration: GET only. Discovery of another API or
// an environment flag must never silently enable financial execution.
export const STRIPE_DEPOSIT_CAPABILITY=Object.freeze({
  mode:'EXTERNAL_USD_FUNDING',provider:'stripe',submission:false,nusdConversion:false,
  financialAccount:STRIPE_TREASURY_FINANCIAL_ACCOUNT,livemode:true,
  apiVersion:'2026-08-26.preview',supportedWriteEndpoint:null,
  reason:'NO_APPLICABLE_NUSD_TO_USD_WRITE_PROVIDER_VERIFIED',
  dashboardUrl:'https://dashboard.stripe.com/'+STRIPE_TREASURY_ACCOUNT+'/treasury',
  documentation:'https://docs.stripe.com/treasury/add-funds'
});
function stripeDepositFailure(code,status=502,evidence={}){
  return Object.assign(new Error(code),{code,status,providerEvidence:evidence});
}
function stripeDepositCheck(ok){if(!ok)throw stripeDepositFailure('STRIPE_DEPOSIT_INVALID_RESPONSE');}
const stripeDepositId=(value,prefix)=>typeof value==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9]{1,128}$').test(value);
function stripeDepositReference(value){stripeDepositCheck(typeof value==='string'&&/^[A-Za-z0-9_]{1,160}$/.test(value));return value;}
function stripeDepositCode(value){stripeDepositCheck(typeof value==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value));return value;}
function stripeDepositOptional(value,validate){return value===undefined||value===null?null:validate(value);}
function stripeDepositNormalize(result,normalize){
  try{return normalize(result.value);}catch{throw stripeDepositFailure('STRIPE_DEPOSIT_INVALID_RESPONSE',502,{...result.response,validationFailed:true});}
}
function stripeDepositInteger(value){
  stripeDepositCheck(typeof value==='bigint'||typeof value==='number'&&Number.isSafeInteger(value)&&!Object.is(value,-0));
  return String(value);
}
function stripeDepositMoney(value){
  stripeDepositCheck(value&&typeof value.currency==='string'&&/^[a-z]{3,8}$/.test(value.currency));
  return {value:stripeDepositInteger(value.value),currency:value.currency};
}
function stripeDepositTime(value){stripeDepositCheck(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)));return value;}
function stripeDepositPage(value){
  stripeDepositCheck(value&&Array.isArray(value.data)&&value.data.length<=50&&Object.hasOwn(value,'next_page_url')&&(value.next_page_url===null||typeof value.next_page_url==='string'&&value.next_page_url.length>0));
  return value;
}
async function stripeDepositGet(env,path,{fetcher=(...args)=>globalThis.fetch(...args),timeoutMs=8000}={}){
  const key=env.NUMINA_STRIPE_TREASURY_READ_KEY;
  if(typeof key!=='string'||!/^rk_live_[A-Za-z0-9]{16,}$/.test(key)||env.NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT!==STRIPE_TREASURY_FINANCIAL_ACCOUNT)
    throw stripeDepositFailure('STRIPE_DEPOSIT_NOT_CONNECTED',503);
  const controller=new AbortController();let timer;
  const evidence={method:'GET',path,httpStatus:null,requestId:null,apiVersion:STRIPE_DEPOSIT_CAPABILITY.apiVersion};
  try{return await Promise.race([
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(stripeDepositFailure('STRIPE_DEPOSIT_TIMEOUT',504,evidence));},timeoutMs);}),
    (async()=>{
      const response=await fetcher('https://api.stripe.com'+path,{method:'GET',redirect:'manual',signal:controller.signal,
        headers:{Authorization:'Bearer '+key,'Stripe-Version':STRIPE_DEPOSIT_CAPABILITY.apiVersion,Accept:'application/json','Cache-Control':'no-store'}});
      evidence.httpStatus=response.status;
      const requestId=response.headers.get('request-id');evidence.requestId=requestId&&/^[A-Za-z0-9._-]{1,100}$/.test(requestId)?requestId:null;
      if(!response.ok||response.redirected){void response.body?.cancel().catch(()=>{});throw stripeDepositFailure('STRIPE_DEPOSIT_PROVIDER_REJECTED',503,evidence);}
      try{return {value:await stripeTreasuryJson(response),response:evidence};}
      catch{throw stripeDepositFailure('STRIPE_DEPOSIT_INVALID_RESPONSE',502,evidence);}
    })()
  ]);}catch(error){if(error.providerEvidence)throw error;throw stripeDepositFailure('STRIPE_DEPOSIT_UNAVAILABLE',503,evidence);}
  finally{clearTimeout(timer);controller.abort();}
}
async function stripeDepositAccount(env,options){
  const result=await stripeDepositGet(env,'/v2/money_management/financial_accounts/'+STRIPE_TREASURY_FINANCIAL_ACCOUNT,options);
  return stripeDepositNormalize(result,v=>{
  stripeDepositCheck(v?.object==='v2.money_management.financial_account'&&v.id===STRIPE_TREASURY_FINANCIAL_ACCOUNT&&v.livemode===true&&v.type==='storage'&&['open','closed'].includes(v.status));
  const balances={};
  for(const name of ['available','inbound_pending','outbound_pending']){
    stripeDepositCheck(v.balance?.[name]?.usd?.currency==='usd');balances[name]=stripeDepositMoney(v.balance[name].usd);
  }
  return {response:result.response,body:{id:v.id,object:v.object,livemode:true,status:v.status,type:v.type,balances}};
  });
}
export async function readStripeDepositInstructions(env,options={}){
  const account=await stripeDepositAccount(env,options);
  if(account.body.status!=='open')throw stripeDepositFailure('STRIPE_DEPOSIT_ACCOUNT_CLOSED',409,account.response);
  try{
  const result=await stripeDepositGet(env,'/v2/money_management/financial_addresses?financial_account='+STRIPE_TREASURY_FINANCIAL_ACCOUNT+'&limit=50',options);
  const normalized=stripeDepositNormalize(result,value=>{
  const page=stripeDepositPage(value),addresses=[];
  for(const item of page.data){
    stripeDepositCheck(item?.object==='v2.money_management.financial_address'&&stripeDepositId(item.id,'finaddr')&&item.financial_account===STRIPE_TREASURY_FINANCIAL_ACCOUNT&&item.livemode===true);
    if(item.status==='active'&&item.currency==='usd'&&item.settlement_currency==='usd'&&item.credentials?.type==='us_bank_account')
      addresses.push({id:item.id,financialAccount:item.financial_account,currency:'usd',settlementCurrency:'usd',status:item.status,credentialsType:'us_bank_account'});
  }
  return {addresses,complete:page.next_page_url===null};
  });
  // Bank credentials stay in the authenticated Stripe Dashboard. Persist only
  // allowlisted provider fields, never account/routing numbers or API secrets.
  return {kind:'instructions',responses:[account,{response:result.response,body:normalized}],
    destinationAvailable:normalized.addresses.length>0,addresses:normalized.addresses,balances:account.body.balances};
  }catch(error){error.providerResponses=[account,{response:error.providerEvidence??null,error:error.code??'STRIPE_DEPOSIT_UNAVAILABLE'}];throw error;}
}
function stripeDepositReceiptObject(v,receiptId,kind){
  const credit=kind==='received_credit';
  stripeDepositCheck(v?.id===receiptId&&v.object==='v2.money_management.'+kind&&v.livemode===true);
  const financialAccount=credit?v.financial_account:v.to?.financial_account;
  let status=v.status,history=[];
  if(!credit){
    stripeDepositCheck(Array.isArray(v.transfer_history)&&v.transfer_history.length>0&&v.transfer_history.length<=100);
    history=v.transfer_history.filter(entry=>entry.level==='canonical').map(entry=>({id:stripeDepositReference(entry.id),type:stripeDepositCode(entry.type),created:stripeDepositTime(entry.created),
      failureReason:stripeDepositOptional(entry.bank_debit_failed?.failure_reason,stripeDepositCode),returnReason:stripeDepositOptional(entry.bank_debit_returned?.return_reason,stripeDepositCode)})).sort((a,b)=>Date.parse(a.created)-Date.parse(b.created));
    stripeDepositCheck(history.length>0);
    const types={bank_debit_queued:'pending',bank_debit_processing:'pending',bank_debit_succeeded:'succeeded',bank_debit_failed:'failed',bank_debit_returned:'returned'};
    status=types[history.at(-1).type];
    stripeDepositCheck(typeof status==='string');
  }
  stripeDepositCheck(stripeDepositId(financialAccount,'fa')&&['pending','succeeded','failed','returned'].includes(status));
  const receipt={id:v.id,object:v.object,financialAccount,livemode:true,amount:stripeDepositMoney(v.amount),status,created:stripeDepositTime(v.created),
    type:credit?stripeDepositCode(v.type):'bank_debit',receiptUrlPresent:typeof v.receipt_url==='string',
    statusEffectiveAt:credit?stripeDepositOptional(v.status_transitions?.[status+'_at'],stripeDepositTime):history.at(-1).created,
    bankTransfer:credit&&v.type==='bank_transfer'?{financialAddress:stripeDepositOptional(v.bank_transfer?.financial_address,stripeDepositReference),network:stripeDepositOptional(v.bank_transfer?.us_bank_account?.network,stripeDepositCode)}:null,
    bankDebit:credit?null:{paymentMethodType:stripeDepositOptional(v.from?.payment_method?.type,stripeDepositCode),credited:stripeDepositMoney(v.to?.credited),history}};
  return receipt;
}
export async function readStripeDepositReceipt(env,receiptId,kind,options={}){
  if(typeof receiptId!=='string'||!/^[A-Za-z0-9_]{3,160}$/.test(receiptId)||!['received_credit','inbound_transfer'].includes(kind))throw stripeDepositFailure('INVALID_PROVIDER_RECEIPT_ID',400);
  const resource=kind==='received_credit'?'received_credits':'inbound_transfers';
  const result=await stripeDepositGet(env,'/v2/money_management/'+resource+'/'+receiptId,options);
  const receipt=stripeDepositNormalize(result,v=>stripeDepositReceiptObject(v,receiptId,kind));
  const responses=[{response:result.response,body:receipt}];let records=[],complete=false,balances=null;
  // Exact flow filtering, bounded single page. No provider pagination URL is
  // followed; an incomplete observation can never establish settlement.
  try{
  const transactions=await stripeDepositGet(env,'/v2/money_management/transactions?financial_account='+STRIPE_TREASURY_FINANCIAL_ACCOUNT+'&flow='+receiptId+'&limit=50',options);
  stripeDepositNormalize(transactions,value=>{
  const page=stripeDepositPage(value);
  for(const item of page.data){
    stripeDepositCheck(item?.object==='v2.money_management.transaction'&&stripeDepositId(item.id,'trxn')&&item.livemode===true&&stripeDepositId(item.financial_account,'fa'));
    records.push({id:item.id,object:item.object,financialAccount:item.financial_account,livemode:true,amount:stripeDepositMoney(item.amount),
      status:stripeDepositCode(item.status),created:stripeDepositTime(item.created),flow:{type:stripeDepositCode(item.flow?.type),reference:stripeDepositOptional(item.flow?.[kind],stripeDepositReference)},
      balanceImpact:{available:stripeDepositMoney(item.balance_impact?.available),inboundPending:stripeDepositMoney(item.balance_impact?.inbound_pending),outboundPending:stripeDepositMoney(item.balance_impact?.outbound_pending)}});
  }
  complete=page.next_page_url===null;
  });
  responses.push({response:transactions.response,body:{data:records,complete}});
  const account=await stripeDepositAccount(env,options);
  responses.push(account);balances=account.body.balances;
  return {kind,receipt,transactions:records,complete,balances,responses};
  }catch(error){
    // Never discard a known returned/failed receipt because a supplementary
    // transaction or balance read failed. Persist each successful stage.
    responses.push({response:error.providerEvidence??null,error:error.code??'STRIPE_DEPOSIT_UNAVAILABLE'});
    return {kind,receipt,transactions:[],complete:false,balances:null,responses};
  }
}
