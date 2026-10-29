import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {controlHash, stable} from '../src/control.js';
import {verifyTreasuryRecord as browserVerify} from '../public/treasury-proof.js';
import {verifyTreasuryRecord as integrationVerify} from '../integrations/numina/src/treasury-proof.js';
import {NuminaClient} from '../integrations/numina/src/client.js';
import {EXPECTED_RELEASE} from '../public/runtime-contract.js';

const principal = 'email:legacy-proof-owner@example.test';
const metadata = Object.freeze({identity:'NUMINA', structure:'NUMINA', hashIdentity:'NUMINA',
  artifactPathIdentity:'NUMINA', runtimeIdIdentity:'NUMINA', securityMechanicsIdentity:'NUMINA', singular:true});
const verifiers = [browserVerify, integrationVerify];

async function seal(record) {
  const event = record.canonical_proof.event;
  event.commandHash = await controlHash(event.command);
  record.canonical_proof.hash = await controlHash(event);
  record.head = record.canonical_proof.hash;
  return record;
}

async function fixture({current = false, prepared = false} = {}) {
  const id = prepared ? 'legacy-bank-request' : 'legacy-native-init', revision = prepared ? 2 : 1;
  const requests = prepared ? [{id, kind:'bank_transaction_request', status:'PREPARED',
    destination_reference:'owner-bank', amount_minor:'12345', currency:'USD', submission_performed:false, receipt:null}] : [];
  const projection = {schema:'numina.treasury.projection.v1', unit:'NUSD', authority:'NUMINA',
    verification:'VERIFIED', system_of_record:'NUMINA', scope:'Numina-native',
    balance:'500000000000000', last_event_id:id, transaction_requests:requests, ...(current ? metadata : {})};
  const previous = 'a'.repeat(64);
  const command = {id, expectedRevision:revision-1, type:'treasury', data:{Principal:principal,
    Authority:'NUMINA', Objective:prepared ? 'treasury.bank.prepare' : 'treasury.initialize',
    Intent:prepared ? {operation:'PREPARE_BANK_TRANSACTION', amountMinor:'12345', currency:'USD',
      destinationReference:'owner-bank', reason:'Offline legacy bank request'}
      : {operation:'INITIALIZE', reason:'Offline legacy initialization'}, expectedHead:previous}};
  const event = {type:'treasury', id, actor:principal, revision, previous, manifestHash:'b'.repeat(64),
    command, result:{outcome:'FINAL', route:'numina.treasury.v1', execution_scope:'Numina-native journal',
      projection:structuredClone(projection), transaction_request:prepared ? structuredClone(requests[0]) : null,
      mint_event:null, bank_transaction:null}};
  return seal({schema:'numina.treasury.v1', route:'numina.treasury.v1', root:'NUMINA', manifest:'NUMINA',
    identity:'NUMINA', authority:'NUMINA', source:'NUMINA', evidence:'NUMINA', provider:'NUMINA',
    provider_verification:true, principal, revision, status:'READY', projection,
    verification_scope:'Numina-native model and journal integrity',
    canonical_proof:{algorithm:'SHA-256', canonicalization:'Numina canonical JSON', scope:'Numina-native journal record', event}});
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value);}
  return value;
}

async function verifyBoth(record, expected, label) {
  for (const verify of verifiers) assert.equal(await verify(record), expected, label);
}

test('both treasury clients accept exact frozen legacy proofs without enriching or changing their bytes', async () => {
  for (const prepared of [false, true]) {
    const record = deepFreeze(await fixture({prepared})), bytes = stable(record), proof = stable(record.canonical_proof);
    assert.equal(Object.keys(record.projection).length, 9);
    await verifyBoth(record, true, 'exact legacy projection');
    assert.equal(stable(record), bytes);
    assert.equal(stable(record.canonical_proof), proof);
    assert.equal(Object.hasOwn(record.projection, 'identity'), false);
    assert.equal(Object.hasOwn(record.canonical_proof.event.result.projection, 'identity'), false);
  }
});

test('both treasury clients retain exact current metadata and proof validation', async () => {
  const record = deepFreeze(await fixture({current:true, prepared:true})), before = stable(record);
  assert.equal(Object.keys(record.projection).length, 16);
  await verifyBoth(record, true, 'exact current projection');
  assert.equal(stable(record), before);
});

test('partial, wrong or unknown projection metadata fails even with consistent proof hashes', async () => {
  const cases = [];
  for (const [key, expected] of Object.entries(metadata)) {
    cases.push([false, projection => {projection[key] = expected;}, 'partial legacy '+key]);
    cases.push([true, projection => {delete projection[key];}, 'partial current '+key]);
    cases.push([true, projection => {projection[key] = expected === true ? false : 'OTHER';}, 'wrong metadata '+key]);
  }
  for (const current of [false, true]) {
    cases.push([current, projection => {projection.unreviewedMetadata = 'NUMINA';}, 'unknown metadata']);
    for (const key of ['schema','unit','authority','verification','system_of_record','scope','balance','last_event_id','transaction_requests']) {
      cases.push([current, projection => {delete projection[key];}, 'missing base field '+key]);
    }
  }
  for (const [current, mutate, label] of cases) {
    const record = await fixture({current});
    mutate(record.projection);
    record.canonical_proof.event.result.projection = structuredClone(record.projection);
    await seal(record);
    await verifyBoth(record, false, label);
  }
});

