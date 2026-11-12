import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {
  SIX_TREASURY_MODULES,
  BUIDL_ADAPTER,
  NUSD_DECIMAL_VARIANTS,
  REVENUE_SPLITTER_REFERENCE,
  SELECTED_RUNTIME_VARIANT,
  TREASURY_RESERVE_REFERENCE,
  USDY_ADAPTER,
  authorizeReserveSettlement,
  combinedSolvency,
  createSolvencyLedger,
  executeRevenueDistribution,
  postSolvencyEntry,
  prepareBuidlObservation,
  prepareQualifiedBankEscrow,
  prepareReserveSettlement,
  prepareReserveTransferFrom,
  prepareRevenueDistribution,
  prepareUsdyObservation,
  releaseQualifiedBankEscrow,
  rescaleReserveBaseUnits,
  solvencyResidual,
  splitRevenueAmount
} from '../src/treasury-modules/index.js';

const read=path=>fs.readFileSync(path);
const sha256=path=>createHash('sha256').update(read(path)).digest('hex');
const throws=(fn,code)=>assert.throws(fn,error=>error.code===code);
const owner='0x1111111111111111111111111111111111111111';
const guardian='0x2222222222222222222222222222222222222222';
const recipient='0x3333333333333333333333333333333333333333';
const reserve='0x4444444444444444444444444444444444444444';
const proof='0x'+'ab'.repeat(32);

test('six modules stay unwired and the reference contracts keep their hashes',()=>{
  assert.equal(SIX_TREASURY_MODULES.length,6);
  assert.deepEqual(SIX_TREASURY_MODULES.map(module=>module.id),['revenue-splitter','treasury-reserve','qualified-bank-escrow','solvency-ledger','usdy-adapter','buidl-adapter']);
  for(const module of SIX_TREASURY_MODULES)assert.equal(module.executionWired,false);
  assert.equal(SELECTED_RUNTIME_VARIANT,null);
  assert.equal(read(REVENUE_SPLITTER_REFERENCE.path).length,REVENUE_SPLITTER_REFERENCE.bytes);
  assert.equal(sha256(REVENUE_SPLITTER_REFERENCE.path),REVENUE_SPLITTER_REFERENCE.sha256);
  assert.equal(read(TREASURY_RESERVE_REFERENCE.path).length,TREASURY_RESERVE_REFERENCE.bytes);
  assert.equal(sha256(TREASURY_RESERVE_REFERENCE.path),TREASURY_RESERVE_REFERENCE.sha256);
  const receipt=JSON.parse(read('docs/nusd/deployment-receipt.json'));
  assert.equal(receipt.issuance.decimals,18);
  assert.equal(receipt.issuance.externallyBackedClaim,false);
  const bound=NUSD_DECIMAL_VARIANTS.find(variant=>variant.id==='receipt-bound-numina-usd-18d');
  assert.equal(bound.sha256,receipt.sourceSha256);
  assert.equal(bound.baseUnits,receipt.issuance.baseUnits);
  const runtime=NUSD_DECIMAL_VARIANTS.find(variant=>variant.id==='runtime-candidate-numina-usd-6d');
  assert.equal(sha256(runtime.path),runtime.sha256);
  assert.match(TREASURY_RESERVE_REFERENCE.knownIssues.join('\n'),/guardian is stored and unused/);
  assert.match(TREASURY_RESERVE_REFERENCE.knownIssues.join('\n'),/nonzero proofHash/);
  assert.match(TREASURY_RESERVE_REFERENCE.knownIssues.join('\n'),/transferFrom/);
  const referenceCap=BigInt(TREASURY_RESERVE_REFERENCE.baseUnitCap);
  assert.notEqual(referenceCap,BigInt(bound.baseUnits));
  assert.equal(referenceCap*(10n**12n),BigInt(bound.baseUnits));
  throws(()=>rescaleReserveBaseUnits(),'DECIMAL_RESCALE_REFUSED');
  for(const file of ['src/native-treasury.js','src/native-treasury-model.js','src/treasury-submission.js','src/treasury-policy.js']){
    assert.equal(read(file).toString('utf8').includes('treasury-modules'),false,file);
  }
});

test('revenue splitter conserves 70/20/10 and does not forward value',()=>{
  assert.deepEqual(splitRevenueAmount('1'),{amount:'1',reserve:'0',staking:'0',protocol:'1'});
  assert.deepEqual(splitRevenueAmount('10000'),{amount:'10000',reserve:'7000',staking:'2000',protocol:'1000'});
  const prepared=prepareRevenueDistribution('123456789');
  const shares=prepared.shares;
  assert.equal(BigInt(shares.reserve)+BigInt(shares.staking)+BigInt(shares.protocol),123456789n);
  assert.equal(prepared.executionPerformed,false);
  assert.equal(prepared.valueForwarded,false);
  throws(()=>executeRevenueDistribution(),'REVENUE_DISTRIBUTION_EXECUTION_NOT_WIRED');
  throws(()=>splitRevenueAmount('0'),'ZERO_REVENUE');
});

