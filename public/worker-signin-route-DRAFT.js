// DRAFT ONLY — NOT APPLIED. Workstream C, Nov 19, 2026.
// Sign-in route for numinalabs.xyz: /signin-with-chatgpt + /signout-with-chatgpt.
//
// Problem (verified): app.html links /signin-with-chatgpt?return_to=%2Fapp and
// app-ui.js / frontier-ui.js generate /signin-with-chatgpt and /signout-with-chatgpt
// URLs, but src/worker.js contains zero occurrences of "signin", so every sign-in
// click on numinalabs.xyz 404s. Sign-in is a ChatGPT Sites-platform feature
// (docs/Control-Plane-v1.md; privacy.html: "The application uses Sites hosting
// and sign-in"); the retained application backend host is
// https://personal-space-m7q9.skott34.chatgpt.site (docs/Source-Alignment-v4.md).
//
// Fix: redirect the two paths to the Sites host sign-in, preserving return_to.
// The upstream base below is the best-known value and is marked OWNER-TO-CONFIRM:
// the owner must confirm the exact Sites sign-in URL before this is applied.
// If the Sites sign-in lives at a different path, only that one constant changes.
//
// INSERTION POINT (src/worker.js, inside fetch(), immediately BEFORE this line):
//   return finish(await env.ASSETS.fetch(req));
// and AFTER the existing route blocks (place it next to the /favicon.ico block).
// Requires no new binding and no secret. Do NOT apply until the owner confirms
// the upstream sign-in URL (see INFRA-ASKS.md, Gap 3).

// OWNER-TO-CONFIRM: exact sign-in base on the retained Sites host.
const SITES_SIGNIN_BASE = 'https://personal-space-m7q9.skott34.chatgpt.site/signin-with-chatgpt';
const SITES_SIGNOUT_BASE = 'https://personal-space-m7q9.skott34.chatgpt.site/signout-with-chatgpt';

if (path === '/signin-with-chatgpt' || path === '/signout-with-chatgpt') {
  if (!['GET', 'HEAD'].includes(req.method)) {
    return finish(response({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, HEAD' }));
  }
  const upstream = new URL(path === '/signin-with-chatgpt' ? SITES_SIGNIN_BASE : SITES_SIGNOUT_BASE);
  const returnTo = url.searchParams.get('return_to');
  if (returnTo) upstream.searchParams.set('return_to', returnTo);
  return finish(new Response(null, { status: 302, headers: { Location: upstream.href } }));
}
