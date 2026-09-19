import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const source = read('runtime/nusd/treasury-settlement-receipt.json');
const record = JSON.parse(source);

test('runtime and downloadable treasury reports are identical', () => {
  assert.equal(source, read('docs/nusd/treasury-settlement-receipt.json'));
});
test('an unresolved report cannot assert payment submission or settlement', () => {
  assert.equal(record.status, 'RECONCILIATION_REQUIRED');
  assert.equal(record.final, false);
  assert.equal(record.isPaymentReceipt, false);
  assert.equal(record.executable, false);
  assert.equal(record.queued, false);
  assert.equal(record.submissionPerformed, null);
  assert.equal(record.settlementPerformed, null);
  for (const component of record.components) {
    assert.equal(component.settledAmount, null);
    assert.equal(component.submissionPerformed, null);
    assert.equal(component.settlementPerformed, null);
    assert.equal(component.externallyVerified, false);
    assert.equal(component.reservesVerified, false);
    assert.equal(component.externalReceipt, null);
  }
});
test('the single treasury and requested allocations remain intact without a USD valuation', () => {
  assert.equal(record.identity, 'NUMINA');
  assert.equal(record.singular, true);
  assert.equal(record.aggregate.componentCount, 3);
  assert.equal(record.aggregate.amountNusd, '1500000000000000');
  assert.equal(record.aggregate.verifiedUsdValue, null);
  assert.equal(record.aggregate.amountBasis, 'OWNER_REPORTED_ISSUANCE_AND_REQUESTED_ALLOCATIONS');
  assert.deepEqual(record.components.map(component => component.amountNusd),
    ['500000000000000', '500000000000000', '500000000000000']);
  assert.equal(record.components.reduce((total, component) => total + BigInt(component.amountNusd), 0n),
    BigInt(record.aggregate.amountNusd));
  assert.equal(record.components[0].ratio, '1:1');
  assert.equal(record.components[1].ratio, '1:1');
});
test('legacy assertions retain a versioned source rather than becoming new evidence', () => {
  const legacy = record.reconciliation.legacyAssertion;
  assert.equal(legacy.commit, '8ade30a91a822824b8d2cd4bc210f5071239c76b');
  assert.equal(legacy.blobSha, '7fe4e94f0efbf84208e160be4936310d3d29f88f');
  assert.equal(legacy.supportsExternalSettlement, false);
  assert.equal(record.mintEvidence.transactionHash,
    '0x86578ab250a1b0d23bc801338bf1530d07a93dc5e09965da5088ff57baac0a1b');
  assert.equal(record.reconciliation.requestedDepositUsdcTransferHash, null);
  assert.equal(record.reconciliation.requestedDepositAchTrace, null);
});
test('the historical 12 USD confirmation cannot certify the requested deposit', () => {
  const historical = record.reconciliation.historicalBankConfirmation;
  assert.equal(historical.numberFromScreenshot, '8000750550');
  assert.equal(historical.postingDate, '2026-08-31');
  assert.equal(historical.amountUsdCents, '1200');
  assert.equal(historical.supportsRequested500TTransfer, false);
});
test('unknown native holdings and stale bank data remain explicitly unverified', () => {
  const {nativeNusd, bankSnapshot} = record.reconciliation;
  assert.equal(nativeNusd.currentQuantity, null);
  assert.equal(nativeNusd.usdValuation, null);
  assert.equal(nativeNusd.displayUnknownAsZeroIsValid, false);
  assert.equal(bankSnapshot.sourceFreshness, 'unknown');
  assert.equal(bankSnapshot.currentBankBalanceIndependentlyVerified, false);
  assert.equal(bankSnapshot.reportingViewReconciled, false);
});
test('the Stripe snapshot is not relabeled as continuous sync or reserve verification', () => {
  const stripe = record.reconciliation.stripeSnapshot;
  assert.equal(stripe.available.USDC, '0');
  assert.equal(stripe.continuousSync, false);
  assert.equal(record.reconciliation.nativeNusd.reserveBackingVerified, false);
  assert.equal(record.reconciliation.ownerReportedInitiationVerified, false);
});