test('reserve preparation uses the guardian and does not treat proofHash as a signature',()=>{
  const prepared=prepareReserveSettlement({owner,guardian,recipient,amount:'10',proofHash:proof,debitFrom:reserve,reserveAddress:reserve});
  assert.equal(prepared.guardianUsed,true);
  assert.equal(prepared.proofHashAuthorizesExecution,false);
  assert.equal(prepared.balancesMoved,false);
  assert.equal(prepared.decimals,6);
  throws(()=>authorizeReserveSettlement(prepared,{}),'PROOF_HASH_IS_NOT_A_SIGNATURE');
  const blocked=authorizeReserveSettlement(prepared,{guardianSignature:'present',authoritySignature:'present'});
  assert.equal(blocked.status,'BLOCKED');
  assert.equal(blocked.signatureVerificationPerformed,false);
  throws(()=>prepareReserveSettlement({owner,guardian:owner,recipient,amount:'10',proofHash:proof,debitFrom:owner,reserveAddress:reserve}),'GUARDIAN_MUST_BE_DISTINCT');
  throws(()=>prepareReserveTransferFrom({from:owner,to:'0x0000000000000000000000000000000000000000',amount:'1'}),'TRANSFER_TO_ZERO_ADDRESS');
  const transfer=prepareReserveTransferFrom({from:owner,to:recipient,amount:'1'});
  assert.equal(transfer.executionPerformed,false);
});

test('qualified bank escrow reserves minor units without moving funds',()=>{
  const prepared=prepareQualifiedBankEscrow({amountMinor:'2500',currency:'USD',destinationReference:'bank-3486',institutionReference:'qualified-custodian',qualificationEvidenceDigest:'sha256:'+'ab'.repeat(32)});
  assert.equal(prepared.fundsMoved,false);
  assert.equal(prepared.submissionPerformed,false);
  assert.equal(prepared.qualificationVerified,false);
  assert.equal(BigInt(prepared.escrowedAmountMinor)+BigInt(prepared.releasedAmountMinor),BigInt(prepared.amountMinor));
  throws(()=>releaseQualifiedBankEscrow(),'BANK_RELEASE_NOT_WIRED');
  throws(()=>prepareQualifiedBankEscrow({amountMinor:'1',currency:'EUR',destinationReference:'bank-3486',institutionReference:'qualified-custodian'}),'INVALID_TRANSACTION_REFERENCE');
});

test('solvency ledger conserves one decimal group and refuses to add variants',()=>{
  let ledger=createSolvencyLedger();
  ledger=postSolvencyEntry(ledger,{id:'cash',component:'bank-usd',decimals:6,direction:'asset',baseUnits:'5000'});
  ledger=postSolvencyEntry(ledger,{id:'note',component:'usdy',decimals:6,direction:'liability',baseUnits:'1250'});
  const residual=solvencyResidual(ledger,6);
  assert.equal(residual.assets,'5000');
  assert.equal(residual.liabilities,'1250');
  assert.equal(residual.residual,'3750');
  assert.equal(residual.externallySolvent,false);
  assert.equal(combinedSolvency(ledger).residual,'3750');
  ledger=postSolvencyEntry(ledger,{id:'receipt-nusd',component:'nusd-18',decimals:18,direction:'asset',baseUnits:'1000'});
  throws(()=>combinedSolvency(ledger),'DECIMAL_VARIANTS_NOT_ADDITIVE');
  assert.equal(solvencyResidual(ledger,18).assets,'1000');
  assert.equal(ledger.executionPerformed,false);
});

test('USDY and BUIDL observations credit no NUSD',()=>{
  const token='0x5555555555555555555555555555555555555555';
  const usdy=prepareUsdyObservation({symbol:USDY_ADAPTER.symbol,decimals:18,nusdDecimals:6,baseUnits:'1000',tokenAddress:token});
  const buidl=prepareBuidlObservation({symbol:BUIDL_ADAPTER.symbol,decimals:6,nusdDecimals:18,baseUnits:'1000',tokenAddress:token});
  for(const observation of [usdy,buidl]){
    assert.equal(observation.status,'PREPARED');
    assert.equal(observation.nusdCredited,'0');
    assert.equal(observation.conversionPerformed,false);
    assert.equal(observation.executionPerformed,false);
    assert.equal(observation.chainObservationPerformed,false);
    assert.equal(observation.decimalVariantsUnresolved,true);
    assert.equal(observation.selectedNusdVariant,null);
  }
  assert.equal(usdy.instrumentClass,'TOKENIZED_TREASURY_NOTES');
  assert.equal(buidl.instrumentClass,'TOKENIZED_MONEY_MARKET_FUND');
  throws(()=>prepareUsdyObservation({symbol:'USDY',decimals:18,nusdDecimals:18,baseUnits:'1',tokenAddress:token,mintNusd:true}),'FUND_CONVERSION_EXECUTION_REFUSED');
  throws(()=>prepareBuidlObservation({symbol:'OTHER',decimals:6,nusdDecimals:6,baseUnits:'1',tokenAddress:token}),'FUND_SYMBOL_MISMATCH');
});
