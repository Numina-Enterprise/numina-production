import { createPublicKey, verify, createHash } from 'node:crypto';

const DOMAIN = Buffer.from('numina-rafting-binding-v1\\0'.replace('\\0','\0'),'utf8');
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
// One backslash: \d is the digit class. A source spelling of \\d matches a
// literal backslash and rejects every dense index, including length >= 2.
const DECIMAL_INDEX = /^(0|[1-9]\d*)$/;
function fail(message) { throw new Error(message); }
function validateUnicode(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('unpaired Unicode surrogate');
    } else if (c >= 0xdc00 && c <= 0xdfff) fail('unpaired Unicode surrogate');
  }
}
function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
function isDigit(c) { return c >= '0' && c <= '9'; }
// JSON text ingestion for the general canonicalizer. Duplicate names are an
// I-JSON violation (RFC 8785 §3.1) and are rejected here. Sequence and
// ttl_seconds safe-integer bounds belong to verifyBinding(), not this parser.
export function tokenize(text) {
  if (typeof text !== 'string') fail('invalid JSON text');
  let i = 0;
  const n = text.length;
  function ws() { while (i < n && isWs(text[i])) i++; }
  function parseString() {
    if (text[i] !== '"') fail('invalid JSON text');
    const start = i;
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        try { return JSON.parse(text.slice(start, i)); }
        catch { fail('invalid JSON text'); }
      }
      if (c === '\\') {
        i++;
        if (i >= n) fail('invalid JSON text');
        const e = text[i];
        if (e === 'u') {
          if (i + 4 >= n || !/^[\da-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail('invalid JSON text');
          i += 5;
        } else if ('"\\/bfnrt'.includes(e)) i++;
        else fail('invalid JSON text');
        continue;
      }
      if (text.charCodeAt(i) < 0x20) fail('invalid JSON text');
      i++;
    }
    fail('invalid JSON text');
  }
  function parseNumber() {
    const start = i;
    if (text[i] === '-') i++;
    if (i >= n || !isDigit(text[i])) fail('invalid JSON text');
    if (text[i] === '0') i++;
    else while (i < n && isDigit(text[i])) i++;
    if (i < n && isDigit(text[i])) fail('invalid JSON text');
    if (text[i] === '.') {
      i++;
      if (i >= n || !isDigit(text[i])) fail('invalid JSON text');
      while (i < n && isDigit(text[i])) i++;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (i >= n || !isDigit(text[i])) fail('invalid JSON text');
      while (i < n && isDigit(text[i])) i++;
    }
    return JSON.parse(text.slice(start, i));
  }
  function parseLiteral(word, value) {
    if (text.slice(i, i + word.length) !== word) fail('invalid JSON text');
    i += word.length;
    return value;
  }
  function parseValue() {
    ws();
    if (i >= n) fail('invalid JSON text');
    const c = text[i];
    if (c === '{') return parseObject();
    if (c === '[') return parseArray();
    if (c === '"') return parseString();
    if (c === 't') return parseLiteral('true', true);
    if (c === 'f') return parseLiteral('false', false);
    if (c === 'n') return parseLiteral('null', null);
    if (c === '-' || isDigit(c)) return parseNumber();
    fail('invalid JSON text');
  }
  function parseObject() {
    i++;
    const obj = {};
    ws();
    if (text[i] === '}') { i++; return obj; }
    while (true) {
      ws();
      const key = parseString();
      if (Object.hasOwn(obj, key)) fail('duplicate property name');
      ws();
      if (text[i] !== ':') fail('invalid JSON text');
      i++;
      Object.defineProperty(obj, key, { value: parseValue(), enumerable: true, writable: true, configurable: true });
      ws();
      if (text[i] === '}') { i++; return obj; }
      if (text[i] !== ',') fail('invalid JSON text');
      i++;
    }
  }
  function parseArray() {
    i++;
    const arr = [];
    ws();
    if (text[i] === ']') { i++; return arr; }
    while (true) {
      arr.push(parseValue());
      ws();
      if (text[i] === ']') { i++; return arr; }
      if (text[i] !== ',') fail('invalid JSON text');
      i++;
    }
  }
  const value = parseValue();
  ws();
  if (i !== n) fail('invalid JSON text');
  return value;
}
export function canonicalize(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') { validateUnicode(value); return JSON.stringify(value); }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // RFC 8785 §3.2.3 keeps array element order and does not sort arrays.
    // Sparse arrays, holes, and extra non-index own properties are not JSON
    // array elements. They are rejected here, not omitted or turned into null.
    assertDenseArray(value);
    let out = '[';
    for (let i = 0; i < value.length; i++) {
      if (i) out += ',';
      out += canonicalize(value[i]);
    }
    return out + ']';
  }
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    // Duplicate names are rejected by tokenize() on raw JSON text. A value
    // that has already been parsed cannot show the overwritten name.
    const keys=Object.keys(value);
    for (const key of keys) validateUnicode(key);
    return '{' + keys.sort().map(k => JSON.stringify(k)+':'+canonicalize(value[k])).join(',') + '}';
  }
  fail('invalid canonical value');
}
function assertKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).sort().join('|') !== [...keys].sort().join('|')) fail('invalid object fields');
}
const hex = (s,n) => typeof s === 'string' && new RegExp('^[0-9a-fA-F]{'+n+'}$').test(s);
function validate(m) {
  assertKeys(m,['schema_id','binding_id','node_a','node_b','sequence','timestamp','ttl_seconds','canonical_spec','signatures']);
  if (m.schema_id !== 'numina.rafting-binding.v1' || m.canonical_spec !== 'RFC-8785') fail('schema mismatch');
  if (typeof m.binding_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(m.binding_id)) fail('invalid binding id');
  if (!Number.isSafeInteger(m.sequence) || m.sequence < 1 || m.sequence > MAX_SAFE) fail('invalid sequence');
  if (!Number.isInteger(m.ttl_seconds) || m.ttl_seconds < 1 || m.ttl_seconds > 86400) fail('invalid ttl');
  if (typeof m.timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(m.timestamp) || !Number.isFinite(Date.parse(m.timestamp))) fail('invalid timestamp');
  for (const node of [m.node_a,m.node_b]) {
    assertKeys(node,['node_id','public_key','state_commitment']);
    if (typeof node.node_id !== 'string' || !node.node_id.length || !hex(node.public_key,64) || typeof node.state_commitment !== 'string' || !/^sha256:[0-9a-fA-F]{64}$/.test(node.state_commitment)) fail('invalid node');
  }
  if (m.node_a.node_id === m.node_b.node_id || m.node_a.public_key.toLowerCase() === m.node_b.public_key.toLowerCase()) fail('self binding');
  assertKeys(m.signatures,['node_a_sig','node_b_sig']);
  if (!hex(m.signatures.node_a_sig,128) || !hex(m.signatures.node_b_sig,128)) fail('invalid signatures');
}
function assertDenseArray(value) {
  for (const key of Object.keys(value)) {
    if (!DECIMAL_INDEX.test(key) || Number(key) >= value.length) fail('sparse or extended array');
  }
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) fail('sparse or extended array');
  }
}
function assertStrictJsonArrays(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    assertDenseArray(value);
    for (let i = 0; i < value.length; i++) assertStrictJsonArrays(value[i]);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto === Object.prototype || proto === null) {
    for (const key of Object.keys(value)) assertStrictJsonArrays(value[key]);
  }
}
export function signingBytes(manifest) {
  const {signatures, ...unsigned} = manifest;
  assertStrictJsonArrays(unsigned);
  return Buffer.concat([DOMAIN, Buffer.from(canonicalize(unsigned),'utf8')]);
}
function ed25519PublicKey(hexKey) {
  return createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(hexKey,'hex')]),format:'der',type:'spki'});
}
export function verifyBinding(manifest, {trustedKeys, previousSequence = 0} = {}) {
  validate(manifest);
  if (!trustedKeys || typeof trustedKeys !== 'object') fail('trusted registry required');
  for (const [node, sig] of [[manifest.node_a,manifest.signatures.node_a_sig],[manifest.node_b,manifest.signatures.node_b_sig]]) {
    if (trustedKeys[node.node_id]?.toLowerCase() !== node.public_key.toLowerCase()) fail('untrusted node');
    if (!verify(null,signingBytes(manifest),ed25519PublicKey(node.public_key),Buffer.from(sig,'hex'))) fail('signature rejected');
  }
  if (!Number.isSafeInteger(previousSequence) || manifest.sequence <= previousSequence) fail('replay sequence');
  return {binding_id:manifest.binding_id,sequence:manifest.sequence,digest:'sha256:'+createHash('sha256').update(signingBytes(manifest)).digest('hex')};
}
export class RaftingLink {
  constructor({verifyManifest, now = () => performance.now()} = {}) {
    if (typeof verifyManifest !== 'function') fail('verifier required');
    this.verifyManifest=verifyManifest; this.now=now; this.state='UNBOUND'; this.sequence=0; this.lastSeen=undefined; this.ttlMs=0; this.bindingId=undefined;
  }
  receive(manifest) {
    if (this.bindingId && manifest.binding_id !== this.bindingId) fail('binding id changed');
    const result=this.verifyManifest(manifest,{previousSequence:this.sequence});
    this.bindingId=manifest.binding_id; this.sequence=result.sequence;
    this.lastSeen=this.now(); this.ttlMs=manifest.ttl_seconds*1000; this.state='BOUND';
    return result;
  }
  tick() {
    if (this.state==='BOUND' && this.now()-this.lastSeen>this.ttlMs) this.state='SLACKENED';
    return this.state;
  }
}
