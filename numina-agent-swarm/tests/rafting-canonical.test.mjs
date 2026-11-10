import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, signingBytes } from '../src/rafting-resilience.mjs';

test('recursive UTF-16 member ordering independent of insertion order',()=>{
 const a={ttl_seconds:300,node_b:{state_commitment:'x',node_id:'B',public_key:'k'},node_a:{public_key:'k',node_id:'A',state_commitment:'x'},sequence:42};
 const b={sequence:42,node_a:{state_commitment:'x',node_id:'A',public_key:'k'},node_b:{public_key:'k',node_id:'B',state_commitment:'x'},ttl_seconds:300};
 assert.equal(canonicalize(a),canonicalize(b));
 assert.equal(canonicalize({'\uE000':1,'\uD800\uDC00':2}),'{"𐀀":2,"":1}');
});
test('whitespace stripped and array order retained',()=>{
 assert.equal(canonicalize(JSON.parse(' { "sequence": 1, "binding_id": "test" } ')),'{"binding_id":"test","sequence":1}');
 assert.equal(canonicalize({metrics:[10,5,20,15]}),'{"metrics":[10,5,20,15]}');
});
test('ECMAScript number serialization follows JCS exponential rules',()=>{
 assert.equal(canonicalize({a:100.0,b:0.00000123,c:1e20,d:1e21,e:-0}), '{"a":100,"b":0.00000123,"c":100000000000000000000,"d":1e+21,"e":0}');
 assert.throws(()=>canonicalize({x:Infinity}),/non-finite/);
 assert.throws(()=>canonicalize({x:NaN}),/non-finite/);
});
test('reject malformed Unicode and unsupported values',()=>{
 assert.throws(()=>canonicalize({x:'\uD800'}),/surrogate/);
 assert.throws(()=>canonicalize({'\uDC00':1}),/surrogate/);
 assert.throws(()=>canonicalize({x:undefined}),/invalid/);
 assert.throws(()=>canonicalize({x:1n}),/invalid/);
 assert.throws(()=>canonicalize([,1]),/sparse/);
});
test('tampering changes canonical bytes and signing bytes exclude signatures',()=>{
 assert.notEqual(canonicalize({binding_id:'test-uuid',sequence:10}),canonicalize({binding_id:'test-uuid',sequence:11}));
 const a={sequence:10,signatures:{node_a_sig:'a',node_b_sig:'b'}};
 const b={signatures:{node_b_sig:'changed',node_a_sig:'changed'},sequence:10};
 assert.deepEqual(signingBytes(a),signingBytes(b));
});
