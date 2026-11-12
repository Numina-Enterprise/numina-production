# NSPR-001: Raft resilience-layer integration contract

Status: experimental, not connected to production consensus.

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

## Production module search

A search of this branch found no production Raft or consensus implementation. Nothing defines `appendEntries`, `requestVote`, or `installSnapshot`, and `numina-agent-swarm/src/swarm-dispatcher.mjs` is not a Raft log, vote, or snapshot module. Its pinned cluster-state root is unchanged. `canonicalize()` and `signingBytes()` are therefore not wired into production Raft code. `RaftingLink` stays an experimental observer-side helper: a caller supplies `verifyManifest`, and the tests pass `verifyBinding`, which signs with `signingBytes()`. No incompatibility with an on-tree Raft API arises, because that API is not in this tree. A later observer must stay off quorum, term, commit-index, and log mutation, as the non-interference invariant requires.

## Pre-merge gates
- Pass the isolated Node 26.13.0 test workflow.
- Validate official RFC 8785 vectors and independent runtime parity.
- Validate strict schema including duplicate-key rejection at raw JSON ingestion.
- Add durable replay/epoch tracking and authenticated key rotation.
- Run partitions, clock skew, delayed delivery, corrupted cache, restart and rollback tests.
- Review the actual Raft observer API and prove non-interference.
- Independent security review and explicit release approval.

No production deployment, treasury operation, or consensus modification is included.
