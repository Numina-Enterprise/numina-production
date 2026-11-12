import {controlError} from '../control.js';
import {requireAddress,requireDecimals,requirePositiveAmount} from './amounts.js';

// Shared preparation for tokenized-fund observations. An observation does not mint or credit NUSD.
export function prepareFundObservation(spec,input){
  if(!input||input.symbol!==spec.symbol)controlError('FUND_SYMBOL_MISMATCH',400);
  if(input.convert===true||input.mintNusd===true)controlError('FUND_CONVERSION_EXECUTION_REFUSED',409);
  const decimals=requireDecimals(input.decimals);
  if(input.nusdDecimals!==6&&input.nusdDecimals!==18)controlError('NUSD_DECIMAL_VARIANT_REQUIRED',400);
  requirePositiveAmount(input.baseUnits,'INVALID_AMOUNT');
  requireAddress(input.tokenAddress,'INVALID_TOKEN_ADDRESS');
  return Object.freeze({
    schema:spec.schema,
    module:spec.module,
    instrument:spec.symbol,
    instrumentClass:spec.instrumentClass,
    issuerLabel:spec.issuerLabel,
    status:'PREPARED',
    tokenAddress:input.tokenAddress,
    instrumentDecimals:decimals,
    instrumentBaseUnits:input.baseUnits,
    nusdDecimalsNoted:input.nusdDecimals,
    selectedNusdVariant:null,
    sameDecimalCount:decimals===input.nusdDecimals,
    decimalVariantsUnresolved:true,
    nusdCredited:'0',
    conversionPerformed:false,
    executionPerformed:false,
    chainObservationPerformed:false
  });
}
