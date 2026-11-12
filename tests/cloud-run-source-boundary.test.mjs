import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{CONTROL_BACKEND_HOST,PRIVATE_NOTICE_JSON} from '../src/worker.js';
import {controlHash} from '../src/control.js';
import {CLOUD_RUN_REPOSITORY,forwardedHeaders} from '../scripts/cloudrun-server.mjs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const forged = {
  'oai-authenticated-user-id': 'forged-owner',
  'oai-authenticated-user-email': 'owner@example.test',
  accept: 'application/json',
};

function rateDb() {
  const statement = {
    bind() { return statement; },
    async first() { return {count: 1}; },
    async all() { return {results: [{count: 1}]}; },
    async run() { return {results: [{count: 1}]}; },
  };
  return {
    prepare() { return statement; },
    async batch() { return [{results: [{count: 1}]}, {results: [{count: 1}]}]; },
  };
}

test('Cloud Run adapter drops client identity headers and does not publish a filesystem path', () => {
  const headers = forwardedHeaders({
    headers: {
      ...forged,
      host: 'numina-production-wfz53i3z3a-uc.a.run.app',
      accept: 'application/json',
      connection: 'keep-alive',
    },
  });
  assert.equal(headers.get('oai-authenticated-user-id'), null);
  assert.equal(headers.get('oai-authenticated-user-email'), null);
  assert.equal(headers.get('host'), null);
  assert.equal(headers.get('connection'), null);
  assert.equal(headers.get('accept'), 'application/json');
  assert.equal(CLOUD_RUN_REPOSITORY, 'Numina-Enterprise/numina-production');
  assert.equal(read('scripts/cloudrun-server.mjs').includes('canonicalRepository: CLOUD_RUN_REPOSITORY'), true);
  assert.equal(read('scripts/cloudrun-server.mjs').includes('canonicalRepository: ROOT'), false);
});

test('Cloud Run source upload keeps dist and excludes credential files', () => {
  const ignore = read('.gcloudignore');
  assert.equal(/^\s*dist\/\s*$/m.test(ignore), false);
  for (const pattern of ['**/.cloudflared_isolated/', '**/.env', '*.key', '**/.pytest_cache/']) {
    assert.equal(ignore.includes(pattern), true, pattern);
  }
});

test('edge hosts reject forged client identity headers on the treasury route', async () => {
  const env = {
    DB: rateDb(),
    NUMINA_CONTROL_OWNER: 'email:owner@example.test',
    NUMINA_CONTROL_API_KEY_SHA256: await controlHash('test-api-key'),
    NUMINA_TELEMETRY_LOGS: 'false',
    ASSETS: {async fetch() { throw new Error('assets unused'); }},
  };
  const forgedTreasury = await worker.fetch(new Request('https://' + CONTROL_BACKEND_HOST + '/api/control/v1/treasury', {headers: forged}), env);
  assert.equal(forgedTreasury.status, 401);
  assert.equal((await forgedTreasury.json()).error, 'UNAUTHENTICATED');

  const cloudRun = await worker.fetch(new Request('https://numina-production-wfz53i3z3a-uc.a.run.app/api/control/v1/treasury', {headers: forged}), env);
  assert.equal(cloudRun.status, 403);
  assert.deepEqual(await cloudRun.json(), PRIVATE_NOTICE_JSON);

  const bearer = await worker.fetch(new Request('https://' + CONTROL_BACKEND_HOST + '/api/control/v1/treasury', {
    headers: {authorization: 'Bearer test-api-key', accept: 'application/json'},
  }), env);
  assert.notEqual(bearer.status, 401);
  const bearerBody = await bearer.json();
  assert.notEqual(bearerBody.error, 'UNAUTHENTICATED');
});
