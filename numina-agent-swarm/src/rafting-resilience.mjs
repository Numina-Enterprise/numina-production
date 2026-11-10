import { createPublicKey, verify, createHash } from 'node:crypto';

const DOMAIN = Buffer.from('numina-rafting-binding-v1\\0'.replace('\\0','\0'),'utf8');
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
function fail(message) { throw new Error(message); }
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail('unsafe number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
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
export function signingBytes(manifest) {
  const {signatures, ...unsigned} = manifest;
  return Buffer.concat([DOMAIN, Buffer.from(canonical(unsigned),'utf8')]);
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
