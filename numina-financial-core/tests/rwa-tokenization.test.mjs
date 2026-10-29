// tests/rwa-tokenization.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RWATokenizationEngine,
  QUALIFIED_RWA_ASSET_TYPES,
  CANONICAL_CLUSTER_STATE_ROOT
} from '../src/rwa-tokenization-engine.mjs';

test('▶ Numina Institutional RWA & Tokenization Suite', async (t) => {
  const engine = new RWATokenizationEngine();

  await t.test('1. Ingestion of Institutional Tokenized MMF (BUIDL & FOBXX style)', () => {
    // 500,000,000 USD BUIDL allocation ($500M)
    const buidl = engine.registerInstitutionalAsset({
      assetId: 'sec-buidl-001',
      assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
      symbol: 'BUIDL',
      issuer: 'BlackRock / Securitize',
      regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
      unitsMicro: 500_000_000_000_000n, // 500M * 10^6
      navUsdMicro: 1_000_000n,          // $1.00 NAV
      custodian: 'BNY Mellon'
    });

    assert.equal(buidl.totalValueMicroUsd, 500_000_000_000_000n);
    assert.match(buidl.attestationHash, /^[a-f0-9]{64}$/);

    // 250,000,000 USD Franklin FOBXX / BENJI allocation ($250M)
    const benji = engine.registerInstitutionalAsset({
      assetId: 'sec-fobxx-001',
      assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
      symbol: 'BENJI',
      issuer: 'Franklin Templeton',
      regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
      unitsMicro: 250_000_000_000_000n,
      navUsdMicro: 1_000_000n,
      custodian: 'State Street'
    });

    assert.equal(benji.totalValueMicroUsd, 250_000_000_000_000n);
  });

  await t.test('2. Ingestion of Tokenized Short-Term Treasury Note (Ondo USDY style)', () => {
    // 150,000,000 USD Ondo USDY note ($150M)
    const usdy = engine.registerInstitutionalAsset({
      assetId: 'ondo-usdy-001',
      assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_TREASURY_NOTE,
      symbol: 'USDY',
      issuer: 'Ondo Finance',
      regulatoryFramework: 'SEC_REG_CRYPTO_ASSETS_SAFE_HARBOR',
      unitsMicro: 150_000_000_000_000n,
      navUsdMicro: 1_000_000n,
      custodian: 'Ankura Trust'
    });

    assert.equal(usdy.totalValueMicroUsd, 150_000_000_000_000n);
  });

  await t.test('3. Aggregate Reserve Calculations and 1:1 Solvency Verification', () => {
    const summary = engine.computeAggregateReserves();
    // 500M + 250M + 150M = 900,000,000 USD
    assert.equal(summary.aggregateMicroUsd, 900_000_000_000_000n);
    assert.equal(summary.assetCount, 3);

    // Test Solvency for 800,000,000 NUSD circulating
    const solvency = engine.verifyBackingSolvency(800_000_000_000_000n);
    assert.equal(solvency.isSolvent, true);
    assert.equal(solvency.surplusMicroUsd, 100_000_000_000_000n);
    assert.equal(solvency.coverageRatioBps, 11250); // 112.5% coverage
    assert.equal(solvency.clusterStateRoot, CANONICAL_CLUSTER_STATE_ROOT);
  });
});
