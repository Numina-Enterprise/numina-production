import test from 'node:test';
import assert from 'node:assert/strict';
import {NUMINA_TREASURY_CONNECTION as model} from '../public/treasury-connection-model.js';
import {renderTreasuryBalances} from '../public/treasury-balances.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';

class Element{
  constructor(){this.children=[];this._text='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;this._text='';}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
}

test('the canonical bank transfer is a modeled target and never renders as a cleared provider balance',async()=>{
  const transfer=model.softwareBalanceModel.bankUsd.transfer;
  assert.equal(transfer.amount,'500000000000000');assert.equal(transfer.unit,'USD');
  assert.equal(transfer.status,'MODEL_RECORDED');assert.equal(transfer.cleared,false);assert.equal(transfer.clearingStatus,'UNVERIFIED');
  assert.equal(transfer.providerVerified,false);assert.equal(transfer.externalSettlementVerified,false);
  const saved={document:globalThis.document,fetch:globalThis.fetch},target=new Element();
  try{
    globalThis.document={createElement:()=>new Element(),dispatchEvent(){}};
    globalThis.fetch=async()=>Response.json({error:'Unavailable'},{status:503});
    await renderTreasuryBalances(target,alignTreasuryAccounts({projection:{unit:'NUSD',balance:'7'}},{accounts:[]}));
    const bank=target.children.find(node=>node.className==='cards two treasury-balances').children[1];
    assert.match(bank.textContent,/500,000,000,000,000\.00 USD · owner-designated modeled target/);
    assert.match(bank.textContent,/Current USDUnavailableAvailable USDUnavailableFreshnessUnknown/);
    assert.match(bank.textContent,/Shared NUSD journal projection7\.00 NUSD/);
    assert.doesNotMatch(bank.textContent,/COMPLETED|CLEARED|8000750550|Transfer status|Cleared8\/31\/2026/);
  }finally{globalThis.document=saved.document;globalThis.fetch=saved.fetch;}
});
