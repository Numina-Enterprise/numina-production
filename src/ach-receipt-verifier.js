import {STRIPE_TREASURY_FINANCIAL_ACCOUNT,stripeTreasuryJson} from './stripe-treasury.js';
// GET only. A posted provider payment can later be returned; this is not a bank-issued settlement receipt.
// https://docs.stripe.com/api/v2/money-management/outbound-payments/retrieve?api-version=2025-06-30.preview
// https://docs.stripe.com/api/v2/money-management/outbound-transfers/list?api-version=2025-12-15.preview
// Resource operations were also checked against the connected 2026-08-26.preview API specification.
const ACH_RECEIPT_SCOPE='Authenticated Stripe report matching the supplied USD amount and payout-method reference. Posted means funds left the provider account; it is not proof of irrevocable bank settlement, ACH-specific rail execution, Bank of America account ownership, or NUSD backing/conversion.';
export async function verifyAchReceipt(evidence,env,{fetcher=(...args)=>globalThis.fetch(...args)}={}){
  const safeRef=typeof evidence?.providerReference==='string'&&/^ob[tp]_[A-Za-z0-9]{8,128}$/.test(evidence.providerReference)?evidence.providerReference:null;
  const source={provider:'Stripe',providerReference:safeRef};
  const result=(status,reason,extra={})=>({status,verified:status==='VERIFIED_PROVIDER_REPORT',reason,scope:ACH_RECEIPT_SCOPE,observedAt:new Date().toISOString(),source:{...source,...extra}});
  if(evidence?.rail==='ACH'&&evidence.provider==='bank_document')return {...result('NOT_VERIFIED','BANK_ISSUER_VERIFIER_NOT_CONFIGURED'),scope:'Stored document integrity only. Document contents, bank issuer and settlement are not independently verified.',source:{provider:'owner_uploaded_document',documentId:evidence.documentId}};
  if(evidence?.rail!=='ACH'||evidence.provider!=='stripe'||!safeRef||typeof evidence.amount!=='string'||!/^\d{1,30}$/.test(evidence.amount)||BigInt(evidence.amount)<=0n||typeof evidence.destinationReference!=='string'||!/^[A-Za-z][A-Za-z0-9_]{7,199}$/.test(evidence.destinationReference))return result('NOT_VERIFIED','EVIDENCE_INVALID');
  const key=env.NUMINA_STRIPE_TREASURY_READ_KEY;
  if(typeof key!=='string'||!/^rk_live_[A-Za-z0-9]{16,}$/.test(key)||env.NUMINA_STRIPE_TREASURY_FINANCIAL_ACCOUNT!==STRIPE_TREASURY_FINANCIAL_ACCOUNT)return result('UNAVAILABLE','READ_ONLY_PROVIDER_NOT_CONFIGURED');
  const transfer=safeRef.startsWith('obt_'),resource=transfer?'outbound_transfers':'outbound_payments';
  const controller=new AbortController();let timer;
  try{return await Promise.race([
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},8000);}),
    (async()=>{
      const response=await fetcher('https://api.stripe.com/v2/money_management/'+resource+'/'+safeRef,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Authorization:'Bearer '+key,'Stripe-Version':'2026-08-26.preview',Accept:'application/json','Cache-Control':'no-store'}});
      const requestId=response.headers.get('request-id'),providerRequestId=requestId&&/^[A-Za-z0-9_-]{1,100}$/.test(requestId)?requestId:null;
      if(response.status===404){void response.body?.cancel().catch(()=>{});return result('NOT_VERIFIED','PROVIDER_REFERENCE_NOT_FOUND',{providerRequestId});}
      if(!response.ok||response.redirected){void response.body?.cancel().catch(()=>{});return result('UNAVAILABLE','PROVIDER_LOOKUP_UNAVAILABLE',{providerRequestId});}
      const report=await stripeTreasuryJson(response),expected=BigInt(evidence.amount)*100n;
      const matches=amount=>amount?.currency==='usd'&&(typeof amount.value==='bigint'||Number.isSafeInteger(amount.value))&&BigInt(amount.value)===expected;
      if(report?.id!==safeRef||report.object!=='v2.money_management.'+(transfer?'outbound_transfer':'outbound_payment')||report.livemode!==true||report.from?.financial_account!==STRIPE_TREASURY_FINANCIAL_ACCOUNT||report.to?.payout_method!==evidence.destinationReference||!matches(report.amount)||!matches(report.from.debited)||!matches(report.to.credited))return result('NOT_VERIFIED','PROVIDER_RECORD_MISMATCH',{providerRequestId});
      const info={providerRequestId,financialAccount:STRIPE_TREASURY_FINANCIAL_ACCOUNT,destinationReference:evidence.destinationReference,amount:evidence.amount,amountMinorUnits:expected.toString(),currency:'usd',providerStatus:typeof report.status==='string'&&/^[a-z_]{1,32}$/.test(report.status)?report.status:null,bankSettlementVerified:false,achConfirmationVerified:false};
      if(report.status==='processing')return result('PENDING','PROVIDER_PROCESSING',info);
      if(['failed','returned','canceled'].includes(report.status))return result('NOT_VERIFIED','PROVIDER_'+report.status.toUpperCase(),info);
      // Only explicit local delivery to a US-bank payout method is recognized here.
      // Automatic or wire delivery does not establish the requested ACH route.
      if(report.delivery_options?.bank_account!=='local'||!/^usba_[A-Za-z0-9]{8,128}$/.test(report.to.payout_method))return result('NOT_VERIFIED','LOCAL_US_BANK_DELIVERY_NOT_ESTABLISHED',info);
      if(report.status!=='posted'||!Number.isFinite(Date.parse(report.status_transitions?.posted_at)))return result('NOT_VERIFIED','PROVIDER_POSTED_STATE_NOT_ESTABLISHED',info);
      const trace=report.trace_id?.status==='supported'&&typeof report.trace_id.value==='string'&&/^[A-Za-z0-9 ._-]{1,128}$/.test(report.trace_id.value)?report.trace_id.value:null;
      return result('VERIFIED_PROVIDER_REPORT','PROVIDER_REPORT_MATCHED_BANK_SETTLEMENT_UNVERIFIED',{...info,postedAt:report.status_transitions.posted_at,providerTraceId:trace});
    })()
  ]);}catch{return result('UNAVAILABLE','PROVIDER_LOOKUP_UNAVAILABLE');}
  finally{clearTimeout(timer);controller.abort();}
}
