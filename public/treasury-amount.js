// Model denomination amounts are whole-unit strings, not provider or chain base units.
// Whole units display with two decimal places; underlying asset precision is unchanged.
export function formatTreasuryModelWholeAmount(value,unit){
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,77})$/.test(value)||!['NUSD','USD','USDC'].includes(unit))throw Error('INVALID_MODEL_WHOLE_AMOUNT');
  return value.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.00 '+unit;
}

export function formatTreasuryNusdWholeAmount(value){return formatTreasuryModelWholeAmount(value,'NUSD');}

// UI-only: nearest whole unit, then two decimal places; halves round away from zero.
// Approximation is explicit. Never feed this display value into a transaction.
export function formatTreasuryRoundedWholeAmount(value,decimals){
  if(!isTreasuryMinorInteger(value)||!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('INVALID_DISPLAY_AMOUNT');
  const raw=BigInt(value),absolute=raw<0n?-raw:raw,scale=10n**BigInt(decimals);
  const rounded=(absolute+scale/2n)/scale;
  return (absolute%scale===0n?'':'≈ ')+(raw<0n&&rounded!==0n?'-':'')+
    rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.00';
}
export function formatTreasuryProviderDisplayAmount(value,currency){
  if(!['usd','usdc'].includes(currency))throw Error('INVALID_PROVIDER_AMOUNT');
  const display=formatTreasuryRoundedWholeAmount(value,currency==='usd'?2:6);
  return currency==='usd'?display.replace(/^((?:≈ )?)(-?)/,'$1$2$'):display+' USDC';
}

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
