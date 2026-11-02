# Numina Authority Physics v0.5 — Distributed Proof Plane

v0.5 extends the constitutional runtime with a distributed proof plane while preserving C1–C14.

## New executable rules

1. **Witness quorum does not create authority.** It only attests a pre-existing constitutional status.
2. **Equivocation is explicit.** Same authority domain + same constitutional sequence + different status roots yields an EquivocationProof and blocks new risk-adding recognition.
3. **Witness history is monotonic.** Older sequences are rollback and same-sequence contradictory roots are equivocation.
4. **Recovery is proof-carrying.** Recovery accepts deterministic event-chain reconstruction; it never assumes missing obligations vanished.
5. **Shard migration is zero-overlap.** Destination authority activates only after source occupancy is proven clear and the source is fenced.
6. **Conformance is portable.** A signed ConformanceBundle binds implementation/build/Constitution/semantic registry/test corpus/VM digest.
7. **Quorum agreement is not sovereignty.** Consensus validates status only under already-recognized witness authority.

## Failure law

`less truth => equal or less risk-adding authority`

No witness failure, partition, recovery event, or migration may increase authority merely because state became harder to observe.
