import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountWalletSigning} from '../public/wallet-signing-ui.js';
import {validateSigningReview} from '../public/wallet-signing-model.js';

const account='0x1a45671AE2ee3E52264116151924FAAcb80Fc02E';
const profile=()=>({constructor:{admin:'reviewed-admin',issuer:'reviewed-issuer',minter:'reviewed-minter',pauser:'reviewed-pauser',adminDelaySeconds:'86400',approvedIssuerPolicyHash:'reviewed-policy'},unresolvedReviews:[{id:'independentSecurityAudit'},{id:'independentRoleKeyCustody'}]});
const connection=()=>({account,chainId:'962421430'});
const quote=()=>({gasLimit:'9007199254740993',gasPrice:'11',calculatedTotalBaseUnits:'99079191802150923',balanceBaseUnits:'99079191802150924',observedAt:'2026-09-16T00:00:00.000Z'});
const handoff=()=>({status:'UNSIGNED_UNVERIFIED_HANDOFF',signed:false,broadcast:false,minted:false,receipt:null});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.textContent='';this.value='';this.hidden=false;this.disabled=false;}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=[...nodes];}
 click(){return this.onclick?.();}
}
function harness(options={}){
 const nodes=new Map(),events=new Map(),timers=new Map(),calls={factory:0,connect:0,estimate:[],handoff:[],dispose:0,provider:[]},downloads=[],instances=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
 const doc={getElementById:node,createElement:tag=>new Element(tag),body:new Element('body')};
 const provider={request:request=>{calls.provider.push(request);throw Error('Unexpected real wallet call');},on(){},removeListener(){}};
 let timerId=0,signal;
 const win={ethereum:options.noWallet?undefined:provider,setTimeout:handler=>{timers.set(++timerId,handler);return timerId;},clearTimeout:id=>timers.delete(id),addEventListener:(name,handler)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(handler);},removeEventListener:(name,handler)=>events.get(name)?.delete(handler)};
 const clientFactory=({provider:passed,onInvalidated})=>{
  calls.factory++;assert.strictEqual(passed,provider);
  const instance={connect:()=>{calls.connect++;return options.connect?options.connect():Promise.resolve(connection());},estimate:value=>{calls.estimate.push(value);return options.estimate?options.estimate(value):Promise.resolve(quote());},handoff:value=>{calls.handoff.push(value);return options.handoff?options.handoff(value):Promise.resolve(handoff());},dispose:()=>{calls.dispose++;onInvalidated('disposed');},invalidate:()=>onInvalidated('account_changed')};
  instances.push(instance);return instance;
 };
 const mounted=mountWalletSigning({doc,win,clientFactory,loadReview:input=>{signal=input;return options.loadReview?options.loadReview(input):Promise.resolve(profile());},download:value=>downloads.push(value)});
 return {node,calls,downloads,instances,timers,mounted,signal:()=>signal,emit:name=>{for(const handler of [...(events.get(name)??[])])handler({type:name});},snapshot:()=>Array.from(nodes,([id,n])=>({id,text:n.textContent,value:n.value,hidden:n.hidden,disabled:n.disabled,children:n.children.map(child=>child.textContent)}))};
}
async function estimated(h){await h.mounted.ready;await h.node('signing-connect').click();await h.node('signing-estimate').click();}

test('Node imports do not auto-mount; a missing browser wallet never requests an account',async()=>{
 assert.equal(typeof globalThis.document,'undefined');assert.equal(typeof mountWalletSigning,'function');
 const h=harness({noWallet:true});await h.mounted.ready;
 assert.equal(h.node('signing-connect').disabled,true);assert.match(h.node('wallet-availability').textContent,/No browser wallet/);
 await h.node('signing-connect').click();await h.node('signing-estimate').click();await h.node('signing-download').click();
 assert.equal(h.calls.factory,0);assert.equal(h.calls.connect,0);assert.equal(h.calls.provider.length,0);assert.equal(h.downloads.length,0);
 h.mounted.dispose();
});

