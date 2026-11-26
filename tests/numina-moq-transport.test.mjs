// numina-moq-transport.test.mjs — Media over QUIC Transport (MOQT)
// session, relay and multicast join, at the NETWORK level.
//
// Sources: draft-ietf-moq-transport-23 (Nandakumar et al., 2 Nov 2026)
// §8.1 varints, §8.2 Locations, §8.3 KVPs, §8.5 reason phrases, §8.6
// range filters, §8.7 namespaces, §8.8 rendering, §8.9 auth tokens,
// §9 control messages and parameters, §11 data plane, §12 errors;
// draft-ramadan-moq-multicast-02 §4.1 multicast endpoints and join
// rules; draft-ramadan-moq-mmt-02 §3.1 MMTP header and §4 MoQ mapping.
//
// What these tests prove:
//   - The wire codecs round-trip and match the draft's own examples
//     (varint Table 4, range-filter §8.6 example, namespace rendering
//     §8.8 example) and refuse malformed input with the draft's codes.
//   - The session handshake, request-ID parity, alias and token
//     registries, REQUEST_UPDATE limits, EXPIRES and GOAWAY rules.
//   - The data plane (datagrams, subgroups, fetch, padding) and the
//     sequencer's malformed-track rules (§12.1).
//   - The relay: fan-out, cache, pause (§7.2), rendezvous, fetch gaps.
//   - MMTP packet build/parse and the MoQ mapping.
//   - Multicast: endpoint validation (§4.1 ignore rules), real join /
//     leave over UDP sockets, per-packet_id sequence tracking,
//     hysteresis, unlisted packet_id discard.
//   - bc-provenance admission on the multicast leg: verify-first,
//     per-datagram digest comparison, whole-batch admission, refusal.
//   - Transports: QUIC is honestly reported unavailable in this Node
//     build; TCP loopback carries a real publisher → relay →
//     subscriber session end to end; UDP loopback is probed and its
//     result is reported, not assumed.
//
// NO KAT/ACVP PASS IS CLAIMED HERE: the drafts publish no KAT/ACVP
// vectors for the transport. No interop with an external MoQ
// implementation is claimed: the codecs are tested against the
// draft's own examples and against round-trips through this
// implementation. Keys are freshly generated per run (node:crypto
// Ed25519) for the bc-admission tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as moq from '../src/numina-moq-transport.js';
import {
  mintBcRecord,
  validateBcCatalog,
  createBcReceiverState,
  createVerificationBudget,
  BC_PROFILE,
  BC_VERSION,
} from '../src/numina-bc-provenance.js';
import { batchDigest } from '../src/numina-batch-signature.js';

const NS = ['numina', 'test'];
const TRACK = 'video';

function moqError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

async function moqErrorAsync(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}

function expectCode(error, code) {
  assert.ok(error, `expected a MoqError with code ${code}, got no error`);
  assert.equal(error.code, code, `expected code ${code}, got ${error.code} (${error.message})`);
}

function handshake(client, server) {
  const clientSetup = client.createSetup({});
  server.receiveSetup(clientSetup);
  const serverSetup = server.createSetup({});
  client.receiveSetup(serverSetup);
  assert.equal(client.isEstablished(), true);
  assert.equal(server.isEstablished(), true);
}

function pairedSessions(clientOpts = {}, serverOpts = {}) {
  const client = moq.createMoqSession({ role: 'client', ...clientOpts });
  const server = moq.createMoqSession({ role: 'server', ...serverOpts });
  handshake(client, server);
  return { client, server };
}

// ---------------------------------------------------------------------------
// Varints (§8.1, Table 4)
// ---------------------------------------------------------------------------

test('varint: Table 4 vectors decode exactly', () => {
  const vectors = [
    ['25', 37n],
    ['8025', 37n], // non-minimal 2-byte form of 37
    ['bbbd', 15293n],
    ['ed7f3e7d', 226442877n],
    ['faa1a0e403d8', 2893212287960n],
    ['fc8998abc66bc0', 151288809941952n],
    ['fefa318fa8e3ca11', 70423237261249041n],
    ['ffffffffffffffffff', 18446744073709551615n], // 2^64-1, nine 0xff bytes
  ];
  for (const [hex, value] of vectors) {
    const decoded = moq.decodeVarint(Buffer.from(hex, 'hex'));
    assert.equal(decoded.value, value, `0x${hex} should decode to ${value}`);
    assert.equal(decoded.length, Buffer.from(hex, 'hex').length);
  }
});

test('varint: Table 4 vectors encode to the draft bytes', () => {
  const vectors = [
    [37n, '25'],
    [15293n, 'bbbd'],
    [226442877n, 'ed7f3e7d'],
    [2893212287960n, 'faa1a0e403d8'],
    [151288809941952n, 'fc8998abc66bc0'],
    [70423237261249041n, 'fefa318fa8e3ca11'],
    [18446744073709551615n, 'ffffffffffffffffff'],
  ];
  for (const [value, hex] of vectors) {
    assert.equal(Buffer.from(moq.encodeVarint(value)).toString('hex'), hex);
  }
});

test('varint: non-minimal encodings are accepted', () => {
  // 0x8025 is the 2-byte form of 37; the draft accepts non-minimal
  // encodings on decode.
  assert.equal(moq.decodeVarint(Buffer.from('8025', 'hex')).value, 37n);
  assert.equal(moq.decodeVarint(Buffer.from('e0000025', 'hex')).value, 37n);
});

test('varint: truncation is refused', () => {
  expectCode(moqError(() => moq.decodeVarint(Buffer.from('bb', 'hex'))), 'MALFORMED_MESSAGE');
  expectCode(moqError(() => moq.decodeVarint(Buffer.alloc(0))), 'MALFORMED_MESSAGE');
});

test('varint: minimal lengths follow the leading-1-bits table', () => {
  assert.equal(moq.varintLength(0n), 1);
  assert.equal(moq.varintLength(127n), 1);
  assert.equal(moq.varintLength(128n), 2);
  assert.equal(moq.varintLength(16383n), 2);
  assert.equal(moq.varintLength(16384n), 3);
  assert.equal(moq.varintLength(268435455n), 4);
  assert.equal(moq.varintLength(268435456n), 5);
  assert.equal(moq.varintLength(18446744073709551615n), 9);
});

test('varint: values above 2^64-1 are refused', () => {
  expectCode(moqError(() => moq.encodeVarint(18446744073709551616n)), 'INVALID_FIELD');
  expectCode(moqError(() => moq.encodeVarint(-1n)), 'INVALID_FIELD');
});

// ---------------------------------------------------------------------------
// KVPs (§8.3) and object properties (§8.4)
// ---------------------------------------------------------------------------

test('kvp: delta-encoded types round-trip (even varint, odd bytes)', () => {
  const kvps = [
    { type: 0x0an, value: 42n },
    { type: 0x0bn, value: Buffer.from('hello') },
    { type: 0x10n, value: 0n },
  ];
  const encoded = moq.encodeKvpList(kvps);
  const decoded = moq.decodeKvpList(encoded);
  assert.equal(decoded.length, 3);
  assert.equal(decoded[0].type, 0x0an);
  assert.equal(decoded[0].value, 42n);
  assert.equal(decoded[1].value.toString('utf8'), 'hello');
  assert.equal(decoded[2].value, 0n);
});

test('kvp: a value over 2^16-1 bytes is refused', () => {
  const error = moqError(() => moq.encodeKvpList([{ type: 0x01n, value: Buffer.alloc(65536) }]));
  expectCode(error, 'FIELD_LENGTH_EXCEEDED');
});

test('kvp: truncated input is refused', () => {
  const encoded = moq.encodeKvpList([{ type: 0x0bn, value: Buffer.from('hello') }]);
  expectCode(moqError(() => moq.decodeKvpList(encoded.subarray(0, 3))), 'MALFORMED_MESSAGE');
});

test('properties: round-trip and duplicate single-instance property refused', () => {
  const properties = [
    { type: 0x02n, value: 7n },
    { type: 0x03n, value: Buffer.from('x') },
  ];
  const encoded = moq.encodeObjectProperties(properties);
  const decoded = moq.decodeObjectProperties(encoded);
  assert.equal(decoded.properties.length, 2);
  assert.equal(decoded.properties[0].value, 7n);
  // A duplicate type in one properties block is malformed when the
  // caller declares the type single-instance (§8.4).
  const kvpBytes = moq.encodeKvpList([{ type: 0x02n, value: 1n }, { type: 0x02n, value: 2n }]);
  expectCode(
    moqError(() => moq.decodeProperties(kvpBytes, { singleInstanceTypes: new Set(['2']) })),
    'MALFORMED_KEY_VALUE',
  );
});

// ---------------------------------------------------------------------------
// Namespaces (§8.7, §8.8) and Locations (§8.2)
// ---------------------------------------------------------------------------

test('namespace: the §8.8 rendering example', () => {
  assert.equal(
    moq.renderFullTrackName(['example.net', 'team2', 'project_x'], 'report'),
    'example.2enet-team2-project_x--report',
  );
});

test('namespace: limits are enforced (32 fields, non-empty field, 4096-byte name)', () => {
  expectCode(
    moqError(() => moq.encodeTrackNamespace(Array.from({ length: 33 }, () => 'a'))),
    'INVALID_TRACK_NAMESPACE',
  );
  expectCode(moqError(() => moq.encodeTrackNamespace(['ok', ''])), 'INVALID_TRACK_NAMESPACE');
  expectCode(
    moqError(() => moq.encodeTrackNamespace(['a'.repeat(4097)])),
    'FIELD_LENGTH_EXCEEDED',
  );
  expectCode(moqError(() => moq.checkTrackName('')), 'INVALID_FIELD');
  expectCode(
    moqError(() => moq.checkFullTrackNameLength(['a'.repeat(4090)], '1234567890')),
    'FIELD_LENGTH_EXCEEDED',
  );
  // Exactly at the limits passes.
  moq.encodeTrackNamespace(Array.from({ length: 32 }, () => 'a'));
  moq.checkTrackName('t');
});

test('namespace: reserved namespaces and .session', () => {
  assert.equal(moq.isReservedNamespace(['.foo', 'bar']), true);
  assert.equal(moq.isReservedNamespace(['.']), true);
  assert.equal(moq.isReservedNamespace(['numina']), false);
  assert.equal(moq.isDotSessionNamespace(['.session']), true);
  assert.equal(moq.isDotSessionNamespace(['.foo']), false);
  assert.equal(moq.isDotSessionNamespace(['.session', 'x']), false);
});

test('namespace: prefix matching', () => {
  assert.equal(moq.namespacePrefixMatches(['a', 'b'], ['a', 'b', 'c']), true);
  assert.equal(moq.namespacePrefixMatches(['a', 'b'], ['a', 'x']), false);
  assert.equal(moq.namespacePrefixMatches(['a', 'b', 'c'], ['a', 'b']), false);
  assert.equal(moq.namespaceEquals(['a'], ['a']), true);
  assert.equal(moq.namespaceEquals(['a'], ['b']), false);
});

test('location: lexicographic comparison', () => {
  assert.equal(moq.compareLocation({ group: 1n, object: 2n }, { group: 1n, object: 3n }), -1);
  assert.equal(moq.compareLocation({ group: 2n, object: 0n }, { group: 1n, object: 9n }), 1);
  assert.equal(moq.compareLocation({ group: 1n, object: 2n }, { group: 1n, object: 2n }), 0);
});

