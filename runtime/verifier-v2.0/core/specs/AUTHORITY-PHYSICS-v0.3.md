# Numina Authority Physics v0.3

## Additional runtime laws

1. Authority programs are deterministic and contain no network/model/nondeterministic opcodes.
2. Portable authority objects use deterministic integer-only binary encoding.
3. Status witnesses are monotonic; rollback and chain breaks fail closed. Same-domain/same-sequence/different-root is equivocation evidence.
4. BEGIN_COMMIT is an atomic persistence boundary consuming both nonce and authorization-operation uniqueness.
5. Shard handoff fences the source before activating equivalent capacity at the destination and refuses occupied shards.
6. Reachability analysis estimates maximum reachable consequence from explicit authority topology; it does not itself grant authority.
7. Optimization, analysis, and VM execution cannot manufacture rights. C1-C14 remain controlling.

See AUTHORITY-PHYSICS-v0.2.md for the inherited Constitution and frozen semantics.
