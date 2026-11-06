import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {ReservationStore} from '../reservation-store.mjs';
const policy={issuer:'https://issuer.example.test',audience:'urn:numina:settler',operator:'operator-test',payer:'payer-test',mandateId:'mandate-test',asset:'USDC',limitMinor:'1000'};
const input=(changes={})=>({...policy,nonce:'nonce-1',jti:'jti-1',amountMinor:'400',expiresAt:Math.floor(Date.now()/1000)+120,...changes});
function setup(){const dir=mkdtempSync(join(tmpdir(),'numina-mcp-'));return {dir,path:join(dir,'reservations.sqlite')};}
function worker(path,change){return new Promise((resolve,reject)=>{const w=new Worker(new URL('./reservation-worker.mjs',import.meta.url),{workerData:{path,policy,input:input(change)}});w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{if(code)reject(Error('worker exit '+code));});});}
test('durable nonce, token ID and budget survive database close/reopen',async()=>{
 const f=setup();let s;try{s=new ReservationStore(f.path,policy);assert.equal(await s.commit(input()),true);s.close();s=new ReservationStore(f.path,policy);
 assert.equal(await s.commit(input()),false);assert.equal(await s.commit(input({nonce:'another'})),false);
 assert.equal(await s.commit(input({nonce:'new',jti:'new',amountMinor:'700'})),false);
 assert.deepEqual(s.snapshot(),{usedMinor:'400',limitMinor:'1000',consumed:1});
 }finally{s?.close();rmSync(f.dir,{recursive:true});}
});
test('separate workers cannot consume one nonce twice',async()=>{
 const f=setup();try{const init=new ReservationStore(f.path,policy);init.close();const results=await Promise.all([worker(f.path,{}),worker(f.path,{})]);assert.deepEqual(results.sort(),[false,true]);const s=new ReservationStore(f.path,policy);assert.equal(s.snapshot().usedMinor,'400');s.close();}finally{rmSync(f.dir,{recursive:true});}
});
test('separate workers reserve the cumulative limit atomically',async()=>{
 const f=setup();try{const init=new ReservationStore(f.path,policy);init.close();const results=await Promise.all([worker(f.path,{nonce:'a',jti:'a',amountMinor:'600'}),worker(f.path,{nonce:'b',jti:'b',amountMinor:'600'})]);assert.deepEqual(results.sort(),[false,true]);const s=new ReservationStore(f.path,policy);assert.equal(s.snapshot().usedMinor,'600');s.close();}finally{rmSync(f.dir,{recursive:true});}
});
test('invalid, expired and wrong-bound input cannot consume a nonce or budget',async()=>{
 const f=setup();const s=new ReservationStore(f.path,policy);try{for(const change of [{amountMinor:'0'},{amountMinor:'1.5'},{amountMinor:'-1'},{amountMinor:'1e9'},{expiresAt:0},{audience:'another'},{mandateId:'other'}])assert.equal(await s.commit(input(change)),false);assert.equal(s.snapshot().usedMinor,'0');assert.equal(await s.commit(input()),true);}finally{s.close();rmSync(f.dir,{recursive:true});}
});
test('policy changes cannot reset a durable running limit and memory stores reject',()=>{
 const f=setup();try{const s=new ReservationStore(f.path,policy);s.close();assert.throws(()=>new ReservationStore(f.path,{...policy,limitMinor:'9999'}),/POLICY_CHANGE_REQUIRES_REVIEW/);assert.throws(()=>new ReservationStore(':memory:',policy),/DURABLE_POLICY_REQUIRED/);}finally{rmSync(f.dir,{recursive:true});}
});
test('financial integer units retain precision above Number safe integer',async()=>{
 const f=setup();const large={...policy,limitMinor:'900719925474099312345678'};const s=new ReservationStore(f.path,large);try{assert.equal(await s.commit(input({amountMinor:'900719925474099312345677'})),true);assert.equal(await s.commit(input({nonce:'n2',jti:'j2',amountMinor:'2'})),false);assert.equal(s.snapshot().usedMinor,'900719925474099312345677');}finally{s.close();rmSync(f.dir,{recursive:true});}
});
