import {prepareFundObservation} from './fund-adapter.js';

// NUSD-facing adapter for tokenized Treasury notes (USDY). Decimals are an input.
// This file does not assume USDY decimals equal the 6-decimal reference reserve or the 18-decimal receipt-bound NUSD.
export const USDY_ADAPTER=Object.freeze({
  schema:'numina.treasury.usdy-adapter.v1',
  module:'usdy-adapter',
  symbol:'USDY',
  instrumentClass:'TOKENIZED_TREASURY_NOTES',
  issuerLabel:'Ondo'
});

export function prepareUsdyObservation(input){
  return prepareFundObservation(USDY_ADAPTER,input);
}
