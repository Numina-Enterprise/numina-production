# Numina Adaptive Authority Control v1.1

This reference layer closes the loop between derived Authority Physics metrics and runtime control while preserving the Constitution's non-creation rule.

## Control law

Automatic adaptation may contract or preserve authority. It may not expand authority. Expansion remains an explicit governance transition backed by legitimate upstream rights.

Derived field state:

- horizon MREC
- liquid authority
- unresolved uncertainty
- maximum authority velocity
- observation lag
- dependency concentration
- authority pressure
- deterministic structural entropy index

The continuous safety envelope compares those derived metrics to explicit bounds. A breach may produce a `ContractionInstruction`; the instruction is valid only when limit, velocity, and offline horizon are each non-expansive.

## Observation / control coupling

Authority velocity must not outrun the system's ability to observe and contract consequence. Higher observation lag therefore permits only equal or lower automatic velocity/offline authority.

## Uncertainty

Automatic contraction may not erase reserved, committed, or uncertain economic consequence. Occupied consequence is a floor until evidence proves release or finality.

## Pressure

High legitimate demand does not create authority. Authority pressure is observable and may justify a governance proposal, but the automatic controller never expands capacity in response.

## Placement

`DynamicAuthorityPlacement` computes a conservation-preserving target distribution across domains. It is a plan only. Any domain whose target falls below its current live allocation is marked as requiring release proof before capacity may be reallocated elsewhere.

## Stress simulation

Stress scenarios run on copied field samples and cannot mutate constitutional state. Hypothetical contractions preserve occupied consequence; hypothetical uncertainty increases occupancy rather than silently disappearing.

## Proof

`AdaptiveResponseProofs.prove_non_expansion()` produces a deterministic digest proving the automatic plan did not increase aggregate authority limits or maximum authority velocity.

## Constitutional boundary

Metrics observe. Simulations explore. Controllers propose contraction. Placement plans propose redistribution. None of these primitives create rights, authorize expansion, or bypass normal commit semantics.
