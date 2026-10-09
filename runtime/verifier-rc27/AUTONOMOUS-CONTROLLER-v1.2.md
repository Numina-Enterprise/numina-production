# Numina Autonomous Institutional Controller v1.2

Numina v1.2 closes the control loop above the v1.1 Authority Physics runtime without granting the adaptive system sovereignty.

## Core law

**Optimization may search the authority field. Only legitimate governance may expand it.**

Automatic control can preserve or contract live authority. It cannot increase a live authority limit, velocity, or erase occupied/uncertain consequence. Expansion is represented as a proposal whose activation requires a governance proof, a current governance epoch, a distinct-approver threshold, and conservation under the parent capacity.

## Predictive authority control

`PredictiveAuthorityController` evaluates deterministic candidate trajectories over a bounded horizon. Each candidate produces projected authority-field metrics, a deterministic integer score, a constitutional-validity result, and a `requires_governance` flag.

`choose_automatic()` can select only a constitutionally valid trajectory that is non-expansive. If no such path exists it fails closed.

## Authority homeostasis

`HomeostasisTarget` defines target liquidity, pressure, uncertainty, observation lag, dependency concentration, and maximum horizon MREC. Targets guide optimization but create no rights and no executable authority.

## Governed expansion

`GovernedExpansion` deliberately separates expansion into three stages:

1. `propose()` creates an immutable expansion proposal bound to the source authority state.
2. `make_proof()` binds distinct approvers, threshold, and governance epoch to that proposal.
3. `authorize()` succeeds only if the proposal digest matches, the governance epoch is current, the threshold is met, and resulting aggregate authority remains within parent capacity.

## Counterfactual shadow universes

`CounterfactualShadowEngine` runs deterministic stress scenarios against copies of the authority field and produces immutable shadow-universe digests. Shadow execution cannot mutate live authority.

## Constitutional chaos

`ConstitutionalChaosEngine` accepts only contractive or uncertainty/lag-producing fault operators. It continuously checks that reusable authority does not increase under fault. There is intentionally no expansion chaos opcode.

## v1.2 invariants

- Predictive optimization does not create authority.
- Automatic control never selects an authority-expansive trajectory.
- Occupied economic consequence is a hard floor under all candidate trajectories.
- Pressure can influence scoring but cannot mint capacity.
- Counterfactual simulations never mutate live constitutional state.
- Governance expansion proofs are proposal-bound, epoch-bound, threshold-bound, and parent-capacity-bound.
- Fault injection may increase uncertainty; it may not convert uncertainty into reusable authority.
- Intelligence proposes; governance authorizes expansion; the Constitution enforces both.
