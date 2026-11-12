import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';

// Static source inspection. Writing this file did not execute it.
const read = path => fs.readFileSync(path);
const text = path => read(path).toString('utf8');
const sha256 = path => createHash('sha256').update(read(path)).digest('hex');
const reference = 'numina-smart-contracts/contracts';
const proposal = 'runtime/nusd/proposals/vengeance-treasury-splitter';
const intake = 'runtime/nusd/reference/vengeance-local-source-intake';

function functionBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`unterminated ${signature}`);
}

test('reference vengeance sources stay the owner-supplied bytes', () => {
  const provenance = JSON.parse(text(`${intake}/provenance.json`));
  assert.equal(provenance.executionWired, false);
  assert.equal(provenance.deploymentIdentityProven, false);
  assert.equal(provenance.externalBackingProven, false);
  assert.equal(provenance.bytecodeEquivalenceClaimed, false);
  assert.equal(provenance.testsExecuted, false);
  assert.equal(provenance.intakeProvenanceFileReobservedInWorkspace, false);
  assert.deepEqual(provenance.fieldsNotReobserved, ['originalMachine', 'originalPath', 'originalMtime']);
  const expected = [
    ['NuminaTreasuryReserve.sol', 4138, '2f1c5551b51042882bf445d96a61e5a4d38fbe491fc358b1c676a488871192ff', '728cee9b25d28057f6800a3531ea9c90bdb93495'],
    ['NuminaRevenueSplitter.sol', 2122, '685d081ff1b4485a112eeb926f4e0edff71b419879b655d8b7ceb31a8d22f000', 'e955c8198a04495b2d58ea29c271c194e0c76018'],
  ];
  assert.equal(provenance.sources.length, expected.length);
  for (const [filename, bytes, hash, blob] of expected) {
    const path = `${reference}/${filename}`;
    const recorded = provenance.sources.find(source => source.filename === filename);
    assert.equal(read(path).length, bytes);
    assert.equal(sha256(path), hash);
    assert.equal(recorded.sha256, hash);
    assert.equal(recorded.bytes, bytes);
    assert.equal(recorded.gitBlob, blob);
    assert.equal(recorded.repositoryPath, path);
    assert.equal(recorded.duplicateBytesAdded, false);
  }
});

test('decimal variants stay distinct and unselected', () => {
  const record = JSON.parse(text(`${intake}/variant-record.json`));
  const receipt = JSON.parse(text('runtime/nusd/deployment-receipt.json'));
  assert.equal(record.status, 'UNRESOLVED');
  assert.equal(record.selectedRuntimeVariant, null);
  assert.equal(record.proposedChoice.selectedRuntimeVariant, null);
  assert.equal(record.executionWired, false);
  assert.equal(record.rescaleApplied, false);
  assert.equal(record.historicalVariantsErased, false);
  assert.equal(record.bytecodeEquivalenceClaimed, false);
  const cap6 = 1_500_000_000_000_000n * (10n ** 6n);
  const base18 = BigInt(receipt.issuance.baseUnits);
  assert.equal(receipt.issuance.decimals, 18);
  assert.equal(receipt.issuance.externallyBackedClaim, false);
  assert.equal(receipt.sourceSha256, '08fdd4e87e7ca336edc3cf7958a035feca73e4275968bee04d30d5d217e18238');
  assert.equal(cap6.toString(), '1500000000000000000000');
  assert.equal(base18.toString(), '1500000000000000000000000000000000');
  assert.equal(cap6 * (10n ** 12n), base18);
  assert.notEqual(cap6, base18);
  const byId = Object.fromEntries(record.variants.map(variant => [variant.id, variant]));
  assert.equal(byId['vengeance-treasury-reserve-6d'].decimals, 6);
  assert.equal(byId['vengeance-treasury-reserve-6d'].baseUnitCap, cap6.toString());
  assert.equal(byId['receipt-bound-numina-usd-18d'].decimals, 18);
  assert.equal(byId['receipt-bound-numina-usd-18d'].sha256, receipt.sourceSha256);
  assert.equal(byId['runtime-candidate-numina-usd-6d'].decimals, 6);
  assert.equal(byId['runtime-candidate-numina-usd-6d'].sameSourceAsVengeanceTreasury, false);
  assert.notEqual(byId['runtime-candidate-numina-usd-6d'].sha256, byId['vengeance-treasury-reserve-6d'].sha256);
  assert.notEqual(byId['runtime-candidate-numina-usd-6d'].sha256, byId['receipt-bound-numina-usd-18d'].sha256);
  for (const file of [...record.sixModuleSnapshot, ...record.preservedEighteenDecimalCopies]) {
    assert.equal(read(file.path).length, file.bytes, file.path);
    assert.equal(sha256(file.path), file.sha256, file.path);
  }
  assert.match(text('runtime/nusd/history/6d/contracts/NuminaUSD.sol'), /return 6;/);
  assert.match(text('docs/contracts/NuminaUSD.sol'), /return 18;/);
  assert.match(text('runtime/nusd/history/18d/contracts/NuminaUSD.sol'), /return 18;/);
  assert.match(text(`${reference}/NuminaTreasuryReserve.sol`), /decimals = 6;/);
  assert.match(text(`${reference}/NuminaTreasuryReserve.sol`), /MAX_SUPPLY = 1_500_000_000_000_000 \* 10\*\*6;/);
});

