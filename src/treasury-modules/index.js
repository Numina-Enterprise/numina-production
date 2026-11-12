import {prepareBuidlObservation} from './buidl-adapter.js';
import {prepareQualifiedBankEscrow} from './qualified-bank-escrow.js';
import {prepareRevenueDistribution} from './revenue-splitter.js';
import {createSolvencyLedger} from './solvency-ledger.js';
import {prepareReserveSettlement,SELECTED_RUNTIME_VARIANT} from './treasury-reserve.js';
import {prepareUsdyObservation} from './usdy-adapter.js';

// Source catalog only. Not imported by src/native-treasury.js or src/treasury-submission.js.
export const SIX_TREASURY_MODULES=Object.freeze([
  Object.freeze({id:'revenue-splitter',prepare:prepareRevenueDistribution,executionWired:false}),
  Object.freeze({id:'treasury-reserve',prepare:prepareReserveSettlement,executionWired:false,selectedRuntimeVariant:SELECTED_RUNTIME_VARIANT}),
  Object.freeze({id:'qualified-bank-escrow',prepare:prepareQualifiedBankEscrow,executionWired:false}),
  Object.freeze({id:'solvency-ledger',prepare:createSolvencyLedger,executionWired:false}),
  Object.freeze({id:'usdy-adapter',prepare:prepareUsdyObservation,executionWired:false}),
  Object.freeze({id:'buidl-adapter',prepare:prepareBuidlObservation,executionWired:false})
]);

export {prepareRevenueDistribution,executeRevenueDistribution,splitRevenueAmount,REVENUE_SPLITTER_REFERENCE} from './revenue-splitter.js';
export {prepareReserveSettlement,prepareReserveTransferFrom,authorizeReserveSettlement,rescaleReserveBaseUnits,TREASURY_RESERVE_REFERENCE,NUSD_DECIMAL_VARIANTS,SELECTED_RUNTIME_VARIANT} from './treasury-reserve.js';
export {prepareQualifiedBankEscrow,releaseQualifiedBankEscrow,assertEscrowConserved} from './qualified-bank-escrow.js';
export {createSolvencyLedger,postSolvencyEntry,solvencyResidual,combinedSolvency} from './solvency-ledger.js';
export {prepareUsdyObservation,USDY_ADAPTER} from './usdy-adapter.js';
export {prepareBuidlObservation,BUIDL_ADAPTER} from './buidl-adapter.js';
