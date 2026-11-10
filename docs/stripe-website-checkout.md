# Numina Labs website checkout

Hosted Stripe Checkout for the public site at `https://www.numinalabs.xyz/`. The site is the Cloudflare Worker declared in `wrangler.jsonc` (`main`: `./dist/server/index.js`, routes for `numinalabs.xyz/*` and `www.numinalabs.xyz/*`). Vercel Git deployments are disabled. Do not put secrets in `wrangler.jsonc`.

This is separate from `local/treasury/`, which already talks to `https://mcp.stripe.com` with OAuth 2.1 for the loopback admin console only. Do not reuse that module for the website, and do not import it from `src/`.

## What the site sells

| Offering | Price | How to buy |
| --- | --- | --- |
| Operational Agent Diagnostic | $1,500 fixed | Pay on `/services#diagnostic` |
| Agentic Systems and Operations Audit | $7,500 fixed, optional | Pay on `/services#audit` |
| SBIR / STTR proposal preparation | Quoted | Contact link only |

Card entry happens on Stripe Checkout. The Worker creates a Checkout Session and redirects there. Success and cancel pages are `/checkout-success` and `/checkout-cancel`. The webhook verifies the signature and logs the event id, type, payment status, and offering. It does not fulfill the engagement by itself.

## Why this is not the `stripe` npm package

`scripts/release-lib.mjs` attests the source tree as `git ls-tree -r HEAD`. That digest covers `package.json` and `package-lock.json`. Adding the `stripe` dependency would change an attested value, so those files are unchanged.

`src/stripe-checkout.js` is the Workers client. `scripts/build.mjs` concatenates it into `dist/server/index.js` and strips `import` lines, which a Node SDK import would not survive. The client calls `POST https://api.stripe.com/v1/checkout/sessions` with `Stripe-Version: 2026-10-28.endive` and verifies webhooks with HMAC-SHA256 over `timestamp.payload` via SubtleCrypto. It exposes `checkout.sessions.create` and `webhooks.constructEventAsync`, the same methods the server SDK uses with `Stripe.createFetchHttpClient()` and `Stripe.createSubtleCryptoProvider()`.

The Worker refuses `sk_live_`, `rk_live_`, and `pk_live_` keys before any network call. Use a test-mode restricted key (`rk_test_...`) with permission to create Checkout Sessions. A test-mode secret key (`sk_test_...`) also works. Prefer the restricted key.

## Environment variables

Set these on the `numina-production` Worker. Placeholders live in `.env.example`. Never commit real values.

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Test-mode restricted or secret key used to create Checkout Sessions |
| `STRIPE_PUBLISHABLE_KEY` | Test-mode publishable key (`pk_test_...`). Stored for parity. Hosted Checkout does not print it on the page |
| `STRIPE_WEBHOOK_SECRET` | Signing secret from the test-mode webhook endpoint (`whsec_...`) |
| `STRIPE_PRICE_DIAGNOSTIC` | Test-mode Price id for the $1,500 diagnostic (`price_...`) |
| `STRIPE_PRICE_AUDIT` | Test-mode Price id for the $7,500 audit (`price_...`) |

From the repo root, with the Cloudflare account the existing deploy workflow already uses:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_PUBLISHABLE_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_DIAGNOSTIC
npx wrangler secret put STRIPE_PRICE_AUDIT
```

`wrangler.jsonc` already runs the Worker before assets for `/api/*`, which covers `POST /api/payments/v1/checkout` and `POST /api/payments/v1/webhook`. No route edit was required. Secrets are bindings, not `[vars]`.

Static pages are served with `public/_headers`. That policy previously set `form-action 'none'`, which blocks the payment form. It is now `form-action 'self'` so the browser can POST to this origin. The response then redirects to `https://checkout.stripe.com`. Card data never hits the Worker.

## Stripe Dashboard (test mode)

1. Turn on **Test mode**. Do not create live products, prices, or webhook endpoints for this rollout. The Worker will reject live keys anyway.
2. Create a one-time Price for **Operational Agent Diagnostic** at 150000 cents USD. Copy the `price_...` id into `STRIPE_PRICE_DIAGNOSTIC`.
3. Create a one-time Price for **Agentic Systems and Operations Audit** at 750000 cents USD. Copy it into `STRIPE_PRICE_AUDIT`.
4. Create a restricted API key with Checkout Sessions write access. Put it in `STRIPE_SECRET_KEY`. Put the test publishable key in `STRIPE_PUBLISHABLE_KEY`.
5. Add a webhook endpoint:
   - URL: `https://www.numinalabs.xyz/api/payments/v1/webhook`
   - The apex host `https://numinalabs.xyz/api/payments/v1/webhook` hits the same Worker. Use one endpoint.
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
6. Put the endpoint signing secret in `STRIPE_WEBHOOK_SECRET`.
7. Redeploy the Worker after the secrets exist. `npm run build` rewrites `dist/` and the application release pin. The signed release statement will not match until that pin is refreshed and the release is signed again. This change does not sign anything.

Local checks use a mocked client. Nothing in the test suite calls Stripe.

## Cursor Stripe MCP

`.cursor/mcp.json` registers the remote Stripe MCP server at `https://mcp.stripe.com` for agents in this repo. The file has the URL only. Cursor starts OAuth in the browser. Do not paste an API key into that file.

That entry is developer tooling. It is not loaded by the website Worker. The loopback treasury adapters in `local/treasury/` remain the only in-repo MCP client, and they stay off the public Worker.
