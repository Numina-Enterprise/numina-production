# Numina Authority Standard test service

Version 0.1.0 extends the existing Numina Labs site with `/authority.html` and `/api/v0.1/*`. No financial adapter or employer-owned code is included.

Node 24+: `node scripts/fixtures.mjs`, `npm run build`, `npm test`, `npm start`. `npm run conformance -- https://www.numinalabs.xyz` independently tests a deployed release. No external runtime dependencies.

Source: `src/`; existing/new static content: `public/`; portable specs: `docs/`; explicitly public test keys/vectors: `fixtures/`; build output: `dist/client`, `dist/server`, `dist/.openai`. The receipt private key belongs only in runtime secret settings. See `docs/Operations-v0.1.md`.

Exact C1–C14 text and original 20 conformance scenarios were unavailable. Identifiers are reserved, not redefined or claimed implemented. Docs are implementation drafts. Public deployment evidence must be checked separately.
