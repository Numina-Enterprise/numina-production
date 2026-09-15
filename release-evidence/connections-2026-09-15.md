# Numina connections implementation — September 15, 2026

The connection inventory now drives working software at `/connections`, a public manifest at `/api/connections/v1/manifest` and the `numina_connections` read-only MCP discovery tool. All 19 source surfaces retain the same NUMINA root and canonical treasury route.

The screen runs fixed same-origin read checks, including only protocol initialization for MCP. It limits concurrency to four, uses an eight-second deadline per check, refuses redirects, limits JSON to 1 MiB, supports cancellation and exports only status observations. Private response bodies, account details, balances and credentials are omitted from exports. Existing endpoint access controls remain authoritative.

Page responses, successful reads, protocol/discovery responses, distribution records, access requirements, unavailable services and disabled financial capabilities have separate labels. No tool execution, payment, financial activation, native installation or store publication is implied.

Validation:

- Build passed. Full root suite: **287 tests passed, zero failed**.
- Final cancellation-summary and hidden-button fixes: all **18 focused connection/readiness tests passed**.
- Local browser: 19/19 checks completed, 13 responding and 6 requiring attention. This is a local environment observation, not production connectivity evidence. The local account service, protected operations, runtime dependency and treasury/provider reads were unavailable; financial capability status remained restricted.
- Mobile inspection at 390 × 844 confirmed readable controls and collapsed navigation; the temporary viewport was reset.
- Current GitHub update `75f2a449647ff61c45318d4a86c3db352ced2c48` was preserved, including the wallet-custody tooling. This task did not provision wallets or run that tooling against real custody state.
- Existing Android/iOS identities, signed artifact bytes and financial activation controls were preserved.

The successful deployment result and exact source identities are recorded in GitHub issue #25 after publication. Earlier Play upload/declaration and operating-evidence blockers remain open; this software update does not certify their completion.
