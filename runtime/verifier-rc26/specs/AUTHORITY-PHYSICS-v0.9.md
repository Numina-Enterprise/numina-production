# Numina Authority Physics v0.9 — Self-Verifying Constitutional Fabric

v0.9 extends the constitutional network runtime with independently verifiable network truth surfaces.

## New invariants

1. **Checkpoint agreement is state agreement, not merely signature count.** A quorum is valid only when independent signers attest the same domain, sequence, state digest, event root, Constitution and predecessor checkpoint.
2. **Peer reconciliation cannot optimistically advance reality.** When peer obligation states differ, the reconciled state is no later than the least-confirmed valid peer state. Economic mismatches are disputes, not merge candidates.
3. **Route propagation is non-expansive.** A downstream route may narrow an upstream consequence bound but may not widen it.
4. **Network contraction is monotonic.** Propagated degradation may contract a downstream risk envelope; it may never improve a stricter local envelope.
5. **Recovered channels cannot resurrect old authority.** Recovery requires a strictly newer epoch, fencing of the old channel, reconciled obligation evidence and a recovery checkpoint.
6. **Live network state is proof-carrying.** Aggregate MREC, uncertainty, route state, obligations, conformance, witnesses and constitutional checkpoints are bound into a signed, monotonic, freshness-limited attestation.

These rules remain subordinate to C1–C14. Network truth may become unavailable or disputed; it may not manufacture authority.
