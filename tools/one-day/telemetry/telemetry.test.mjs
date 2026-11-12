import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {canonical,parseSpacePacket,SpacePacketStream,normalizeStac,SequenceGuard,toCoreRecord} from './adapters.mjs';
import {SimulationPolicy,receiptSigner,ReceiptVerifier} from './provenance.mjs';
import {packet,stacItem} from './fixtures.mjs';

test('fixed independent CCSDS header vector decodes exact six-octet header',()=>{
 const record=parseSpacePacket(Buffer.from('002ac0030002010203','hex'));
 assert.equal(record.payload.apid,42);assert.equal(record.payload.sequence,3);assert.equal(record.payload.dataBytes,3);
 assert.equal(typeof toCoreRecord(record).payload,'string');
});
test('CCSDS rejects incomplete, incorrect-length and unsupported profiles',()=>{
 assert.throws(()=>parseSpacePacket(Buffer.alloc(6)),/TRUNCATED/);
 assert.throws(()=>parseSpacePacket(Buffer.concat([packet(),Buffer.from([0])])),/LENGTH_MISMATCH/);
 for(const [change,error]of [[{version:1},'PACKET_VERSION'],[{type:1},'TELECOMMAND'],[{secondary:1},'SECONDARY'],[{flags:1},'SEGMENTATION'],[{apid:2047},'IDLE']]){
  assert.throws(()=>parseSpacePacket(packet(change)),new RegExp(error));
 }
 assert.throws(()=>parseSpacePacket(packet({data:Buffer.alloc(4097)})),/OVERSIZE/);
});
test('standalone CCSDS parser rejects invalid payload limit configuration',()=>{
 for(const maxDataBytes of [0,-1,NaN,Infinity,1.2,65537,'4'])assert.throws(()=>parseSpacePacket(packet(),{maxDataBytes}),/INVALID_LIMIT/);
 assert.equal(parseSpacePacket(packet({data:Buffer.from([1])}),{maxDataBytes:1}).payload.dataBytes,1);
});
test('stream accepts arbitrary chunk boundaries and multiple packets',()=>{
 const input=Buffer.concat([packet({sequence:1}),packet({sequence:2})]),stream=new SpacePacketStream();let records=[];
 for(const byte of input)records.push(...stream.push(Buffer.from([byte])));
 stream.finish();assert.deepEqual(records.map(r=>r.payload.sequence),[1,2]);
});
test('stream fails closed on oversized declared frame/chunk and truncated final input',()=>{
 const declared=packet();declared.writeUInt16BE(65535,4);const s=new SpacePacketStream();
 assert.throws(()=>s.push(declared),/OVERSIZE/);assert.throws(()=>s.push(packet()),/STREAM_FAILED/);
 const partial=new SpacePacketStream();partial.push(packet().subarray(0,8));assert.throws(()=>partial.finish(),/TRUNCATED/);
 assert.throws(()=>new SpacePacketStream().push(Buffer.alloc(65537)),/CHUNK_OVERSIZE/);
});
test('sequence policy detects replay, gaps, old data and modulo wrap per APID',()=>{
 const guard=new SequenceGuard(),inspect=sequence=>guard.inspect(parseSpacePacket(packet({sequence})));
 assert.equal(inspect(16383).decision,'ALLOW');assert.equal(inspect(0).decision,'ALLOW');
 assert.equal(inspect(0).decision,'DENY');assert.equal(inspect(2).decision,'ESCALATE');assert.equal(inspect(1).decision,'DENY');
 assert.equal(guard.inspect(parseSpacePacket(packet({apid:43,sequence:1}))).decision,'ALLOW');assert.equal(inspect(3).decision,'ALLOW');
});
test('STAC profile preserves source digest and core-compatible serialized payload',()=>{
 const item=stacItem(),record=normalizeStac(item);assert.equal(record.payload.source,'stac');assert.equal(record.payload.assetCount,1);
 assert.deepEqual(JSON.parse(toCoreRecord(record).payload),record.payload);
 const reordered=Object.fromEntries(Object.entries(item).reverse());assert.deepEqual(normalizeStac(reordered),record);
});
test('STAC rejects invalid dates, geometry bounds, unsafe URLs, extensions and oversized records',()=>{
 for(const mutate of [i=>i.properties.datetime='2026-02-30T00:00:00Z',i=>i.geometry.coordinates=[181,0],i=>i.bbox=[0,0,1,1],i=>i.assets.image.href='file:///etc/passwd',i=>i.assets.image.href='https://user:password@example.invalid/a',i=>i.stac_extensions=['https://example.invalid/schema'],i=>i.geometry={type:'Polygon',coordinates:[]},i=>i.properties.datetime=undefined]){
  const item=stacItem();mutate(item);assert.throws(()=>normalizeStac(item));
 }
 const item=stacItem();item.properties.note='x'.repeat(65536);assert.throws(()=>normalizeStac(item),/OVERSIZE/);
});
test('STAC null geometry/time interval and collection rules are explicit',()=>{
 const item=stacItem();item.geometry=null;delete item.bbox;item.properties={datetime:null,start_datetime:'2026-11-01T00:00:00Z',end_datetime:'2026-11-02T00:00:00Z'};
 assert.equal(normalizeStac(item).payload.geometry,null);
 item.bbox=[0,0,1,1];assert.throws(()=>normalizeStac(item),/NULL_GEOMETRY/);delete item.bbox;
 item.properties.end_datetime='2026-10-31T00:00:00Z';assert.throws(()=>normalizeStac(item),/TIME_RANGE/);
 const collection=stacItem();collection.collection='test';assert.throws(()=>normalizeStac(collection),/COLLECTION/);
 collection.links=[{rel:'collection',href:'https://example.invalid/collection.json'}];assert.equal(normalizeStac(collection).payload.collection,'test');
});
test('policy denies unauthorized/action/replay and escalates tasking without dispatch',()=>{
 const p=new SimulationPolicy(),record=parseSpacePacket(packet());
 assert.equal(p.decide(record,{principal:'outsider',action:'observe'}).decision,'DENY');
 assert.equal(p.decide(record,{principal:'simulation-operator',action:'execute'}).decision,'DENY');
 assert.equal(p.decide(record,{principal:'simulation-operator',action:'tasking_proposal'}).decision,'ESCALATE');
 assert.equal(p.decide(record,{principal:'simulation-operator',action:'observe'}).decision,'ALLOW');
 assert.equal(p.decide(record,{principal:'simulation-operator',action:'observe'}).decision,'DENY');
});
test('receipt signatures bind run, key, normalized record, decision and chain order',()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'),signer=receiptSigner({privateKey,runId:'generated-test-run'});
 const record=parseSpacePacket(packet()),a=signer(record,{decision:'ALLOW',reason:'test_only'}),b=signer(record,{decision:'ESCALATE',reason:'test_only'});
 const v=new ReceiptVerifier({publicKey,runId:'generated-test-run'});assert.equal(v.accept(b),false);assert.equal(v.accept(a),true);assert.equal(v.accept(a),false);assert.equal(v.accept(b),true);
 const altered=structuredClone(a);altered.body.decision.decision='DENY';assert.equal(new ReceiptVerifier({publicKey,runId:'generated-test-run'}).accept(altered),false);
 assert.equal(new ReceiptVerifier({publicKey,runId:'wrong-run'}).accept(a),false);
 assert.equal(new ReceiptVerifier({publicKey:generateKeyPairSync('ed25519').publicKey,runId:'generated-test-run'}).accept(a),false);
 assert.equal(a.body.classification,'LOCAL_SIMULATION');assert.equal(a.body.operationalAuthority,false);
});
test('canonicalizer rejects invalid numbers, types, Unicode and excessive nesting',()=>{
 for(const value of [NaN,Infinity,undefined,new Date(),'\ud800'])assert.throws(()=>canonical(value));
 let nested=0;for(let i=0;i<33;i++)nested=[nested];assert.throws(()=>canonical(nested),/DEPTH/);
 assert.equal(canonical({b:1,a:'a'}),'{"a":"a","b":1}');
});
test('canonicalizer rejects array holes and enumerable, hidden or symbol extensions',()=>{
 const sparse=new Array(2);sparse[1]=1;
 const extended=[1];extended.extra=2;
 const hidden=[1];Object.defineProperty(hidden,'extra',{value:2});
 const symbolic=[1];symbolic[Symbol('extra')]=2;
 const balanced=new Array(1);balanced.extra=2;
 for(const value of [sparse,extended,hidden,symbolic,balanced])assert.throws(()=>canonical(value),/INVALID_JSON_ARRAY/);
 assert.equal(canonical([1,null,'x']),'[1,null,"x"]');
});
