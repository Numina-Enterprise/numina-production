# Numina Authority Physics v0.7 — Economic Control Mesh

v0.7 extends the sovereign federation into an executable control mesh.

## New primitives

- **ProofCarryingEndpointContract** — an endpoint declares the authority class, Constitution, issuer, consequence ceiling, and freshness it recognizes.
- **AuthorityChannelPolicy / AuthoritySession** — bilateral authority may be opened as a bounded session with aggregate, per-operation, velocity, expiry, and nonce limits.
- **BilateralObligation** — cross-domain consequence persists independently from settlement success and cannot be erased by dispute.
- **AuthorityPeeringPolicy** — institutions recognize only an explicit intersection of Constitution, issuer, class, freshness, and open-obligation limits.
- **EconomicControlMesh** — economically consequential endpoints form a path only when every edge recognizes the requested authority class and consequence.
- **ContinuousNetworkReachability** — the network exposes a conservative reachable-consequence and occupied-authority projection.

## Laws

1. An endpoint never infers authority from identity, connectivity, or API capability.
2. A stale status proof requires revalidation; it never degrades into ALLOW.
3. An authority session cannot exceed its aggregate, per-operation, velocity, temporal, or replay bounds.
4. Session optimization cannot create authority; it only consumes a previously bounded channel.
5. Cross-domain obligations survive execution, settlement failure, dispute, and recovery until constitutionally finalized.
6. Peering is explicit and non-ambient; recognition is not inherited from network adjacency.
7. A mesh path is legitimate only where every enforcement boundary recognizes the same bounded consequence.
8. Whole-network MREC is conservative. Unknown correlation or missing proof cannot reduce it.

The invariant remains: **capability may route widely; legitimate economic power remains bounded by conserved authority at every enforcement boundary.**
