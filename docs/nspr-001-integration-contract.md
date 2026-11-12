# NSPR-001: Raft resilience-layer integration contract

Status: experimental binding verifier. The Otter-Raft mesh serializer delegates to `canonicalize()`. No Raft log RPC implementation is in this tree.

## Non-interference invariant
The resilience layer MUST NOT call or modify Raft `appendEntries`, `requestVote`, `installSnapshot`, quorum, term, commit-index, log-compaction, or membership mutation paths. It may observe committed index/term and emit advisory health events only. A SLACKENED edge is not a Raft membership removal or leadership transfer.

## Canonicalizer and binding bounds
`tokenize()` reads JSON text for the general canonicalizer. It rejects duplicate property names and does not apply the binding limits on `sequence` or `ttl_seconds`. `canonicalize()` likewise accepts any finite IEEE number. `verifyBinding()` keeps the stricter safe-integer bound on `sequence` and the 1..86400 integer bound on `ttl_seconds`.

## Binding exchange
1. Both peers agree on the *entire* unsigned manifest, including both state commitments.
2. Each signs the same domain-separated RFC 8785 bytes.
3. Verify both signatures against pinned trusted identities before accepting the manifest.
4. Reject replayed or stale sequences and unauthorized identity changes. Sequence checkpoints MUST be persisted before any production activation.
5. Use local monotonic elapsed time for link slackening. The signed wall-clock timestamp is for audit, not consensus authorization.

## Recovery
- A slackened edge may mirror only bounded, content-addressed *advisory* shards.
- Hash equality proves byte integrity, not consensus commitment or authorization.
- Recovery must reconcile against the actual Raft committed index and authenticated snapshots.
- During partitions, all globally exclusive operations remain subject to the existing Raft quorum.
- No unverified shard may overwrite a committed Raft log or snapshot.

## Production serializer

Nothing in this tree defines Raft `appendEntries`, `requestVote`, or `installSnapshot`. `numina-agent-swarm/src/swarm-dispatcher.mjs` is not a Raft log. Its pinned cluster-state root is unchanged.

The production Otter-Raft serializer is `canonicalizeJson()` in `numina-doc-alignment/src/numina-mesh-router.mjs`. It now calls `canonicalize()` after the existing soft-hyphen and prototype-pollution checks. Plain JSON objects keep the same canonical bytes. Holes, extra non-index array properties, lone surrogates, and `undefined` values now throw instead of being emitted.

`signingBytes()` is the domain-separated byte string for `numina.rafting-binding.v1` only. The mesh router signs E2EE envelopes and grant transcripts under different domains, so those transcripts still do not call `signingBytes()`. Swapping them would invalidate existing signatures. `RaftingLink` remains an observer: it does not call quorum, term, commit-index, or log mutation paths.

## Pre-merge gates
- Pass the isolated Node 26.13.0 test workflow.
- Validate official RFC 8785 vectors and independent runtime parity.
- Validate strict schema including duplicate-key rejection at raw JSON ingestion.
- Add durable replay/epoch tracking and authenticated key rotation.
- Run partitions, clock skew, delayed delivery, corrupted cache, restart and rollback tests.
- Review the actual Raft observer API and prove non-interference.
- Independent security review and explicit release approval.

No production deployment, treasury operation, or consensus modification is included.