test('connect, estimate and handoff each require a separate explicit click and preserve exact fee integers',async()=>{
 const supplied=profile(),expected=handoff(),h=harness({loadReview:()=>Promise.resolve(supplied),handoff:()=>Promise.resolve(expected)});await h.mounted.ready;
 assert.equal(h.calls.factory,0);assert.equal(h.calls.connect,0);assert.equal(h.calls.estimate.length,0);assert.equal(h.calls.handoff.length,0);
 await h.node('signing-estimate').click();await h.node('signing-download').click();assert.equal(h.calls.factory,0);
 await h.node('signing-connect').click();assert.equal(h.calls.connect,1);assert.equal(h.calls.estimate.length,0);assert.match(h.node('signing-connection').textContent,new RegExp(account));
 await h.node('signing-download').click();assert.equal(h.calls.handoff.length,0);
 await h.node('signing-estimate').click();assert.strictEqual(h.calls.estimate[0],supplied);assert.equal(h.calls.handoff.length,0);
 assert.equal(h.node('signing-gas-limit').textContent,'9007199254740993');assert.equal(h.node('signing-gas-price').textContent,'11 native base units');
 assert.equal(h.node('signing-total').textContent,'99079191802150923 native base units');assert.equal(h.node('signing-balance').textContent,'99079191802150924 native base units');
 assert.equal(h.node('signing-maximum').value,'99079191802150923');assert.equal(h.node('signing-quote').hidden,false);assert.equal(h.node('signing-download').disabled,false);
 h.node('signing-maximum').value='  99079191802150924  ';h.node('signing-maximum').oninput();
 await h.node('signing-download').click();assert.deepEqual(h.calls.handoff,[{maximumFeeBaseUnits:'99079191802150924'}]);assert.strictEqual(h.downloads[0],expected);
 assert.match(h.node('signing-status').textContent,/Unsigned handoff downloaded/);assert.match(h.node('signing-status').textContent,/No transaction was submitted/);
 assert.equal(h.calls.provider.length,0);h.mounted.dispose();
});

for(const phase of ['connect','estimate','handoff'])test(`pending ${phase} blocks duplicate clicks, reconnect, clear and other work`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise});await h.mounted.ready;
 if(phase!=='connect')await h.node('signing-connect').click();if(phase==='handoff')await h.node('signing-estimate').click();
 const target=phase==='handoff'?'signing-download':'signing-'+phase,operation=h.node(target).click(),before={factory:h.calls.factory,connect:h.calls.connect,estimate:h.calls.estimate.length,handoff:h.calls.handoff.length,dispose:h.calls.dispose};
 for(const id of ['signing-connect','signing-clear','signing-estimate','signing-download']){assert.equal(h.node(id).disabled,true);await h.node(id).click();}
 assert.deepEqual({factory:h.calls.factory,connect:h.calls.connect,estimate:h.calls.estimate.length,handoff:h.calls.handoff.length,dispose:h.calls.dispose},before);assert.equal(h.downloads.length,0);
 pending.resolve(phase==='connect'?connection():phase==='estimate'?quote():handoff());await operation;
 assert.equal(h.downloads.length,phase==='handoff'?1:0);h.mounted.dispose();
});

test('clear removes the connection and all observed fee fields and requires a new connection',async()=>{
 const h=harness();await estimated(h);h.node('signing-clear').click();
 assert.equal(h.calls.dispose,1);assert.equal(h.node('signing-connection').textContent,'No wallet connected.');assert.equal(h.node('signing-maximum').value,'');assert.equal(h.node('signing-quote').hidden,true);
 for(const id of ['signing-gas-limit','signing-gas-price','signing-total','signing-balance','signing-observed'])assert.equal(h.node(id).textContent,'');
 await h.node('signing-estimate').click();await h.node('signing-download').click();assert.equal(h.calls.estimate.length,1);assert.equal(h.calls.handoff.length,0);assert.equal(h.downloads.length,0);
 await h.node('signing-connect').click();assert.equal(h.calls.factory,2);assert.equal(h.calls.connect,2);h.mounted.dispose();
});

test('a disposed client callback cannot invalidate the replacement connection or its estimate',async()=>{
 const h=harness();await estimated(h);const old=h.instances[0];
 h.node('signing-clear').click();await h.node('signing-connect').click();
 assert.equal(h.calls.dispose,1);assert.equal(h.calls.factory,2);const connected=h.snapshot();
 old.invalidate();assert.deepEqual(h.snapshot(),connected);assert.equal(h.node('signing-estimate').disabled,false);
 await h.node('signing-estimate').click();const estimatedView=h.snapshot();old.invalidate();
 assert.deepEqual(h.snapshot(),estimatedView);assert.equal(h.node('signing-download').disabled,false);
 await h.node('signing-download').click();assert.equal(h.downloads.length,1);assert.equal(h.calls.handoff.length,1);h.mounted.dispose();
});

