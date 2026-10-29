# Numina Authorization Model — Lean 4 Scaffold

Lean 4 (v4.35.0, Lake 5.0.0) formalization scaffold for the authorization
logic of `draft-kott-numina-pair-binding` ("Singularity"). Started 2026-10-20.

## Build

```sh
export PATH="$HOME/.elan/bin:$PATH"
lake build
```

## What is modeled (`NuminaAuth/Basic.lean`)

- `Artifact` (a commitment hash) and `Companion` — the universal pair:
  Source 1 and Source 2, each keeping its own attribution string.
- `Claim` — a statement about a companion at a stated revision.
- `Checks` — the draft's separate verification outcomes as independent
  fields: `sigValid`, `signerAuthorized` (authenticity), `revisionCurrent`
  (freshness).
- `authentic`, `fresh`, `accept` — bounded acceptance is the conjunction
  of the two separate checks, nothing else.
- `Policy`, `runChecks`, `decide` — the decision procedure, with signature
  verification and canonical encoding as *parameters* (interfaces), not
  trusted code inside the model.

## What is proved (no `sorry` anywhere)

- `accept_iff`, `accept_sound` — acceptance is exactly authenticity ∧
  freshness, and whatever is accepted has both.
- `authentic_not_fresh` — a submission can be authentic yet stale, and is
  rejected: authenticity does not imply freshness (counterexample proof).
- `fresh_not_authentic` — the mirror separation.
- `decide_sound` — end-to-end soundness of the decision procedure,
  inherited from the acceptance logic.
- `no_rebind` — under an injective canonical encoding (an explicit
  hypothesis), one issued byte string names at most one companion.

## Axiom audit (measured 2026-10-20, `lake env lean` + `#print axioms`)

- `authentic_not_fresh`, `fresh_not_authentic`, `no_rebind`: **no axioms**
  (fully constructive).
- `accept_iff`, `accept_sound`: `propext` only.
- `decide_sound`: Lean's standard trio (`propext`, `Classical.choice`,
  `Quot.sound`).
- No theorem depends on `sorryAx` — there are no admitted steps.

## What is deliberately NOT claimed

Ed25519 is not formalized here; verification is an oracle parameter.
Canonical encoding is abstract; injectivity is a named hypothesis.
This is a scaffold of the authorization *logic*, in the same spirit as
the draft: premises and assumptions are labeled, proofs cover the
inference.

## Roadmap

1. Concrete length-prefixed canonical encoding with a proved
   injectivity lemma (discharging `no_rebind`'s hypothesis).
2. The full claim lifecycle from the draft's Sections 5–6 (issue,
   supersede, revoke) with revision monotonicity theorems.
3. Correspondence with the NCPS manuscript's authorization model.
4. A verified checker for the LP duality certificates
   (`~/workspace/your_files/lp_certificate.py`) — the same
   "answers carry receipts" discipline, machine-checked.
