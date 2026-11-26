// numina-pedigree.test.mjs — PEDIGREE delegation chains, mandate
// narrowing proofs, and signed completion blocks for NCPS (owner
// directive Nov 20, 2026).
//
// Source: draft-rampalli-pedigree-01 (Rampalli, 19 Nov 2026), §4.2
// (par_hash, grants, mandate, narrowing_proof), §4.5 (chain
// invariants), §5.1-§5.3 (mint, conveyance, verify), §5.6 (outcome
// names), §8 (mandate narrowing), §9 (completion blocks).
//
// What these tests prove:
//  - Item 1: a well-formed 3-hop chain verifies with EVERY parent
//    checked; a parent swap, a missing ancestor, a tampered middle
//    signature, a wrong del_depth / parent_chain, an altered principal
//    or consent chain, widened grants, and an expired token are each
//    refused with the draft's own outcome name — and no ancestor is
//    ever fetched (the verifier takes only the conveyed array).
//  - Item 2: the §8.3 syntactic subset check passes and fails exactly
//    as the draft specifies; a rewritten narrower permit needs a
//    proof artifact, and the §8.4 decision procedure is followed in
//    order (syntactic, then proof with digest + checker, then
//    input_unavailable, then refuse); a safety-critical mandate
//    demands a verified proof even when the syntactic check passes.
//  - Item 3: a completion block minted under a token's bound key
//    verifies, binds to exactly that token and exactly the result
//    bytes, and ALWAYS carries the §9.1 caveat — a report, not an
//    observation; verification_status is an assertion, never evidence
//    a check took place.
//
// NO KAT/ACVP PASS IS CLAIMED HERE: draft Appendix A publishes no
// byte-level vectors ("This revision includes no byte-level vectors"),
// so there is nothing to pin. These tests are negative-control and
// mutant-kill tests: every field, when mutated, must fail with the
// draft's outcome. Keys are freshly generated per run (node:crypto
// Ed25519); signatures are deterministic given the keys, and every
// minted token is re-verified by the module before it is returned, so
// cross-run randomness cannot mask a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign, createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import {
  PEDIGREE_DRAFT,
  COMPLETION_CAVEAT,
  jwkThumbprint,
  pedigreeSigningInput,
  pedigreeTokenDigest,
  pedigreeDigest,
  pedigreeCanonicalText,
  parsePedigreeToken,
  validateMandate,
  narrowMandate,
  syntacticSubsetCheck,
  grantsCover,
  mintRootToken,
  mintChildToken,
  verifyPedigreeChain,
  mintCompletionBlock,
  verifyCompletionBlock,
  completionBlockRequired,
} from '../src/numina-pedigree.js';

const NOW = 1794000000; // fixed verifier-supplied clock (deterministic tests)
const CEILING_REF = pedigreeDigest(new TextEncoder().encode('numina-test-ceiling-document'));
const ISSUER = 'root-issuer';
const PRINCIPAL = 'u-4821';
const RESOURCE = 'https://calendar.example.net/cal/u-4821';
const AUD = 'https://calendar.example.net';

function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const exported = publicKey.export({ format: 'jwk' });
  return {
    jwk: { kty: exported.kty, crv: exported.crv, x: exported.x },
    sign: (bytes) => new Uint8Array(cryptoSign(null, Buffer.from(bytes), privateKey)),
  };
}

function b64url(text) {
  return Buffer.from(text, 'utf8').toString('base64url');
}

const GRANTS_ROOT = [{ resource: RESOURCE, scopes: ['read', 'write'] }];
const GRANTS_READ = [{ resource: RESOURCE, scopes: ['read'] }];

// Cedar policies (draft §8.1: exactly one static policy each).
const P_READ = 'permit(principal, action == Pedigree::Action::"read", resource == Pedigree::Resource::"https://calendar.example.net/cal/u-4821");';
const P_READ_RANGE30 = 'permit(principal, action == Pedigree::Action::"read", resource == Pedigree::Resource::"https://calendar.example.net/cal/u-4821") when { context.range_days <= 30 };';
const P_READ_RANGE7 = 'permit(principal, action == Pedigree::Action::"read", resource == Pedigree::Resource::"https://calendar.example.net/cal/u-4821") when { context.range_days <= 7 };';
const F_WRITE = 'forbid(principal, action == Pedigree::Action::"write", resource == Pedigree::Resource::"https://calendar.example.net/cal/u-4821");';

