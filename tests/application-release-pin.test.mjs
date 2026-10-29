import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import handler from '../api/application-release.mjs';
import {syncApplicationReleasePin} from '../scripts/sync-application-release-pin.mjs';

test('root application release reports the exact current distribution inventory',async()=>{
  const release=JSON.parse(readFileSync(new URL('../dist/client/downloads/application-release-v4.json',import.meta.url)));
  const verified=syncApplicationReleasePin();
  const response={setHeader(){},end(body){this.body=JSON.parse(body);}};
  await handler({method:'GET',url:'/v4/release/manifest'},response);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.build_id,verified.buildId);
  assert.equal(response.body.build_id,release.build_id);
  assert.equal(response.body.version,release.version);
  assert.equal(verified.updated,false);
});
