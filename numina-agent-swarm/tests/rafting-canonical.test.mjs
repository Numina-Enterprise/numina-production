import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, tokenize } from '../src/rafting-resilience.mjs';

const vectorDir = join(dirname(fileURLToPath(import.meta.url)), 'vectors', 'jcs');

test('RFC 8785 §3.2.3 recursive UTF-16 member ordering independent of insertion order',()=>{
 const a={ttl_seconds:300,node_b:{state_commitment:'x',node_id:'B',public_key:'k'},node_a:{public_key:'k',node_id:'A',state_commitment:'x'},sequence:42};
 const b={sequence:42,node_a:{state_commitment:'x',node_id:'A',public_key:'k'},node_b:{public_key:'k',node_id:'B',state_commitment:'x'},ttl_seconds:300};
 assert.equal(canonicalize(a),canonicalize(b));
 assert.equal(canonicalize({'\uE000':1,'\uD800\uDC00':2}),'{"𐀀":2,"":1}');
});
test('RFC 8785 §3.2.1 whitespace stripped and §3.2.3 array order retained',()=>{
 assert.equal(canonicalize(JSON.parse(' { "sequence": 1, "binding_id": "test" } ')),'{"binding_id":"test","sequence":1}');
 assert.equal(canonicalize({metrics:[10,5,20,15]}),'{"metrics":[10,5,20,15]}');
});
test('RFC 8785 §3.2.2.3 ECMAScript number serialization follows JCS exponential rules',()=>{
 assert.equal(canonicalize({a:100.0,b:0.00000123,c:1e20,d:1e21,e:-0}), '{"a":100,"b":0.00000123,"c":100000000000000000000,"d":1e+21,"e":0}');
 assert.throws(()=>canonicalize({x:Infinity}),/non-finite/);
 assert.throws(()=>canonicalize({x:NaN}),/non-finite/);
});
test('RFC 8785 §3.1 I-JSON and §3.2.2.2 reject malformed Unicode and non-JSON values',()=>{
 assert.throws(()=>canonicalize({x:'\uD800'}),/surrogate/);
 assert.throws(()=>canonicalize({'\uDC00':1}),/surrogate/);
 assert.throws(()=>canonicalize({x:undefined}),/invalid/);
 assert.throws(()=>canonicalize({x:1n}),/invalid/);
 assert.throws(()=>canonicalize([,1]),/sparse or extended array/);
});
test('tampering changes canonical bytes',()=>{
 assert.notEqual(canonicalize({binding_id:'test-uuid',sequence:10}),canonicalize({binding_id:'test-uuid',sequence:11}));
});
test('RFC 8785 array order is kept and sparse, hole, and extra non-index arrays are rejected',()=>{
 assert.equal(canonicalize([10,5,20,15]),'[10,5,20,15]');
 assert.equal(canonicalize([0,1]),'[0,1]');
 const sparse=[1,2];
 sparse.length=4;
 assert.throws(()=>canonicalize(sparse),/sparse or extended array/);
 assert.throws(()=>canonicalize([,1]),/sparse or extended array/);
 assert.throws(()=>canonicalize([1,,3]),/sparse or extended array/);
 const extra=[10,5,20,15];
 extra.note='not-an-index';
 assert.throws(()=>canonicalize(extra),/sparse or extended array/);
 const padded=[1,2];
 padded['01']=9;
 assert.throws(()=>canonicalize(padded),/sparse or extended array/);
});
test('tokenize rejects duplicate names and does not apply sequence or ttl bounds',()=>{
 assert.throws(()=>tokenize('{"a":1,"a":2}'),/duplicate property name/);
 assert.throws(()=>tokenize('{"a":1,"\\u0061":2}'),/duplicate property name/);
 assert.throws(()=>tokenize('{"outer":{"b":1,"b":2}}'),/duplicate property name/);
 assert.throws(()=>tokenize('01'),/invalid JSON text/);
 assert.throws(()=>tokenize('{"a":1,}'),/invalid JSON text/);
 const parsed=tokenize('{"ttl_seconds":0,"sequence":1e+21}');
 assert.equal(parsed.sequence,1e21);
 assert.equal(parsed.ttl_seconds,0);
 assert.equal(canonicalize(parsed),'{"sequence":1e+21,"ttl_seconds":0}');
 assert.equal(canonicalize(tokenize('{"ttl_seconds":86401,"sequence":9007199254740992}')),'{"sequence":9007199254740992,"ttl_seconds":86401}');
});
test('RFC 8785 §3.2.1 §3.2.2 §3.2.2.3 §3.2.3 official input/output bytes',()=>{
 const names=readdirSync(join(vectorDir,'input')).filter(name=>name.endsWith('.json')).sort();
 assert.deepEqual(names,['arrays.json','french.json','structures.json','unicode.json','values.json','weird.json']);
 for (const name of names) {
  const text=readFileSync(join(vectorDir,'input',name),'utf8');
  const value=tokenize(text);
  assert.deepEqual(value, JSON.parse(text), name);
  const expected=readFileSync(join(vectorDir,'output',name));
  assert.deepEqual(Buffer.from(canonicalize(value),'utf8'), expected, name);
 }
});
test('RFC 8785 §3.2.2.3 bounded deterministic ES6 number sample',()=>{
 const lines=readFileSync(join(vectorDir,'es6-numbers-static.txt'),'utf8').split('\n').filter(Boolean);
 assert.equal(lines.length,168);
 const u64=new BigUint64Array(1);
 const f64=new Float64Array(u64.buffer);
 for (const line of lines) {
  const comma=line.indexOf(',');
  u64[0]=BigInt('0x'+line.slice(0,comma));
  assert.equal(canonicalize(f64[0]), line.slice(comma+1), line.slice(0,comma));
 }
 // Published sample lines from upstream testdata/README.md. The first two are
 // outside the static edge-case prefix; the rest are inside the vendored file.
 for (const line of ['4340000000000001,9007199254740994','4340000000000002,9007199254740996','444b1ae4d6e2ef50,1e+21','3eb0c6f7a0b5ed8d,0.000001','3eb0c6f7a0b5ed8c,9.999999999999997e-7','8000000000000000,0','0,0']) {
  const comma=line.indexOf(',');
  u64[0]=BigInt('0x'+line.slice(0,comma));
  assert.equal(canonicalize(f64[0]), line.slice(comma+1), line.slice(0,comma));
 }
});