for(const phase of ['connect','estimate','handoff'])for(const resolution of ['resolve','reject'])test(`wallet invalidation suppresses a late ${phase} ${resolution}`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise});await h.mounted.ready;
 if(phase!=='connect')await h.node('signing-connect').click();if(phase==='handoff')await h.node('signing-estimate').click();
 const operation=h.node(phase==='handoff'?'signing-download':'signing-'+phase).click();h.instances[0].invalidate();
 assert.equal(h.node('signing-connection').textContent,'No wallet connected.');assert.equal(h.node('signing-maximum').value,'');assert.equal(h.node('signing-quote').hidden,true);assert.equal(h.node('signing-download').disabled,true);
 const afterInvalidation=h.snapshot();
 if(resolution==='reject')pending.reject(Error('late wallet result'));else pending.resolve(phase==='connect'?connection():phase==='estimate'?quote():handoff());
 await operation;assert.deepEqual(h.snapshot(),afterInvalidation);assert.equal(h.downloads.length,0);h.mounted.dispose();
});

for(const phase of ['connect','estimate','handoff'])test(`pagehide disposes a pending ${phase} and ignores its late response`,async()=>{
 const pending=deferred(),h=harness({[phase]:()=>pending.promise});await h.mounted.ready;
 if(phase!=='connect')await h.node('signing-connect').click();if(phase==='handoff')await h.node('signing-estimate').click();
 const operation=h.node(phase==='handoff'?'signing-download':'signing-'+phase).click();h.emit('pagehide');
 assert.equal(h.calls.dispose,1);assert.equal(h.signal().aborted,true);assert.equal(h.timers.size,0);assert.equal(h.node('signing-maximum').value,'');assert.equal(h.node('signing-quote').hidden,true);
 assert.equal(h.node('signing-connection').textContent,'No wallet connected.');
 for(const id of ['signing-gas-limit','signing-gas-price','signing-total','signing-balance','signing-observed'])assert.equal(h.node(id).textContent,'');
 for(const id of ['signing-connect','signing-clear','signing-estimate','signing-download','signing-maximum'])assert.equal(h.node(id).disabled,true);
 const afterDisposal=h.snapshot();pending.resolve(phase==='connect'?connection():phase==='estimate'?quote():handoff());await operation;
 assert.deepEqual(h.snapshot(),afterDisposal);assert.equal(h.downloads.length,0);
 await h.node('signing-connect').click();await h.node('signing-download').click();h.mounted.dispose();assert.equal(h.calls.dispose,1);assert.equal(h.downloads.length,0);
});

test('expired observations erase the fee limit and cannot be exported',async()=>{
 const h=harness();await estimated(h);assert.equal(h.timers.size,1);[...h.timers.values()][0]();
 assert.equal(h.node('signing-maximum').value,'');assert.equal(h.node('signing-quote').hidden,true);assert.equal(h.node('signing-download').disabled,true);assert.match(h.node('signing-status').textContent,/expired/);
 await h.node('signing-download').click();assert.equal(h.calls.handoff.length,0);assert.equal(h.downloads.length,0);assert.equal(h.calls.dispose,1);h.mounted.dispose();
});

test('a failed review load keeps connection unavailable',async()=>{
 const h=harness({loadReview:()=>Promise.reject(Error('review unavailable'))});await h.mounted.ready;
 assert.equal(h.node('signing-connect').disabled,true);assert.match(h.node('signing-profile-status').textContent,/could not be verified/);
 await h.node('signing-connect').click();assert.equal(h.calls.factory,0);assert.equal(h.calls.connect,0);h.mounted.dispose();
});

test('a review arriving after pagehide cannot populate or enable the controls',async()=>{
 const pending=deferred(),h=harness({loadReview:()=>pending.promise});h.emit('pagehide');const before=h.snapshot();pending.resolve(profile());await h.mounted.ready;
 assert.equal(h.signal().aborted,true);assert.deepEqual(h.snapshot(),before);assert.equal(h.calls.factory,0);assert.equal(h.downloads.length,0);
});

test('edited review execution and approval flags fail actual byte validation before any account prompt',async()=>{
 const review=JSON.parse(readFileSync(new URL('../public/wallet-signing-review.json',import.meta.url),'utf8'));
 for(const key of ['signed','broadcast','minted','deposited','productionReady','reviewEvidenceVerified','policyReviewVerified'])review[key]=true;
 review.receipt={status:'success'};
 const bytes=new TextEncoder().encode(JSON.stringify(review));const h=harness({loadReview:()=>validateSigningReview(bytes)});await h.mounted.ready;
 assert.equal(h.node('signing-connect').disabled,true);assert.match(h.node('signing-profile-status').textContent,/could not be verified/);
 await h.node('signing-connect').click();await h.node('signing-download').click();assert.equal(h.calls.factory,0);assert.equal(h.downloads.length,0);h.mounted.dispose();
});
