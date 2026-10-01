import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {NUMINA_LAYERS} from '../public/architecture-layers.js';
import {PUBLIC_LAYER_LABELS} from '../public/architecture-labels.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url));
const assets = ['architecture-labels.js', 'contact-support.css', 'support-chat.css', 'support-chat.js', 'support-faq-engine.js', 'support-faq.json'];
const knowledge = JSON.parse(read('public/support-faq.json'));

test('support assets ship byte-for-byte in the verified distribution inventory', () => {
  const release = JSON.parse(read('dist/client/downloads/application-release-v4.json'));
  for (const file of [...assets, 'contact.html', 'index.html', 'app.html', 'frontier-ui.js']) {
    const source = read('public/' + file), built = read('dist/client/' + file);
    assert.deepEqual(built, source, file);
    const artifact = release.artifacts.find(entry => entry.path === 'client/' + file);
    assert.equal(artifact?.sha256, createHash('sha256').update(built).digest('hex'), file);
  }
});

test('both entry pages load support assets and all nine FAQs also work without scripts', () => {
  for (const page of ['index.html', 'contact.html']) {
    const html = read('public/' + page).toString();
    assert.match(html, /<script type="module" src="\/support-chat\.js"><\/script>/);
    assert.match(html, /<link rel="stylesheet" href="\/support-chat\.css">/);
  }
  const contact = read('public/contact.html').toString().replaceAll('&amp;', '&');
  for (const faq of knowledge.faq) {
    assert.ok(contact.includes('id="faq-' + faq.id + '"'), faq.id);
    assert.ok(contact.includes(faq.question), faq.id + ' question');
    assert.ok(contact.includes(faq.answer), faq.id + ' answer');
  }
  assert.match(read('public/app.html').toString(), /<h1>One core\.<br>One connected workspace\.<\/h1>/);
});

test('descriptive public labels cover canonical layers without replacing their identities', () => {
  assert.deepEqual(Object.keys(PUBLIC_LAYER_LABELS), NUMINA_LAYERS.layers.map(layer => layer.id));
  assert.equal(new Set(Object.values(PUBLIC_LAYER_LABELS).map(layer => layer.title)).size, 5);
  for (const layer of NUMINA_LAYERS.layers) {
    assert.equal(layer.name, 'NUMINA');
    assert.deepEqual(layer.capabilities, ['NUMINA']);
    assert.ok(PUBLIC_LAYER_LABELS[layer.id].description.length > 20);
  }
});