test('reference review leads remain visible in the original source', () => {
  const treasury = text(`${reference}/NuminaTreasuryReserve.sol`);
  const splitter = text(`${reference}/NuminaRevenueSplitter.sol`);
  assert.match(treasury, /1:1 Stablecoin Rail/);
  assert.match(treasury, /guardian = _guardian;/);
  assert.equal(treasury.includes('msg.sender == guardian'), false);
  assert.equal(treasury.includes('ecrecover'), false);
  const settlement = functionBody(treasury, 'function executeSettlement(');
  assert.match(settlement, /proofHash != bytes32\(0\)/);
  assert.match(settlement, /emit Transfer\(owner, recipient, amount\);/);
  assert.match(settlement, /balanceOf\[address\(this\)\] -= amount;/);
  const transferFrom = functionBody(treasury, 'function transferFrom(');
  assert.equal(transferFrom.includes('TRANSFER_TO_ZERO_ADDRESS'), false);
  const receive = functionBody(splitter, 'receive()');
  assert.match(receive, /distributeRevenue\(\);/);
  assert.match(splitter, /payable\(treasuryReserveVault\)\.transfer\(reserveShare\);/);
  assert.match(splitter, /protocolShare = amount - reserveShare - stakingShare;/);
  assert.match(splitter, /RESERVE_BPS = 7000/);
  assert.match(splitter, /STAKING_BPS = 2000/);
  assert.match(splitter, /PROTOCOL_BPS = 1000/);
});

