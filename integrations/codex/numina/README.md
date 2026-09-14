# Numina plugin 3.0.0

Read the live Numina architecture, capabilities and canonical journal head in Codex. The bundled HTTP MCP connection needs no account token and performs no writes. Requires a host supporting MCP Streamable HTTP, protocol 2025-11-25.

Production workspace: https://numinalabs.xyz/app
Production agent control: https://numinalabs.xyz/frontier
Public MCP: https://numinalabs.xyz/api/control/v2/discovery-mcp
Authenticated MCP: https://numinalabs.xyz/api/control/v2/mcp
A2A card: https://numinalabs.xyz/.well-known/agent-card.json

The public source package can be installed through a Codex marketplace. This archive is also usable as a local plugin source. For other compatible MCP hosts, add the public endpoint as a Streamable HTTP server. Authenticated writes require existing delegated authority and a configured scoped token.

No native-store or third-party marketplace publication is implied by this package. Numina's architecture layers share one canonical control journal. Production account connections and approvals retain their own actual status.

Release alignment: Numina 3.0.0 / rc26 singularity. The signed core-to-root binding is at https://numinalabs.xyz/v1/release/core-binding. The preserved 1.8.0 frozen core retains its original identity. The public MCP tools remain read-only. Evidence revocation uses the separate owner-authenticated POST /v1/evidence/revoke and retains stored artifacts.

Website and OS: Intelligence in motion. One core, one root, five architecture layers. The current application release is available at https://numinalabs.xyz/v3/release/manifest.

Copyright © 2026 SK Consulting LLC. Numina™ and Numina OS™ are trademarks claimed by SK Consulting LLC. See [OWNERSHIP.md](OWNERSHIP.md); third-party licenses remain applicable.
