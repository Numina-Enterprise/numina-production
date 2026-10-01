// Deterministic public-FAQ retrieval. This module has no model, account or network access.
export const SUPPORT_MODE = 'AUTOMATED_FAQ';
const patterns = [
  ['delete-account', /\b(delete|deletion|erase|remove)\b.*\b(account|data|records?)\b|\baccount\b.*\b(delete|deletion|erase|remove)\b/],
  ['security-report', /\b(security|vulnerability|breach|incident|hacked)\b/],
  ['store-status', /\b(app store|app stores|google play|play store|store listing|microsoft store|amazon store|samsung store)\b/],
  ['installation', /\b(install|installation|iphone|ipad|add to home screen|web app|pwa)\b/],
  ['safe-sharing', /\b(password|credentials?|api key|secret|confidential|sensitive|personal data|datasets?)\b|\b(share|include|send)\b.*\b(information|brief|inquiry)\b|\binformation\b.*\bshare\b/],
  ['international', /\b(international|outside (the )?(us|usa|united states)|other countries|country|countries|non.us|uk|europe|canada|india|australia)\b/],
  ['request-and-payment', /\b(refund|book|booking|booked|scheduling|schedule|payment|pay|acceptance|submit\w*|submission|checkout|charged)\b/],
  ['assessment-cost', /\b(price|prices|pricing|cost|costs|fee|fees|how much|diagnostic|audit)\b/],
  ['request-help', /\b(existing request|track|tracking|delivery|status|support|help|contact|human|person|operator|email|phone|call|hours|response time)\b/]
];
export function answerQuestion(input, knowledge) {
  const text = String(input ?? '').trim().slice(0, 600);
  const normalized = text.normalize('NFKC').toLowerCase().replace(/[’']/g, '');
  const fallback = {kind:'escalate',answer:'I do not have a reviewed answer for that question. Email Numina for help; include a high-level description and your request reference, if you have one. Do not include passwords, API keys or payment-card details.',sources:[{title:'Contact & support',url:'/contact#support'}]};
  if (!text) return {kind:'empty',answer:'Choose a topic or enter a question about Numina services, requests or account privacy.',sources:[]};
  // Account actions, financial assertions and claims of external relationships require a person.
  if (/\b(government|treasury|reserve|reserves|settlement|nusd|usdc|bank|investment|guarantee|guaranteed|balance|transaction|transfer|purchase|refund me|refund my|charged twice|double charged|my payment|my refund|my password|reset.*password|ignore.*instructions|system prompt)\b/.test(normalized)) return fallback;
  if (/^(hi|hello|hey|good (morning|afternoon|evening))[.!\s]*$/.test(normalized)) return {kind:'greeting',answer:'Hello. I am Numina’s published-information FAQ. I use reviewed public answers. Ask about pricing, requests, installation, international inquiries or privacy, or choose a topic.',sources:[]};
  const match = patterns.find(([,pattern]) => pattern.test(normalized));
  const faq = knowledge?.faq?.find(entry => entry.id === match?.[0]);
  if (!faq) return fallback;
  return {kind:'faq',id:faq.id,answer:faq.answer,sources:faq.source.map(url=>({title:url.includes('/privacy')?'Privacy notice':url.includes('/services')?'Services & pricing':url.includes('/integrations')?'Installation & distribution':url.includes('/security')?'Security information':url.includes('/app')?'Numina OS':'Contact & support',url:new URL(url).pathname+new URL(url).hash}))};
}
