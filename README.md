# Numina Authority Standard test service

Web version 0.2.0 extends the existing Numina Labs site with `/authority.html` and `/api/v0.1/*`. No financial adapter or employer-owned code is included.

Node 24+: `node scripts/fixtures.mjs`, `npm run build`, `npm test`, `npm start`. `npm run conformance -- https://www.numinalabs.xyz` independently tests a deployed release. No external runtime dependencies.

Source: `src/`; existing/new static content: `public/`; portable specs: `docs/`; explicitly public test keys/vectors: `fixtures/`; build output: `dist/client`, `dist/server`, `dist/.openai`. The receipt private key belongs only in runtime secret settings. See `docs/Operations-v0.1.md`.

Core v1.8 is preserved unchanged under vendor/numina-core-v1.8. Frozen C1–C14 names and the original 20 scenarios are included. The web adapter implements bounded reference EAC verification and observational margin arithmetic, not the entire Python runtime. Public deployment evidence must be checked separately.
