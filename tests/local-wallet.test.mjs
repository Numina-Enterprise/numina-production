import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {Wallet} from '../public/vendor/ethers-6.15.0.min.js';
import {encryptLocalWallet} from '../public/local-wallet-crypto.js';
import {validWalletPasswords,walletBackup} from '../public/local-wallet-policy.js';
import {createLocalDraft} from '../public/deployment-readiness-model.js';
// Public, deliberately insecure fixture. Never fund or use this key outside tests.
const fixtureKey='0x'+'11'.repeat(32),password='PUBLIC-TEST-PASSWORD-ONLY';
const fixtureWallet=new Wallet(fixtureKey);
const fixture=await encryptLocalWallet(password,()=>{},()=>fixtureWallet);
test('pinned library bytes and version match the reviewed local distribution',()=>{
 const bytes=readFileSync(new URL('../public/vendor/ethers-6.15.0.min.js',import.meta.url));
 const record=JSON.parse(readFileSync(new URL('../public/vendor/ethers-6.15.0-record.json',import.meta.url)));
 assert.equal(record.version,'6.15.0');assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);assert.equal(bytes.length,record.bytes);
});
test('public fixture round-trips through production-strength encrypted keystore without exposing plaintext',async()=>{
 const stored=JSON.parse(fixture.keystore);assert.equal(stored.Crypto.kdfparams.n,131072);assert.equal(stored.Crypto.kdfparams.r,8);assert.equal(stored.Crypto.kdfparams.p,1);
 assert.ok(!fixture.keystore.includes(fixtureKey.slice(2)));assert.ok(!fixture.keystore.includes(password));assert.ok(!fixture.keystore.includes('mnemonic'));
 const restored=await Wallet.fromEncryptedJson(fixture.keystore,password);assert.equal(restored.address,fixtureWallet.address);
 await assert.rejects(Wallet.fromEncryptedJson(fixture.keystore,'wrong-password-for-test'));
});
test('weak encryption, malformed output and arbitrary metadata cannot reach the backup download',()=>{
 const value=JSON.parse(fixture.keystore);value.privateKey=fixtureKey;value.password=password;
 const cleaned=walletBackup({...fixture,keystore:JSON.stringify(value)});assert.ok(!cleaned.keystore.includes(password));assert.ok(!cleaned.keystore.includes('privateKey'));
 value.Crypto.kdfparams.n=2;assert.throws(()=>walletBackup({...fixture,keystore:JSON.stringify(value)}));assert.throws(()=>walletBackup({address:fixture.address,keystore:'bad'}));
 assert.equal(validWalletPasswords('short','short'),false);assert.equal(validWalletPasswords(password,password+'x'),false);assert.equal(validWalletPasswords(password,password),true);
});
class Element{constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.handlers={};this.children=[];}addEventListener(name,callback){this.handlers[name]=callback;}append(...items){this.children.push(...items);}click(){this.clicked=true;}remove(){this.removed=true;}}
function harness({secure=true,ready=true}={}){
 const elements=new Map(),events={},workers=[],blobs=[],revoked=[],recipients=[];
 const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const doc={getElementById:get,createElement:()=>new Element(),body:new Element()};
 const win={isSecureContext:secure,crypto,addEventListener:(name,callback)=>events[name]=callback};
 const workerFactory=()=>{const worker={messages:[],terminated:false,postMessage(message){this.messages.push(message);},terminate(){this.terminated=true;}};workers.push(worker);return worker;};
 const context=vm.createContext({document:doc,window:win,Blob,URL:{createObjectURL(blob){blobs.push(blob);return 'blob:fixture-'+blobs.length;},revokeObjectURL(url){revoked.push(url);}},validWalletPasswords,walletBackup});
 const ui=readFileSync(new URL('../public/local-wallet-ui.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function mountLocalWallet','function mountLocalWallet').replace('import.meta.url',"'https://numina.invalid/local-wallet-ui.js'");
 vm.runInContext(ui+'\nglobalThis.mount=mountLocalWallet;',context);
 const controller=context.mount({isReady:()=>ready,onRecipient:address=>recipients.push(address),doc,win,workerFactory});
 const setPasswords=()=>{get('wallet-password').value=password;get('wallet-confirmation').value=password;};
 const submit=()=>get('wallet-form').handlers.submit({preventDefault(){}});
 return {get,events,workers,blobs,revoked,recipients,controller,setPasswords,submit};
}
test('creation requires matching passwords, secure context and a ready source before any worker starts',async()=>{
 for(const options of [{secure:false},{ready:false},{}]){const h=harness(options);h.setPasswords();if(!Object.keys(options).length)h.get('wallet-confirmation').value='different';await h.submit();assert.equal(h.workers.length,0);assert.equal(h.recipients.length,0);}
});
test('one user action clears password fields, prevents duplicate creation, and requires backup before recipient handoff',async()=>{
 const h=harness();h.setPasswords();await h.submit();await h.submit();assert.equal(h.workers.length,1);assert.equal(h.get('wallet-password').value,'');assert.equal(h.get('wallet-confirmation').value,'');
 const worker=h.workers[0];worker.onmessage({data:{type:'ready',...fixture}});assert.ok(worker.terminated);assert.equal(h.get('wallet-use').disabled,true);assert.equal(h.recipients.length,0);
 h.get('wallet-download').handlers.click();assert.equal(h.blobs.length,1);const download=await h.blobs[0].text();assert.ok(!download.includes(password));assert.ok(!download.includes(fixtureKey.slice(2)));
 h.get('wallet-use').handlers.click();assert.equal(h.recipients.length,0);h.get('wallet-backup-confirmed').checked=true;h.get('wallet-backup-confirmed').handlers.change();h.get('wallet-use').handlers.click();assert.deepEqual(h.recipients,[fixture.address]);
 const draft=createLocalDraft({recipient:h.recipients[0]});assert.equal(draft.productionReady,false);assert.equal(draft.signed,false);assert.ok(!JSON.stringify(draft).includes(password));
 h.events.pagehide();assert.equal(h.get('wallet-address').textContent,'No wallet created.');assert.equal(h.get('wallet-use').disabled,true);assert.equal(h.revoked.length,1);
});
test('cancel, page exit and errors ignore late completions without exposing error arguments',async()=>{
 for(const action of ['cancel','pagehide','error']){
  const h=harness();h.setPasswords();await h.submit();const worker=h.workers[0];
  if(action==='cancel')h.get('wallet-cancel').handlers.click();else if(action==='pagehide')h.events.pagehide();else worker.onerror({message:password,privateKey:fixtureKey});
  worker.onmessage({data:{type:'ready',...fixture}});
  assert.equal(h.get('wallet-download').disabled,true);assert.equal(h.get('wallet-password').value,'');assert.equal(h.recipients.length,0);assert.ok(!h.get('wallet-status').textContent.includes(password));
 }
});
test('worker protocol starts once, clears input message and returns only encrypted/public output',async()=>{
 const posts=[],message={password};let calls=0;
 const self={isSecureContext:true,postMessage:value=>posts.push(value),close(){}};
 const code=readFileSync(new URL('../public/local-wallet-worker.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(code,{self,crypto,encryptLocalWallet:async(value,progress)=>{calls++;assert.equal(value,password);progress(.5);return fixture;}});
 await self.onmessage({data:message});await self.onmessage({data:{password}});
 assert.equal(calls,1);assert.equal(message.password,null);assert.equal(posts.at(-1).address,fixture.address);assert.ok(!JSON.stringify(posts).includes(password));assert.ok(!JSON.stringify(posts).includes(fixtureKey.slice(2)));
});
