import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {answerQuestion} from '../public/support-faq-engine.js';

const knowledge = JSON.parse(readFileSync(new URL('../public/support-faq.json', import.meta.url)));
const source = readFileSync(new URL('../public/support-chat.js', import.meta.url), 'utf8')
  .replace(/^import \{answerQuestion\} from '\/support-faq-engine\.js';\r?\n/, '');
const settled = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const response = (data = knowledge) => ({ok: true, json: async () => structuredClone(data)});

// Minimal DOM/event harness for the actual browser module. This checks state and
// rendering sinks; full browser tests remain responsible for layout and native focus.
function harness(load = () => Promise.resolve(response())) {
  const requests = [], timers = new Map(), htmlWrites = [], elements = [];
  let timerId = 0;
  const document = {activeElement: null};
  class Element {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attributes = new Map();
      this.listeners = new Map();
      this.selectors = new Map();
      this._text = '';
      this.value = '';
      this.hidden = false;
      this.open = false;
      this.focusCalls = 0;
      elements.push(this);
    }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) {
      htmlWrites.push({element: this, value});
      this.replaceChildren();
      if (this.tagName !== 'dialog') return;
      for (const [selector, tag] of [
        ['.support-chat-log', 'div'], ['.support-chat-status', 'p'], ['input', 'input'],
        ['.support-chat-retry', 'button'], ['.support-chat-topics', 'div'],
        ['.support-chat-close', 'button'], ['form', 'form'], ['.support-chat-clear', 'button']
      ]) {
        const node = new Element(tag);
        node.hidden = selector === '.support-chat-retry';
        this.selectors.set(selector, node);
        this.append(node);
      }
    }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) {
      for (const node of this.children) node.parent = null;
      this.children = [];
      this.append(...nodes);
    }
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
    get childElementCount() { return this.children.length; }
    get firstElementChild() { return this.children[0]; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name); }
    querySelector(selector) { return this.selectors.get(selector) ?? null; }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    emit(name, event = {}) { return Promise.all((this.listeners.get(name) ?? []).map(fn => fn(event))); }
    click() { this.focus(); return this.emit('click'); }
    focus() { document.activeElement = this; this.focusCalls++; }
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { this.open = false; return this.emit('close'); }
  }
  document.body = new Element('body');
  document.createElement = tag => new Element(tag);
  document.querySelector = selector => document.body.children.find(node => `#${node.id}` === selector) ?? null;
  const forbidden = () => { throw Error('Support chat must not store or transmit questions'); };
  const context = vm.createContext({
    document, location: {origin: 'https://numinalabs.xyz'}, answerQuestion, URL, AbortController,
    localStorage: {setItem: forbidden}, sessionStorage: {setItem: forbidden},
    navigator: {sendBeacon: forbidden},
    setTimeout(fn, delay) { timers.set(++timerId, {fn, delay}); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { requests.push({url, options}); return load(url, options, requests.length); }
  });
  vm.runInContext(source, context, {filename: 'support-chat.js'});
  const [launcher, dialog] = document.body.children;
  const get = selector => dialog.querySelector(selector);
  return {
    document, launcher, dialog, requests, timers, htmlWrites, elements, get,
    input: get('input'), log: get('.support-chat-log'), status: get('.support-chat-status'),
    retry: get('.support-chat-retry'), topics: get('.support-chat-topics'),
    open: () => launcher.click(), close: () => get('.support-chat-close').click(),
    clear: () => get('.support-chat-clear').click(),
    submit(question) {
      get('input').value = question;
      let prevented = false;
      get('form').emit('submit', {preventDefault() { prevented = true; }});
      assert.equal(prevented, true, 'Form must never submit the question to the server');
    }
  };
}

test('clear discards delayed answers and erases an unsent question', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  await h.open();
  h.submit('How much does it cost?');
  h.input.value = 'Private unsent draft';
  await h.clear();
  assert.equal(h.input.value, '');
  assert.equal(h.log.childElementCount, 1);
  const cleared = h.log.textContent;
  pending.resolve(response());
  await settled();
  assert.equal(h.log.textContent, cleared);
  assert.doesNotMatch(h.log.textContent, /Private unsent draft|\$5,000/);
  assert.equal(h.timers.size, 0);
  h.submit('How do I install the web app?');
  await settled();
  assert.match(h.log.textContent, /Add to Home Screen/);
  assert.equal(h.requests.length, 1, 'Answers stay local after knowledge is loaded');
});