test('direct JavaScript verifier inputs cannot hide unknown fields outside canonical JSON keys', async () => {
  for (const current of [false, true]) for (const hidden of ['metadata','unknown','symbol']) {
    const record = await fixture({current});
    if (hidden === 'symbol') record.projection[Symbol('unreviewedMetadata')] = 'OTHER';
    else Object.defineProperty(record.projection, hidden === 'metadata' && !current ? 'identity' : 'unreviewedMetadata', {value:'OTHER'});
    await verifyBoth(record, false, 'hidden '+hidden+' current='+current);
  }
});

test('legacy compatibility preserves financial types, base constants and request capacity checks', async () => {
  const invalid = [
    projection => {projection.unit = 'USD';},
    projection => {projection.authority = 'OTHER';},
    projection => {projection.verification = 'UNVERIFIED';},
    projection => {projection.system_of_record = 'OTHER';},
    projection => {projection.scope = 'provider';},
    ...['01','-1','1.0','1e3','9'.repeat(79), 500000000000000].map(balance => projection => {projection.balance = balance;}),
    projection => {projection.last_event_id = '';},
    projection => {projection.transaction_requests = {};},
    projection => {projection.transaction_requests = Array.from({length:101}, () => ({}));}
  ];
  for (const current of [false, true]) for (const mutate of invalid) {
    const record = await fixture({current});
    mutate(record.projection);
    record.canonical_proof.event.result.projection = structuredClone(record.projection);
    await seal(record);
    await verifyBoth(record, false, 'invalid financial projection');
  }
});

test('legacy compatibility cannot bypass proof, request, actor, command or revision bindings', async () => {
  const mutations = [
    record => {record.projection.balance = '1';},
    record => {record.projection.transaction_requests[0].amount_minor = '1';},
    record => {record.projection.transaction_requests[0].receipt = {provider_reference:'fabricated'};},
    record => {record.canonical_proof.hash = 'c'.repeat(64);},
    record => {record.canonical_proof.algorithm = 'unverified';},
    record => {record.canonical_proof.canonicalization = 'other';},
    record => {record.canonical_proof.scope = 'external-provider';},
    record => {record.canonical_proof.event.commandHash = 'c'.repeat(64);},
    record => {record.canonical_proof.event.result.projection.balance = '1';},
    record => {record.canonical_proof.event.command.data.Intent.amountMinor = '1';},
    record => {record.canonical_proof.event.actor = 'email:other@example.test';},
    record => {record.canonical_proof.event.command.data.Principal = 'email:other@example.test';},
    record => {record.canonical_proof.event.command.data.Authority = 'OTHER';},
    record => {record.canonical_proof.event.command.expectedRevision = 99;},
    record => {record.canonical_proof.event.command.data.expectedHead = 'c'.repeat(64);},
    record => {record.canonical_proof.event.result.mint_event = {id:'unobserved-mint'};},
    record => {record.head = 'c'.repeat(64);},
    record => {record.revision = 0;}
  ];
  for (const current of [false, true]) for (const mutate of mutations) {
    const record = await fixture({current, prepared:true});
    mutate(record);
    await verifyBoth(record, false, 'tampered bound record');
  }
});

test('integration reads legacy proofs only through the existing authenticated read route', async () => {
  const record = await fixture({prepared:true}), token = 'offline-legacy-owner-token', requests = [];
  const client = new NuminaClient({baseUrl:'https://numina.test', token, fetch:async (url, options) => {
    requests.push(url);
    assert.equal(options.method, 'GET');
    if (url.endsWith('/v4/release/manifest')) {
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({schema:'numina.application-release.v2', schema_version:2, product:'Numina', version:'4.0.0',
        release:'numina-v4.0.0', artifact_digest_algorithm:'sha256', build_id:record.head,
        artifacts:[{path:'offline-fixture', sha256:record.head}], runtime_dependency:{version:EXPECTED_RELEASE.production_version, release:EXPECTED_RELEASE.release}});
    }
    assert.equal(url, 'https://numina.test/api/control/v1/treasury');
    assert.equal(options.headers.Authorization, 'Bearer '+token);
    return Response.json(record);
  }});
  const result = await client.readTreasury();
  assert.deepEqual(result.data, record);
  assert.equal(result.verification, 'server_reported_not_independently_verified');
  assert.equal(result.asset_execution_available, false);
  assert.equal(requests.length, 2);
  await assert.rejects(client.readTreasury({legacy:true}), {code:'INVALID_ARGUMENTS'});
  assert.equal(requests.length, 2);
  await assert.rejects(new NuminaClient({baseUrl:'https://numina.test', fetch:() => assert.fail('No unauthenticated request')}).readTreasury(), {code:'SERVER_AUTH_REQUIRED'});
});

test('browser and integration treasury verifier copies retain identical source bytes', () => {
  assert.deepEqual(readFileSync(new URL('../public/treasury-proof.js', import.meta.url)),
    readFileSync(new URL('../integrations/numina/src/treasury-proof.js', import.meta.url)));
});