// ---------------------------------------------------------------------------
// Range filter (§8.6)
// ---------------------------------------------------------------------------

test('range filter: the §8.6 example (3-5, 10-15) encodes as Start=3 End=2 Start=5 End=5', () => {
  const ranges = [{ start: 3n, end: 5n }, { start: 10n, end: 15n }];
  const encoded = moq.encodeRangeFilter(ranges);
  // Length (4) then Start 3, End 2 (5-3), Start 5 (10-5), End 5 (15-10).
  assert.equal(Buffer.from(encoded).toString('hex'), '0403020505');
  const decoded = moq.decodeRangeFilter(encoded);
  assert.deepEqual(decoded.ranges, ranges);
});

test('range filter: matcher honours open-ended last ranges', () => {
  const ranges = [{ start: 3n, end: 5n }, { start: 10n, end: null }];
  assert.equal(moq.rangeFilterMatches(ranges, 4n), true);
  assert.equal(moq.rangeFilterMatches(ranges, 6n), false);
  assert.equal(moq.rangeFilterMatches(ranges, 10n), true);
  assert.equal(moq.rangeFilterMatches(ranges, 999999n), true);
  assert.equal(moq.rangeFilterMatches([], 0n), false);
});

test('range filter: an empty filter encodes as length 0', () => {
  assert.equal(Buffer.from(moq.encodeRangeFilter([])).toString('hex'), '00');
  assert.deepEqual(moq.decodeRangeFilter(Buffer.from([0])).ranges, []);
});

// ---------------------------------------------------------------------------
// Auth tokens (§8.9)
// ---------------------------------------------------------------------------

test('token: all four alias types round-trip', () => {
  const cases = [
    { aliasType: 0x0n, tokenAlias: 3n },
    { aliasType: 0x1n, tokenAlias: 3n, tokenType: 0x2n, tokenValue: Buffer.from([1, 2, 3]) },
    { aliasType: 0x2n, tokenAlias: 3n },
    { aliasType: 0x3n, tokenType: 0x2n, tokenValue: Buffer.from([9]) },
  ];
  for (const token of cases) {
    const encoded = moq.encodeAuthToken(token);
    const { token: decoded } = moq.decodeAuthToken(encoded);
    assert.equal(decoded.aliasType, token.aliasType);
    assert.equal(decoded.tokenAlias ?? null, token.tokenAlias ?? null);
    assert.equal(decoded.tokenType ?? null, token.tokenType ?? null);
    if (token.tokenValue) assert.ok(decoded.tokenValue.equals(token.tokenValue));
  }
});

test('token: malformed combinations are refused', () => {
  // REGISTER without a value.
  expectCode(moqError(() => moq.encodeAuthToken({ aliasType: 0x1n, tokenAlias: 1n, tokenType: 0x2n })), 'MALFORMED_AUTH_TOKEN');
  // USE_ALIAS without an alias.
  expectCode(moqError(() => moq.encodeAuthToken({ aliasType: 0x2n })), 'MALFORMED_AUTH_TOKEN');
  // DELETE with an extra value is accepted but the value is dropped:
  // the encoder only writes the fields the alias type carries.
  const deleted = moq.encodeAuthToken({ aliasType: 0x0n, tokenAlias: 1n, tokenValue: Buffer.from([1]) });
  assert.equal(moq.decodeAuthToken(deleted).token.tokenValue, undefined);
});

// ---------------------------------------------------------------------------
// Parameters (§9.19)
// ---------------------------------------------------------------------------

test('parameters: ascending order, unknown types and duplicates are refused', () => {
  // The encoder SORTS out-of-order input (delta encoding can only
  // express ascending types), so an out-of-order encode decodes in
  // ascending order.
  const sorted = moq.encodeParameters([
    { type: 0x22n, value: 1n },
    { type: 0x11n, value: 0n },
  ]);
  assert.deepEqual(moq.decodeParameters(sorted, 2).map((p) => p.type), [0x11n, 0x22n]);
  // Unknown type.
  expectCode(moqError(() => moq.encodeParameters([{ type: 0x99n, value: 1n }])), 'INVALID_PARAMETER');
  // Duplicate single-instance type (encoder).
  expectCode(
    moqError(() => moq.encodeParameters([{ type: 0x11n, value: 0n }, { type: 0x11n, value: 1n }])),
    'INVALID_PARAMETER',
  );
  // Duplicate single-instance type (decoder): a zero type delta.
  const first = moq.encodeParameters([{ type: 0x11n, value: 0n }]);
  const duplicateBytes = Buffer.concat([first, Buffer.from([0x00, 0x01])]);
  expectCode(moqError(() => moq.decodeParameters(duplicateBytes, 2)), 'INVALID_PARAMETER');
  // Ascending order round-trips.
  const encoded = moq.encodeParameters([
    { type: 0x11n, value: 1n },
    { type: 0x20n, value: 100 },
    { type: 0x22n, value: 2n },
  ]);
  const decoded = moq.decodeParameters(encoded, 3);
  assert.deepEqual(decoded.map((p) => p.type), [0x11n, 0x20n, 0x22n]);
});

test('parameters: PAUSED / GROUP_ORDER / INCLUDE_PROPERTIES accept BigInt and Number, refuse other values', () => {
  // Regression: the encoder once compared BigInt values with strict
  // !== against Numbers and rejected a valid BigInt 1n.
  for (const value of [0, 1, 0n, 1n]) {
    const encoded = moq.encodeParameters([{ type: 0x11n, value }]);
    assert.equal(moq.decodeParameters(encoded, 1)[0].value, Number(value));
  }
  expectCode(moqError(() => moq.encodeParameters([{ type: 0x11n, value: 2n }])), 'INVALID_PARAMETER');
  expectCode(moqError(() => moq.encodeParameters([{ type: 0x22n, value: 3n }])), 'INVALID_PARAMETER');
  expectCode(moqError(() => moq.encodeParameters([{ type: 0x35n, value: 5 }] ) ), 'INVALID_PARAMETER');
  for (const value of [1n, 2n]) {
    const encoded = moq.encodeParameters([{ type: 0x22n, value }]);
    assert.equal(moq.decodeParameters(encoded, 1)[0].value, Number(value));
  }
});

test('parameters: LOCATION_FILTER all five types round-trip', () => {
  const filters = [
    { type: 0x00n },
    { type: 0x01n, startGroup: 2n },
    { type: 0x02n, startGroup: 5n, startObject: 3n },
    { type: 0x03n, startGroup: 2n, startObject: 0n, endGroupDelta: 2n },
    { type: 0x04n, startGroup: 2n, startObject: 0n, endGroupDelta: 2n, endObject: 8n },
    { type: 0x05n },
  ];
  for (const filter of filters) {
    const encoded = moq.encodeParameters([{ type: 0x21n, value: filter }]);
    const decoded = moq.decodeParameters(encoded, 1);
    assert.equal(decoded[0].type, 0x21n);
    assert.equal(decoded[0].value.type, filter.type);
    if (filter.startGroup !== undefined) assert.equal(decoded[0].value.startGroup, filter.startGroup);
    if (filter.startObject !== undefined) assert.equal(decoded[0].value.startObject, filter.startObject);
    if (filter.endGroupDelta !== undefined) assert.equal(decoded[0].value.endGroupDelta, filter.endGroupDelta);
    if (filter.endObject !== undefined) assert.equal(decoded[0].value.endObject, filter.endObject);
  }
  // An unknown location filter type is refused.
  expectCode(
    moqError(() => moq.encodeParameters([{ type: 0x21n, value: { type: 0x06n } }])),
    'INVALID_PARAMETER',
  );
});

test('parameters: resolveLocationFilter clamps a relative start to the largest object', () => {
  // Type 0x01 (Largest Object): startGroup is how many groups back
  // from the largest; 1 back from group 4 is group 4.
  const resolved = moq.resolveLocationFilter(
    { type: 0x01n, startGroup: 1n },
    { group: 4n, object: 10n },
  );
  assert.deepEqual(resolved, { start: { group: 4n, object: 0n }, end: null });
  const absolute = moq.resolveLocationFilter(
    { type: 0x02n, startGroup: 2n, startObject: 3n },
    { group: 4n, object: 10n },
  );
  assert.deepEqual(absolute, { start: { group: 2n, object: 3n }, end: null });
  const next = moq.resolveLocationFilter({ type: 0x05n }, { group: 4n, object: 10n });
  assert.deepEqual(next, { start: { group: 4n, object: 11n }, end: null });
});

test('parameters: FILL_PARAMETERS nests the Table 7 scope and is non-coalescible', () => {
  const fill = {
    type: 0x23n,
    value: [
      { type: 0x20n, value: 50 },
      { type: 0x22n, value: 1n },
    ],
  };
  const encoded = moq.encodeParameters([fill]);
  const decoded = moq.decodeParameters(encoded, 1);
  assert.equal(decoded[0].type, 0x23n);
  assert.equal(decoded[0].value.length, 2);
  // A type outside the Table 7 scope inside FILL_PARAMETERS is refused.
  expectCode(
    moqError(() => moq.encodeParameters([{ type: 0x23n, value: [{ type: 0x11n, value: 1n }] }])),
    'INVALID_PARAMETER',
  );
  // FILL_PARAMETERS makes a REQUEST_UPDATE non-coalescible.
  const coalesced = moq.coalesceRequestUpdates([
    { parameters: [{ type: 0x11n, value: 1n }] },
    { parameters: [{ type: 0x23n, value: [{ type: 0x20n, value: 50 }] }] },
    { parameters: [{ type: 0x11n, value: 0n }] },
  ]);
  assert.equal(coalesced.length, 2);
});

// ---------------------------------------------------------------------------
// Control messages (§9)
// ---------------------------------------------------------------------------

test('control: SETUP round-trips with setup options', () => {
  const bytes = moq.encodeSetupMessage([
    { type: 0x07n, value: 'numina-moq-transport/1.0' },
    { type: 0x09n, value: 65535n },
  ]);
  const decoded = moq.decodeControlMessage(bytes);
  assert.equal(decoded.typeName, 'SETUP');
  const options = moq.decodeSetupMessage(decoded.body);
  assert.equal(options.length, 2);
  assert.equal(options[0].value, 'numina-moq-transport/1.0');
  assert.equal(options[1].value, 65535n);
});

test('control: GOAWAY round-trips and refuses an over-long URI', () => {
  const bytes = moq.encodeGoawayMessage({ newSessionUri: 'https://example.com/new', timeoutMs: 5000n });
  const decoded = moq.decodeControlMessage(bytes);
  assert.equal(decoded.typeName, 'GOAWAY');
  assert.equal(moq.decodeGoawayMessage(decoded.body).newSessionUri, 'https://example.com/new');
  assert.equal(moq.decodeGoawayMessage(decoded.body).timeoutMs, 5000n);
  expectCode(
    moqError(() => moq.encodeGoawayMessage({ newSessionUri: 'x'.repeat(8193) })),
    'FIELD_LENGTH_EXCEEDED',
  );
});

