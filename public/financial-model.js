export const FINANCIAL_SERVICES = Object.freeze({
  personal_lender: {name:'Personal loan direct lender', required:['provider_agreement','operating_authority','loan_terms','fees','data_practices','security_review','reviewer_flow']},
  loan_facilitator: {name:'Loan facilitator', required:['provider_agreement','operating_authority','loan_terms','fees','data_practices','security_review','reviewer_flow']},
  earned_wages: {name:'Earned wage advances', required:['provider_agreement','operating_authority','ewa_terms','fees','data_practices','security_review','reviewer_flow']},
  digital_wallet: {name:'Mobile payments and digital wallets', required:['provider_agreement','operating_authority','custody_terms','fees','data_practices','security_review','reviewer_flow']},
  money_transfer: {name:'Money transfer and wire services', required:['provider_agreement','operating_authority','transfer_terms','fees','data_practices','security_review','reviewer_flow']},
  crypto_wallet: {name:'Cryptocurrency wallet', required:['provider_agreement','operating_authority','custody_terms','fees','data_practices','security_review','reviewer_flow']},
  crypto_exchange: {name:'Cryptocurrency exchange', required:['provider_agreement','operating_authority','exchange_terms','custody_terms','fees','data_practices','security_review','reviewer_flow']}
});
export const FINANCIAL_DOCUMENT_KINDS = Object.freeze({provider_agreement:'Provider relationship and agreement',operating_authority:'License, registration or reviewed exemption',loan_terms:'Loan terms and repayment example',ewa_terms:'Earned wage advance terms',custody_terms:'Custody and holder terms',transfer_terms:'Transfer and cancellation terms',exchange_terms:'Exchange and execution terms',fees:'Fees and charges',data_practices:'Data use, retention and deletion',security_review:'Security controls and review evidence',reviewer_flow:'Reviewer access and functional test evidence'});
export function financialInputError(code){throw Object.assign(new Error(code),{code,status:400});}
function financialText(value,max,required=true,multiline=false){const unsafe=multiline?/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/:/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;if(typeof value!=='string'||value.length>max||unsafe.test(value)||(required&&!value.trim()))financialInputError('INVALID_EVIDENCE_FIELD');return value.trim();}
export function validateFinancialEvidence(value){
  const fields=['service','kind','entity','provider','relationship','jurisdictions','reference','sourceUrl','expiresOn','documentId','note'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))financialInputError('INVALID_EVIDENCE_FIELDS');
  if(!Object.hasOwn(FINANCIAL_SERVICES,value.service)||!Object.hasOwn(FINANCIAL_DOCUMENT_KINDS,value.kind))financialInputError('INVALID_EVIDENCE_CATEGORY');
  if(!FINANCIAL_SERVICES[value.service].required.includes(value.kind))financialInputError('DOCUMENT_NOT_APPLICABLE');
  if(!Array.isArray(value.jurisdictions)||!value.jurisdictions.length||value.jurisdictions.length>60||value.jurisdictions.some(v=>typeof v!=='string'||!/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(v)))financialInputError('INVALID_JURISDICTIONS');
  if(!/^[a-f0-9]{64}$/.test(value.documentId||''))financialInputError('DOCUMENT_RECEIPT_REQUIRED');
  const sourceUrl=financialText(value.sourceUrl,600,false);if(sourceUrl){let url;try{url=new URL(sourceUrl);}catch{financialInputError('INVALID_SOURCE_URL');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)financialInputError('INVALID_SOURCE_URL');}
  const expiresOn=financialText(value.expiresOn,10,false);if(expiresOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)||!Number.isFinite(Date.parse(expiresOn))||new Date(expiresOn).toISOString().slice(0,10)!==expiresOn))financialInputError('INVALID_EXPIRY_DATE');
  return {service:value.service,kind:value.kind,entity:financialText(value.entity,200),provider:financialText(value.provider,200),relationship:financialText(value.relationship,500),jurisdictions:[...new Set(value.jurisdictions)].sort(),reference:financialText(value.reference,200),sourceUrl,expiresOn,documentId:value.documentId,note:financialText(value.note,1000,false,true)};
}
export function assessFinancialEvidence(records,now=new Date().toISOString().slice(0,10)){
  return Object.entries(FINANCIAL_SERVICES).map(([id,service])=>{
    const applicable=records.filter(record=>record.evidence.service===id),usable=applicable.filter(record=>!record.evidence.expiresOn||record.evidence.expiresOn>=now);
    const missing=service.required.filter(kind=>!usable.some(record=>record.evidence.kind===kind));
    return {id,name:service.name,documents:applicable.length,expired:applicable.length-usable.length,missing,documentCoverage:missing.length?'incomplete':'present_for_review',verification:'not_independently_verified',financialExecution:false};
  });
}
