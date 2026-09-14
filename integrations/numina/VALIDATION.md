# Package status — 4.0.0

This source alignment release uses the Numina 4 application manifest at `/v4/release/manifest`, six default discovery tools and the existing authenticated control MCP bridge. The manifest schema remains `numina.application-release.v2`; protocol/schema versions do not rename the product.

Packaging regenerates provider descriptors, distribution metadata, the file inventory and archive digests from the current source. No application tests, live model-provider calls, host installation or registry publication are performed by packaging. Source syntax and artifact integrity checks are recorded separately from provider acceptance.

Historical 0.2.0 validation remains in `history/0.2.0/`. Prior 2.0.0 root-readiness and runtime-build revisions remain historical releases; their checks do not validate this changed archive. The client retains the rc26 runtime identity and all authentication, asset-pinning and activation checks.

The source maps to one Numina root through the canonical head, control state and treasury endpoints. An owner funding declaration is an internal journal statement; it does not alter provider balances.
