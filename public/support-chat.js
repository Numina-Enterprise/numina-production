import {answerQuestion} from '/support-faq-engine.js';

if (!document.querySelector('#numina-support-launcher')) {
  const launcher = document.createElement('button');
  launcher.id = 'numina-support-launcher';
  launcher.className = 'support-chat-launcher';
  launcher.type = 'button';
  launcher.textContent = 'Help & FAQ';
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-controls', 'numina-support-chat');
  launcher.setAttribute('aria-expanded', 'false');
  const dialog = document.createElement('dialog');
  dialog.id = 'numina-support-chat';
  dialog.className = 'support-chat';
  dialog.setAttribute('aria-labelledby', 'support-chat-title');
  dialog.setAttribute('aria-describedby', 'support-chat-description');
  dialog.innerHTML = `<header class="support-chat-header"><div><h2 id="support-chat-title">Numina help</h2><p id="support-chat-description">Published-information FAQ · automated answers</p></div><button type="button" class="support-chat-close" aria-label="Close support chat">Close</button></header><div class="support-chat-body"><p class="support-chat-privacy">Your questions stay in this page and are not sent to a model or saved as a support ticket. Keep passwords, payment details and confidential data out of chat.</p><div class="support-chat-topics" aria-label="Common support topics"></div><div class="support-chat-log" role="log" aria-live="polite" aria-relevant="additions" aria-label="Support conversation"></div><p class="support-chat-status" role="status"></p><button type="button" class="support-chat-retry" hidden>Retry loading answers</button></div><form class="support-chat-form" role="search" aria-label="Search published FAQs"><label for="support-chat-question">Search published FAQs</label><div class="support-chat-input-row"><input id="support-chat-question" name="question" type="search" maxlength="600" autocomplete="off" placeholder="Pricing, requests, installation or privacy" required><button type="submit">Search</button></div></form><footer class="support-chat-footer"><a href="mailto:skott34@numinalabs.xyz?subject=Numina%20support%20request">Email a person</a><a href="/contact#support">Contact details</a><button type="button" class="support-chat-clear">Clear chat</button></footer>`;
  document.body.append(launcher, dialog);
  const log = dialog.querySelector('.support-chat-log');
  const status = dialog.querySelector('.support-chat-status');
  const input = dialog.querySelector('input');
  const retry = dialog.querySelector('.support-chat-retry');
  const topics = dialog.querySelector('.support-chat-topics');
  let knowledge;
  let loading;
  let conversationVersion = 0;
  function message(text, role, sources = []) {
    const item = document.createElement('article');
    item.className = `support-chat-message support-chat-${role}`;
    const label = document.createElement('strong');
    label.textContent = role === 'visitor' ? 'You' : 'FAQ assistant';
    const content = document.createElement('p');
    content.textContent = text;
    item.append(label, content);
    if (sources.length) {
      const links = document.createElement('div');
      links.className = 'support-chat-sources';
      links.setAttribute('aria-label', 'Answer sources');
      const seen = new Set();
      for (const source of sources) {
        const url = new URL(source.url, location.origin);
        if (url.origin !== location.origin || seen.has(url.href)) continue;
        seen.add(url.href);
        const link = document.createElement('a');
        link.href = url.pathname + url.hash;
        link.textContent = source.title;
        links.append(link);
      }
      item.append(links);
    }
    log.append(item);
    while (log.childElementCount > 30) log.firstElementChild.remove();
    item.scrollIntoView({block:'nearest',behavior:'instant'});
  }
  function greet() {
    message('Hello. Search published information about pricing, requests, installation, international inquiries or privacy. For account-specific help, use “Email a person”.', 'assistant');
  }
  async function loadKnowledge() {
    if (knowledge || loading) return loading;
    status.textContent = 'Loading reviewed answers…';
    retry.hidden = true;
    loading = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch('/support-faq.json', {credentials:'omit',cache:'no-cache',redirect:'error',signal:controller.signal});
        if (!response.ok) throw new Error('Unavailable');
        const data = await response.json();
        if (data.schema !== 'numina.support-faq.v1' || !Array.isArray(data.faq) || !data.faq.length || !data.faq.every(entry => typeof entry.id === 'string' && typeof entry.question === 'string' && typeof entry.answer === 'string' && Array.isArray(entry.source) && entry.source.length && entry.source.every(source => typeof source === 'string' && source.startsWith('https://numinalabs.xyz/')))) throw new Error('Invalid answers');
        knowledge = data;
        status.textContent = `Public answers reviewed ${data.reviewedAt}. Human response times follow your engagement terms.`;
        topics.replaceChildren();
        for (const faq of data.faq) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = faq.question;
          button.addEventListener('click', () => ask(faq.question));
          topics.append(button);
        }
      } catch {
        status.textContent = 'Reviewed answers are unavailable right now. Use “Email a person” or contact details for help.';
        retry.hidden = false;
      } finally { clearTimeout(timeout); loading = null; }
    })();
    return loading;
  }
  async function ask(question) {
    const text = question.trim().slice(0,600);
    if (!text) return;
    const version = conversationVersion;
    message(text, 'visitor');
    input.value = '';
    await loadKnowledge();
    if (version !== conversationVersion) return;
    if (!knowledge) message('I cannot load the reviewed answers right now. Email skott34@numinalabs.xyz for help.', 'assistant');
    else {
      const result = answerQuestion(text, knowledge);
      message(result.answer, 'assistant', result.sources);
    }
    if (dialog.open) input.focus();
  }
  launcher.addEventListener('click', () => {
    dialog.showModal();
    launcher.setAttribute('aria-expanded', 'true');
    if (!log.childElementCount) greet();
    loadKnowledge();
    input.focus();
  });
  dialog.querySelector('.support-chat-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {launcher.setAttribute('aria-expanded','false');launcher.focus();});
  dialog.querySelector('form').addEventListener('submit', event => {event.preventDefault();ask(input.value);});
  retry.addEventListener('click', loadKnowledge);
  dialog.querySelector('.support-chat-clear').addEventListener('click', () => {conversationVersion++;input.value='';log.replaceChildren();greet();input.focus();});
}
