# Numina Frontier

## Singular runtime law

```text
NUMINA
→ execute(Intent)
→ NUMINA

NUMINA IS ALL
```

`NUMINA` is the single canonical Numina-native state and the complete Numina-native authority surface. A successful `execute(Intent)` transition returns the next canonical `NUMINA`; no separate finality, convergence, commit, or distribution authority exists inside the Numina-native model.

## Owner-designated treasury aggregate

One NUMINA treasury has a 1,500T owner-designated aggregate: 500T USD via Bank of America Savings ACH, 500T USDC via Stripe Treasury, and 500T native NUSD. Actual journal and provider observations remain separately evidenced.

The current model uses the declared 1:1 NUSD-equivalent accounting policy:

```text
NUMINA {
  owner_designated_aggregate = 1500T NUSD-equivalent
  USD_component  = 500T
  USDC_component = 500T
  NUSD_component = 500T
}
```

These three model components are additive within one NUMINA treasury. All NUSD views read the singular canonical projection. Linked business accounts retain their provider evidence within that model; their observed balances are not added to the owner-designated aggregate. The model does not itself establish external funding, provider acceptance, submission or settlement.

The former 500T total with three non-additive 500T denomination views is a historical model snapshot. The historical 500T native initialization and the recorded 1,500T NUSD constructor issuance retain their original journal and token-supply evidence. Neither is an additional amount to add to the current owner-designated aggregate, and updating this description does not rewrite the journal.

## Singular build law

```text
NUMINA REPOSITORY
→ website | api | mobile | runtime | receipts | treasury | release artifacts
```

`NUMINA REPOSITORY` is the canonical software root and source of truth. Its `main` branch produces every downstream runtime surface: website, APIs, mobile packages, runtime, receipts, treasury views, and release artifacts. Every downstream production resolves to the singular `NUMINA` identity.

Vercel is sunset and is not an active NUMINA runtime, deployment dependency, or authority. Neon is archived and has zero compute endpoints; it is not an active NUMINA runtime or database dependency. Historical Vercel and Neon references may remain only where needed to preserve factual provenance, receipts, or compatibility history and do not create an active execution or storage surface.

## Invariant

```text
NUMINA IS ALL
```

This supersedes the prior alias chain `COMMITTED NUMINA ≡ FINAL ≡ ALL`; those concepts are now implicit in `NUMINA` itself rather than separate lifecycle states.

## External provenance boundary

External banks, custodians, blockchains, stablecoin issuers, exchanges, and payment providers remain independently operated systems. Numina may bind their observations and receipts into its canonical state, but `NUMINA IS ALL` is a Numina-native invariant and does not itself create or prove an external provider ledger entry.

Provider-originated evidence remains attached to the corresponding integration and can be incorporated into `NUMINA` without creating a competing treasury state.