test('control: SUBSCRIBE and SUBSCRIBE_OK round-trip', () => {
  // encodeRequestMessage already returns a complete control message.
  const subBytes = moq.encodeRequestMessage(moq.MOQ_MESSAGE_TYPES.SUBSCRIBE, {
    requestId: 0n, namespace: NS, trackName: TRACK, parameters: [],
  });
  const subDecoded = moq.decodeControlMessage(subBytes);
  assert.equal(subDecoded.typeName, 'SUBSCRIBE');
  const sub = moq.decodeRequestMessage(subDecoded.body, moq.MOQ_MESSAGE_TYPES.SUBSCRIBE);
  assert.equal(sub.requestId, 0n);
  assert.equal(sub.trackName.toString('utf8'), TRACK);
  assert.deepEqual(sub.namespace.map((f) => f.toString('utf8')), NS);

  const okBytes = moq.encodeSubscribeOkMessage({ trackAlias: 3n, parameters: [], properties: [] });
  const okDecoded = moq.decodeControlMessage(okBytes);
  assert.equal(okDecoded.typeName, 'SUBSCRIBE_OK');
  assert.equal(moq.decodeSubscribeOkMessage(okDecoded.body).trackAlias, 3n);
});

test('control: REQUEST_ERROR round-trips, including the REDIRECT detail', () => {
  const bytes = moq.encodeRequestErrorMessage({
    errorCode: BigInt(moq.MOQ_REQUEST_ERROR_CODES.REDIRECT),
    retryIntervalMs: 1000n,
    reason: 'moved',
    details: [{
      type: 0x01n,
      value: moq.encodeRedirectDetail({ connectUri: 'https://relay.example.com', trackName: 'video' }),
    }],
  });
  const decoded = moq.decodeControlMessage(bytes);
  assert.equal(decoded.typeName, 'REQUEST_ERROR');
  const error = moq.decodeRequestErrorMessage(decoded.body);
  assert.equal(error.errorCode, BigInt(moq.MOQ_REQUEST_ERROR_CODES.REDIRECT));
  assert.equal(error.reason, 'moved');
  const redirect = moq.decodeRedirectDetail(error.details[0].value);
  assert.equal(redirect.connectUri, 'https://relay.example.com');
  assert.equal(redirect.trackName.toString('utf8'), 'video');
  // REDIRECT (0x34) without a redirect detail is refused.
  expectCode(
    moqError(() => moq.encodeRequestErrorMessage({ errorCode: BigInt(moq.MOQ_REQUEST_ERROR_CODES.REDIRECT), reason: 'moved', details: [] })),
    'MALFORMED_MESSAGE',
  );
});

test('control: PUBLISH and PUBLISH_DONE round-trip', () => {
  // encodePublishMessage already returns a complete control message.
  const pubBytes = moq.encodePublishMessage({ requestId: 2n, namespace: NS, trackName: TRACK, trackAlias: 0n, parameters: [], properties: [] });
  const pubDecoded = moq.decodeControlMessage(pubBytes);
  assert.equal(pubDecoded.typeName, 'PUBLISH');
  const pub = moq.decodePublishMessage(pubDecoded.body);
  assert.equal(pub.requestId, 2n);
  assert.equal(pub.trackAlias, 0n);

  const doneBytes = moq.encodePublishDoneMessage({ statusCode: 0x00n, streamCount: 2n, reason: 'track ended' });
  const doneDecoded = moq.decodeControlMessage(doneBytes);
  assert.equal(doneDecoded.typeName, 'PUBLISH_DONE');
  const done = moq.decodePublishDoneMessage(doneDecoded.body);
  assert.equal(done.statusCode, 0x00n);
  assert.equal(done.streamCount, 2n);
  assert.equal(done.reason, 'track ended');
});

test('control: FETCH, TRACK_STATUS, REQUEST_UPDATE and PUBLISH_STATE_NOTIFY round-trip', () => {
  for (const type of [moq.MOQ_MESSAGE_TYPES.FETCH, moq.MOQ_MESSAGE_TYPES.TRACK_STATUS]) {
    const bytes = moq.encodeRequestMessage(type, { requestId: 4n, namespace: NS, trackName: TRACK, parameters: [] });
    const decoded = moq.decodeControlMessage(bytes);
    assert.equal(decoded.type, BigInt(type));
    const request = moq.decodeRequestMessage(decoded.body, type);
    assert.equal(request.requestId, 4n);
    assert.equal(request.trackName.toString('utf8'), TRACK);
  }
  const updateBytes = moq.encodeRequestUpdateMessage({ requestId: 4n, parameters: [{ type: 0x11n, value: 1n }] });
  assert.equal(moq.decodeControlMessage(updateBytes).typeName, 'REQUEST_UPDATE');
  const notifyBytes = moq.encodePublishStateNotifyMessage({ parameters: [{ type: 0x11n, value: 0n }] });
  assert.equal(moq.decodeControlMessage(notifyBytes).typeName, 'PUBLISH_STATE_NOTIFY');
  assert.equal(moq.decodePublishStateNotifyMessage(moq.decodeControlMessage(notifyBytes).body).parameters[0].type, 0x11n);
});

test('control: namespace messages round-trip', () => {
  const cases = [
    [moq.MOQ_MESSAGE_TYPES.PUBLISH_NAMESPACE, (body) => moq.encodeNamespaceRequestMessage(moq.MOQ_MESSAGE_TYPES.PUBLISH_NAMESPACE, body), (body) => moq.decodeNamespaceRequestMessage(body, moq.MOQ_MESSAGE_TYPES.PUBLISH_NAMESPACE), { requestId: 6n, namespacePrefix: NS, parameters: [] }],
    [moq.MOQ_MESSAGE_TYPES.SUBSCRIBE_NAMESPACE, (body) => moq.encodeNamespaceRequestMessage(moq.MOQ_MESSAGE_TYPES.SUBSCRIBE_NAMESPACE, body), (body) => moq.decodeNamespaceRequestMessage(body, moq.MOQ_MESSAGE_TYPES.SUBSCRIBE_NAMESPACE), { requestId: 8n, namespacePrefix: NS, parameters: [] }],
    [moq.MOQ_MESSAGE_TYPES.NAMESPACE, moq.encodeNamespaceMessage, moq.decodeNamespaceMessage, { namespaceSuffix: NS }],
    [moq.MOQ_MESSAGE_TYPES.NAMESPACE_DONE, moq.encodeNamespaceDoneMessage, moq.decodeNamespaceDoneMessage, { namespaceSuffix: NS }],
    [moq.MOQ_MESSAGE_TYPES.SUBSCRIBE_TRACKS, moq.encodeSubscribeTracksMessage, moq.decodeSubscribeTracksMessage, { requestId: 10n, namespacePrefix: NS, parameters: [] }],
    [moq.MOQ_MESSAGE_TYPES.PUBLISH_SKIPPED, moq.encodePublishSkippedMessage, moq.decodePublishSkippedMessage, { namespaceSuffix: NS, trackName: TRACK }],
  ];
  for (const [type, encode, decode, body] of cases) {
    const bytes = encode(body);
    const decoded = moq.decodeControlMessage(bytes);
    assert.equal(decoded.type, BigInt(type));
    assert.ok(decode(decoded.body));
  }
});

test('control: unknown and reserved legacy types are refused', () => {
  // Unknown type 0x1234.
  const unknown = Buffer.concat([moq.encodeVarint(0x1234n), moq.encodeVarint(0n)]);
  expectCode(moqError(() => moq.decodeControlMessage(unknown)), 'UNEXPECTED_MESSAGE');
  // CLIENT_SETUP (0x40) is a reserved legacy type in -23.
  const legacy = Buffer.concat([moq.encodeVarint(0x40n), moq.encodeVarint(0n)]);
  const error = moqError(() => moq.decodeControlMessage(legacy));
  expectCode(error, 'UNEXPECTED_MESSAGE');
  assert.match(error.message, /CLIENT_SETUP|legacy/i);
});

test('control: a message over MAX_CONTROL_MESSAGE_SIZE is refused', () => {
  const oversized = Buffer.concat([
    moq.encodeVarint(moq.MOQ_MESSAGE_TYPES.GOAWAY),
    moq.encodeVarint(70000n),
    Buffer.alloc(70000),
  ]);
  expectCode(
    moqError(() => moq.decodeControlMessage(oversized, { maxControlMessageSize: 65535 })),
    'FIELD_LENGTH_EXCEEDED',
  );
});

test('control: truncation is refused as malformed', () => {
  const bytes = moq.encodeGoawayMessage({ newSessionUri: 'https://example.com', timeoutMs: 0n });
  expectCode(moqError(() => moq.decodeControlMessage(bytes.subarray(0, bytes.length - 2))), 'MALFORMED_MESSAGE');
});

// ---------------------------------------------------------------------------
// Session (§6)
// ---------------------------------------------------------------------------

test('session: client/server SETUP handshake establishes both sides', () => {
  const client = moq.createMoqSession({ role: 'client' });
  const server = moq.createMoqSession({ role: 'server' });
  assert.equal(client.isEstablished(), false);
  handshake(client, server);
  assert.equal(client.session.state, 'established');
  assert.equal(server.session.state, 'established');
});

test('session: a second SETUP is refused', () => {
  const { client, server } = pairedSessions();
  // The client already sent SETUP, so sending again is a violation.
  expectCode(moqError(() => client.createSetup({})), 'PROTOCOL_VIOLATION');
  // A fresh server receiving SETUP twice refuses the second one.
  const client2 = moq.createMoqSession({ role: 'client' });
  const server2 = moq.createMoqSession({ role: 'server' });
  const setup2 = client2.createSetup({});
  server2.receiveSetup(setup2);
  expectCode(moqError(() => server2.receiveSetup(setup2)), 'UNEXPECTED_MESSAGE');
});

test('session: AUTHORITY/PATH from the server are refused', () => {
  const client = moq.createMoqSession({ role: 'client' });
  const server = moq.createMoqSession({ role: 'server' });
  const serverSetup = server.createSetup({
    options: [{ type: BigInt(moq.MOQ_SETUP_OPTIONS.AUTHORITY), value: 'example.com' }],
  });
  // The server's own createSetup does not add AUTHORITY (client-only
  // option); the option is injected via extra.options, and the client
  // must refuse it.
  const error = moqError(() => client.receiveSetup(serverSetup));
  expectCode(error, 'INVALID_AUTHORITY');
});

test('session: request-ID parity and duplicates are refused', () => {
  const { client, server } = pairedSessions();
  // The server expects even (client) request IDs from the peer; an
  // odd one is refused.
  const oddSubscribe = moq.encodeRequestMessage(moq.MOQ_MESSAGE_TYPES.SUBSCRIBE, {
    requestId: 1n, namespace: NS, trackName: TRACK, parameters: [],
  });
  expectCode(moqError(() => server.receiveSubscribe(oddSubscribe)), 'INVALID_REQUEST_ID');
  // A valid subscribe, then the same request ID again.
  const { requestId, bytes } = client.createSubscribe({ namespace: NS, trackName: TRACK });
  assert.equal(requestId, 0n);
  assert.equal(server.receiveSubscribe(bytes).ok, true);
  expectCode(moqError(() => server.receiveSubscribe(bytes)), 'INVALID_REQUEST_ID');
});

