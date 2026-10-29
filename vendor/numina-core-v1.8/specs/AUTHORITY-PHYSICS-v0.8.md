# Numina Authority Physics v0.8 — Continuous Constitutional Network Runtime

v0.8 makes the control mesh a persistent economic state machine rather than a collection of independently valid components.

## Coupled Commit Law

An operation that crosses the mesh commit boundary MUST atomically bind:

1. one valid EAC nonce,
2. one bounded authority session consumption,
3. one current authority-route fencing epoch,
4. one unique economic operation,
5. one bilateral obligation lineage.

Partial success is constitutionally invalid. If any coupled write fails, all writes roll back.

## Dependency Closure Law

The dependency root bound into the Economic Authorization Credential MUST equal the fresh Status Witness dependency closure root used at commit. A valid signature over stale or different dependencies does not authorize the transition.

## Route Fencing Law

Authority routing is epoch-fenced. A route may be reconfigured only monotonically. A credential or session presenting an older route epoch is stale and cannot commit.

## Health Contraction Law

Runtime health may contract new risk-adding authority but may not manufacture authority. DISPUTED and RECOVERY_VERIFYING states reduce new risk-adding capacity to zero by default while obligation-satisfying paths may remain available when explicitly classified as non-risk-adding.

## Endpoint Discovery Law

Discovery advertises capability and recognition requirements; discovery never grants authority. Selecting an endpoint cannot widen issuer, Constitution, consequence, freshness, session, or route constraints.

## Obligation Continuity Law

Once a bilateral obligation is created, execution/settlement/finality transitions are monotonic. Dispute preserves the obligation; finality is immutable. Failed settlement or lost connectivity does not erase a valid commitment.

## Continuous Runtime Safety Statement

For every accepted network commit:

`EAC ∩ Recognition ∩ Endpoint ∩ Witness ∩ Conformance ∩ Program ∩ VM ∩ Session ∩ Health ∩ RouteFence`

must all permit the exact bounded transition, and the resulting session occupancy, operation, nonce consumption, and obligation are one atomic state transition.
