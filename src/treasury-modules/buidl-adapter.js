import {prepareFundObservation} from './fund-adapter.js';

// NUSD-facing adapter for a tokenized money market fund (BUIDL). Decimals are an input.
// This file does not assume BUIDL decimals equal either NUSD variant, and it does not credit NUSD.
export const BUIDL_ADAPTER=Object.freeze({
  schema:'numina.treasury.buidl-adapter.v1',
  module:'buidl-adapter',
  symbol:'BUIDL',
  instrumentClass:'TOKENIZED_MONEY_MARKET_FUND',
  issuerLabel:'BlackRock'
});

export function prepareBuidlObservation(input){
  return prepareFundObservation(BUIDL_ADAPTER,input);
}
