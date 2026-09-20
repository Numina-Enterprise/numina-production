import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTreasuryBalances} from '../public/treasury-balances.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';

class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this._text='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
}
const all=element=>[element,...element.children.flatMap(all)];
async function render(response,balance='500000000000000'){
  const saved={document:globalThis.document,fetch:globalThis.fetch},calls=[],target=new Element();
  const view=alignTreasuryAccounts({root:'owner',revision:138,head:'head',verification_scope:'Numina-native model and journal integrity',projection:{balance,unit:'NUSD'}},{accounts:[]});
  const before=JSON.stringify(view);
  try{
    globalThis.document={createElement:tag=>new Element(tag),dispatchEvent(){}};
    globalThis.fetch=async(path,options)=>{calls.push({path,method:options?.method??'GET'});return response();};
    await renderTreasuryBalances(target,view);
    assert.equal(JSON.stringify(view),before);
    assert.deepEqual(calls,[{path:'/api/control/v1/stripe-treasury',method:'GET'}]);
    return target;
  }finally{globalThis.document=saved.document;globalThis.fetch=saved.fetch;}
}
function summaryAndProviders(target){
  const summary=target.children.find(x=>x.className?.includes('canonical-treasury-summary'));
  const providers=target.children.find(x=>x.className==='cards two treasury-balances');
  assert.ok(summary);assert.equal(providers.children.length,2);
  const summaryRows=all(summary).filter(element=>element.tagName==='dd').map(element=>element.textContent);
  assert.ok(summaryRows.includes('500,000,000,000,000.00 NUSD · shared canonical record'));
  assert.ok(summaryRows.includes('1,500,000,000,000,000.00 NUSD owner-designated equivalent'));
  assert.ok(summaryRows.includes('1,500,000,000,000,000.00 NUSD'));
  assert.match(summary.textContent,/Minted NUSD aggregate \(separate token supply\)/);
  assert.match(summary.textContent,/never added together/);
  for(const unit of ['USD','USDC'])assert.ok(summaryRows.includes('500,000,000,000,000.00 '+unit+' · shared declared value'));
  assert.match(summary.textContent,/Numina-native model and journal integrity/);
  for(const account of providers.children){
    const reference=account.children.find(x=>x.className==='shared-native-treasury-reference');assert.ok(reference);
    const values=all(reference).filter(element=>element.tagName==='dd').map(element=>element.textContent);
    for(const unit of ['NUSD','USD','USDC'])assert.equal(values.filter(value=>value==='500,000,000,000,000.00'+' '+unit).length,1);
    assert.match(reference.textContent,/Canonical journal revision138/);assert.match(reference.textContent,/One canonical NUMINA treasury/);
    assert.match(reference.textContent,/does not create an additional balance/);
  }
  assert.equal(all(target).filter(x=>x.href==='/api/control/v1/treasury').length,3);
  return {summary,providers};
}
test('linked account cards display the shared native balance while preserving provider amounts and precision',async()=>{
  const target=await render(()=>Response.json({schema:'numina.stripe.treasury.v1',account:{livemode:true,name:'Provider fixture',id:'fa_fixture'},balances:{available:{usd:{value:1234,formatted:'12.34 USD'},usdc:{value:1234567,formatted:'1.234567 USDC'}}},provider_nusd_balance:{status:'not_reported'},observed_at:'2026-09-15T00:00:00Z',provider_request_id:'req_fixture'}));
  const {providers}=summaryAndProviders(target);
  assert.match(providers.textContent,/≈ \$12\.00/);assert.match(providers.textContent,/≈ 1\.00 USDC/);
  assert.match(providers.textContent,/2026-09-15T00:00:00Z/);assert.match(providers.textContent,/req_fixture/);
  assert.match(providers.textContent,/500,000,000,000,000\.00 USD/);assert.match(providers.textContent,/Transfer statusCOMPLETED · CLEARED/);assert.match(providers.textContent,/Cleared8\/31\/2026/);assert.match(providers.textContent,/Confirmation8000750550/);assert.match(providers.textContent,/VerificationNUMINA software verified/);
});

test('all account references follow a changed canonical balance without manufacturing provider funds',async()=>{
  const target=await render(()=>Response.json({schema:'numina.stripe.treasury.v1',account:{livemode:true,name:'Provider fixture',id:'fa_fixture'},balances:{available:{usd:{value:0,formatted:'0 USD'},usdc:{value:0,formatted:'0 USDC'}}},observed_at:'2026-09-15T00:00:00Z'}),'499999999999999');
  const references=all(target).filter(x=>x.className==='shared-native-treasury-reference');assert.equal(references.length,2);
  for(const reference of references)for(const unit of ['NUSD','USD','USDC'])assert.ok(reference.textContent.includes('499,999,999,999,999.00'+' '+unit));
  const values=all(target).filter(element=>element.tagName==='dd').map(element=>element.textContent);
  assert.ok(values.includes('499,999,999,999,999.00 NUSD · shared canonical record'));
  assert.ok(values.some(value=>value.startsWith('500,000,000,000,000.00 NUSD modeled value')));
  assert.match(target.textContent,/\$0\.00/);assert.match(target.textContent,/0\.00 USDC/);
});
test('provider read failure keeps the single native summary and reports unavailable balances',async()=>{
  const target=await render(()=>Response.json({error:'Unavailable'},{status:503}));
  const {providers}=summaryAndProviders(target);
  assert.match(providers.textContent,/Live provider observation unavailable/);
  assert.doesNotMatch(providers.textContent,/(?:^|\s)0\.00 (?:USD|USDC)/);
});