test('session: duplicate track aliases are refused', () => {
  const { client, server } = pairedSessions();
  const sub = client.createSubscribe({ namespace: NS, trackName: TRACK });
  server.receiveSubscribe(sub.bytes);
  const ok = server.createSubscribeOk({ requestId: sub.requestId, trackAlias: 5n });
  client.receiveSubscribeOk(sub.requestId, ok.bytes);
  // A second subscription answered with the same alias.
  const sub2 = client.createSubscribe({ namespace: NS, trackName: 'other' });
  server.receiveSubscribe(sub2.bytes);
  expectCode(
    moqError(() => server.createSubscribeOk({ requestId: sub2.requestId, trackAlias: 5n })),
    'DUPLICATE_TRACK_ALIAS',
  );
});

test('session: duplicate auth token alias in SETUP is refused', () => {
  // A token's cache size is 16 + value length (§9.1.3), so the cache
  // must be at least 17 bytes for this 1-byte token to register at
  // all; with a 4-byte cache both REGISTERs would be downgraded to
  // USE_VALUE in SETUP instead of the second one being a duplicate.
  const client = moq.createMoqSession({ role: 'client', maxAuthTokenCacheSize: 64 });
  const server = moq.createMoqSession({ role: 'server', maxAuthTokenCacheSize: 64 });
  const token = { aliasType: 0x1n, tokenAlias: 5n, tokenType: 0x2n, tokenValue: Buffer.from([1]) };
  const clientSetup = client.createSetup({
    options: [
      { type: BigInt(moq.MOQ_SETUP_OPTIONS.AUTHORIZATION_TOKEN), value: token },
      { type: BigInt(moq.MOQ_SETUP_OPTIONS.AUTHORIZATION_TOKEN), value: token },
    ],
  });
  expectCode(moqError(() => server.receiveSetup(clientSetup)), 'DUPLICATE_AUTH_TOKEN_ALIAS');
});

test('session: DELETE/USE_ALIAS tokens in SETUP from the client are a role violation', () => {
  const client = moq.createMoqSession({ role: 'client' });
  const server = moq.createMoqSession({ role: 'server' });
  const clientSetup = client.createSetup({
    options: [{ type: BigInt(moq.MOQ_SETUP_OPTIONS.AUTHORIZATION_TOKEN), value: { aliasType: 0x2n, tokenAlias: 1n } }],
  });
  expectCode(moqError(() => server.receiveSetup(clientSetup)), 'ROLE_VIOLATION');
});

test('session: MAX_REQUEST_UPDATES is enforced', () => {
  const { client, server } = pairedSessions(
    { maxRequestUpdates: 1 },
    { maxRequestUpdates: 1 },
  );
  const sub = client.createSubscribe({ namespace: NS, trackName: TRACK });
  server.receiveSubscribe(sub.bytes);
  const ok = server.createSubscribeOk({ requestId: sub.requestId, trackAlias: 0n });
  client.receiveSubscribeOk(sub.requestId, ok.bytes);
  const update1 = client.createRequestUpdate({ requestId: sub.requestId, parameters: [] });
  server.receiveRequestUpdate(sub.requestId, update1);
  // The initiator enforces the peer's limit locally: a second
  // update from the same client is refused before it is sent.
  expectCode(moqError(() => client.createRequestUpdate({ requestId: sub.requestId, parameters: [] })), 'TOO_MANY_REQUEST_UPDATES');
  // A peer that ignores the limit and sends a second update anyway
  // is refused on receipt too.
  const update2Bytes = moq.encodeRequestUpdateMessage({ requestId: sub.requestId, parameters: [] });
  expectCode(moqError(() => server.receiveRequestUpdate(sub.requestId, update2Bytes)), 'TOO_MANY_REQUEST_UPDATES');
});

test('session: EXPIRES terminates the subscription at the deadline', () => {
  const { client, server } = pairedSessions();
  const now = Date.now();
  const sub = client.createSubscribe({ namespace: NS, trackName: TRACK, nowMs: now });
  server.receiveSubscribe(sub.bytes);
  const ok = server.createSubscribeOk({
    requestId: sub.requestId,
    trackAlias: 0n,
    parameters: [{ type: 0x08n, value: 1000n }],
    nowMs: now,
  });
  client.receiveSubscribeOk(sub.requestId, ok.bytes);
  assert.equal(client.checkExpiries(now + 500).length, 0);
  const expired = client.checkExpiries(Date.now() + 2000);
  assert.equal(expired.length, 1);
  assert.equal(expired[0].kind, 'subscribe');
});

test('session: GOAWAY rules (client zero-URI, second GOAWAY refused, no new requests)', () => {
  const { client, server } = pairedSessions();
  expectCode(
    moqError(() => client.createGoaway({ newSessionUri: 'https://example.com' })),
    'ROLE_VIOLATION',
  );
  const serverGoaway = server.createGoaway({ newSessionUri: 'https://example.com/new', timeoutMs: 1000n });
  const received = client.receiveGoaway(serverGoaway);
  assert.equal(received.newSessionUri, 'https://example.com/new');
  expectCode(moqError(() => server.createGoaway({})), 'UNEXPECTED_MESSAGE');
  assert.equal(client.canInitiateNewRequests(), false);
});

test('session: a reserved-namespace subscribe is refused with DOES_NOT_EXIST', () => {
  const { client, server } = pairedSessions();
  const sub = client.createSubscribe({ namespace: ['.hidden'], trackName: TRACK });
  const received = server.receiveSubscribe(sub.bytes);
  assert.equal(received.ok, false);
  assert.equal(received.requestErrorCode, BigInt(moq.MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST));
});

// ---------------------------------------------------------------------------
// Data plane (§11)
// ---------------------------------------------------------------------------

test('datagram: round-trip with properties, priority and end-of-group', () => {
  const object = {
    trackAlias: 2n,
    groupId: 3n,
    objectId: 7n,
    payload: Buffer.from('hello-object'),
    properties: [{ type: 0x02n, value: 1n }],
    publisherPriority: 90,
    endOfGroup: true,
  };
  const encoded = moq.encodeObjectDatagram(object);
  const decoded = moq.decodeObjectDatagram(encoded);
  assert.equal(decoded.trackAlias, 2n);
  assert.equal(decoded.groupId, 3n);
  assert.equal(decoded.objectId, 7n);
  assert.equal(decoded.payload.toString('utf8'), 'hello-object');
  assert.equal(decoded.publisherPriority, 90);
  assert.equal(decoded.endOfGroup, true);
  assert.equal(decoded.properties[0].value, 1n);
  // Object ID 0 omits the object ID field (ZERO_OBJECT_ID flag).
  const zero = moq.decodeObjectDatagram(moq.encodeObjectDatagram({ trackAlias: 0n, groupId: 0n, objectId: 0n, payload: Buffer.from('z') }));
  assert.equal(zero.objectId, 0n);
});

test('datagram: invalid flag combinations are refused', () => {
  // Hand-crafted datagrams must set DEFAULT_PRIORITY (0x08) and
  // ZERO_OBJECT_ID (0x04) or the decoder reads further bytes for
  // the priority/object ID.
  // STATUS (0x20) + END_OF_GROUP (0x02) together.
  const both = Buffer.concat([moq.encodeVarint(0x2en), moq.encodeVarint(0n), moq.encodeVarint(0n)]);
  expectCode(moqError(() => moq.decodeObjectDatagramStrict(both)), 'INVALID_STREAM_HEADER');
  // Reserved bit 4 (0x10) set.
  const bit4 = Buffer.concat([moq.encodeVarint(0x1cn), moq.encodeVarint(0n), moq.encodeVarint(0n)]);
  expectCode(moqError(() => moq.decodeObjectDatagramStrict(bit4)), 'INVALID_STREAM_HEADER');
  // Flags >= 128.
  const big = Buffer.concat([moq.encodeVarint(0x8cn), moq.encodeVarint(0n), moq.encodeVarint(0n)]);
  expectCode(moqError(() => moq.decodeObjectDatagramStrict(big)), 'INVALID_STREAM_HEADER');
  // PROPERTIES with a zero properties length.
  const emptyProps = Buffer.concat([
    moq.encodeVarint(0x0dn), moq.encodeVarint(0n), moq.encodeVarint(0n), moq.encodeVarint(0n),
  ]);
  expectCode(moqError(() => moq.decodeObjectDatagramStrict(emptyProps)), 'MALFORMED_OBJECT');
  // STATUS with trailing payload bytes.
  const statusPayload = Buffer.concat([
    moq.encodeVarint(0x2cn), moq.encodeVarint(0n), moq.encodeVarint(0n), moq.encodeVarint(0x00n), Buffer.from('x'),
  ]);
  expectCode(moqError(() => moq.decodeObjectDatagramStrict(statusPayload)), 'MALFORMED_OBJECT');
});

test('datagram: padding stream and datagram round-trip, and decodeDatagram routing', () => {
  // decodeDatagram handles only the padding DATAGRAM type
  // (0x132B3E29), not the padding STREAM type (0x132B3E28), so the
  // stream form is checked by its bytes: the type varint followed
  // by zero padding bytes.
  const padStream = moq.encodePaddingStream(12);
  assert.equal(moq.decodeVarint(padStream).value, 0x132b3e28n);
  assert.ok(padStream.subarray(moq.decodeVarint(padStream).length).every((b) => b === 0));
  const padDatagram = moq.encodePaddingDatagram(5);
  assert.equal(moq.decodeDatagram(padDatagram).kind, 'padding');
  const object = moq.encodeObjectDatagram({ trackAlias: 0n, groupId: 1n, objectId: 2n, payload: Buffer.from('p') });
  assert.equal(moq.decodeDatagram(object).kind, 'object');
  assert.equal(moq.decodeDatagram(object).payload.toString('utf8'), 'p');
});

test('subgroup: header and object round-trip', () => {
  const header = moq.encodeSubgroupHeader({
    trackAlias: 1n, groupId: 2n, subgroupIdMode: 2, subgroupId: 3n, publisherPriority: 100, firstObject: true,
  });
  const { header: decoded } = moq.decodeSubgroupHeader(header);
  assert.equal(decoded.subgroupId, 3n);
  assert.equal(decoded.publisherPriority, 100);
  assert.equal(decoded.firstObject, true);
  assert.equal(decoded.groupId, 2n);
  // Mode 0b11 is reserved.
  const reserved = moq.encodeVarint(0x16n); // bit 4 set + mode 0b11
  expectCode(moqError(() => moq.decodeSubgroupHeader(Buffer.concat([reserved, moq.encodeVarint(0n), moq.encodeVarint(0n)]))), 'INVALID_STREAM_HEADER');
  // Bit 4 unset is refused.
  const noBit4 = moq.encodeVarint(0x04n);
  expectCode(moqError(() => moq.decodeSubgroupHeader(Buffer.concat([noBit4, moq.encodeVarint(0n), moq.encodeVarint(0n)]))), 'INVALID_STREAM_HEADER');
});