test('proposed sources harden preparation and execution without rescaling', () => {
  const treasury = text(`${proposal}/NuminaTreasuryReserve.proposed.sol`);
  const splitter = text(`${proposal}/NuminaRevenueSplitter.proposed.sol`);
  assert.match(treasury, /PROPOSED SOURCE ONLY/);
  assert.match(treasury, /decimals = 6;/);
  assert.match(treasury, /MAX_SUPPLY = 1_500_000_000_000_000 \* 10\*\*6;/);
  assert.equal(treasury.includes('10**18'), false);
  assert.match(treasury, /externalBackingVerified = false;/);
  assert.match(treasury, /does not verify cash, USDC, bank balances, or a 1:1 rail/);
  assert.match(treasury, /EIP712Domain/);
  assert.match(treasury, /GUARDIAN_MUST_BE_DISTINCT/);
  const prepare = functionBody(treasury, 'function prepareSettlement(');
  assert.match(prepare, /proofHash != bytes32\(0\)/);
  assert.equal(prepare.includes('balanceOf'), false);
  const executeStart = treasury.indexOf('function executeSettlement(');
  const executeSignature = treasury.slice(executeStart, treasury.indexOf('{', executeStart));
  assert.equal(executeSignature.includes('proofHash'), false);
  const execute = functionBody(treasury, 'function executeSettlement(');
  assert.match(execute, /prep\.proofHash/);
  assert.equal(execute.includes('proofHash != bytes32(0)'), false);
  assert.match(execute, /SETTLEMENT_EXECUTION_DISABLED/);
  assert.match(execute, /GUARDIAN_SIGNATURE_REQUIRED/);
  assert.match(execute, /AUTHORITY_SIGNATURE_REQUIRED/);
  assert.match(execute, /emit Transfer\(debitFrom, recipient, amount\);/);
  assert.equal(execute.includes('emit Transfer(owner, recipient, amount)'), false);
  assert.match(execute, /totalSupply == supplyBefore/);
  assert.match(functionBody(treasury, 'function transferFrom('), /TRANSFER_TO_ZERO_ADDRESS/);
  assert.match(functionBody(treasury, 'constructor(address _guardian)'), /externalBackingVerified|guardian = _guardian/);
  assert.equal(functionBody(treasury, 'constructor(address _guardian)').includes('settlementExecutionEnabled = true'), false);
  const receive = functionBody(splitter, 'receive()');
  assert.match(receive, /escrowed \+= msg.value;/);
  assert.equal(receive.includes('distributeRevenue'), false);
  assert.equal(receive.includes('executeDistribution'), false);
  assert.equal(splitter.includes('.transfer('), false);
  const distribute = functionBody(splitter, 'function executeDistribution(');
  assert.match(distribute, /DISTRIBUTION_DISABLED/);
  assert.match(distribute, /SPLIT_NOT_CONSERVED/);
  assert.equal(distribute.includes('.call'), false);
  const claim = functionBody(splitter, 'function claim()');
  assert.ok(claim.indexOf('totalClaimable -= amount;') < claim.indexOf('.call{value: amount}'));
  assert.match(splitter, /RESERVE_BPS \+ STAKING_BPS \+ PROTOCOL_BPS == TOTAL_BPS/);
});

test('70/20/10 remainder stays with protocol and conserves the amount', () => {
  const split = amount => {
    const reserve = (amount * 7000n) / 10000n;
    const staking = (amount * 2000n) / 10000n;
    const protocol = amount - reserve - staking;
    return {reserve, staking, protocol};
  };
  for (const amount of [1n, 9_999n, 10_000n, 123_456_789n, 1_500_000_000_000_000n * (10n ** 6n)]) {
    const shares = split(amount);
    assert.equal(shares.reserve + shares.staking + shares.protocol, amount);
    assert.ok(shares.protocol >= amount * 1000n / 10000n);
  }
  assert.deepEqual(split(1n), {reserve: 0n, staking: 0n, protocol: 1n});
  assert.deepEqual(split(10_000n), {reserve: 7000n, staking: 2000n, protocol: 1000n});
});

test('proposal patches and records are not wired into execution entrypoints', () => {
  const record = JSON.parse(text(`${intake}/variant-record.json`));
  assert.equal(record.executionWired, false);
  for (const file of [
    'scripts/nusd-contract-record.mjs',
    'runtime/nusd/scripts/deploy-production.mjs',
    'runtime/nusd/scripts/activate-minted-nusd.mjs',
    'runtime/nusd/scripts/prepare-mint.mjs',
    'public/nusd-contract-record.js',
  ]) {
    const source = text(file);
    assert.equal(source.includes('vengeance-treasury-splitter'), false, file);
    assert.equal(source.includes('NuminaTreasuryReserve'), false, file);
    assert.equal(source.includes('NuminaRevenueSplitter'), false, file);
  }
  for (const filename of ['NuminaTreasuryReserve.proposed.patch', 'NuminaRevenueSplitter.proposed.patch']) {
    assert.match(text(`${proposal}/${filename}`), /numina-smart-contracts\/contracts\//);
  }
  assert.match(text(`${proposal}/NuminaTreasuryReserve.proposed.patch`), /numina-smart-contracts\/contracts\/NuminaTreasuryReserve\.sol/);
  assert.match(text(`${proposal}/NuminaRevenueSplitter.proposed.patch`), /runtime\/nusd\/proposals\/vengeance-treasury-splitter\/NuminaRevenueSplitter\.proposed\.sol/);
  assert.match(text(`${proposal}/PROPOSED-CHANGES.md`), /selectedRuntimeVariant` in the variant record is `null`/);
});
