import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RWATokenizationEngine, QUALIFIED_RWA_ASSET_TYPES } from '../src/rwa-tokenization-engine.mjs';

const engine = new RWATokenizationEngine();

// 1. Ingest BUIDL ($500M)
engine.registerInstitutionalAsset({
  assetId: 'RWA-BUIDL-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
  symbol: 'BUIDL',
  issuer: 'BlackRock Financial Management',
  regulatoryFramework: 'SEC_REG_CRYPTO_ASSETS_SAFE_HARBOR',
  unitsMicro: 500_000_000_000_000n,
  navUsdMicro: 1_000_000n,
  custodian: 'BNY Mellon Qualified Custody'
});

// 2. Ingest BENJI / FOBXX ($350M)
engine.registerInstitutionalAsset({
  assetId: 'RWA-BENJI-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
  symbol: 'BENJI',
  issuer: 'Franklin Templeton',
  regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
  unitsMicro: 350_000_000_000_000n,
  navUsdMicro: 1_000_000n,
  custodian: 'State Street Global Services'
});

// 3. Ingest USDY ($250M)
engine.registerInstitutionalAsset({
  assetId: 'RWA-USDY-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_TREASURY_NOTE,
  symbol: 'USDY',
  issuer: 'Ondo Finance Inc',
  regulatoryFramework: 'SEC_REG_CRYPTO_ASSETS_SAFE_HARBOR',
  unitsMicro: 250_000_000_000_000n,
  navUsdMicro: 1_000_000n,
  custodian: 'Ankura Trust Escrow'
});

// 4. Ingest Bank Escrow ($400M)
engine.registerInstitutionalAsset({
  assetId: 'CASH-BOFA-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.QUALIFIED_BANK_DEPOSIT,
  symbol: 'USD-ESCROW',
  issuer: 'Bank of America CashPro',
  regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
  unitsMicro: 400_000_000_000_000n,
  navUsdMicro: 1_000_000n,
  custodian: 'Bank of America Custody'
});

const agg = engine.computeAggregateReserves();
const circulatingNusdMicro = 1_500_000_000_000_000n; // $1.5 Billion
const solvency = engine.verifyBackingSolvency(circulatingNusdMicro);

console.log('================================================================================');
console.log('NUMINA RWA TOKENIZATION ENGINE: LIVE EXECUTION STATUS');
console.log('================================================================================');
console.log('Cluster State Root:       ', engine.clusterStateRoot);
console.log('Total Assets Ingested:    ', agg.assetCount);
console.log('Aggregate Reserve Value:  ', agg.aggregateUsdFormatted);
console.log('Aggregate Micro Units:    ', agg.aggregateMicroUsd.toString(), 'n');
console.log('Circulating NUSD:         ', engine.formatUsdFromMicro(circulatingNusdMicro));
console.log('1:1 Solvency Backing:     ', solvency.isSolvent ? 'VERIFIED & 100% SOLVENT' : 'INSOLVENT');
console.log('Coverage Ratio:           ', (solvency.coverageRatioBps / 100).toFixed(2) + '%');
console.log('Surplus Liquidity:        ', engine.formatUsdFromMicro(solvency.surplusMicroUsd));
console.log('--------------------------------------------------------------------------------');
console.log('INSTITUTIONAL ASSET REGISTRY:');
for (const [id, asset] of engine.reserves.entries()) {
  console.log(`- [${asset.symbol}] ${asset.issuer}`);
  console.log(`    Allocation:   ${engine.formatUsdFromMicro(asset.totalValueMicroUsd)}`);
  console.log(`    Asset Type:   ${asset.assetType}`);
  console.log(`    Custodian:    ${asset.custodian}`);
  console.log(`    Proof Digest: ${asset.attestationHash}`);
}
console.log('================================================================================');
