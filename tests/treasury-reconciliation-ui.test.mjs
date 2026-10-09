import test from 'node:test';
import assert from 'node:assert/strict';
import {renderFundingPlan,renderTreasuryReconciliation} from '../public/funding-plan.js';
import {treasuryEvidencePayload} from '../src/treasury-evidence.js';
import {alignTreasuryAccounts} from '../src/treasury-alignment.js';
class Element{
  constructor(tag){this.tagName=tag;this.children=[];this._text='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this._text='';this.children=[...nodes];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(n=>n.textContent).join('');}
}
const t={root:'owner',status:'READY',revision:138,head:'a'.repeat(64),verification_scope:'native model',projection:{balance:'500000000000000',unit:'NUSD',verification:'VERIFIED'}};
const frontier={accounts:[],fundingPlan:{id:'plan',eventId:'plan-event',status:'UNFUNDED_PLAN'},fundingDeclaration:{FUNDED_PLAN:true,eventId:'owner-event'}};
async function fixture(){return {view:alignTreasuryAccounts(t,frontier),receipt:{payload:await treasuryEvidencePayload({treasury:t,frontier,providerObservation:{status:'UNAVAILABLE',record:null},supportingDocuments:null,capturedAt:'2026-09-15T00:00:00Z'})}};}
async function dom(run){const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};try{return await run();}finally{globalThis.document=previous;}}
test('reconciliation view describes captured sources and never turns owner approval into deposit readiness',()=>dom(async()=>{
  const {view,receipt}=await fixture(),before=JSON.stringify({view,receipt}),panel=renderTreasuryReconciliation(receipt,view);
  assert.match(panel.textContent,/journal revision 138/);assert.match(panel.textContent,/Stripe USD available balanceUnavailable/);
  assert.match(panel.textContent,/Bank of AmericaBank connection unavailable/);assert.match(panel.textContent,/Not ready for submission/);
  assert.doesNotMatch(panel.textContent,/500,000,000,000,000|provider.confirmed|deposit completed/i);
  assert.equal(JSON.stringify({view,receipt}),before);
}));
test('reconciliation rejects stale snapshots, retargeted roots and claimed execution',()=>dom(async()=>{
  const {view,receipt}=await fixture();
  for(const change of [p=>p.root='another',p=>p.revision++,p=>p.head='b'.repeat(64),p=>p.reconciliation.capturedAt='other',p=>p.reconciliation.canonicalTreasury.id='another',p=>p.reconciliation.depositReadiness.status='READY',p=>p.reconciliation.depositReadiness.submissionPerformed=true,p=>p.reconciliation.depositReadiness.receipt={}]){
    const changed=structuredClone(receipt);change(changed.payload);assert.throws(()=>renderTreasuryReconciliation(changed,view),/does not match/);
  }
}));
test('reading reconciliation uses the existing evidence GET and drops results after view cancellation',()=>dom(async()=>{
  const {view,receipt}=await fixture(),target=new Element('div'),calls=[],controller=new AbortController();
  let resolve;const api=(path,body)=>{calls.push({path,body});return new Promise(r=>{resolve=r;});};
  await renderFundingPlan(target,view,api,()=>assert.fail('No refresh or write expected'),{signal:controller.signal});
  const button=target.children.find(n=>n.textContent==='Read treasury reconciliation and evidence');
  const pending=button.onclick();controller.abort();resolve(receipt);await pending;
  assert.deepEqual(calls,[{path:'treasury/evidence',body:undefined}]);
  assert.equal(target.children.find(n=>n.tagName==='div').children.length,0);
}));
test('a successful evidence read renders the current summary and source details without writing',()=>dom(async()=>{
  const {view,receipt}=await fixture(),target=new Element('div'),calls=[];
  await renderFundingPlan(target,view,async(path,body)=>{calls.push({path,body});return receipt;},()=>assert.fail('No refresh or write expected'));
  await target.children.find(n=>n.textContent==='Read treasury reconciliation and evidence').onclick();
  const result=target.children.find(n=>n.tagName==='div');
  assert.equal(result.children[0].tagName,'section');assert.equal(result.children[1].tagName,'details');
  assert.match(result.textContent,/Treasury reconciliation/);assert.match(result.textContent,/Inspect source records and Numina signature/);
  assert.deepEqual(calls,[{path:'treasury/evidence',body:undefined}]);
}));
