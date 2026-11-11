import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pinRel = 'docs/otter-rafting-singularity-protocol.md';
const read = rel => readFileSync(path.join(root, rel), 'utf8');
const motto = 'Like otters holding hands so they dont drift apart while resting, every agent stays connected without losing its independence. One identity. One purpose. Many coordinated agents. Singularity confirmed. NUMINA aligned.';

function body(text) {
  const source = text.replace(/^\uFEFF/, '');
  const front = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  return front ? source.slice(front[0].length) : source;
}

function firstContentLine(text) {
  return body(text).split(/\r?\n/).find(line => line.trim().length > 0) || '';
}

const entryPoints = [
  'AGENTS.md',
  'README.md',
  'GEMINI.md',
  '.cursor/rules/otter-singularity-pin.mdc',
  '.agents/rules/numina-zero-trust-contract.md',
  '.agents/rules/mesh-router-architecture.md'
];

test('the pin quotes existing protocol text and leaves missing names as placeholders', () => {
  const pin = read(pinRel);
  assert.match(pin, /^# Otter Rafting Protocol \/ Singularity Protocol\r?\n/);
  assert.match(pin, /This file is the topmost layer\. It is the first thing read each day\./);
  assert.match(pin, /PLACEHOLDER: repository text that uses the name "Otter Rafting Protocol"/);
  assert.match(pin, /PLACEHOLDER: repository text that uses "Singularity Protocol" as its own name/);
  assert.match(pin, /PLACEHOLDER: the source document outside this repository/);
  assert.match(pin, /PLACEHOLDER: source text that places the Otter Rafting Protocol and the Singularity Protocol above Stripe checkout/);
  assert.ok(pin.includes(motto));
  assert.ok(pin.includes('ALL agent definition files across all workspaces must embody the Otter-Raft Singularity Protocol.'));
  assert.ok(pin.includes('Anti-Drift Handshake: Inter-agent communications maintain continuous cryptographic consensus; any state divergence triggers fail-closed quarantine.'));
  assert.equal(read('AGENTS.md').includes(motto), true);
  assert.equal(read('numina-agent-swarm/src/swarm-dispatcher.mjs').includes(motto), true);
});

test('first-read entry points keep the pin pointer at the top', () => {
  for (const rel of entryPoints) {
    const text = read(rel);
    const line = firstContentLine(text);
    assert.match(line, /^\*\*OTTER-PIN-FIRST-READ:\*\*/, rel);
    const link = line.match(/\(([^)]+)\)/)?.[1];
    assert.ok(link, rel);
    assert.equal(path.normalize(path.resolve(path.dirname(path.join(root, rel)), link)), path.normalize(path.join(root, pinRel)), rel);
    assert.match(line, /topmost layer/, rel);
  }
  const cursor = read('.cursor/rules/otter-singularity-pin.mdc');
  assert.match(cursor, /^---\r?\n[\s\S]*?\balwaysApply:\s*true\b/);
  for (const rel of ['.agents/rules/numina-zero-trust-contract.md', '.agents/rules/mesh-router-architecture.md']) {
    assert.match(read(rel), /^---\r?\n[\s\S]*?\balways_on:\s*true\b/, rel);
  }
  assert.match(read('AGENTS.md'), /\*\*OTTER-PIN-FIRST-READ:\*\*[\s\S]*\r?\n# Universal Agent Operational Contract & Governance Specification\r?\n/);
  assert.match(read('README.md'), /\*\*OTTER-PIN-FIRST-READ:\*\*[\s\S]*\r?\n# NUMINA\r?\n/);
  assert.match(read('GEMINI.md'), /\*\*OTTER-PIN-FIRST-READ:\*\*[\s\S]*\r?\n# Universal Agent Operational Contract & Governance Specification \(GEMINI Delivery\)\r?\n/);
});
