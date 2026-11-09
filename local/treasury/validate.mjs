// Input validation: semantic field rules (amounts, currencies, Stripe ids) plus a JSON Schema
// subset check against the inputSchema the server returned from tools/list.
export class ValidationError extends Error{constructor(message,details){super(message);this.name='ValidationError';this.code='INVALID_INPUT';this.details=details;}}

const CURRENCY=/^[A-Za-z]{3}$/;
const DECIMAL=/^(0|[1-9]\d{0,14})(\.\d{1,8})?$/;
const STRIPE_ID=/^[a-z][a-z0-9]{1,9}_[A-Za-z0-9_]{6,128}$/;
const isAmountKey=k=>/(^|_)amount($|_)|^amount[A-Z]/.test(k);
const isCurrencyKey=k=>/(^|_)currency$/.test(k);
const isIdKey=k=>/(^|_)(recipient|financial_account|payout_method|outbound_setup_intent|customer|payment_intent|charge|refund|invoice|subscription)_id$|^recipient$/.test(k);

export function validateAmount(v,path){
  if(typeof v==='number'){
    if(!Number.isSafeInteger(v)||v<0)throw new ValidationError(`${path}: amount must be a non-negative integer in minor units (or a decimal string)`);
    return;
  }
  if(typeof v==='string'){if(!DECIMAL.test(v))throw new ValidationError(`${path}: amount string must be a plain decimal like "125.50"`);return;}
  if(v&&typeof v==='object'){walk(v,path);return;}
  throw new ValidationError(`${path}: amount must be an integer (minor units) or a decimal string`);
}
export function validateCurrency(v,path){if(typeof v!=='string'||!CURRENCY.test(v))throw new ValidationError(`${path}: currency must be a 3-letter ISO 4217 code`);}
export function validateStripeId(v,path){if(typeof v!=='string'||!STRIPE_ID.test(v))throw new ValidationError(`${path}: not a valid Stripe object id`);}

function walk(obj,path='args'){
  if(Array.isArray(obj)){obj.forEach((v,i)=>walk(v,`${path}[${i}]`));return;}
  if(!obj||typeof obj!=='object')return;
  for(const [k,v] of Object.entries(obj)){
    const p=`${path}.${k}`;
    if(v===undefined||v===null)continue;
    if(isAmountKey(k))validateAmount(v,p);
    else if(isCurrencyKey(k)&&typeof v!=='object')validateCurrency(v,p);
    else if(isIdKey(k)&&typeof v==='string')validateStripeId(v,p);
    else if(typeof v==='object')walk(v,p);
    else if(typeof v==='string'&&v.length>20000)throw new ValidationError(`${p}: value too long`);
  }
}
export function validateSemantics(args){
  if(!args||typeof args!=='object'||Array.isArray(args))throw new ValidationError('arguments must be a JSON object');
  walk(args);
}

// JSON Schema subset (type, required, properties, additionalProperties, enum, const, items,
// minimum/maximum, minLength/maxLength, pattern, anyOf/oneOf). Unknown keywords are ignored.
export function validateSchema(schema,value,path='args'){
  const errors=[];check(schema,value,path,errors);
  if(errors.length)throw new ValidationError(`arguments do not match the server's input schema: ${errors.slice(0,5).join('; ')}`,errors);
}
const typeOf=v=>v===null?'null':Array.isArray(v)?'array':Number.isInteger(v)?'integer':typeof v;
function typeMatches(t,v){const a=typeOf(v);return t===a||(t==='number'&&a==='integer');}
function check(s,v,p,errors){
  if(!s||typeof s!=='object'||s===true)return;
  if(s.anyOf||s.oneOf){const alts=s.anyOf||s.oneOf;if(!alts.some(alt=>{const e=[];check(alt,v,p,e);return !e.length;}))errors.push(`${p}: matches none of the allowed shapes`);return;}
  if(s.type){const types=[].concat(s.type);if(!types.some(t=>typeMatches(t,v))){errors.push(`${p}: expected ${types.join('|')}`);return;}}
  if(s.enum&&!s.enum.some(e=>JSON.stringify(e)===JSON.stringify(v)))errors.push(`${p}: must be one of ${s.enum.join(', ')}`);
  if('const' in s&&JSON.stringify(s.const)!==JSON.stringify(v))errors.push(`${p}: must equal ${JSON.stringify(s.const)}`);
  if(typeof v==='string'){
    if(s.minLength!=null&&v.length<s.minLength)errors.push(`${p}: too short`);
    if(s.maxLength!=null&&v.length>s.maxLength)errors.push(`${p}: too long`);
    if(s.pattern){try{if(!new RegExp(s.pattern,'u').test(v))errors.push(`${p}: does not match pattern`);}catch{}}
  }
  if(typeof v==='number'){
    if(s.minimum!=null&&v<s.minimum)errors.push(`${p}: below minimum`);
    if(s.maximum!=null&&v>s.maximum)errors.push(`${p}: above maximum`);
  }
  if(Array.isArray(v)&&s.items)v.forEach((x,i)=>check(s.items,x,`${p}[${i}]`,errors));
  if(v&&typeof v==='object'&&!Array.isArray(v)){
    for(const r of s.required||[])if(!(r in v))errors.push(`${p}.${r}: required`);
    const props=s.properties||{};
    for(const [k,x] of Object.entries(v)){
      if(props[k])check(props[k],x,`${p}.${k}`,errors);
      else if(s.additionalProperties===false)errors.push(`${p}.${k}: not allowed by the server schema`);
      else if(s.additionalProperties&&typeof s.additionalProperties==='object')check(s.additionalProperties,x,`${p}.${k}`,errors);
    }
  }
}
