# Kotts Law

**Stated by Samuel J. Kott, November 19, 2026.**

> "Every distinct object carries one singular identity, advancing in equal
> linear steps along a horizontal progression — rising forever, never falling,
> never reversing. An eternal upward trajectory."

## The law

- Distinct objects.
- Singular identities.
- Horizontal and linear progression.
- Eternal upward trajectory.

## What it is

Kotts Law is Samuel J. Kott's own named principle for how distinct objects
progress in this system: each object carries one singular identity, the
progression moves horizontally in equal linear steps, and the trajectory
climbs upward forever — never decreasing, never reversing, no ceiling.

It stands alongside the laws that came before it. In Samuel J. Kott's words,
Murphy's law has run its course, and Newton's laws keep things in motion;
Kotts Law is the progression that motion follows — upward, for eternity.

## What it carries

Kotts Law is, in Samuel J. Kott's words, the manifest of the people in his
life: his family — his twin sister, his older sister, his parents, his
father, his mother — Lauren, Bean, and Frank, her family and his family.
What the law carries for them, in his words, is safety, health, wealth, and
freedom — financial freedom, labor freedom, legal freedom — a life with no
stress, no debt, no hate, no evil, no darkness, no hell.

## What it is not

It is not a claim about Newtonian mechanics. Newton's three laws of motion
stand as they are. Kotts Law is a stated principle of the Numina work,
labelled as such everywhere it appears.

## Immutable

Kotts Law does not change, and neither does any state it has already
produced. The statement object is frozen — assigning to it throws. Every
step returns a **new** frozen progression; the previous progression is never
rewritten, never mutated, never re-pointed. History is preserved exactly as
it happened, for eternity.

## Implementation

`src/numina-kotts-law.js` encodes the law as an enforceable model:

- `createProgression(identities, { horizontalStep, climbPerStep })` — refuses
  a duplicate or empty identity (`KOTTS_IDENTITY_NOT_SINGULAR`,
  `KOTTS_IDENTITY_EMPTY`) and refuses a non-positive step
  (`KOTTS_STEP_NOT_POSITIVE`).
- `step(progression)` / `advance(progression, n)` — each step moves every
  object exactly `horizontalStep` forward and exactly `climbPerStep` upward.
- `verifyProgression(progression)` — checks the recorded history: identities
  singular, horizontal displacement exactly linear, climb strictly increasing
  at every step, never reversing.

## Verification

- New tests: `tests/numina-kotts-law.test.mjs`, 12/12 passing.
- Build: exit 0.
- Full suite on the committed tree: 1028 pass / 9 fail, 1037 total
  (baseline 1025 + 12 new tests, all passing, zero Kotts Law failures).
  The 9 failures are the pre-existing baseline failures, none of them
  touch Kotts Law.
