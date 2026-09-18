// Model denomination amounts are whole-unit strings, not provider or chain base units.
// Eighteen display places do not rescale the model or change any asset's precision.
export function formatTreasuryModelWholeAmount(value,unit){
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,77})$/.test(value)||!['NUSD','USD','USDC'].includes(unit))throw Error('INVALID_MODEL_WHOLE_AMOUNT');
  return value.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+'0'.repeat(18)+' '+unit;
}

export function formatTreasuryNusdWholeAmount(value){return formatTreasuryModelWholeAmount(value,'NUSD');}

// Provider minor units retain their currency and exact integer representation.
export function isTreasuryMinorInteger(value){
  return typeof value==='number'?Number.isSafeInteger(value)&&!Object.is(value,-0):
    typeof value==='string'&&/^(?:0|-?[1-9][0-9]{0,77})$/.test(value);
}
export function formatTreasuryProviderAmount(value,currency){
  if(!isTreasuryMinorInteger(value)||!['usd','usdc'].includes(currency))throw Error('INVALID_PROVIDER_AMOUNT');
  const raw=BigInt(value),digits=currency==='usd'?2:6,absolute=raw<0n?-raw:raw;
  const padded=absolute.toString().padStart(digits+1,'0');
  const whole=padded.slice(0,-digits).replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const decimal=whole+'.'+padded.slice(-digits),sign=raw<0n?'-':'';
  return currency==='usd'?sign+'$'+decimal:sign+decimal+' USDC';
}
