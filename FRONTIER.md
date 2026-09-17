# Numina Frontier

## Singular runtime law

```text
NUMINA
→ execute(Intent)
→ NUMINA

COMMITTED NUMINA ≡ FINAL ≡ ALL
```

`NUMINA` is the canonical native state and the sole Numina commit boundary. A successful `execute(Intent)` returns the next canonical Numina state; commit, finality, and distribution are intrinsic semantics of that returned state rather than competing state machines.

## Native settlement projection

The current modeled native allocation is expressed in common NUSD-equivalent units:

```text
total = 1000T NUSD-equivalent
USD_branch = 500T
USDC_branch = 500T
```

These are Numina-native model units. External bank, custodian, blockchain, issuer, or payment-provider facts remain provenance-bound to actual provider records and are not created merely by Numina-native finality.