function makeChain({ rootMandate, childMandate, leafMandate, childProof, leafProof, proofOpts = {} } = {}) {
  const anchor = makeKeypair();
  const agent0 = makeKeypair();
  const agent1 = makeKeypair();
  const agent2 = makeKeypair();
  const root = mintRootToken({
    fields: {
      iss: ISSUER, sub: PRINCIPAL, client_id: 'orchestrator-7f3a', aud: AUD,
      jti: 'root-jti-0001', iat: NOW - 60, exp: NOW + 3600,
      grants: GRANTS_ROOT, consent_chain: ['consent-91d4'], ceiling_ref: CEILING_REF,
      ...(rootMandate ? { mandate: rootMandate } : {}),
    },
    sign: anchor.sign, anchorPublicJwk: anchor.jwk, agentPublicJwk: agent0.jwk,
  });
  const t1 = mintChildToken({
    parent: root, sign: agent0.sign, parentPublicJwk: agent0.jwk, childPublicJwk: agent1.jwk,
    ...proofOpts,
    fields: {
      client_id: 'calendar-helper-2', aud: AUD, jti: 'child-jti-0002',
      iat: NOW - 30, exp: NOW + 1800, grants: GRANTS_READ,
      ceiling_ref: CEILING_REF,
      ...(childMandate ? { mandate: childMandate } : {}),
      ...(childProof ? { narrowing_proof: childProof } : {}),
    },
  });
  const t2 = mintChildToken({
    parent: t1, sign: agent1.sign, parentPublicJwk: agent1.jwk, childPublicJwk: agent2.jwk,
    ...proofOpts,
    fields: {
      client_id: 'calendar-helper-3', aud: AUD, jti: 'leaf-jti-0003',
      iat: NOW - 10, exp: NOW + 900, grants: GRANTS_READ,
      ceiling_ref: CEILING_REF,
      ...(leafMandate ? { mandate: leafMandate } : {}),
      ...(leafProof ? { narrowing_proof: leafProof } : {}),
    },
  });
  const chain = [root.compact, t1.compact, t2.compact];
  return { anchor, agent0, agent1, agent2, root, t1, t2, chain };
}

function verifyOpts(fixture, overrides = {}) {
  return {
    trustAnchors: [{ iss: ISSUER, key: fixture.anchor.jwk }],
    nowUnixSeconds: NOW,
    acceptedCeilings: [CEILING_REF],
    ...overrides,
  };
}

/** Re-sign a minted token after mutating its payload (tamper tests). */
function resignToken(token, signer, mutate) {
  const header = { ...token.header };
  const payload = JSON.parse(JSON.stringify(token.payload));
  mutate(payload);
  const { ascii, bytes } = pedigreeSigningInput(header, payload);
  const signature = signer.sign(bytes);
  const compact = `${b64url(pedigreeCanonicalText(header))}.${b64url(pedigreeCanonicalText(payload))}.${Buffer.from(signature).toString('base64url')}`;
  return { compact, header, payload, signingInput: ascii };
}

/**
 * Re-mint the leaf from a mutated T_1 so the par_hash link is intact
 * and the failure lands at the step under test (4, 5, or 6) instead of
 * at step 3. Per the draft's step order, linkage is checked before
 * shape, attenuation, and time.
 */
function rebaseLeaf(f, mutatedT1) {
  const t2 = mintChildToken({
    parent: mutatedT1, sign: f.agent1.sign, parentPublicJwk: f.agent1.jwk, childPublicJwk: f.agent2.jwk,
    fields: {
      client_id: 'calendar-helper-3', aud: AUD, jti: 'leaf-jti-0003',
      iat: NOW - 10, exp: NOW + 900, grants: GRANTS_READ,
      ceiling_ref: CEILING_REF,
    },
  });
  return [f.root.compact, mutatedT1.compact, t2.compact];
}

// --- Item 1: parent-hash chain binding -------------------------------------

test('draft identity: the module names draft-rampalli-pedigree-01', () => {
  assert.equal(PEDIGREE_DRAFT, 'draft-rampalli-pedigree-01');
});

