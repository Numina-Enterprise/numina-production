import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatTreasuryNusdWholeAmount,formatTreasuryModelWholeAmount,formatTreasuryProviderAmount} from '../public/treasury-amount.js';

test('NUSD whole-unit display preserves exact integers and pads eighteen decimal places',()=>{
  assert.equal(formatTreasuryNusdWholeAmount('0'),'0.000000000000000000 NUSD');
  assert.equal(formatTreasuryNusdWholeAmount('1500000000000000'),'1,500,000,000,000,000.000000000000000000 NUSD');
  assert.equal(formatTreasuryNusdWholeAmount('9007199254740993'),'9,007,199,254,740,993.000000000000000000 NUSD');
  for(const value of [null,undefined,1,9007199254740992,1n,'-1','01','1.1','1e18',' 1','1\n','1'.repeat(79)])assert.throws(()=>formatTreasuryNusdWholeAmount(value),/INVALID_MODEL_WHOLE_AMOUNT/);
});

test('all model denomination views use eighteen display places without changing their unit',()=>{
  for(const unit of ['USD','USDC','NUSD'])assert.equal(formatTreasuryModelWholeAmount('500000000000000',unit),'500,000,000,000,000.000000000000000000 '+unit);
  assert.throws(()=>formatTreasuryModelWholeAmount('1','BTC'),/INVALID_MODEL_WHOLE_AMOUNT/);
});

test('provider currencies retain their own minor units, including beyond safe Number precision',()=>{
  assert.equal(formatTreasuryProviderAmount('9007199254740993','usd'),'$90,071,992,547,409.93');
  assert.equal(formatTreasuryProviderAmount('9007199254740993','usdc'),'9,007,199,254.740993 USDC');
  assert.equal(formatTreasuryProviderAmount('-1','usdc'),'-0.000001 USDC');
});

test('public issuance copy agrees with the existing receipt without changing contract identity',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const receipt=JSON.parse(read('runtime/nusd/deployment-receipt.json'));
  const verification=JSON.parse(read('runtime/nusd/deployment-verification.json'));
  assert.equal(receipt.issuance.decimals,18);
  assert.equal(BigInt(receipt.issuance.amountNusd)*10n**18n,BigInt(receipt.issuance.baseUnits));
  for(const path of ['public/economy.html','public/blockchain.html']){
    const html=read(path);
    assert.ok(html.includes(receipt.token.address));
    assert.ok(html.includes(receipt.chainId));
    assert.ok(html.includes(formatTreasuryNusdWholeAmount(receipt.issuance.amountNusd)));
    assert.ok(html.includes('/downloads/nusd/deployment-receipt.json'));
    assert.ok(html.includes('/downloads/nusd/deployment-verification.json'));
    assert.doesNotMatch(html,/Six-decimal NUSD|NUSD is not issued|No treasury minting has been performed|Deployment addresses and transaction receipts remain unverified/);
    assert.match(html,/newer chain observation/);
  }
  assert.equal(verification.issuance.paused,true);
  assert.equal(verification.externalSettlement.reservesVerified,false);
});
