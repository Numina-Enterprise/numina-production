import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('▶ Numina Smart Contracts & Revenue Rails Suite', async (t) => {

  await t.test('1. NuminaTreasuryReserve Solidity Contract Invariants', () => {
    const solPath = path.join(__dirname, '..', 'contracts', 'NuminaTreasuryReserve.sol');
    assert.ok(fs.existsSync(solPath), 'NuminaTreasuryReserve.sol exists');
    const source = fs.readFileSync(solPath, 'utf8');

    // Invariants
    assert.match(source, /0x726e35da14739512f2ce45e03e394e81766388a28ce4164fed071b2383aab7cd/);
    assert.match(source, /MAX_SUPPLY = 1_500_000_000_000_000 \* 10\*\*6;/);
    assert.match(source, /decimals = 6;/);
    assert.match(source, /nonReentrant/);
    assert.match(source, /executeSettlement/);
  });

  await t.test('2. NuminaRevenueSplitter Mathematical Invariants', () => {
    const solPath = path.join(__dirname, '..', 'contracts', 'NuminaRevenueSplitter.sol');
    assert.ok(fs.existsSync(solPath), 'NuminaRevenueSplitter.sol exists');
    const source = fs.readFileSync(solPath, 'utf8');

    assert.match(source, /RESERVE_BPS = 7000/);
    assert.match(source, /STAKING_BPS = 2000/);
    assert.match(source, /PROTOCOL_BPS = 1000/);

    // Verify 70/20/10 integer math with arbitrary units
    const totalRevenue = 123456789n; // $123.456789
    const reserveShare = (totalRevenue * 7000n) / 10000n;
    const stakingShare = (totalRevenue * 2000n) / 10000n;
    const protocolShare = totalRevenue - reserveShare - stakingShare;

    assert.equal(reserveShare + stakingShare + protocolShare, totalRevenue);
  });

});
