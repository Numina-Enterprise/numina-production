# Numina Authority Physics v0.4

v0.4 integrates the deterministic Authority VM into a persistent proof-carrying execution pipeline.

## Execution invariant
A live operation may cross `BEGIN_COMMIT` only when all of the following independently hold:

1. the proof-carrying authority program is signed and bound to the recognized Constitution and compiler;
2. the relying party accepts a fresh monotonic Status Witness;
3. the currently running implementation reports healthy live conformance for the same Constitution and program;
4. the deterministic Authority VM returns `ALLOW` for the canonical context;
5. nonce and authorization consumption occur atomically in the persistent commit store.

No failure in steps 1-4 creates an operation. Failure in step 5 cannot partially consume only one of nonce/operation identity.

## Proof-carrying programs
Programs bind semantic source, compiler, reachable-authority analysis, approval, and Constitution identity. Intelligence may generate candidate source policy, but a runtime executes only an approved signed program.

## Live conformance
Conformance is a state input, not a marketing label. A verifier may reject execution when the running build, Constitution, program, status root, or test state falls outside its recognition profile.

## Dependency closure
Authority-relevant epochs are represented as a deterministic closure root. Stale dependencies require revalidation; newer state cannot be silently projected backward to legitimize an older authorization.

## Persistent execution
`BEGIN_COMMIT` is the linearization point. The reference engine uses a durable transaction to consume nonce and operation authorization identity atomically.
