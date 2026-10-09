import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Bank of America transfer display uses canonical 500T software transfer amount',()=>{
  const balances=read('public/treasury-balances.js');
  const connection=read('public/treasury-connection.js');
  assert.match(balances,/transfer\.amount/);
  assert.match(balances,/transfer\.unit/);
  assert.match(connection,/transfer\.amount/);
  assert.match(connection,/transfer\.unit/);
  assert.doesNotMatch(balances,/Provider displayed transaction amount/);
  assert.doesNotMatch(connection,/provider-displayed transaction/);
});
