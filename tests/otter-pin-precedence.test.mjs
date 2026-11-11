import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const pinRel = 'docs/otter-rafting-singularity-protocol.md';
const read = rel => readFileSync(path.join(root, rel), 'utf8');
const protocolBodySha256 = '5146df237edaa9507612ad4ce001391bc91072ebecb3b7eefd304173cb1090f0';

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

function protocolBody(text) {
  const source = text.replace(/\r\n/g, '\n');
  const marker = '<!-- protocol-body -->\n';
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, 'protocol body marker');
  return source.slice(at + marker.length);
}

const protocolBodyText = `Like otters holding hands, every agent stays connected without losing its independence.

That\u2019s the idea behind Singularity, the coordination model I\u2019m developing at Numina Labs.

As AI agents work together, each needs to retain its own identity, authority, and accountability. Shared work should leave evidence that others can independently check.

Our design brings these principles together:

- Independent identity: each agent remains identifiable, with defined permissions.
- Ed25519 verification: digital signatures help verify who signed specific data and whether it changed. Authorization still requires separate checks.
- Evidence and provenance: claims stay connected to their supporting records.
- Zero Trust: participation alone never grants authority.
- Multi-signature governance: decisions require the independent approvals defined by policy.

The proposed Singularity Task Envelope organizes coordination around six components: identity, topology, task, evidence, signatures, and protocol versioning. In everyday terms: who is involved, how they connect, what they are doing, and what can be verified.

This application-level design is separate from our published pair-binding Internet-Draft, which proposes associating two fixed software-artifact commitments with attribution and revisioned claims.

Both are work in progress. The task-envelope design and operational multi-signature enforcement still require implementation and verification. The Internet-Draft is a proposal, without IETF endorsement.

The goal is simple: agents that can cooperate while preserving independent identity and verifiable accountability.
`;

test('the pin body matches the authoritative Singularity Coordination Model text and its SHA-256', () => {
  const pin = read(pinRel).replace(/\r\n/g, '\n');
  assert.match(pin, /^# Singularity Coordination Model\n/);
  assert.match(pin, /\*\*First read\.\*\* This pin is the topmost layer\. It is the first thing read each day\./);
  assert.match(pin, /\*\*Purpose\.\*\* Authoritative statement of the Singularity Coordination Model, also called the Otter Rafting Protocol \/ Singularity Protocol\./);
  const recorded = pin.match(/\*\*Protocol body SHA-256:\*\* `([a-f0-9]{64})`/)?.[1];
  const digest = createHash('sha256').update(protocolBody(pin)).digest('hex');
  assert.equal(protocolBody(pin), protocolBodyText);
  assert.equal(digest, protocolBodySha256);
  assert.equal(recorded, protocolBodySha256);
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
