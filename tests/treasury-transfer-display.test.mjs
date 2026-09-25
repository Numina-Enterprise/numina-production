import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Bank location labels the target without presenting a historical transfer as current funds',()=>{
  const balances=read('public/treasury-balances.js');
  const connection=read('public/treasury-connection.js');
  for(const source of [balances,connection]){
    assert.match(source,/nativeHoldingText\('USD'\)/);
    assert.doesNotMatch(source,/COMPLETED · CLEARED|Confirmation 8000750550|transfer\.amount/);
  }
  assert.match(balances,/journalTreasuryMetadata/);
  assert.match(balances,/amount unverified/);
  assert.match(balances,/historical allocation target/);
});
