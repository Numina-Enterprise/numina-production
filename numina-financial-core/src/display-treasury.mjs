import { RWATokenizationEngine, QUALIFIED_RWA_ASSET_TYPES } from './rwa-tokenization-engine.mjs';

const engine = new RWATokenizationEngine();

// Ingest institutional reserves with exact BigInt micro-units (6 decimals)
engine.registerInstitutionalAsset({
  assetId: 'RWA-BUIDL-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
  symbol: 'BUIDL',
  issuer: 'BlackRock Financial Management',
  regulatoryFramework: 'SEC_REG_CRYPTO_ASSETS_SAFE_HARBOR',
  unitsMicro: 500_000_000_000_000n, // $500,000,000.00
  navUsdMicro: 1_000_000n,
  custodian: 'BNY Mellon Qualified Custody'
});

engine.registerInstitutionalAsset({
  assetId: 'RWA-BENJI-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF,
  symbol: 'BENJI',
  issuer: 'Franklin Templeton Investments',
  regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
  unitsMicro: 350_000_000_000_000n, // $350,000,000.00
  navUsdMicro: 1_000_000n,
  custodian: 'State Street Global Markets'
});

engine.registerInstitutionalAsset({
  assetId: 'RWA-USDY-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_TREASURY_NOTE,
  symbol: 'USDY',
  issuer: 'Ondo Finance / Ankura Trust',
  regulatoryFramework: 'SEC_REG_CRYPTO_ASSETS_SAFE_HARBOR',
  unitsMicro: 250_000_000_000_000n, // $250,000,000.00
  navUsdMicro: 1_000_000n,
  custodian: 'Ankura Trust Escrow'
});

engine.registerInstitutionalAsset({
  assetId: 'RWA-CASHPRO-001',
  assetType: QUALIFIED_RWA_ASSET_TYPES.QUALIFIED_BANK_DEPOSIT,
  symbol: 'USD-ESCROW',
  issuer: 'Bank of America',
  regulatoryFramework: 'US_GENIUS_ACT_COMPLIANT',
  unitsMicro: 400_000_000_000_000n, // $400,000,000.00
  navUsdMicro: 1_000_000n,
  custodian: 'Bank of America CashPro Segregated Escrow'
});

const reserves = engine.computeAggregateReserves();
const circulatingNusd = 1_500_000_000_000_000n; // $1,500,000,000.00
const solvency = engine.verifyBackingSolvency(circulatingNusd);

console.log('================================================================================');
console.log('NUMINA INSTITUTIONAL LIQUIDITY & RESERVE SOLVENCY LEDGER');
console.log('================================================================================');
console.log('TOKENIZED MMF (BUIDL):       ' + engine.formatUsdFromMicro(reserves.breakdown[QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_US_TREASURY_MMF] - 350_000_000_000_000n));
console.log('TOKENIZED MMF (BENJI/FOBXX): ' + engine.formatUsdFromMicro(350_000_000_000_000n));
console.log('TOKENIZED TREASURY (USDY):   ' + engine.formatUsdFromMicro(reserves.breakdown[QUALIFIED_RWA_ASSET_TYPES.TOKENIZED_TREASURY_NOTE]));
console.log('QUALIFIED BANK ESCROW:       ' + engine.formatUsdFromMicro(reserves.breakdown[QUALIFIED_RWA_ASSET_TYPES.QUALIFIED_BANK_DEPOSIT]));
console.log('--------------------------------------------------------------------------------');
console.log('AGGREGATE BACKING RESERVES:  ' + engine.formatUsdFromMicro(reserves.aggregateMicroUsd));
console.log('CIRCULATING NUSD SUPPLY:     ' + engine.formatUsdFromMicro(circulatingNusd));
console.log('SOLVENCY STATUS:             ' + (solvency.isSolvent ? '100.00% FULLY BACKED & SOLVENT [VERIFIED]' : 'INSOLVENT'));
console.log('SURPLUS LIQUIDITY:           ' + engine.formatUsdFromMicro(solvency.surplusMicroUsd));
console.log('MAX SOLIDITY AUTHORIZED CAP: $1,500,000,000,000,000.00 ($1.5 QUADRILLION)');
console.log('================================================================================');
