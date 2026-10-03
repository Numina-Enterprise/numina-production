import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NUMINA_TREASURY_CONNECTION as model} from '../public/treasury-connection-model.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('bank location display retains historical targets without claiming a current completed transfer',()=>{
  const balances=read('public/treasury-balances.js');
  const connection=read('public/treasury-connection.js');
  assert.equal(model.softwareBalanceModel.bankUsd.current,null);
  assert.equal(Object.hasOwn(model.softwareBalanceModel.bankUsd,'transfer'),false);
  assert.equal(model.softwareBalanceModel.bankUsd.historicalTransfer.providerBalanceCurrentVerified,false);
  assert.equal(model.softwareBalanceModel.bankUsd.historicalTransfer.providerTransactionCurrentVerified,false);
  assert.equal(model.softwareBalanceModel.bankUsd.historicalTransfer.externalSettlementVerified,false);
  assert.match(balances,/Current settlement status/);
  for(const source of [balances,connection])assert.doesNotMatch(source,/transfer\.(amount|unit)|COMPLETED · CLEARED/);
  assert.doesNotMatch(balances,/Provider displayed transaction amount/);
  assert.doesNotMatch(connection,/provider-displayed transaction/);
});