test('root-only chain verifies; status is recorded as not evaluated', () => {
  const f = makeChain();
  const result = verifyPedigreeChain([f.root.compact], verifyOpts(f));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'verified');
  assert.equal(result.depth, 0);
  assert.deepEqual(result.notEvaluated, ['token-status', 'consent-status']);
  assert.equal(result.checks.ceiling.evaluated, true);
});

test('three-hop chain verifies with every parent checked', () => {
  const f = makeChain();
  const result = verifyPedigreeChain(f.chain, verifyOpts(f));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'verified');
  assert.equal(result.depth, 2);
  assert.equal(result.leaf.client_id, 'calendar-helper-3');
  assert.equal(result.checks.signatures.tokens, 3);
  assert.equal(result.checks.linkage.hops, 2);
});

test('par_hash equals base64url SHA-256 of the parent Signing Input', () => {
  const f = makeChain();
  const digest = pedigreeTokenDigest(f.root.signingInput);
  assert.equal(f.t1.payload.par_hash, digest);
  const recomputed = Buffer.from(createHash('sha256').update(f.root.signingInput, 'utf8').digest()).toString('base64url');
  assert.equal(digest, recomputed);
});

test('jwk thumbprint follows RFC 7638 (recomputed independently)', () => {
  const agent = makeKeypair();
  const text = canonicalize({ crv: 'Ed25519', kty: 'OKP', x: agent.jwk.x });
  const expected = Buffer.from(createHash('sha256').update(text, 'utf8').digest()).toString('base64url');
  assert.equal(jwkThumbprint(agent.jwk), expected);
});

