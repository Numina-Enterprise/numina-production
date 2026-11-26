import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tree = JSON.parse(readFileSync(new URL('../config/numina-module-tree.v1.json', import.meta.url), 'utf8'));
const MATURITY = new Set(['LEGACY','ALPHA','BETA','STABLE']);
const AUDIENCE = new Set(['INTERNAL','DEVELOPER','PRIVATE','PUBLIC']);
const DEPLOYMENT = new Set(['NOT_DEPLOYED','STAGING','PRODUCTION']);
const ACCEPTANCE = new Set(['NOT_RUN','BLOCKED','PASS','FAIL','INCONCLUSIVE','RELEASE_HOLD']);

function validate(registry) {
  assert.equal(registry.schema, 'numina.module-tree.v1');
  const byId = new Map();
  for (const m of registry.modules) {
    assert.equal(typeof m.id, 'string');
    assert.ok(!byId.has(m.id), 'duplicate module: ' + m.id);
    assert.ok(MATURITY.has(m.maturity), 'invalid maturity: ' + m.id);
    assert.ok(AUDIENCE.has(m.audience), 'invalid audience: ' + m.id);
    assert.ok(DEPLOYMENT.has(m.deployment), 'invalid deployment: ' + m.id);
    assert.ok(ACCEPTANCE.has(m.acceptance), 'invalid acceptance: ' + m.id);
    byId.set(m.id, m);
  }
  assert.equal(registry.root_id, 'numina.neural-network');
  assert.equal(byId.get(registry.root_id)?.parent_id, null);
  assert.equal([...byId.values()].filter(m => m.parent_id === null).length, 1);
  for (const m of byId.values()) {
    const seen = new Set();
    let cur = m;
    while (cur.parent_id !== null) {
      assert.ok(!seen.has(cur.id), 'cycle: ' + m.id);
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
      assert.ok(cur, 'orphan: ' + m.id);
    }
    assert.equal(cur.id, registry.root_id);
  }
  assert.equal(byId.get('numina.llm')?.parent_id, registry.root_id);
  assert.equal(byId.get('numina.treasury')?.parent_id, registry.root_id);
  const required = registry.required_release_evidence;
  assert.equal(new Set(required).size, required.length);
  for (const key of ['licensed_weights','gguf_sha256','llama_cpp_binary_sha256','actual_generation_receipt','acceptance_fixtures','ci_receipts','independent_review','authorized_signatures']) assert.ok(required.includes(key));
  const complete = required.every(key => {
    const e = registry.release_evidence?.[key];
    return e?.status === 'PASS' && typeof e?.ref === 'string' && e.ref.length > 0;
  });
  if (!complete) assert.equal(registry.release_disposition, 'RELEASE_HOLD');
  return complete;
}

test('one singular root and all modules under it', () => {
  assert.equal(validate(tree), false);
});
test('missing inference evidence cannot be accepted', () => {
  assert.throws(() => validate({ ...tree, release_disposition: 'PASS' }), /RELEASE_HOLD/);
});
test('registered modules cannot silently pass', () => {
  const altered = structuredClone(tree);
  altered.modules.find(m => m.id === 'numina.llm').acceptance = 'UNVERIFIED_PASS';
  assert.throws(() => validate(altered), /invalid acceptance/);
});
test('cycles and orphans are rejected', () => {
  const altered = structuredClone(tree);
  altered.modules.find(m => m.id === 'numina.llm').parent_id = 'numina.llm';
  assert.throws(() => validate(altered), /cycle/);
});
