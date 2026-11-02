# Numina Institutional Compiler v1.3

v1.3 treats an autonomous institution as an executable constitutional program. The compiler consumes a deterministic Institution IR and emits roots for rights, authority, obligations, recognition, recovery and reachable state together with viability and MREC projections.

## Invariants

1. Derived rights may not exceed their source rights.
2. Authority aggregated against a right may not exceed that right.
3. Rights lineage cycles are invalid.
4. Recognition edges may narrow but not widen their source domain.
5. Recovery paths may not expand risk-adding authority and must preserve obligations.
6. Open obligations remain represented during wind-down.
7. Institutional dissolution is impossible while open obligations remain.
8. Build and diff artifacts are deterministic and digest-bound.
9. Activation requires an exact build-bound governance proof.
10. Compilation analyzes declared institutional state; it does not create external legal rights or recognition by assertion.

## Lifecycle

ACTIVE -> WIND_DOWN -> OBLIGATION_ONLY -> RECONCILIATION_ONLY -> DISSOLVED

Configuration rollback never rewrites intervening economic history.
