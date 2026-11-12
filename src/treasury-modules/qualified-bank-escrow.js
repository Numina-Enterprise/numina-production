import {controlError} from '../control.js';
import {amountText,requirePositiveAmount} from './amounts.js';

// Mirrors PREPARE_BANK_TRANSACTION fields from src/native-treasury-model.js:
// amountMinor, currency USD, destination reference, submission_performed false.
// This module does not append a journal event or contact a bank.
const REFERENCE=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const DIGEST=/^sha256:[a-f0-9]{64}$/;

export function prepareQualifiedBankEscrow({amountMinor,currency,destinationReference,institutionReference,qualificationEvidenceDigest=null}){
  const amount=requirePositiveAmount(amountMinor,'INVALID_TRANSACTION_AMOUNT');
  if(currency!=='USD')controlError('INVALID_TRANSACTION_REFERENCE',400);
  if(typeof destinationReference!=='string'||!REFERENCE.test(destinationReference))controlError('INVALID_TRANSACTION_REFERENCE',400);
  if(typeof institutionReference!=='string'||!REFERENCE.test(institutionReference))controlError('INVALID_INSTITUTION_REFERENCE',400);
  if(qualificationEvidenceDigest!==null&&(typeof qualificationEvidenceDigest!=='string'||!DIGEST.test(qualificationEvidenceDigest)))controlError('INVALID_QUALIFICATION_DIGEST',400);
  const prepared=Object.freeze({
    schema:'numina.treasury.qualified-bank-escrow.preparation.v1',
    module:'qualified-bank-escrow',
    kind:'bank_transaction_request',
    status:'PREPARED',
    currency:'USD',
    amountMinor:amountText(amount),
    escrowedAmountMinor:amountText(amount),
    releasedAmountMinor:'0',
    destinationReference,
    institutionReference,
    qualificationEvidenceDigest,
    qualificationVerified:false,
    fundsMoved:false,
    submissionPerformed:false,
    executionPerformed:false,
    receipt:null
  });
  assertEscrowConserved(prepared);
  return prepared;
}

export function assertEscrowConserved(prepared){
  const escrowed=BigInt(prepared.escrowedAmountMinor);
  const released=BigInt(prepared.releasedAmountMinor);
  if(escrowed<0n||released<0n||escrowed+released!==BigInt(prepared.amountMinor))controlError('ESCROW_NOT_CONSERVED',409);
  return true;
}

export function releaseQualifiedBankEscrow(){
  controlError('BANK_RELEASE_NOT_WIRED',409);
}
