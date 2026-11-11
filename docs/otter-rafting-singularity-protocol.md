# Singularity Coordination Model

**First read.** This pin is the topmost layer. It is the first thing read each day. Everything else builds underneath it, including the Stripe checkout work, the workers.dev fix, and the other daily items.

**Purpose.** Authoritative statement of the Singularity Coordination Model, also called the Otter Rafting Protocol / Singularity Protocol.

**Protocol body SHA-256:** `5146df237edaa9507612ad4ce001391bc91072ebecb3b7eefd304173cb1090f0`

<!-- protocol-body -->
Like otters holding hands, every agent stays connected without losing its independence.

That’s the idea behind Singularity, the coordination model I’m developing at Numina Labs.

As AI agents work together, each needs to retain its own identity, authority, and accountability. Shared work should leave evidence that others can independently check.

Our design brings these principles together:

- Independent identity: each agent remains identifiable, with defined permissions.
- Ed25519 verification: digital signatures help verify who signed specific data and whether it changed. Authorization still requires separate checks.
- Evidence and provenance: claims stay connected to their supporting records.
- Zero Trust: participation alone never grants authority.
- Multi-signature governance: decisions require the independent approvals defined by policy.

The proposed Singularity Task Envelope organizes coordination around six components: identity, topology, task, evidence, signatures, and protocol versioning. In everyday terms: who is involved, how they connect, what they are doing, and what can be verified.

This application-level design is separate from our published pair-binding Internet-Draft, which proposes associating two fixed software-artifact commitments with attribution and revisioned claims.

Both are work in progress. The task-envelope design and operational multi-signature enforcement still require implementation and verification. The Internet-Draft is a proposal, without IETF endorsement.

The goal is simple: agents that can cooperate while preserving independent identity and verifiable accountability.