test('fetch: object round-trip and end-of-track indicator', () => {
  const encoded = moq.encodeFetchObject({
    firstInStream: true, groupIdDelta: 2n, objectIdDelta: 5n, subgroupIdMode: 0,
    publisherPriority: 200, payload: Buffer.from('fetch-payload'),
  });
  const { object } = moq.decodeFetchObject(encoded, 0, { firstInStream: true });
  assert.equal(object.groupId, 2n);
  assert.equal(object.objectId, 5n);
  assert.equal(object.payload.toString('utf8'), 'fetch-payload');
  // Second object in the same stream resolves relative IDs.
  const second = moq.encodeFetchObject({ objectIdDelta: 0n, payload: Buffer.from('next') });
  const { object: secondDecoded } = moq.decodeFetchObject(second, 0, { prevGroupId: 2n, prevObjectId: 5n, prevSubgroupId: 0n });
  assert.equal(secondDecoded.groupId, 2n);
  assert.equal(secondDecoded.objectId, 7n);
  // End of Track indicator.
  const indicator = moq.encodeFetchObject({ indicator: 0x81n });
  assert.equal(moq.decodeFetchObject(indicator).object.indicator, 0x81n);
  // An unknown indicator is refused.
  expectCode(moqError(() => moq.encodeFetchObject({ indicator: 0x99n })), 'MALFORMED_OBJECT');
});

// ---------------------------------------------------------------------------
// Sequencer (§12.1 malformed tracks)
// ---------------------------------------------------------------------------

function sequencerObject(overrides = {}) {
  return {
    groupId: 0n, subgroupId: 0n, objectId: 0n,
    payload: Buffer.from('o'), properties: [], ...overrides,
  };
}

test('sequencer: in-order admission, largest object, duplicate dedup', () => {
  const sequencer = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  assert.equal(sequencer.admitObject(sequencerObject({ objectId: 0n })).ok, true);
  assert.equal(sequencer.admitObject(sequencerObject({ objectId: 1n })).ok, true);
  const dedup = sequencer.admitObject(sequencerObject({ objectId: 1n }));
  assert.equal(dedup.ok, true);
  assert.equal(dedup.deduped, true);
  assert.deepEqual(sequencer.getLargestObject(), { group: 0n, object: 1n });
});

test('sequencer: a duplicate with a different payload is malformed', () => {
  const sequencer = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  sequencer.admitObject(sequencerObject({ objectId: 0n, payload: Buffer.from('a') }));
  const refused = sequencer.admitObject(sequencerObject({ objectId: 0n, payload: Buffer.from('b') }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'duplicate_object_differs');
});

test('sequencer: subgroup priority change is malformed (§12.1 condition 1)', () => {
  const sequencer = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  sequencer.admitObject(sequencerObject({ objectId: 0n, publisherPriority: 10 }));
  const refused = sequencer.admitObject(sequencerObject({ objectId: 1n, publisherPriority: 20 }));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'subgroup_priority_changed');
});

test('sequencer: gaps, group regression and objects after end are refused', () => {
  const sequencer = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  sequencer.admitObject(sequencerObject({ objectId: 0n }));
  // Gap: object 2 without object 1.
  const gap = sequencer.admitObject(sequencerObject({ objectId: 2n }));
  assert.equal(gap.ok, false);
  assert.equal(gap.reason, 'object_out_of_order');
  // Datagram mode allows gaps (allowGap is an admit option; the relay
  // sets it from object.deliveryMode === 'datagram').
  const datagram = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  datagram.admitObject(sequencerObject({ objectId: 0n, deliveryMode: 'datagram' }));
  assert.equal(datagram.admitObject(sequencerObject({ objectId: 5n, deliveryMode: 'datagram' }), { allowGap: true }).ok, true);
  // Group regression.
  const regressed = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  regressed.admitObject(sequencerObject({ groupId: 2n, objectId: 0n }));
  const regression = regressed.admitObject(sequencerObject({ groupId: 1n, objectId: 0n }));
  assert.equal(regression.ok, false);
  assert.equal(regression.reason, 'group_regressed');
  // Object after End of Track (status 0x4).
  const ended = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  ended.admitObject(sequencerObject({ objectId: 0n }));
  ended.admitObject(sequencerObject({ objectId: 1n, objectStatus: 0x04n }));
  assert.equal(ended.isTrackEnded(), true);
  assert.equal(ended.admitObject(sequencerObject({ objectId: 2n })).reason, 'object_after_end_of_track');
  // Object beyond a group final (endOfGroup at object 0).
  const beyond = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  beyond.admitObject(sequencerObject({ objectId: 0n, endOfGroup: true }));
  assert.equal(beyond.admitObject(sequencerObject({ objectId: 1n })).reason, 'object_beyond_final');
});

test('sequencer: advancing groups abandons (not refuses) the unended previous group', () => {
  const sequencer = moq.createTrackSequencer({ namespace: NS, trackName: TRACK });
  sequencer.admitObject(sequencerObject({ groupId: 0n, objectId: 0n }));
  assert.equal(sequencer.admitObject(sequencerObject({ groupId: 1n, objectId: 0n })).ok, true);
  assert.equal(sequencer.admitObject(sequencerObject({ groupId: 0n, objectId: 1n })).reason, 'group_regressed');
});

// ---------------------------------------------------------------------------
// Scheduler (§5.1.2) and delivery timeouts (§5.2)
// ---------------------------------------------------------------------------

test('scheduler: subscriber priority, then publisher priority, then group order; datagrams first on a mode tie', () => {
  const candidates = [
    { subscriberPriority: 10, publisherPriority: 200, groupId: 0n, subgroupId: 0n, objectId: 1n, deliveryMode: 'subgroup' },
    { subscriberPriority: 5, publisherPriority: 200, groupId: 0n, subgroupId: 0n, objectId: 0n, deliveryMode: 'subgroup' },
    { subscriberPriority: 10, publisherPriority: 100, groupId: 0n, subgroupId: 0n, objectId: 0n, deliveryMode: 'subgroup' },
    { subscriberPriority: 10, publisherPriority: 100, groupId: 0n, subgroupId: 0n, objectId: 0n, deliveryMode: 'datagram' },
    { subscriberPriority: 10, publisherPriority: 100, groupId: 1n, subgroupId: 0n, objectId: 0n, deliveryMode: 'subgroup' },
  ];
  const sorted = moq.sortTransmissionCandidates(candidates);
  assert.equal(sorted[0].subscriberPriority, 5);
  assert.equal(sorted[1].deliveryMode, 'datagram');
  assert.equal(sorted[2].deliveryMode, 'subgroup');
  assert.equal(sorted[2].objectId, 0n);
  assert.equal(sorted[3].groupId, 1n);
  assert.equal(sorted[4].objectId, 1n);
  // Descending group order reverses the group comparison.
  const descending = moq.sortTransmissionCandidates(candidates, { groupOrder: moq.MOQ_GROUP_ORDER.DESCENDING });
  assert.equal(descending[1].groupId, 1n);
  assert.equal(descending[4].groupId, 0n);
});

test('timeouts: the smaller non-zero timeout wins; 0 means no timeout', () => {
  assert.equal(moq.effectiveDeliveryTimeout({ publisherTimeoutMs: 1000, subscriberTimeoutMs: 500 }), 500);
  assert.equal(moq.effectiveDeliveryTimeout({ publisherTimeoutMs: 1000, subscriberTimeoutMs: 0 }), 1000);
  assert.equal(moq.effectiveDeliveryTimeout({ publisherTimeoutMs: 0, subscriberTimeoutMs: 0 }), 0);
  assert.equal(moq.isDeliveryExpired({ sentAtMs: 1000, nowMs: 1400, timeoutMs: 500 }), false);
  // isDeliveryExpired is strict (>): at exactly the timeout elapsed
  // the delivery is NOT expired.
  assert.equal(moq.isDeliveryExpired({ sentAtMs: 1000, nowMs: 1500, timeoutMs: 500 }), false);
  assert.equal(moq.isDeliveryExpired({ sentAtMs: 1000, nowMs: 1501, timeoutMs: 500 }), true);
  assert.equal(moq.isDeliveryExpired({ sentAtMs: 1000, nowMs: 99999, timeoutMs: 0 }), false);
  assert.equal(
    moq.deliveryTimeoutCheck({ publisherTimeoutMs: 1000, subscriberTimeoutMs: 400, sentAtMs: 0, nowMs: 401 }).expired,
    true,
  );
});

// ---------------------------------------------------------------------------
// Relay (§7)
// ---------------------------------------------------------------------------

function relayWithPublisher() {
  const relay = moq.createMoqRelay({});
  relay.publishNamespace(['numina']);
  const registered = relay.registerPublisher({ namespace: NS, trackName: TRACK, requestId: 0n });
  assert.equal(registered.ok, true);
  return relay;
}

test('relay: publish fans out to established unpaused subscriptions and caches', () => {
  const relay = relayWithPublisher();
  const sub = relay.subscribe({ namespace: NS, trackName: TRACK, requestId: 2n });
  assert.equal(sub.ok, true);
  const published = relay.publishObject({
    namespace: NS, trackName: TRACK, groupId: 0n, subgroupId: 0n, objectId: 0n,
    payload: Buffer.from('frame-0'), properties: [], deliveryMode: 'datagram',
  });
  assert.equal(published.ok, true);
  assert.deepEqual(published.deliveredTo, [2n]);
  const cached = relay.getCachedObject({ namespace: NS, trackName: TRACK, groupId: 0n, objectId: 0n });
  assert.equal(cached.payload.toString('utf8'), 'frame-0');
  const drained = relay.drainDeliveries({ namespace: NS, trackName: TRACK, requestId: 2n });
  assert.equal(drained.ok, true);
  assert.equal(drained.deliveries.length, 1);
  assert.equal(drained.deliveries[0].kind, 'object');
});

test('relay: upstream stays unpaused while ANY downstream is unpaused (§7.2)', () => {
  const relay = relayWithPublisher();
  relay.subscribe({ namespace: NS, trackName: TRACK, requestId: 2n, parameters: [{ type: 0x11n, value: 1 }] });
  relay.subscribe({ namespace: NS, trackName: TRACK, requestId: 4n });
  assert.equal(relay.upstreamPaused({ namespace: NS, trackName: TRACK }), false);
  relay.setPaused({ namespace: NS, trackName: TRACK, requestId: 4n, paused: true });
  assert.equal(relay.upstreamPaused({ namespace: NS, trackName: TRACK }), true);
  relay.setPaused({ namespace: NS, trackName: TRACK, requestId: 2n, paused: false });
  assert.equal(relay.upstreamPaused({ namespace: NS, trackName: TRACK }), false);
});

test('relay: rendezvous holds a subscription until a publisher registers', () => {
  const relay = moq.createMoqRelay({});
  const held = relay.subscribe({
    namespace: NS, trackName: TRACK, requestId: 2n,
    parameters: [{ type: 0x04n, value: 60000n }],
  });
  assert.equal(held.ok, true);
  assert.equal(held.held, true);
  const registered = relay.registerPublisher({ namespace: NS, trackName: TRACK, requestId: 0n });
  assert.equal(registered.ok, true);
  assert.deepEqual(registered.rendezvousReady, [2n]);
  // Without a rendezvous timeout there is no publisher to wait for.
  const relay2 = moq.createMoqRelay({});
  const refused = relay2.subscribe({ namespace: NS, trackName: TRACK, requestId: 2n });
  assert.equal(refused.ok, false);
  assert.equal(refused.requestErrorCode, BigInt(moq.MOQ_REQUEST_ERROR_CODES.DOES_NOT_EXIST));
});