test('a cleared failure cannot append a stale fallback message', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  await h.open();
  h.submit('Pricing');
  await h.clear();
  const cleared = h.log.textContent;
  pending.reject(Error('Synthetic load failure'));
  await settled();
  assert.equal(h.log.textContent, cleared);
  assert.equal(h.retry.hidden, false);
  assert.equal(h.timers.size, 0);
});

test('failed knowledge load exposes retry and a successful retry restores answers', async () => {
  const h = harness((_url, _options, count) => count === 1
    ? Promise.resolve({ok: false}) : Promise.resolve(response()));
  await h.open();
  await settled();
  assert.match(h.status.textContent, /unavailable/);
  assert.equal(h.retry.hidden, false);
  assert.equal(h.topics.childElementCount, 0);
  await h.retry.click();
  await settled();
  assert.equal(h.requests.length, 2);
  assert.equal(h.retry.hidden, true);
  assert.equal(h.topics.childElementCount, knowledge.faq.length);
  assert.equal(h.timers.size, 0);
  h.submit('What do the diagnostic and audit cost?');
  await settled();
  assert.match(h.log.textContent, /\$5,000 USD/);
  assert.equal(h.requests.length, 2);
});

test('knowledge requests time out after ten seconds without transmitting the question', async () => {
  const h = harness((_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
  }));
  await h.open();
  const question = 'Synthetic private query: do not transmit this';
  h.submit(question);
  assert.equal(h.requests.length, 1);
  const {url, options} = h.requests[0];
  assert.equal(url, '/support-faq.json');
  assert.deepEqual(Object.keys(options).sort(), ['cache', 'credentials', 'redirect', 'signal']);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-cache');
  assert.equal(options.redirect, 'error');
  assert.equal(options.signal.aborted, false);
  assert.equal(JSON.stringify(h.requests).includes(question), false);
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 10000);
  timer.fn();
  await settled();
  assert.equal(options.signal.aborted, true);
  assert.equal(h.retry.hidden, false);
  assert.match(h.status.textContent, /unavailable/);
  assert.match(h.log.textContent, /cannot load the reviewed answers/);
  assert.equal(h.timers.size, 0);
  assert.equal(h.requests.length, 1);
});

test('closing while an answer is loading preserves launcher focus after completion', async () => {
  const pending = deferred(), h = harness(() => pending.promise);
  await h.open();
  h.submit('Pricing');
  await h.close();
  assert.equal(h.dialog.open, false);
  assert.equal(h.launcher.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(h.document.activeElement, h.launcher);
  const focusCalls = h.input.focusCalls;
  pending.resolve(response());
  await settled();
  assert.equal(h.input.focusCalls, focusCalls);
  assert.strictEqual(h.document.activeElement, h.launcher);
  assert.equal(h.timers.size, 0);
});

test('visitor text, topic text and FAQ answers use text rendering rather than HTML', async () => {
  const payload = '<img src=x onerror=alert(1)>', data = structuredClone(knowledge);
  data.faq.find(entry => entry.id === 'assessment-cost').answer = `Literal answer: ${payload}`;
  data.faq.find(entry => entry.id === 'assessment-cost').question = `Pricing ${payload}`;
  const h = harness(() => Promise.resolve(response(data)));
  await h.open();
  await settled();
  h.submit(`Pricing ${payload}`);
  await settled();
  const messages = h.log.children.slice(-2);
  assert.equal(messages[0].children[1].textContent, `Pricing ${payload}`);
  assert.equal(messages[1].children[1].textContent, `Literal answer: ${payload}`);
  assert.ok(h.topics.children.some(button => button.textContent === `Pricing ${payload}`));
  assert.equal(h.htmlWrites.length, 1, 'Only the fixed dialog scaffold may use innerHTML');
  assert.doesNotMatch(h.htmlWrites[0].value, /<img/);
  assert.equal(h.elements.some(element => element.tagName === 'img'), false);
  assert.equal(h.requests.length, 1);
});

test('malformed or external-source knowledge fails closed and offers retry', async () => {
  for (const data of [{schema: 'unexpected', faq: []}, {
    ...knowledge, faq: [{id: 'assessment-cost', question: 'Pricing', answer: 'Unreviewed',
      source: ['https://untrusted.example/']}]
  }]) {
    const h = harness(() => Promise.resolve(response(data)));
    await h.open();
    await settled();
    assert.equal(h.retry.hidden, false);
    assert.equal(h.topics.childElementCount, 0);
    assert.doesNotMatch(h.log.textContent, /Unreviewed/);
    assert.equal(h.timers.size, 0);
  }
});
