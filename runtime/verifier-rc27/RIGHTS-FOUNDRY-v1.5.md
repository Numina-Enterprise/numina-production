# Numina Rights Foundry + Autonomous Contracting Runtime v1.5

v1.5 makes rights formation executable. The Foundry separates **right-type governance** from **right-instance creation**, supports deterministic templates, conserved rights transformations, exclusivity, genesis-path analysis, and atomic reciprocal contracting.

## Core laws

1. A right instance may be created only from an approved right type/template and a valid `RightCreationAuthority`.
2. Novel right types require explicit governance proof bound to proposal digest and governance epoch.
3. Derived/right-transformed capacity may not exceed the conserved result of the source right and transformation rule.
4. Exclusive right classes cannot be silently duplicated for the same principal.
5. Autonomous contracts are proof-bound and all-or-nothing: rights and matching obligations either appear together or not at all.
6. Contract formation does not bypass the Rights Runtime; created rights remain subject to occupancy, lifecycle, recognition, and downstream authority rules.
7. Genesis min-cut is measured over independent creation authorities; adding issuance paths increases institutional rights-formation attack surface.
8. Rights creation may form institutional structure; it does not imply external recognition outside its recognition domain.

## Pipeline

`Right Type -> Governance -> Template -> Genesis/Transform -> Contract Commit -> Right + Obligation -> Institutional Compiler`