test('relay: fetch gaps are classified gone / unknown / non-existent', () => {
  const relay = relayWithPublisher();
  relay.publishObject({
    namespace: NS, trackName: TRACK, groupId: 0n, subgroupId: 0n, objectId: 0n,
    payload: Buffer.from('a'), properties: [], deliveryMode: 'datagram',
  });
  relay.publishObject({
    namespace: NS, trackName: TRACK, groupId: 0n, subgroupId: 0n, objectId: 2n,
    payload: Buffer.from('c'), properties: [], deliveryMode: 'datagram',
  });
  const fetched = relay.fetch({ namespace: NS, trackName: TRACK, start: { group: 0n, object: 0n } });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.objects.length, 2);
  assert.equal(fetched.gaps.length, 1);
  assert.equal(fetched.gaps[0].kind, 'unknown');
  // Beyond the largest object, with the track still open: unknown.
  const beyond = relay.fetch({ namespace: NS, trackName: TRACK, start: { group: 0n, object: 3n } });
  assert.equal(beyond.gaps[0].kind, 'unknown');
  relay.endTrack({ namespace: NS, trackName: TRACK });
  const ended = relay.fetch({ namespace: NS, trackName: TRACK, start: { group: 0n, object: 3n } });
  assert.equal(ended.gaps[0].kind, 'non-existent');
});

test('relay: a malformed object terminates downstream with PUBLISH_DONE MALFORMED_TRACK and is not cached', () => {
  const relay = relayWithPublisher();
  relay.subscribe({ namespace: NS, trackName: TRACK, requestId: 2n });
  relay.publishObject({
    namespace: NS, trackName: TRACK, groupId: 0n, subgroupId: 0n, objectId: 0n,
    payload: Buffer.from('a'), properties: [], deliveryMode: 'datagram',
  });
  relay.drainDeliveries({ namespace: NS, trackName: TRACK, requestId: 2n });
  const bad = relay.publishObject({
    namespace: NS, trackName: TRACK, groupId: 0n, subgroupId: 0n, objectId: 0n,
    payload: Buffer.from('different'), properties: [], deliveryMode: 'datagram',
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.malformed, true);
  const drained = relay.drainDeliveries({ namespace: NS, trackName: TRACK, requestId: 2n });
  assert.equal(drained.deliveries.length, 1);
  assert.equal(drained.deliveries[0].kind, 'publish_done');
  assert.equal(drained.deliveries[0].statusCode, BigInt(moq.MOQ_PUBLISH_DONE_CODES.MALFORMED_TRACK));
  // The triggering object was NOT cached: the cache still holds only object 0 'a'.
  const cached = relay.getCachedObject({ namespace: NS, trackName: TRACK, groupId: 0n, objectId: 0n });
  assert.equal(cached.payload.toString('utf8'), 'a');
});

test('relay: namespace advertisement and unpublish', () => {
  const relay = moq.createMoqRelay({});
  relay.publishNamespace(['numina']);
  relay.publishNamespace(['numina', 'live']);
  assert.deepEqual(
    relay.advertiseNamespaces().map((entry) => entry.namespacePrefix.map((f) => f.toString('utf8')).join('/')),
    ['numina', 'numina/live'],
  );
  relay.unpublishNamespace(['numina', 'live']);
  assert.equal(relay.advertiseNamespaces().length, 1);
});

// ---------------------------------------------------------------------------
// MMTP (draft-ramadan-moq-mmt-02 §3.1, §4)
// ---------------------------------------------------------------------------

test('mmtp: packet build/parse round-trip with FEC type 1 and an extension', () => {
  const packet = moq.buildMmtpPacket({
    type: 0x00, packetId: 5, timestamp: 1000, packetSequenceNumber: 42,
    payload: Buffer.from('hello-mmtp'),
  });
  assert.equal(packet.length, 12 + 10);
  const parsed = moq.parseMmtpPacket(packet);
  assert.equal(parsed.version, 0);
  assert.equal(parsed.packetId, 5);
  assert.equal(parsed.timestamp, 1000);
  assert.equal(parsed.packetSequenceNumber, 42);
  assert.equal(parsed.payload.toString('utf8'), 'hello-mmtp');
  // FEC type 1 carries a trailing 4-byte Source FEC Payload ID.
  const fec = moq.buildMmtpPacket({
    type: 0x00, packetId: 5, timestamp: 1, packetSequenceNumber: 1,
    fecType: 1, sourceFecPayloadId: Buffer.from([0x01, 0x02, 0x03, 0x04]), payload: Buffer.from('x'),
  });
  assert.ok(moq.parseMmtpPacket(fec).sourceFecPayloadId.equals(Buffer.from([0x01, 0x02, 0x03, 0x04])));
  // Extension: u16 type + u16 length + value.
  const ext = moq.buildMmtpPacket({
    type: 0x00, packetId: 5, timestamp: 1, packetSequenceNumber: 1,
    headerExtension: { type: 0x0001, value: Buffer.from([0xaa, 0xbb]) },
    payload: Buffer.from('x'),
  });
  const parsedExt = moq.parseMmtpPacket(ext);
  assert.equal(parsedExt.headerExtension.type, 0x0001);
  assert.ok(parsedExt.headerExtension.value.equals(Buffer.from([0xaa, 0xbb])));
});

test('mmtp: version, C flag and packet_id 0 rules are enforced', () => {
  const base = { type: 0x00, packetId: 5, timestamp: 1, packetSequenceNumber: 1, payload: Buffer.from('x') };
  // Version 00 is enforced: a packet with version 01 is refused.
  const versioned = Buffer.from(moq.buildMmtpPacket(base));
  versioned[0] = 0x40; // version 01
  expectCode(moqError(() => moq.parseMmtpPacket(versioned)), 'INVALID_FIELD');
  // C=1 (a packet carrying more than one MMTP packet) is refused:
  // the C flag is byte 0 bit 5.
  const cFlag = Buffer.from(moq.buildMmtpPacket(base));
  cFlag[0] = 0x20; // C bit
  expectCode(moqError(() => moq.parseMmtpPacket(cFlag)), 'INVALID_FIELD');
  // packet_id 0 is reserved for signaling: a media packet with id 0 is refused.
  expectCode(
    moqError(() => moq.buildMmtpPacket({ ...base, packetId: 0 })),
    'INVALID_FIELD',
  );
  // A packet shorter than the 12-byte header is refused.
  expectCode(moqError(() => moq.parseMmtpPacket(Buffer.alloc(11))), 'MALFORMED_OBJECT');
});

test('mmtp: signaling header (complete unfragmented) round-trip', () => {
  const header = moq.buildMmtpSignalingHeader(0x0001);
  assert.equal(Buffer.from(header).toString('hex'), '00000001');
  const parsed = moq.parseMmtpSignalingHeader(header);
  assert.equal(parsed.fragmentIndicator, 0);
  assert.equal(parsed.fragmentCount, 0);
  assert.equal(parsed.messageId, 1);
  assert.equal(parsed.messageBytes.length, 0);
  // A signaling packet with a message body carries it after message_id.
  const withBody = Buffer.concat([header, Buffer.from('manifest-bytes')]);
  assert.equal(moq.parseMmtpSignalingHeader(withBody).messageBytes.toString('utf8'), 'manifest-bytes');
});

test('mmtp: MoQ mapping round-trip (packet -> object -> packet)', () => {
  const packet = moq.buildMmtpPacket({
    type: 0x00, packetId: 5, timestamp: 1000, packetSequenceNumber: 42,
    payload: Buffer.from('media'),
  });
  const object = moq.mmtpPacketToMoqObject(packet, { groupId: 2n, objectId: 9n, trackAlias: 1n });
  assert.equal(object.groupId, 2n);
  assert.equal(object.objectId, 9n);
  assert.equal(object.packet.packetId, 5);
  assert.equal(object.packet.packetSequenceNumber, 42);
  const rebuilt = moq.moqObjectToMmtpPacket(object);
  assert.equal(rebuilt.packetSequenceNumber, 42);
  assert.equal(rebuilt.payload.toString('utf8'), 'media');
});

// ---------------------------------------------------------------------------
// Multicast endpoints (ramadan §4.1)
// ---------------------------------------------------------------------------

function ssmEndpoint(overrides = {}) {
  return {
    protocol: 'ssm',
    groupAddress: '232.1.2.3',
    sourceAddress: '198.51.100.7',
    port: 5004,
    tracks: [{ name: 'video', packetId: 1 }],
    ...overrides,
  };
}

function catalogTracks() {
  const map = new Map();
  map.set('video', { packaging: 'mmtp', namespace: [Buffer.from('numina'), Buffer.from('test')] });
  map.set('video/repair', { packaging: 'fec-repair', namespace: [Buffer.from('numina'), Buffer.from('test')] });
  return map;
}

test('multicast: a valid SSM endpoint validates, with S = sourceAddress', () => {
  const result = moq.validateMulticastEndpoint(ssmEndpoint(), { namespace: NS, catalogTracks: catalogTracks() });
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(result.normalized.protocol, 'ssm');
  assert.equal(result.normalized.sourceForJoin, '198.51.100.7');
  assert.equal(result.normalized.catalogValidated, true);
});

test('multicast: a valid ASM endpoint validates, with no S', () => {
  const result = moq.validateMulticastEndpoint({
    protocol: 'asm', groupAddress: '239.1.2.3', port: 5004,
    tracks: [{ name: 'video', packetId: 1 }],
  }, { namespace: NS, catalogTracks: catalogTracks() });
  assert.equal(result.ok, true, result.reasons.join('; '));
  assert.equal(result.normalized.sourceForJoin, null);
});

test('multicast: group ranges are enforced (§4.1 ignore rules)', () => {
  const bad = [
    // SSM group outside 232/8.
    ssmEndpoint({ groupAddress: '239.1.2.3' }),
    // ASM group inside 232/8.
    { protocol: 'asm', groupAddress: '232.1.2.3', port: 5004, tracks: [{ name: 'video', packetId: 1 }] },
    // Not a multicast address at all.
    ssmEndpoint({ groupAddress: '198.51.100.7' }),
    // SSM without a source.
    ssmEndpoint({ sourceAddress: undefined }),
    // ASM carrying a sourceAddress.
    { protocol: 'asm', groupAddress: '239.1.2.3', sourceAddress: '198.51.100.7', port: 5004, tracks: [{ name: 'video', packetId: 1 }] },
    // packet_id 0 is reserved for signaling.
    ssmEndpoint({ tracks: [{ name: 'video', packetId: 0 }] }),
    // packet_id out of range.
    ssmEndpoint({ tracks: [{ name: 'video', packetId: 65536 }] }),
    // Duplicate packetId within one endpoint.
    ssmEndpoint({ tracks: [{ name: 'video', packetId: 1 }, { name: 'audio', packetId: 1 }] }),
    // Track not in the catalog.
    ssmEndpoint({ tracks: [{ name: 'missing', packetId: 1 }] }),
    // Protected endpoint without bandwidth.
    ssmEndpoint({ auth: { senderAddress: '198.51.100.7' } }),
    // Protected ASM without auth.senderAddress.
    { protocol: 'asm', groupAddress: '239.1.2.3', port: 5004, tracks: [{ name: 'video', packetId: 1 }], auth: {}, bandwidth: 1000000 },
  ];
  for (const endpoint of bad) {
    const result = moq.validateMulticastEndpoint(endpoint, { namespace: NS, catalogTracks: catalogTracks() });
    assert.equal(result.ok, false, `expected ${JSON.stringify(endpoint)} to be refused`);
    assert.ok(result.reasons.length > 0);
  }
  // Protected ASM WITH auth.senderAddress validates (S = auth.senderAddress).
  const protectedAsm = moq.validateMulticastEndpoint({
    protocol: 'asm', groupAddress: '239.1.2.3', port: 5004,
    tracks: [{ name: 'video', packetId: 1 }],
    auth: { senderAddress: '198.51.100.7' }, bandwidth: 1000000,
  }, { namespace: NS, catalogTracks: catalogTracks() });
  assert.equal(protectedAsm.ok, true, protectedAsm.reasons.join('; '));
  assert.equal(protectedAsm.normalized.sourceForJoin, '198.51.100.7');
});

test('multicast: IPv6 SSM (ff3x::/32) and ASM (ff00::/8) ranges', () => {
  const ssm6 = moq.validateMulticastEndpoint({
    protocol: 'ssm', groupAddress: 'ff3e::1234', sourceAddress: '2001:db8::1', port: 5004,
    tracks: [{ name: 'video', packetId: 1 }],
  }, { namespace: NS, catalogTracks: catalogTracks() });
  assert.equal(ssm6.ok, true, ssm6.reasons.join('; '));
  assert.equal(ssm6.normalized.family, 'ipv6');
  const asm6 = moq.validateMulticastEndpoint({
    protocol: 'asm', groupAddress: 'ff0e::1234', port: 5004,
    tracks: [{ name: 'video', packetId: 1 }],
  }, { namespace: NS, catalogTracks: catalogTracks() });
  assert.equal(asm6.ok, true, asm6.reasons.join('; '));
  // An IPv6 SSM group outside ff3x::/32.
  const bad = moq.validateMulticastEndpoint({
    protocol: 'ssm', groupAddress: 'ff0e::1234', sourceAddress: '2001:db8::1', port: 5004,
    tracks: [{ name: 'video', packetId: 1 }],
  }, { namespace: NS, catalogTracks: catalogTracks() });
  assert.equal(bad.ok, false);
});

test('multicast: an endpoint set refuses a duplicate (S,G,port) tuple', () => {
  const set = moq.validateMulticastEndpointSet(
    [ssmEndpoint(), ssmEndpoint()],
    { namespace: NS, catalogTracks: catalogTracks() },
  );
  assert.equal(set.ok, false);
  assert.match(set.reasons.join(' '), /already used/);
  const ok = moq.validateMulticastEndpointSet(
    [ssmEndpoint(), ssmEndpoint({ port: 5005 })],
    { namespace: NS, catalogTracks: catalogTracks() },
  );
  assert.equal(ok.ok, true);
});

test('multicast: AMT networkSource validates but the join refuses it', () => {
  const endpoint = ssmEndpoint({
    networkSource: { type: 'amt', relay: 'amt.example.com', discovery: 'dns' },
  });
  const result = moq.validateMulticastEndpoint(endpoint, { namespace: NS, catalogTracks: catalogTracks() });
  assert.equal(result.ok, true, result.reasons.join('; '));
  const error = moqError(() => moq.createMulticastJoin({ endpoint }));
  assert.ok(error);
  assert.match(error.message, /networkSource 'amt' is not supported/);
});

// ---------------------------------------------------------------------------
// Multicast join lifecycle
// ---------------------------------------------------------------------------

test('multicast: join and leave over a real UDP socket', async () => {
  const join = moq.createMulticastJoin({ endpoint: ssmEndpoint({ groupAddress: '239.255.0.1', protocol: 'asm', sourceAddress: undefined }) });
  assert.equal(join.join.state, 'idle');
  const joined = await join.joinSocket();
  assert.equal(joined.ok, true);
  assert.equal(join.join.state, 'joined');
  assert.ok(join.join.socket);
  assert.equal(join.join.socket.address().port, 5004);
  const left = await join.leaveSocket();
  assert.equal(left.ok, true);
  assert.equal(join.join.state, 'left');
});

test('multicast: per-packet_id sequence tracking detects gaps and duplicates', () => {
  const tracker = moq.createMmtpSequenceTracker();
  assert.equal(tracker.note(1, 10).gap, null);
  assert.equal(tracker.note(1, 11).gap, null);
  const gap = tracker.note(1, 14);
  assert.deepEqual(gap.gap, { from: 12, to: 14 });
  assert.equal(tracker.note(1, 14).duplicate, true);
  assert.equal(tracker.get(1).duplicates, 1);
  assert.equal(tracker.get(1).gaps.length, 1);
  // u32 wraparound: 2^32-1 then 0 is the next sequence.
  tracker.note(2, 4294967295);
  assert.equal(tracker.note(2, 0).gap, null);
});

test('multicast: hysteresis — fallback after sustained loss, switch-back after a stable period', () => {
  const join = moq.createMulticastJoin({ endpoint: ssmEndpoint() });
  join.join.state = 'joined';
  join.join.joinedAtMs = 1000;
  assert.equal(join.shouldFallbackToUnicast(2000).fallback, false);
  join.recordLoss({ consecutiveFailures: 3, nowMs: 2000 });
  assert.equal(join.shouldFallbackToUnicast(2000).fallback, true);
  join.enterFallbackUnicast('sustained loss');
  assert.equal(join.shouldSwitchBackToMulticast(5000).switchBack, false);
  join.join.stableSinceMs = 5000;
  join.join.consecutiveFailures = 0;
  assert.equal(join.shouldSwitchBackToMulticast(15000).switchBack, true);
  // No data after join: fallback is recommended after the timeout.
  const quiet = moq.createMulticastJoin({ endpoint: ssmEndpoint() });
  quiet.join.state = 'joined';
  quiet.join.joinedAtMs = 1000;
  assert.equal(quiet.noteNoData(2000).fallbackRecommended, false);
  assert.equal(quiet.noteNoData(5000).fallbackRecommended, true);
});

test('multicast: an unlisted packet_id is discarded, a listed one is delivered', () => {
  const delivered = [];
  const join = moq.createMulticastJoin({
    endpoint: ssmEndpoint(),
    onPacket: (delivery) => delivered.push(delivery),
  });
  join.join.state = 'joined';
  const unlisted = moq.buildMmtpPacket({ type: 0x00, packetId: 99, timestamp: 1, packetSequenceNumber: 1, payload: Buffer.from('x') });
  const refused = join.handleUdpDatagram(unlisted);
  assert.equal(refused.action, 'discarded');
  assert.equal(refused.reason, 'unlisted_packet_id');
  assert.equal(join.join.discarded, 1);
  const listed = moq.buildMmtpPacket({ type: 0x00, packetId: 1, timestamp: 1, packetSequenceNumber: 1, payload: Buffer.from('video-frame') });
  const ok = join.handleUdpDatagram(listed);
  assert.equal(ok.action, 'delivered');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].packet.payload.toString('utf8'), 'video-frame');
  // packet_id 0 goes to the signaling path.
  const signaling = moq.buildMmtpPacket({ type: 0x02, packetId: 0, timestamp: 1, packetSequenceNumber: 1, payload: moq.buildMmtpSignalingHeader(0x0001) });
  assert.equal(join.handleUdpDatagram(signaling).action, 'signaling');
  assert.equal(join.join.signaling, 1);
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function testCatalog() {
  return {
    tracks: [
      { name: 'video', packaging: 'mmtp', namespace: ['numina', 'test'] },
      { name: 'video/repair', packaging: 'fec-repair', namespace: ['numina', 'test'] },
    ],
    multicast: {
      endpoints: [ssmEndpoint()],
    },
  };
}

test('catalog: a valid catalog parses, with endpoints and no bc member', () => {
  const parsed = moq.parseMulticastCatalog(testCatalog(), { namespace: NS });
  assert.equal(parsed.ok, true, parsed.reasons.join('; '));
  assert.equal(parsed.validEndpoints.length, 1);
  assert.equal(parsed.bcCatalog, null);
});

test('catalog: a missing multicast member is refused; a bad bc member is reported', () => {
  assert.equal(moq.parseMulticastCatalog({ tracks: [] }).ok, false);
  const parsed = moq.parseMulticastCatalog({
    ...testCatalog(),
    'bc-provenance': { scheme: 'wrong', version: 2, sig: 'ed25519', keys: [], minEpoch: 0 },
  }, { namespace: NS });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.bcCatalog.ok, false);
});

