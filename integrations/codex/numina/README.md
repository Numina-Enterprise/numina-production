# Numina plugin 4.0.0

Business, partnership and support contact: [skott34@numinalabs.xyz](mailto:skott34@numinalabs.xyz). [Explore services](https://numinalabs.xyz/services) or [track an existing request](https://numinalabs.xyz/app#service-work).

Read the live Numina architecture, capabilities and canonical journal head in Codex. The bundled HTTP MCP connection needs no account token and performs no writes. Requires a host supporting MCP Streamable HTTP, protocol 2025-11-25.

Production workspace: https://numinalabs.xyz/app
Production agent control: https://numinalabs.xyz/frontier
Public MCP: https://numinalabs.xyz/api/control/v2/discovery-mcp
Authenticated MCP: https://numinalabs.xyz/api/control/v2/mcp
A2A card: https://numinalabs.xyz/.well-known/agent-card.json

The public source package can be installed through a Codex marketplace. This archive is also usable as a local plugin source. For other compatible MCP hosts, add the public endpoint as a Streamable HTTP server. Authenticated writes require existing delegated authority and a configured scoped token.

No native-store or third-party marketplace publication is implied by this package. Numina's architecture layers share one canonical control journal. Production account connections and approvals retain their own actual status.

Release alignment: Numina 4.0.0 / rc27 singularity. The signed core-to-root binding is at https://numinalabs.xyz/v1/release/core-binding. The preserved 1.8.0 frozen core retains its original identity. The public MCP tools remain read-only. Evidence revocation uses the separate owner-authenticated POST /v1/evidence/revoke and retains stored artifacts.

Website and OS: Intelligence in motion. One core, one root, seven final frontier layers. The current application release is available at https://numinalabs.xyz/v4/release/manifest.

Copyright © 2026 SK Consulting LLC. Numina™ and Numina OS™ are trademarks claimed by SK Consulting LLC. See [OWNERSHIP.md](OWNERSHIP.md); third-party licenses remain applicable.

## Procurement usage

The current shared application release publishes `procurement_usage: true` at https://numinalabs.xyz/v4/release/manifest. This permits use of existing Numina procurement workflows under the current owner and delegated permissions. Read https://numinalabs.xyz/business-core.json for the owner authorization and https://numinalabs.xyz/api/control/v2/manifest for current capabilities. Provider payment evidence and treasury rules remain applicable. The hosted workspace reads this shared release; packaged native binaries retain their separately recorded build identities.

## Shared denomination policy

Read `denomination_policy` from the live `numina_architecture` or `numina_capabilities` response. Numina declares **1 NUSD = 1 USDC = 1 USD** across L1–L5 and the hosted application. This is one native balance with declared equivalent values; keep provider balances, asset identity and execution status as reported. A declaration does not establish external reserves or a completed conversion.
