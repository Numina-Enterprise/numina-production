import {controlError} from '../control.js';
import {isZeroAddress,requireAddress,requirePositiveAmount} from './amounts.js';

const HEX32=/^0x[0-9a-fA-F]{64}$/;

// Reference copy: numina-smart-contracts/contracts/NuminaTreasuryReserve.sol
// SHA-256 2f1c5551b51042882bf445d96a61e5a4d38fbe491fc358b1c676a488871192ff (4138 bytes).
// This module does not replace that file and does not rescale any token.
export const TREASURY_RESERVE_REFERENCE=Object.freeze({
  label:'reference-original',
  path:'numina-smart-contracts/contracts/NuminaTreasuryReserve.sol',
  sha256:'2f1c5551b51042882bf445d96a61e5a4d38fbe491fc358b1c676a488871192ff',
  bytes:4138,
  decimals:6,
  capExpression:'1_500_000_000_000_000 * 10**6',
  baseUnitCap:'1500000000000000000000',
  knownIssues:Object.freeze([
    'Reference treasury uses 6 decimals and a 1.5-quadrillion cap; the receipt-bound on-chain NUSD source uses 18 decimals',
    'guardian is stored and unused',
    'executeSettlement accepts any nonzero proofHash and does not check a signature',
    'transferFrom does not reject a zero address'
  ])
});

// Unselected. The receipt-bound source and the runtime candidate stay separate files.
export const NUSD_DECIMAL_VARIANTS=Object.freeze([
  Object.freeze({id:'vengeance-treasury-reserve-6d',decimals:6,baseUnits:'1500000000000000000000',sha256:TREASURY_RESERVE_REFERENCE.sha256,role:'reference-original'}),
  Object.freeze({id:'receipt-bound-numina-usd-18d',decimals:18,baseUnits:'1500000000000000000000000000000000',sha256:'08fdd4e87e7ca336edc3cf7958a035feca73e4275968bee04d30d5d217e18238',role:'receipt-bound-source',receipt:'docs/nusd/deployment-receipt.json'}),
  Object.freeze({id:'runtime-candidate-numina-usd-6d',decimals:6,sha256:'c2aa2975d3a5c6fb1fe75ee86e3851e7a13ef1c21bfe06f8fa2a5a1558e52510',role:'runtime-candidate',path:'runtime/nusd/contracts/NuminaUSD.sol'})
]);
export const SELECTED_RUNTIME_VARIANT=null;

export function prepareReserveSettlement({owner,guardian,recipient,amount,proofHash,debitFrom,reserveAddress}){
  requireAddress(owner,'INVALID_OWNER');
  requireAddress(guardian,'INVALID_GUARDIAN');
  requireAddress(recipient,'INVALID_RECIPIENT');
  requireAddress(debitFrom,'INVALID_DEBIT_ACCOUNT');
  requireAddress(reserveAddress,'INVALID_RESERVE_ADDRESS');
  if(isZeroAddress(guardian)||isZeroAddress(owner)||guardian.toLowerCase()===owner.toLowerCase())controlError('GUARDIAN_MUST_BE_DISTINCT',400);
  if(isZeroAddress(recipient))controlError('INVALID_RECIPIENT',400);
  if(isZeroAddress(reserveAddress))controlError('INVALID_RESERVE_ADDRESS',400);
  const debit=debitFrom.toLowerCase();
  if(debit!==owner.toLowerCase()&&debit!==reserveAddress.toLowerCase())controlError('INVALID_DEBIT_ACCOUNT',400);
  requirePositiveAmount(amount,'ZERO_SETTLEMENT_AMOUNT');
  if(typeof proofHash!=='string'||!HEX32.test(proofHash)||/^0x0{64}$/i.test(proofHash))controlError('INVALID_PROOF_HASH',400);
  return Object.freeze({
    schema:'numina.treasury.reserve.preparation.v1',
    module:'treasury-reserve',
    status:'PREPARED',
    reference:TREASURY_RESERVE_REFERENCE.path,
    decimals:TREASURY_RESERVE_REFERENCE.decimals,
    selectedRuntimeVariant:SELECTED_RUNTIME_VARIANT,
    executionPerformed:false,
    balancesMoved:false,
    proofHashAuthorizesExecution:false,
    guardianUsed:true,
    signatureVerificationPerformed:false,
    owner,guardian,recipient,amount,proofHash,debitFrom,reserveAddress
  });
}

export function prepareReserveTransferFrom({from,to,amount}){
  requireAddress(from,'INVALID_ADDRESS');
  requireAddress(to,'INVALID_ADDRESS');
  if(isZeroAddress(from)||isZeroAddress(to))controlError('TRANSFER_TO_ZERO_ADDRESS',400);
  requirePositiveAmount(amount);
  return Object.freeze({status:'PREPARED',executionPerformed:false,balancesMoved:false,from,to,amount});
}

// A nonzero proofHash is not authorization. Present signatures are not checked here.
export function authorizeReserveSettlement(preparation,signatures={}){
  if(!preparation||preparation.status!=='PREPARED'||preparation.proofHashAuthorizesExecution!==false)controlError('SETTLEMENT_NOT_PREPARED',409);
  const guardianSignature=signatures.guardianSignature??null;
  const authoritySignature=signatures.authoritySignature??null;
  if(!guardianSignature||!authoritySignature)controlError('PROOF_HASH_IS_NOT_A_SIGNATURE',409);
  return Object.freeze({
    status:'BLOCKED',
    executionPerformed:false,
    signatureVerificationPerformed:false,
    reason:'SIGNATURE_VERIFICATION_NOT_PERFORMED'
  });
}

export function rescaleReserveBaseUnits(){
  controlError('DECIMAL_RESCALE_REFUSED',409);
}
