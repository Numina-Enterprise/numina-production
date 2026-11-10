import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {signingBytes,verifyBinding,RaftingLink} from '../src/rafting-resilience.mjs';

const keys=()=>{const k=generateKeyPairSync('ed25519');return {...k,hex:k.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex')}};
test('bilateral verification, replay rejection, tamper rejection, and slackening without Raft mutation',()=>{
 const a=keys(),b=keys(),hash='sha256:'+'a'.repeat(64);
 const m={schema_id:'numina.rafting-binding.v1',binding_id:'123e4567-e89b-42d3-a456-426614174000',node_a:{node_id:'A',public_key:a.hex,state_commitment:hash},node_b:{node_id:'B',public_key:b.hex,state_commitment:hash},sequence:1,timestamp:'2026-11-09T00:00:00Z',ttl_seconds:2,canonical_spec:'RFC-8785',signatures:{node_a_sig:'',node_b_sig:''}};
 const bytes=signingBytes(m);m.signatures.node_a_sig=sign(null,bytes,a.privateKey).toString('hex');m.signatures.node_b_sig=sign(null,bytes,b.privateKey).toString('hex');
 const trustedKeys={A:a.hex,B:b.hex};
 assert.equal(verifyBinding(m,{trustedKeys}).sequence,1);
 assert.throws(()=>verifyBinding(m,{trustedKeys,previousSequence:1}),/replay/);
 assert.throws(()=>verifyBinding({...m,ttl_seconds:3},{trustedKeys}),/signature/);
 let t=0;const link=new RaftingLink({verifyManifest:(x,o)=>verifyBinding(x,{...o,trustedKeys}),now:()=>t});
 link.receive(m);assert.equal(link.tick(),'BOUND');t=2001;assert.equal(link.tick(),'SLACKENED');
 assert.equal(link.sequence,1);
});
