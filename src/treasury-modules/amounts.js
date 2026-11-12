import {controlError} from '../control.js';

// Same unsigned decimal-string bound as the native treasury journal. No provider I/O.
export const UNSIGNED_AMOUNT=/^(0|[1-9][0-9]{0,77})$/;
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
export const ZERO_ADDRESS='0x0000000000000000000000000000000000000000';

export function requirePositiveAmount(value,code='INVALID_AMOUNT'){
  if(typeof value!=='string'||!UNSIGNED_AMOUNT.test(value)||value==='0')controlError(code,400);
  return BigInt(value);
}
export function amountText(value){
  const text=value.toString();
  if(!UNSIGNED_AMOUNT.test(text))controlError('AMOUNT_OUT_OF_RANGE',409);
  return text;
}
export function requireDecimals(value,code='INVALID_DECIMALS'){
  if(!Number.isInteger(value)||value<0||value>36)controlError(code,400);
  return value;
}
export function requireAddress(value,code='INVALID_ADDRESS'){
  if(typeof value!=='string'||!ADDRESS.test(value))controlError(code,400);
  return value;
}
export function isZeroAddress(value){
  return typeof value==='string'&&value.toLowerCase()===ZERO_ADDRESS;
}
