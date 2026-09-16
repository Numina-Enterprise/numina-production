import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReceiptIntake} from '../public/receipt-intake-ui.js';
import {MAX_RECEIPT_BYTES} from '../public/receipt-intake-model.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const report=(valid=true)=>({result:{valid,errors:valid?[]:['TEST_FAILURE']},mintPerformed:false});
function harness(review=async()=>report()){
 const nodes=new Map(),events=new Map(),downloads=[],calls=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,files:[]});return nodes.get(id);};
 const doc={getElementById:id=>node(id.replace('receipt-intake-',''))};
 const win={addEventListener:(event,handler)=>events.set(event,handler),removeEventListener:event=>events.delete(event)};
 const mounted=mountReceiptIntake({doc,win,review:async text=>{calls.push(text);return review(text);},download:(value,name)=>downloads.push({value,name})});
 return{doc,win,node,mounted,downloads,calls,events,paste:text=>{node('text').value=text;node('text').oninput();},select:(file)=>{node('file').files=[file];return node('file').onchange();}};
}
test('restoring a page after a successful review does not retain the success message',async()=>{
 const h=harness();h.paste('public observations');await h.node('check').onclick();
 assert.match(h.node('status').textContent,/consistent/);
 h.events.get('pagehide')();
 const restored=mountReceiptIntake({doc:h.doc,win:h.win});
 assert.equal(h.node('status').textContent,'No receipt observations loaded.');
 assert.equal(h.node('text').value,'');assert.equal(h.node('result').hidden,true);
 assert.equal(h.node('check').disabled,true);assert.equal(h.node('download').disabled,true);restored.dispose();
});
test('requires explicit checking and exports only the checked review',async()=>{
 const h=harness();assert.equal(h.node('check').disabled,true);assert.equal(h.calls.length,0);
 h.paste('{"actual":"observations"}');assert.equal(h.calls.length,0);
 await h.node('check').onclick();assert.equal(h.calls.length,1);assert.equal(h.node('download').disabled,false);
 h.node('download').onclick();assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].name,'Numina-NUSD-Receipt-Review.json');
 h.paste('changed');assert.equal(h.node('download').disabled,true);assert.equal(h.node('result').textContent,'');
 h.node('download').onclick();assert.equal(h.downloads.length,1);h.mounted.dispose();
});
test('a cleared or edited request cannot receive a late success',async()=>{
 const waiting=deferred(),h=harness(()=>waiting.promise);h.paste('first');const pending=h.node('check').onclick();
 h.node('clear').onclick();waiting.resolve(report());await pending;
 assert.equal(h.node('text').value,'');assert.equal(h.node('download').disabled,true);assert.equal(h.node('result').textContent,'');
 h.mounted.dispose();
});
test('failed or oversized file selection clears earlier success before reading',async()=>{
 const h=harness();h.paste('first');await h.node('check').onclick();
 let read=false;await h.select({size:MAX_RECEIPT_BYTES+1,arrayBuffer:async()=>{read=true;}});
 assert.equal(read,false);assert.equal(h.node('text').value,'');assert.equal(h.node('download').disabled,true);assert.equal(h.node('result').textContent,'');
 await h.select({size:1,arrayBuffer:async()=>Uint8Array.of(255).buffer});assert.equal(h.node('text').value,'');
 h.mounted.dispose();
});
test('a late file read cannot overwrite newer pasted input and page disposal erases state',async()=>{
 const waiting=deferred(),h=harness();const pending=h.select({size:2,arrayBuffer:()=>waiting.promise});
 h.paste('new input');waiting.resolve(new TextEncoder().encode('{}').buffer);await pending;
 assert.equal(h.node('text').value,'new input');assert.equal(h.calls.length,0);
 h.events.get('pagehide')();assert.equal(h.node('text').value,'');assert.equal(h.node('result').textContent,'');
});
test('private material rejection clears input and the template is not a result',async()=>{
 const h=harness(async()=>{throw Object.assign(new Error(),{code:'PRIVATE_MATERIAL_NOT_ACCEPTED'});});
 h.paste('synthetic secret');await h.node('check').onclick();assert.equal(h.node('text').value,'');assert.equal(h.node('download').disabled,true);
 h.node('template').onclick();assert.equal(h.downloads[0].value.receipt,null);assert.equal(h.downloads[0].value.mintPerformed,false);
 h.mounted.dispose();
});
