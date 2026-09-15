// Whole-unit declared valuations. Provider minor-unit balances are never inputs.
export const NUMINA_DENOMINATION_POLICY = Object.freeze({
  schema:'numina.denomination-policy.v1',id:'numina-usd-usdc-nusd-parity-2026-09-15',
  basis:'owner_authorized_denomination_policy',scope:'declared_valuation',
  expression:'1 NUSD = 1 USDC = 1 USD',referenceUnit:'USD',
  units:Object.freeze(['NUSD','USDC','USD']),
  rates:Object.freeze(['NUSD','USDC','USD'].map(base=>Object.freeze({base,quote:'USD',numerator:'1',denominator:'1'}))),
  preserveCurrencyIdentity:true,providerBalancesChanged:false,
  reserveVerificationEstablished:false,executableConversionVerified:false
});

export function declaredTreasuryDenominations(nativeAmount) {
  if(typeof nativeAmount!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(nativeAmount))throw Error('INVALID_NATIVE_VALUATION_AMOUNT');
  return NUMINA_DENOMINATION_POLICY.units.map(unit=>({
    unit,amount:nativeAmount,amountBasis:'whole_units',
    rate:{base:'NUSD',quote:unit,numerator:'1',denominator:'1'}
  }));
}
