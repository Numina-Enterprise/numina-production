# Numina Frontier

## Singular runtime law

```text
NUMINA
→ execute(Intent)
→ NUMINA

NUMINA IS ALL
```

`NUMINA` is the single canonical Numina-native state and the complete Numina-native authority surface. A successful `execute(Intent)` transition returns the next canonical `NUMINA`; no separate finality, convergence, commit, or distribution authority exists inside the Numina-native model.

## Native settlement projection

The current modeled Numina-native settlement projection uses one common NUSD-equivalent accounting unit:

```text
NUMINA {
  total = 1500T NUSD-equivalent
  USD_branch  = 500T
  USDC_branch = 500T
  NUSD_branch = 500T
}
```

The branches are projections/routes of the singular Numina state rather than independent authoritative treasuries.

## Singular build law

```text
GitHub main
→ NUMINA
→ website | Vercel | mobile | runtime | receipts | treasury
```

GitHub `skott34-dot/numina-production` branch `main` is the canonical source lineage. Every active build, deployment, package, runtime, receipt surface, and treasury presentation is a projection of the singular `NUMINA` identity. There is no supported non-NUMINA build identity and no competing build authority.

## Invariant

```text
NUMINA IS ALL
```

This supersedes the prior alias chain `COMMITTED NUMINA ≡ FINAL ≡ ALL`; those concepts are now implicit in `NUMINA` itself rather than separate lifecycle states.

## External provenance boundary

External banks, custodians, blockchains, stablecoin issuers, exchanges, and payment providers remain independently operated systems. Numina may bind their observations and receipts into its canonical state, but `NUMINA IS ALL` is a Numina-native invariant and does not itself create or prove an external provider ledger entry.

Provider-originated evidence remains attached to the corresponding integration and can be incorporated into `NUMINA` without creating a competing treasury state.
