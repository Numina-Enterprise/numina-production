# Numina Constitutional Market Runtime v1.7

v1.7 extends Numina's institution network into multi-institution clearing and coordination while preserving sovereign rights and non-creation of authority.

## Core invariants

1. Netting requires an explicit `NettingRight`; gross obligations remain provable even when settlement exposure is compressed.
2. Collateral authority is derived from existing lots, conservative integer haircuts, and explicit encumbrance. Collateral cannot be double-reserved.
3. Default preserves obligations and deficiency. Crisis never creates rights, capacity, or authority.
4. Closeout requires pre-authorized bounded `CloseoutAuthority`; it cannot exceed open obligations or its own envelope.
5. Systemic stress propagation is bounded per edge and cycle-safe; correlated failure cannot manufacture consequence through graph revisits.
6. Inter-institution settlement proofs bind clearing domain, obligation identity, parties, resource, amount, prior state, result, sequence and evidence root; replay is rejected.
7. All state roots are deterministic and integer-only.

## Constitutional market path

`rights → recognized authority → bilateral obligation → clearing domain → explicit netting/collateral → settlement/default/closeout → proof`

Numina does not custody assets or replace legal settlement systems in this reference runtime. It proves and constrains economic authority around them.