test('tampered middle signature is refused (signature_invalid, step 2)', () => {
  const f = makeChain();
  const parts = f.t1.compact.split('.');
  const sig = Buffer.from(parts[2], 'base64url');
  sig[0] ^= 0x01;
  const tampered = `${parts[0]}.${parts[1]}.${sig.toString('base64url')}`;
  const result = verifyPedigreeChain([f.root.compact, tampered, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
  assert.equal(result.step, 2);
});

test('parent swap is refused (par_hash_mismatch, step 3)', () => {
  const f = makeChain();
  // T1* has the same agent key (so step 2 passes) but a different
  // signing input (different jti/aud), so T2's par_hash no longer
  // names the conveyed parent.
  const t1star = mintChildToken({
    parent: f.root, sign: f.agent0.sign, parentPublicJwk: f.agent0.jwk, childPublicJwk: f.agent1.jwk,
    fields: {
      client_id: 'calendar-helper-2', aud: 'https://other.example.net', jti: 'child-jti-9999',
      iat: NOW - 30, exp: NOW + 1800, grants: GRANTS_READ,
      ceiling_ref: CEILING_REF,
    },
  });
  const result = verifyPedigreeChain([f.root.compact, t1star.compact, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'par_hash_mismatch');
  assert.equal(result.step, 3);
});

test('missing ancestor is refused, never fetched (no ancestor fetch)', () => {
  const f = makeChain();
  // Convey [T_0, T_2]: T_2's header key is not the key T_0 binds, so
  // the refusal lands at step 2 — the point is the refusal, and the
  // verifier never goes to the network to complete the chain.
  const result = verifyPedigreeChain([f.root.compact, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('wrong del_depth is refused (linkage_invalid, step 3)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => { p.del_depth = 5; });
  const result = verifyPedigreeChain([f.root.compact, bad.compact, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'linkage_invalid');
  assert.equal(result.step, 3);
});

test('wrong parent_chain is refused (linkage_invalid, step 3)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => { p.parent_chain = ['not-the-root-jti']; });
  const result = verifyPedigreeChain([f.root.compact, bad.compact, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'linkage_invalid');
});

test('T_0 carrying par_hash is refused (malformed, step 1)', () => {
  const f = makeChain();
  const bad = resignToken(f.root, f.anchor, (p) => { p.par_hash = pedigreeTokenDigest(f.root.signingInput); });
  const result = verifyPedigreeChain([bad.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

test('child without par_hash is refused (malformed, step 1)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => { delete p.par_hash; });
  const result = verifyPedigreeChain([f.root.compact, bad.compact, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

test('altered principal is refused (principal_altered, step 4)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => { p.sub = 'u-9999'; });
  const result = verifyPedigreeChain(rebaseLeaf(f, bad), verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'principal_altered');
  assert.equal(result.step, 4);
});

test('altered consent chain is refused (consent_altered, step 4)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => { p.consent_chain = ['consent-other']; });
  const result = verifyPedigreeChain(rebaseLeaf(f, bad), verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'consent_altered');
});

test('widened grants are refused (scope_widened, step 5)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => {
    p.grants = [{ resource: RESOURCE, scopes: ['read', 'write', 'delete'] }];
  });
  const result = verifyPedigreeChain(rebaseLeaf(f, bad), verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'scope_widened');
  assert.equal(result.step, 5);
});

test('grantsCover: subset passes, widened scope or unknown resource fails', () => {
  assert.equal(grantsCover(GRANTS_ROOT, GRANTS_READ), true);
  assert.equal(grantsCover(GRANTS_ROOT, [{ resource: RESOURCE, scopes: ['delete'] }]), false);
  assert.equal(grantsCover(GRANTS_ROOT, [{ resource: 'https://other.example.net/x', scopes: ['read'] }]), false);
});

test('expired token is refused (expired, step 6)', () => {
  const f = makeChain();
  const result = verifyPedigreeChain(f.chain, verifyOpts(f, { nowUnixSeconds: NOW + 3601 }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'expired');
  assert.equal(result.step, 6);
});

test('child exp later than parent exp is refused (expired, invariant 8)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => { p.exp = NOW + 7200; });
  const result = verifyPedigreeChain(rebaseLeaf(f, bad), verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'expired');
});

test('root signed by an untrusted key is refused (signature_invalid)', () => {
  const f = makeChain();
  const otherAnchor = makeKeypair();
  const otherRoot = mintRootToken({
    fields: {
      iss: ISSUER, sub: PRINCIPAL, client_id: 'orchestrator-7f3a', aud: AUD,
      jti: 'root-jti-0001', iat: NOW - 60, exp: NOW + 3600,
      grants: GRANTS_ROOT, consent_chain: ['consent-91d4'], ceiling_ref: CEILING_REF,
    },
    sign: otherAnchor.sign, anchorPublicJwk: otherAnchor.jwk, agentPublicJwk: f.agent0.jwk,
  });
  const result = verifyPedigreeChain([otherRoot.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('no trust anchors configured is refused (signature_invalid)', () => {
  const f = makeChain();
  const result = verifyPedigreeChain(f.chain, { nowUnixSeconds: NOW, trustAnchors: [] });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('root issuer with no matching anchor is refused (signature_invalid)', () => {
  const f = makeChain();
  const result = verifyPedigreeChain(f.chain, verifyOpts(f, {
    trustAnchors: [{ iss: 'someone-else', key: f.anchor.jwk }],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('non-canonical encoding is refused (non_canonical, step 1)', () => {
  const f = makeChain();
  // Re-encode the payload with keys in reverse order: same object,
  // not its JCS serialization. The original signature is kept; the
  // parse step refuses before any signature work.
  const parsed = parsePedigreeToken(f.t1.compact);
  const reversed = {};
  for (const key of Object.keys(parsed.payload).reverse()) reversed[key] = parsed.payload[key];
  const parts = f.t1.compact.split('.');
  const nonCanonical = `${parts[0]}.${b64url(JSON.stringify(reversed))}.${parts[2]}`;
  const result = verifyPedigreeChain([f.root.compact, nonCanonical, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'non_canonical');
});

test('unlisted claim is refused (malformed, step 1)', () => {
  const f = makeChain();
  const bad = resignToken(f.t1, f.agent0, (p) => { p.evil = true; });
  const result = verifyPedigreeChain([f.root.compact, bad.compact, f.t2.compact], verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

test('non-absolute grant resource is refused at mint', () => {
  const f = makeChain();
  assert.throws(() => mintChildToken({
    parent: f.root, sign: f.agent0.sign, parentPublicJwk: f.agent0.jwk, childPublicJwk: f.agent1.jwk,
    fields: {
      client_id: 'calendar-helper-2', aud: AUD, jti: 'child-jti-0002',
      iat: NOW - 30, exp: NOW + 1800,
      grants: [{ resource: 'cal', scopes: ['read'] }],
      ceiling_ref: CEILING_REF,
    },
  }), /absolute URI/);
});

test('chain over the configured token bound is refused (malformed)', () => {
  const f = makeChain();
  const result = verifyPedigreeChain(f.chain, verifyOpts(f, { maxTokens: 2 }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'malformed');
});

test('ceiling: unconfigured set is recorded as not evaluated; unknown ref is refused', () => {
  const f = makeChain();
  const unconfigured = verifyPedigreeChain(f.chain, {
    trustAnchors: [{ iss: ISSUER, key: f.anchor.jwk }],
    nowUnixSeconds: NOW,
  });
  assert.equal(unconfigured.ok, true);
  assert.ok(unconfigured.notEvaluated.includes('ceiling'));
  assert.equal(unconfigured.checks.ceiling.evaluated, false);
  const unknown = verifyPedigreeChain(f.chain, verifyOpts(f, {
    acceptedCeilings: [`sha256:${'0'.repeat(64)}`],
  }));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.outcome, 'ceiling_unknown');
  assert.equal(unknown.step, 7);
});

test('audience: leaf aud must name the configured verifier (step 9)', () => {
  const f = makeChain();
  const ok = verifyPedigreeChain(f.chain, verifyOpts(f, { audience: AUD }));
  assert.equal(ok.ok, true);
  const bad = verifyPedigreeChain(f.chain, verifyOpts(f, { audience: 'https://other.example.net' }));
  assert.equal(bad.ok, false);
  assert.equal(bad.outcome, 'audience_mismatch');
});

test('verify never throws on garbage input', () => {
  const f = makeChain();
  assert.equal(verifyPedigreeChain(['not-a-token'], verifyOpts(f)).ok, false);
  assert.equal(verifyPedigreeChain([], verifyOpts(f)).ok, false);
  assert.equal(verifyPedigreeChain(null, verifyOpts(f)).ok, false);
  assert.equal(verifyPedigreeChain(f.chain, {}).ok, false);
});

test('mint refuses a child whose grants widen the parent', () => {
  const f = makeChain();
  assert.throws(() => mintChildToken({
    parent: f.root, sign: f.agent0.sign, parentPublicJwk: f.agent0.jwk, childPublicJwk: f.agent1.jwk,
    fields: {
      client_id: 'calendar-helper-2', aud: AUD, jti: 'child-jti-0002',
      iat: NOW - 30, exp: NOW + 1800,
      grants: [{ resource: RESOURCE, scopes: ['read', 'delete'] }],
      ceiling_ref: CEILING_REF,
    },
  }), /not covered/);
});

test('mint refuses a child signed by the wrong parent key', () => {
  const f = makeChain();
  const impostor = makeKeypair();
  assert.throws(() => mintChildToken({
    parent: f.root, sign: impostor.sign, parentPublicJwk: impostor.jwk, childPublicJwk: f.agent1.jwk,
    fields: {
      client_id: 'calendar-helper-2', aud: AUD, jti: 'child-jti-0002',
      iat: NOW - 30, exp: NOW + 1800, grants: GRANTS_READ,
      ceiling_ref: CEILING_REF,
    },
  }), /thumbprint does not equal parent cnf.jkt/);
});

// --- Item 2: mandate narrowing ---------------------------------------------

const MANDATE_PARENT = { format: 'cedar', policy_set: [P_READ, P_READ_RANGE30] };
const MANDATE_CHILD_SUBSET = { format: 'cedar', policy_set: [P_READ] };
const MANDATE_CHILD_REWRITTEN = { format: 'cedar', policy_set: [P_READ_RANGE7] };
const MANDATE_PARENT_FORBID = { format: 'cedar', policy_set: [P_READ, F_WRITE] };

test('syntactic subset check: dropping a permit narrows; dropping a forbid does not', () => {
  assert.equal(syntacticSubsetCheck(MANDATE_PARENT, MANDATE_CHILD_SUBSET), true);
  assert.equal(syntacticSubsetCheck(MANDATE_PARENT_FORBID, MANDATE_CHILD_SUBSET), false);
  assert.equal(syntacticSubsetCheck(MANDATE_PARENT, { format: 'cedar', policy_set: [P_READ, P_READ_RANGE30, P_READ_RANGE7] }), false);
});

test('narrowing: subset child narrows via the syntactic check', () => {
  const result = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_SUBSET, {});
  assert.deepEqual(result, { narrows: true, method: 'syntactic', outcome: null, reasons: [] });
});

test('narrowing: child that drops the parent mandate is refused', () => {
  const result = narrowMandate(MANDATE_PARENT, undefined, {});
  assert.equal(result.narrows, false);
  assert.equal(result.outcome, 'mandate_not_narrower');
});

test('narrowing: parent without a mandate, child adds one — child only', () => {
  const result = narrowMandate(undefined, MANDATE_CHILD_SUBSET, {});
  assert.deepEqual(result, { narrows: true, method: 'child-only', outcome: null, reasons: [] });
  const f = makeChain({ leafMandate: MANDATE_CHILD_SUBSET });
  assert.equal(verifyPedigreeChain(f.chain, verifyOpts(f)).ok, true);
});

test('narrowing: rewritten narrower permit fails the syntactic check and needs a proof', () => {
  const result = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN, {});
  assert.equal(result.narrows, false);
  assert.equal(result.outcome, 'mandate_not_narrower');
});

function proofArtifactFor(parentMandate, childMandate) {
  const artifact = new TextEncoder().encode(canonicalize({
    parentMandateDigest: pedigreeDigest(new TextEncoder().encode(canonicalize(parentMandate))),
    childMandateDigest: pedigreeDigest(new TextEncoder().encode(canonicalize(childMandate))),
  }));
  return artifact;
}

function testProofChecker(artifactBytes, parentMandate, childMandate) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(artifactBytes));
    return parsed.parentMandateDigest === pedigreeDigest(new TextEncoder().encode(canonicalize(parentMandate)))
      && parsed.childMandateDigest === pedigreeDigest(new TextEncoder().encode(canonicalize(childMandate)));
  } catch {
    return false;
  }
}

test('narrowing: proof with an unimplemented format is refused', () => {
  const artifact = proofArtifactFor(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN);
  const proof = { format: 'test-proof-v1', hash: pedigreeDigest(artifact) };
  const result = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN, {
    narrowingProof: proof,
    artifactFor: () => artifact,
  });
  assert.equal(result.narrows, false);
  assert.equal(result.outcome, 'mandate_not_narrower');
});

test('narrowing: implemented format but artifact unavailable is transient (input_unavailable)', () => {
  const artifact = proofArtifactFor(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN);
  const proof = { format: 'test-proof-v1', hash: pedigreeDigest(artifact) };
  const result = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN, {
    narrowingProof: proof,
    proofCheckers: { 'test-proof-v1': testProofChecker },
    artifactFor: () => null,
  });
  assert.equal(result.narrows, false);
  assert.equal(result.outcome, 'input_unavailable');
});

test('narrowing: artifact digest mismatch is refused', () => {
  const artifact = proofArtifactFor(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN);
  const proof = { format: 'test-proof-v1', hash: pedigreeDigest(new TextEncoder().encode('different-bytes')) };
  const result = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN, {
    narrowingProof: proof,
    proofCheckers: { 'test-proof-v1': testProofChecker },
    artifactFor: () => artifact,
  });
  assert.equal(result.narrows, false);
  assert.equal(result.outcome, 'mandate_not_narrower');
});

test('narrowing: verified proof narrows (method proof); a failing checker refuses', () => {
  const artifact = proofArtifactFor(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN);
  const proof = { format: 'test-proof-v1', hash: pedigreeDigest(artifact) };
  const ok = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN, {
    narrowingProof: proof,
    proofCheckers: { 'test-proof-v1': testProofChecker },
    artifactFor: () => artifact,
  });
  assert.deepEqual(ok, { narrows: true, method: 'proof', outcome: null, reasons: [] });
  const refused = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN, {
    narrowingProof: proof,
    proofCheckers: { 'test-proof-v1': () => false },
    artifactFor: () => artifact,
  });
  assert.equal(refused.narrows, false);
  assert.equal(refused.outcome, 'mandate_not_narrower');
});

test('narrowing: full chain with a proof-backed rewritten mandate verifies', () => {
  const artifact = proofArtifactFor(MANDATE_PARENT, MANDATE_CHILD_REWRITTEN);
  const proof = { format: 'test-proof-v1', hash: pedigreeDigest(artifact) };
  const proofOpts = {
    proofCheckers: { 'test-proof-v1': testProofChecker },
    artifactFor: () => artifact,
  };
  const f = makeChain({ rootMandate: MANDATE_PARENT, childMandate: MANDATE_CHILD_REWRITTEN, childProof: proof, leafMandate: MANDATE_CHILD_REWRITTEN, proofOpts });
  const result = verifyPedigreeChain(f.chain, verifyOpts(f, proofOpts));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'verified');
});

test('narrowing: safety-critical mandate demands a verified proof even when syntactic passes', () => {
  const syntacticOnly = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_SUBSET, { requireNarrowingProof: true });
  assert.equal(syntacticOnly.narrows, false);
  assert.equal(syntacticOnly.outcome, 'mandate_not_narrower');
  const artifact = proofArtifactFor(MANDATE_PARENT, MANDATE_CHILD_SUBSET);
  const proof = { format: 'test-proof-v1', hash: pedigreeDigest(artifact) };
  const withProof = narrowMandate(MANDATE_PARENT, MANDATE_CHILD_SUBSET, {
    requireNarrowingProof: true,
    narrowingProof: proof,
    proofCheckers: { 'test-proof-v1': testProofChecker },
    artifactFor: () => artifact,
  });
  assert.equal(withProof.narrows, true);
  assert.equal(withProof.method, 'proof');
});

test('mandate validity: non-cedar format, template slot, and empty set are invalid', () => {
  assert.equal(validateMandate({ format: 'rego', policy_set: [P_READ] }, {}).ok, false);
  assert.equal(validateMandate({ format: 'cedar', policy_set: ['permit(?principal, action == Pedigree::Action::"read");'] }, {}).ok, false);
  assert.equal(validateMandate({ format: 'cedar', policy_set: [] }, {}).ok, false);
  assert.equal(validateMandate({ format: 'cedar', policy_set: [P_READ] }, {}).ok, true);
  assert.equal(validateMandate({ format: 'cedar', policy_set: [P_READ] }, {}).validity, 'shape-only');
});

test('mandate validity: a supplied Cedar validator is authoritative', () => {
  const oddPolicy = 'not-a-cedar-policy';
  assert.equal(validateMandate({ format: 'cedar', policy_set: [oddPolicy] }, {}).ok, false);
  const validated = validateMandate({ format: 'cedar', policy_set: [oddPolicy] }, { cedarValidator: () => true });
  assert.equal(validated.ok, true);
  assert.equal(validated.validity, 'validator');
  const rejected = validateMandate({ format: 'cedar', policy_set: [P_READ] }, { cedarValidator: () => false });
  assert.equal(rejected.ok, false);
});

// --- Item 3: signed completion blocks --------------------------------------

const RESULT = new TextEncoder().encode('{"outcome":"read 7 events"}');
const TIMESTAMP = '2026-11-20T22:30:00Z';

function makeBlock(f, overrides = {}) {
  return mintCompletionBlock({
    token: f.t2,
    sign: f.agent2.sign,
    signerPublicJwk: f.agent2.jwk,
    fields: {
      jti: 'completion-0001',
      status: 'completed',
      resultBytes: RESULT,
      verification_status: 'self_reported',
      timestamp: TIMESTAMP,
      ...overrides,
    },
  });
}

test('completion block mints and verifies; the caveat is always present', () => {
  const f = makeChain();
  const block = makeBlock(f);
  assert.equal(block.payload.token_hash, pedigreeTokenDigest(f.t2.signingInput));
  assert.equal(block.payload.result_hash, pedigreeDigest(RESULT));
  assert.equal(block.payload.signing_agent, 'calendar-helper-3');
  const result = verifyCompletionBlock(block.compact, f.chain, RESULT, verifyOpts(f));
  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'verified');
  assert.equal(result.caveat, COMPLETION_CAVEAT);
  assert.equal(result.evidenceOfCheck, false);
  assert.equal(result.verification_status, 'self_reported');
  assert.equal(result.token.jti, 'leaf-jti-0003');
});

test('completion block: result_hash mismatch is refused', () => {
  const f = makeChain();
  const block = makeBlock(f);
  const other = new TextEncoder().encode('{"outcome":"read 8 events"}');
  const result = verifyCompletionBlock(block.compact, f.chain, other, verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'completion_result_mismatch');
});

test('completion block: token not in the conveyed chain is unbound', () => {
  const f = makeChain();
  const block = makeBlock(f);
  const result = verifyCompletionBlock(block.compact, [f.root.compact, f.t1.compact], RESULT, verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'completion_unbound');
});

test('completion block: tampered signature is refused', () => {
  const f = makeChain();
  const block = makeBlock(f);
  const parts = block.compact.split('.');
  const sig = Buffer.from(parts[2], 'base64url');
  sig[63] ^= 0x01;
  const tampered = `${parts[0]}.${parts[1]}.${sig.toString('base64url')}`;
  const result = verifyCompletionBlock(tampered, f.chain, RESULT, verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'signature_invalid');
});

test('completion block: signing_agent mismatch is unbound', () => {
  const f = makeChain();
  const block = makeBlock(f);
  const header = { ...block.header };
  const payload = { ...block.payload, signing_agent: 'someone-else' };
  const { ascii, bytes } = pedigreeSigningInput(header, payload);
  const signature = f.agent2.sign(bytes);
  const forged = `${b64url(pedigreeCanonicalText(header))}.${b64url(pedigreeCanonicalText(payload))}.${Buffer.from(signature).toString('base64url')}`;
  void ascii;
  const result = verifyCompletionBlock(forged, f.chain, RESULT, verifyOpts(f));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'completion_unbound');
});

test('completion block: mint refuses a signer who is not the bound agent', () => {
  const f = makeChain();
  const impostor = makeKeypair();
  assert.throws(() => mintCompletionBlock({
    token: f.t2, sign: impostor.sign, signerPublicJwk: impostor.jwk,
    fields: { jti: 'completion-0001', status: 'completed', resultBytes: RESULT, verification_status: 'self_reported', timestamp: TIMESTAMP },
  }), /thumbprint does not equal the token cnf.jkt/);
});

test('completion block: failed and partial statuses verify; bad status refuses at mint', () => {
  const f = makeChain();
  for (const status of ['failed', 'partial']) {
    const block = makeBlock(f, { status, jti: `completion-${status}` });
    assert.equal(verifyCompletionBlock(block.compact, f.chain, RESULT, verifyOpts(f)).ok, true);
  }
  assert.throws(() => makeBlock(f, { status: 'done' }), /status must be one of/);
});

test('completion block: tool_verified is an assertion, never evidence a check took place', () => {
  const f = makeChain();
  const block = makeBlock(f, { verification_status: 'tool_verified', jti: 'completion-tool' });
  const result = verifyCompletionBlock(block.compact, f.chain, RESULT, verifyOpts(f));
  assert.equal(result.ok, true);
  assert.equal(result.verification_status, 'tool_verified');
  assert.equal(result.evidenceOfCheck, false);
  assert.ok(result.caveat.includes('NOT evidence'));
});

test('completion block: mint refuses a negative cost and a bad timestamp', () => {
  const f = makeChain();
  assert.throws(() => makeBlock(f, { cost_cents: -1 }), /cost_cents/);
  assert.throws(() => makeBlock(f, { timestamp: 'not-a-time' }), /RFC 3339/);
});

test('completion block: a block for an unverified chain passes the chain outcome through', () => {
  const f = makeChain();
  const block = makeBlock(f);
  const result = verifyCompletionBlock(block.compact, f.chain, RESULT, verifyOpts(f, { nowUnixSeconds: NOW + 3601 }));
  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'expired');
});

test('completionBlockRequired follows the token completion_bindable flag', () => {
  const f = makeChain();
  assert.equal(completionBlockRequired(f.t2.payload), false);
  const anchor = makeKeypair();
  const agent0 = makeKeypair();
  const root = mintRootToken({
    fields: {
      iss: ISSUER, sub: PRINCIPAL, client_id: 'orchestrator-7f3a', aud: AUD,
      jti: 'root-jti-0001', iat: NOW - 60, exp: NOW + 3600,
      grants: GRANTS_ROOT, consent_chain: ['consent-91d4'], ceiling_ref: CEILING_REF,
      completion_bindable: true,
    },
    sign: anchor.sign, anchorPublicJwk: anchor.jwk, agentPublicJwk: agent0.jwk,
  });
  assert.equal(completionBlockRequired(root.payload), true);
});
