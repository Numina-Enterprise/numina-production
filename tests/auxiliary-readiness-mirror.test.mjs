import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign as signMessage} from 'node:crypto';
import {shouldMirrorAuthoritativeReadiness,validateAuthoritativeReadinessResponse} from '../api/application-release.mjs';

test('auxiliary projects mirror authoritative readiness only when they lack the runtime signing key',()=>{
  assert.equal(shouldMirrorAuthoritativeReadiness({VERCEL_PROJECT_ID:'prj_aux'}),true);
  assert.equal(shouldMirrorAuthoritativeReadiness({VERCEL_PROJECT_ID:'prj_aux',NUMINA_RUNTIME_SIGNING_KEY_DER_B64:'present'}),false);
  assert.equal(shouldMirrorAuthoritativeReadiness({VERCEL_PROJECT_ID:'prj_WY1kKgo522ufsymotnArIUee01uO'}),false);
  assert.equal(shouldMirrorAuthoritativeReadiness({}),false);
});

test('authoritative readiness validator rejects unsigned or unhealthy mirrors',()=>{
  assert.throws(()=>validateAuthoritativeReadinessResponse({readiness:{schema:'numina.frontier-readiness.v3',ready:true,deployed:true}}));
  assert.throws(()=>validateAuthoritativeReadinessResponse({readiness:{schema:'numina.frontier-readiness.v3',ready:false,deployed:true},receipt:{}}));
});
