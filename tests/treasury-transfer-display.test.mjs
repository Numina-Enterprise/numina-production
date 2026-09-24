import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Bank location displays the native settlement without presenting a historical transfer as 500T',()=>{
  const balances=read('public/treasury-balances.js');
  const connection=read('public/treasury-connection.js');
  for(const source of [balances,connection]){
    assert.match(source,/receipt\.id/);
    assert.match(source,/nativeHoldingText\('USD'\)/);
    assert.doesNotMatch(source,/COMPLETED · CLEARED|Confirmation 8000750550|transfer\.amount/);
  }
});