test('catalog: reassemble sorts by (group, object) and concatenates payloads', () => {
  const bytes = moq.reassembleCatalogObjects([
    { groupId: 0n, objectId: 1n, payload: Buffer.from('b') },
    { groupId: 0n, objectId: 0n, payload: Buffer.from('a') },
    { groupId: 1n, objectId: 0n, payload: Buffer.from('c') },
  ]);
  assert.equal(bytes.toString('utf8'), 'abc');
});

test('catalog: fetch over a session subscribe function (no URL fetch exists)', async () => {
  const catalogJson = JSON.stringify(testCatalog());
  const result = await moq.fetchCatalogOverSession({
    subscribe: async () => Buffer.from(catalogJson, 'utf8'),
    namespace: NS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.validEndpoints.length, 1);
  const noSubscribe = await moqErrorAsync(() => moq.fetchCatalogOverSession({}));
  assert.ok(noSubscribe);
  assert.match(noSubscribe.message, /requires a subscribe function/);
});

// ---------------------------------------------------------------------------
// bc-provenance admission on the multicast leg
// ---------------------------------------------------------------------------

function makeBcKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey, publicJwk: publicKey.export({ format: 'jwk' }) };
}

function makeBcCatalog(keys, overrides = {}) {
  return {
    scheme: BC_PROFILE,
    version: BC_VERSION,
    sig: 'ed25519',
    keys: keys.map((entry) => ({
      kid: entry.kid,
      publicKey: entry.publicJwk.x,
      firstEpoch: entry.firstEpoch,
    })),
    minEpoch: 0,
    endpoint: { streamId: 7, port: 5004, ...(overrides.endpoint ?? {}) },
  };
}

function mintBcFlowRecord({ source, group, port = 5004, streamId = 7, firstSeq = 100, count = 3 } = {}) {
  const keys = makeBcKeys();
  const now = Math.floor(Date.now() / 1000);
  const flow = { streamId, source, group, port };
  const encoder = new TextEncoder();
  const items = Array.from({ length: count }, (_, i) => ({
    seq: firstSeq + i,
    data: encoder.encode(`bc-item-${firstSeq + i}`),
  }));
  const digests = items.map((item) => batchDigest(flow, item.data));
  const fields = {
    kid: 'key-1', epoch: 3, mseq: 41, first_seq: firstSeq, count,
    hash_alg: 'sha-256', flags: 0, sent: now, flow, digests,
  };
  const minted = mintBcRecord({
    fields,
    sign: (bytes) => cryptoSign(null, bytes, keys.privateKey),
    publicJwk: keys.publicJwk,
  });
  const catalog = validateBcCatalog(makeBcCatalog([{ kid: 'key-1', publicJwk: keys.publicJwk, firstEpoch: 0 }])).normalized;
  // mintBcRecord returns { manifest, ctx, paramsHash, timing };
  // the admission layer takes the compact JWS string
  // (minted.manifest.compact), not the whole return object.
  return { keys, now, flow, items, minted, compact: minted.manifest.compact, catalog };
}

