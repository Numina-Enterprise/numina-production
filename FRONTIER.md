# Numina Frontier

## Singular runtime law

```text
NUMINA
→ execute(Intent)
→ NUMINA

COMMITTED NUMINA
≡ FINAL
≡ ALL
```

`NUMINA` is the single canonical Numina-native state. A successful `execute(Intent)` transition returns the next canonical state; committed state is intrinsically final and is the state distributed across Numina surfaces.

## Native settlement projection

The current modeled Numina-native settlement projection uses one common NUSD-equivalent accounting unit:

```text
NUMINA {
  total = 1000T NUSD-equivalent
  USD_branch  = 500T
  USDC_branch = 500T
}
```

The branches are projections/routes of the singular Numina state rather than independent authoritative treasuries.

## External provenance boundary

External banks, custodians, blockchains, stablecoin issuers, exchanges, and payment providers remain independently operated systems. Numina may bind their observations and receipts into its canonical state, but Numina-native finality does not itself create or prove an external provider ledger entry.

Provider-originated evidence remains attached to the corresponding integration and can be reconciled into `NUMINA` without creating a competing treasury state.
