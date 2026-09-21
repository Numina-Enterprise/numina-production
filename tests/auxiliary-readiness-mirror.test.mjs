import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign as signMessage} from 'node:crypto';
import {shouldMirrorAuthoritativeReadiness,validateAuthoritativeReadinessResponse} from '../api/application-release.mjs';

test('explicit Numina mirrors require the authoritative runtime only when they lack the signing key',()=>{
  assert.equal(shouldMirrorAuthoritativeReadiness({NUMINA_MIRROR_AUTHORITATIVE_READINESS:'true'}),true);
  assert.equal(shouldMirrorAuthoritativeReadiness({NUMINA_MIRROR_AUTHORITATIVE_READINESS:'true',NUMINA_RUNTIME_SIGNING_KEY_DER_B64:'present'}),false);
  assert.equal(shouldMirrorAuthoritativeReadiness({NUMINA_MIRROR_AUTHORITATIVE_READINESS:'false'}),false);
  assert.equal(shouldMirrorAuthoritativeReadiness({}),false);
});

test('authoritative readiness validator rejects unsigned or unhealthy mirrors',()=>{
  assert.throws(()=>validateAuthoritativeReadinessResponse({readiness:{schema:'numina.frontier-readiness.v3',ready:true,deployed:true}}));
  assert.throws(()=>validateAuthoritativeReadinessResponse({readiness:{schema:'numina.frontier-readiness.v3',ready:false,deployed:true},receipt:{}}));
});
