# Numina Rights Runtime v1.4

The Rights Runtime makes rights genesis, backing, recognition, mutation, and extinction deterministic and replayable before authority is derived from those rights.

## Core separation

A right may be created by an explicit genesis mechanism. That does not automatically make it externally recognized or executable. The runtime keeps intrinsic right state, recognition state, and downstream authority separate.

## Executable laws

1. Root genesis requires explicit `RightCreationAuthority` with `allow_root_genesis=true`.
2. Derived resource-backed rights consume source-right availability through encumbrance.
3. A failed genesis operation leaves source rights unchanged.
4. A claim right and its paired obligation are created atomically.
5. Recognition may narrow a right and is bounded by a `RecognitionBudget`; it may not widen intrinsic capacity.
6. Rights uncertainty consumes rights liquidity until narrowed by accepted evidence.
7. Occupied rights cannot transfer or extinguish.
8. A parent right cannot extinguish while active descendants remain.
9. Extinguishing a derived right releases its backing to the source right.
10. Rights VM execution is deterministic and fail-stop.
11. Rights Runtime state can be projected directly into the Institutional Compiler.

## Right state

`PROPOSED -> ACTIVE -> SUSPENDED -> ACTIVE` and `ACTIVE/SUSPENDED -> EXTINGUISHED` subject to occupancy and descendant rules.

Recognition is orthogonal: `LOCAL | RECOGNIZED | DISPUTED | REJECTED`.

## Rights occupancy

`available = capacity - reserved_for_creation - encumbered - exercised - uncertain`

A suspended or extinguished right has zero executable availability.

## Reciprocal rights

For claim-bearing economic structures, the runtime can atomically create a right/obligation pair. This is the first reference implementation of dual-entry rights accounting.

## Scope

This is a deterministic reference implementation. It does not itself establish external legal rights; external effect depends on the relevant recognition and legal/institutional domain.
