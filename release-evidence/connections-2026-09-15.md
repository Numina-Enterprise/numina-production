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

## Live observation on deployed version 74

At **2026-09-15 19:30:18–19:30:21 UTC**, the deployed `/connections` screen completed all 19 checks in the existing authenticated browser session: **18 responding; 1 needing attention**. This observation supersedes the local-only result for production availability, not for the broader scope of installation, financial operation or independent assurance.

- Website, Numina OS, Services, Frontier and Control panel returned pages.
- Account-service health and the shared control manifest responded.
- Both MCP interfaces accepted initialization. No tool was called.
- A2A discovery, the integration-kit record and both native package records responded. No external installation or agent message was tested.
- The pinned core runtime responded.
- The authorized canonical treasury and provider observation reads succeeded. Balances, account identifiers and private response bodies were not included in this record.
- Telemetry definitions and the deployed release record responded.
- Financial status reported disabled capabilities and remained marked for attention. No financial execution was activated or tested.

Observed deployment: `appgdep_6aa99c662e2c8191947e617c424d4321`, version 74. Hosting source `d85b00d86b47c1005be1ef7b53e124fd4f179781`; GitHub source `2b96aaf177dd439d4f3d5051e371c13f960a60e1`; identical tree `4ab9ba1737b51786b7a0aa851320f9f0b727d08e`.

These are dated session observations. They do not establish availability for other accounts or future requests, endpoint authorization coverage, valid reserves, financial operating authority, settlement, installed native applications or Play approval.