test('admission: a verified manifest admits a matching datagram, refuses a tampered one', () => {
  const { now, flow, items, compact, catalog } = mintBcFlowRecord({ source: '198.51.100.7', group: '232.1.2.3' });
  // A protected endpoint carries auth + bandwidth (§7.2.6); without
  // auth the admission treats the endpoint as unprotected and admits
  // without provenance.
  const endpoint = moq.validateMulticastEndpoint(
    ssmEndpoint({ auth: { senderAddress: '198.51.100.7' }, bandwidth: 1000000 }),
    { namespace: NS, catalogTracks: catalogTracks() },
  ).normalized;
  const admission = moq.createMulticastAdmission({ endpoint, catalog, nowUnixSeconds: now });
  const verified = admission.verifyManifestRecord(compact);
  assert.equal(verified.ok, true, JSON.stringify(verified.reasons ?? verified));
  const admitted = admission.admitSingleDatagram({ packetBytes: items[0].data, seq: 100 });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.admitted, true);
  assert.equal(admitted.provenance, 'bc-provenance');
  assert.equal(admitted.manifestIndex, 0);
  assert.equal(admitted.digest, batchDigest(flow, items[0].data));
  // The §7.2.2 wire digest is reported alongside (IPv4 endpoint).
  assert.ok(admitted.wireDigest);
  assert.match(admitted.wireDigest, /^sha256:[0-9a-f]{64}$/);
  // Tampered payload: the digest does not match the manifest entry.
  const tampered = admission.admitSingleDatagram({ packetBytes: Buffer.from('tampered'), seq: 100 });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.reason, 'digest_mismatch');
  // A sequence outside the manifest range is refused.
  assert.equal(admission.admitSingleDatagram({ packetBytes: items[0].data, seq: 200 }).reason, 'sequence_out_of_manifest_range');
  // No verified manifest: refused.
  const fresh = moq.createMulticastAdmission({ endpoint, catalog, nowUnixSeconds: now });
  assert.equal(fresh.admitSingleDatagram({ packetBytes: items[0].data, seq: 100 }).reason, 'no_verified_manifest');
});

test('admission: whole-batch admission refuses the whole batch on one bad item', () => {
  const { now, items, compact, catalog } = mintBcFlowRecord({ source: '198.51.100.7', group: '232.1.2.3' });
  const endpoint = moq.validateMulticastEndpoint(
    ssmEndpoint({ auth: { senderAddress: '198.51.100.7' }, bandwidth: 1000000 }),
    { namespace: NS, catalogTracks: catalogTracks() },
  ).normalized;
  const admission = moq.createMulticastAdmission({ endpoint, catalog, nowUnixSeconds: now });
  const ok = admission.admitBatch({ manifest: compact, items });
  assert.equal(ok.ok, true);
  assert.equal(ok.admitted.length, 3);
  const badItems = [...items];
  badItems[1] = { seq: 101, data: Buffer.from('tampered') };
  const refused = admission.admitBatch({ manifest: compact, items: badItems });
  assert.equal(refused.ok, false);
  assert.equal(refused.admitted.length, 0);
});

test('admission: an unprotected endpoint admits without provenance and says so', () => {
  const endpoint = moq.validateMulticastEndpoint(ssmEndpoint(), { namespace: NS, catalogTracks: catalogTracks() }).normalized;
  const admission = moq.createMulticastAdmission({ endpoint, catalog: null });
  const result = admission.admitSingleDatagram({ packetBytes: Buffer.from('plain'), seq: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.provenance, 'none');
});

test('admission: IPv6 admits on the batch digest; the §7.2.2 wire digest refuses IPv6', () => {
  const { now, items, compact, catalog } = mintBcFlowRecord({ source: '2001:db8::1', group: 'ff3e::1234' });
  const endpoint = moq.validateMulticastEndpoint({
    protocol: 'ssm', groupAddress: 'ff3e::1234', sourceAddress: '2001:db8::1', port: 5004,
    tracks: [{ name: 'video', packetId: 1 }],
    auth: { senderAddress: '2001:db8::1' }, bandwidth: 1000000,
  }, { namespace: NS, catalogTracks: catalogTracks() }).normalized;
  const admission = moq.createMulticastAdmission({ endpoint, catalog, nowUnixSeconds: now });
  assert.equal(admission.verifyManifestRecord(compact).ok, true);
  const admitted = admission.admitSingleDatagram({ packetBytes: items[0].data, seq: 100 });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.provenance, 'bc-provenance');
  // The §7.2.2 wire digest is IPv4-only: it is refused, while
  // admission itself proceeds on the batch digest.
  const wire = admission.wireDigestForDatagram(items[0].data);
  assert.equal(wire.ok, false);
  assert.equal(wire.reason, 'bc_provenance_ipv6_unsupported');
});

// ---------------------------------------------------------------------------
// Transports: QUIC probe, TCP framing, UDP loopback probe
// ---------------------------------------------------------------------------

test('transport: QUIC is honestly reported unavailable in this Node build', async () => {
  const probe = await moq.detectQuicSupport();
  assert.equal(typeof probe.nodeQuic, 'boolean');
  assert.equal(typeof probe.webTransport, 'boolean');
  assert.equal(typeof probe.quicAvailable, 'boolean');
  // This Node 26.13.1 build exposes neither node:quic nor
  // WebTransport (verified live twice); the probe must say so.
  assert.equal(probe.nodeQuic, false);
  assert.equal(probe.webTransport, false);
  assert.equal(probe.quicAvailable, false);
  const error = await moqErrorAsync(() => moq.createQuicTransport());
  assert.ok(error);
  assert.match(error.message, /quic_unavailable/);
});

test('transport: TCP frame socket round-trips control and datagram frames over real sockets', async () => {
  const net = await import('node:net');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const received = [];
  const serverSocket = await new Promise((resolve) => {
    server.once('connection', resolve);
    const client = net.connect(port, '127.0.0.1');
    client.once('connect', () => {
      // Send one control frame and one datagram frame, the datagram
      // frame split across two writes (partial-frame handling).
      const control = moq.encodeGoawayMessage({ newSessionUri: '', timeoutMs: 0n });
      const datagram = moq.encodeObjectDatagram({ trackAlias: 0n, groupId: 0n, objectId: 0n, payload: Buffer.from('tcp-frame') });
      const frameSocket = moq.createTcpFrameSocket(client);
      frameSocket.sendControl(control);
      const header = Buffer.alloc(5);
      header[0] = moq.MOQ_TCP_FRAME_KINDS.DATAGRAM;
      header.writeUInt32BE(datagram.length, 1);
      client.write(Buffer.concat([header, datagram.subarray(0, 4)]));
      setTimeout(() => client.write(datagram.subarray(4)), 10);
    });
  });
  const serverFrames = moq.createTcpFrameSocket(serverSocket);
  serverFrames.onFrame((frame) => received.push(frame));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(received.length, 2);
  assert.equal(received[0].kind, moq.MOQ_TCP_FRAME_KINDS.CONTROL);
  assert.equal(received[1].kind, moq.MOQ_TCP_FRAME_KINDS.DATAGRAM);
  assert.equal(moq.decodeObjectDatagram(received[1].payload).payload.toString('utf8'), 'tcp-frame');
  serverSocket.destroy();
  server.close();
});

test('transport: UDP loopback probe reports the environment truth (blocked in this VM)', async () => {
  const result = await moq.probeUdpLoopback({ timeoutMs: 1500 });
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.received, 'boolean');
  // UDP loopback delivery does NOT work in this VM (unicast UDP
  // loopback timed out in two Node variants; Python3 cannot even
  // create a UDP socket: PermissionError Errno 1). The probe must
  // report that, not claim delivery.
  assert.equal(result.ok, false);
  assert.equal(result.received, false);
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// Loopback session pair: publisher -> relay -> subscriber over real TCP
// ---------------------------------------------------------------------------

test('pair: end-to-end publish -> relay -> subscribe over real TCP loopback', async () => {
  const pair = await moq.createLoopbackSessionPair({ namespace: NS });
  try {
    const started = await pair.start();
    assert.equal(started.ok, true);
    assert.ok(started.port > 0);
    const published = await pair.publish({ namespace: NS, trackName: TRACK });
    assert.equal(published.ok, true, published.reason ?? '');
    const subscribed = await pair.subscribe({ namespace: NS, trackName: TRACK });
    assert.equal(subscribed.ok, true, subscribed.reason ?? '');
    await pair.publishObject({ namespace: NS, trackName: TRACK, groupId: 0n, objectId: 0n, payload: Buffer.from('frame-0') });
    await pair.publishObject({ namespace: NS, trackName: TRACK, groupId: 0n, objectId: 1n, payload: Buffer.from('frame-1') });
    await pair.publishObject({ namespace: NS, trackName: TRACK, groupId: 0n, objectId: 2n, payload: Buffer.from('frame-2') });
    const objects = pair.getSubscriberObjects();
    assert.equal(objects.length, 3);
    assert.deepEqual(objects.map((o) => o.payload.toString('utf8')), ['frame-0', 'frame-1', 'frame-2']);
    assert.deepEqual(objects.map((o) => o.objectId), [0n, 1n, 2n]);
    // The relay cached the objects.
    assert.equal(pair.pair.relay.listTracks()[0].cachedObjects, 3);
  } finally {
    await pair.close();
  }
});

test('pair: subscribing to a track with no publisher is refused with DOES_NOT_EXIST', async () => {
  const pair = await moq.createLoopbackSessionPair({ namespace: NS });
  try {
    await pair.start();
    const subscribed = await pair.subscribe({ namespace: NS, trackName: 'missing' });
    assert.equal(subscribed.ok, false);
    assert.match(subscribed.reason ?? '', /no publisher|DOES_NOT_EXIST/i);
  } finally {
    await pair.close();
  }
});

test('pair: the catalog track is fetched over the session (SUBSCRIBE, no URL)', async () => {
  const pair = await moq.createLoopbackSessionPair({ namespace: NS });
  try {
    await pair.start();
    const catalogJson = JSON.stringify(testCatalog());
    const catalogBytes = Buffer.from(catalogJson, 'utf8');
    const published = await pair.publish({ namespace: NS, trackName: moq.MOQ_CATALOG_TRACK_NAME });
    assert.equal(published.ok, true);
    const half = Math.ceil(catalogBytes.length / 2);
    await pair.publishObject({
      namespace: NS, trackName: moq.MOQ_CATALOG_TRACK_NAME,
      groupId: 0n, objectId: 0n, payload: catalogBytes.subarray(0, half),
    });
    await pair.publishObject({
      namespace: NS, trackName: moq.MOQ_CATALOG_TRACK_NAME,
      groupId: 0n, objectId: 1n, payload: catalogBytes.subarray(half),
    });
    const fetched = await pair.fetchCatalog();
    assert.equal(fetched.ok, true, fetched.reasons?.join('; ') ?? '');
    assert.equal(fetched.validEndpoints.length, 1);
    assert.equal(fetched.validEndpoints[0].groupAddress, '232.1.2.3');
  } finally {
    await pair.close();
  }
});
