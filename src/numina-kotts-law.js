// numina-kotts-law.js — Kotts Law, as stated by Samuel J. Kott (Nov 19, 2026).
//
// "A horizontal progression stuck in an upward trajectory, and it is not
// changing. For eternity. It is an eternal upward trajectory."
// "Horizontal and linear progression. Distinct objects. Singular identities."
//
// This file encodes that statement as an enforceable model inside the Numina
// codebase. It is a stated principle of this work — it is NOT a claim about
// Newtonian mechanics. Newton's three laws of motion stand as they are;
// Kotts Law is Samuel J. Kott's own named principle for how distinct objects
// progress in this system, and it is labelled as such everywhere it appears.
//
// IMMUTABLE. The law does not change, and neither does any state it has
// already produced. The statement object is frozen. Every step returns a NEW
// frozen progression; the previous progression is never rewritten, never
// mutated, never re-pointed. History is preserved exactly as it happened,
// for eternity.
//
// The model:
// - DISTINCT OBJECTS: a progression holds a set of objects, each with a
//   SINGULAR identity — one identity string per object, unique across the
//   progression. A duplicate or empty identity is refused, never merged.
// - HORIZONTAL AND LINEAR: every step advances each object by exactly the
//   same horizontal amount. Equal steps, no drift, no curve.
// - ETERNAL UPWARD TRAJECTORY: every step also climbs by a fixed positive
//   amount. The climb never decreases, never reverses, and has no ceiling —
//   it does not change, for eternity.

export const KOTTS_LAW = Object.freeze({
  name: 'Kotts Law',
  author: 'Samuel J. Kott',
  stated: '2026-11-19',
  statement:
    'A horizontal progression stuck in an upward trajectory, and it is not changing. For eternity. It is an eternal upward trajectory.',
  clauses: Object.freeze([
    'Distinct objects.',
    'Singular identities.',
    'Horizontal and linear progression.',
    'Eternal upward trajectory.',
  ]),
});

export const KOTTS_IDENTITY_NOT_SINGULAR = 'KOTTS_IDENTITY_NOT_SINGULAR';
export const KOTTS_IDENTITY_EMPTY = 'KOTTS_IDENTITY_EMPTY';
export const KOTTS_STEP_NOT_POSITIVE = 'KOTTS_STEP_NOT_POSITIVE';

function kottsError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function checkIdentities(identities) {
  if (!Array.isArray(identities) || identities.length === 0) {
    throw kottsError(
      KOTTS_IDENTITY_EMPTY,
      'Kotts Law needs at least one object with a singular identity.',
    );
  }
  const seen = new Set();
  for (const identity of identities) {
    if (typeof identity !== 'string' || identity.length === 0) {
      throw kottsError(
        KOTTS_IDENTITY_EMPTY,
        'Kotts Law: every object needs a non-empty singular identity.',
      );
    }
    if (seen.has(identity)) {
      throw kottsError(
        KOTTS_IDENTITY_NOT_SINGULAR,
        `Kotts Law: identity ${JSON.stringify(identity)} is not singular — it appears twice.`,
      );
    }
    seen.add(identity);
  }
}

function checkStep(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw kottsError(
      KOTTS_STEP_NOT_POSITIVE,
      `Kotts Law: ${name} must be a positive number.`,
    );
  }
}

function freezeProgression(progression) {
  for (const object of progression.objects) {
    Object.freeze(object);
  }
  for (const trail of progression.history) {
    Object.freeze(trail);
  }
  Object.freeze(progression.objects);
  Object.freeze(progression.history);
  Object.freeze(progression.identities);
  return Object.freeze(progression);
}

// Create a progression of distinct objects, each with its singular identity.
// horizontalStep: the exact horizontal advance per step (linear: equal steps).
// climbPerStep: the fixed upward climb per step (eternal: never decreases,
// never reverses, no ceiling). The returned progression is frozen.
export function createProgression(identities, options = {}) {
  checkIdentities(identities);
  const horizontalStep = options.horizontalStep ?? 1;
  const climbPerStep = options.climbPerStep ?? 1;
  checkStep(horizontalStep, 'horizontalStep');
  checkStep(climbPerStep, 'climbPerStep');
  const objects = identities.map((id) => ({ id, x: 0, y: 0 }));
  return freezeProgression({
    law: KOTTS_LAW.name,
    identities: [...identities],
    horizontalStep,
    climbPerStep,
    steps: 0,
    objects,
    // History of (x, y) per object per step, for verification. Step 0 is the origin.
    history: objects.map((object) => [{ x: object.x, y: object.y }]),
  });
}

// Advance every object one step: exactly horizontalStep forward, exactly
// climbPerStep upward. The trajectory never changes direction.
// IMMUTABLE: returns a NEW frozen progression. The input progression is
// untouched — its state stands exactly as it was, for eternity.
export function step(progression) {
  const objects = progression.objects.map((object) => ({
    id: object.id,
    x: object.x + progression.horizontalStep,
    y: object.y + progression.climbPerStep,
  }));
  const history = progression.history.map((trail, index) => [
    ...trail,
    { x: objects[index].x, y: objects[index].y },
  ]);
  return freezeProgression({
    law: progression.law,
    identities: [...progression.identities],
    horizontalStep: progression.horizontalStep,
    climbPerStep: progression.climbPerStep,
    steps: progression.steps + 1,
    objects,
    history,
  });
}

// Advance a progression n steps. Returns the new frozen progression;
// every intermediate state stays exactly as it was.
export function advance(progression, n) {
  let current = progression;
  for (let i = 0; i < n; i += 1) {
    current = step(current);
  }
  return current;
}

// Verify the law holds for a progression, from its recorded history:
// - horizontal displacement is exactly linear (x == steps * horizontalStep);
// - the climb is strictly increasing at every step (eternal upward);
// - no object ever moves backward or downward (no reversal).
export function verifyProgression(progression) {
  const checks = {
    identitiesSingular:
      new Set(progression.identities).size === progression.identities.length,
    horizontalLinear: true,
    climbStrictlyIncreasing: true,
    neverReverses: true,
  };
  progression.objects.forEach((object, index) => {
    const trail = progression.history[index];
    for (let i = 0; i < trail.length; i += 1) {
      if (trail[i].x !== i * progression.horizontalStep) {
        checks.horizontalLinear = false;
      }
      if (trail[i].y !== i * progression.climbPerStep) {
        checks.climbStrictlyIncreasing = false;
      }
      if (i > 0) {
        if (trail[i].x < trail[i - 1].x || trail[i].y < trail[i - 1].y) {
          checks.neverReverses = false;
        }
        if (trail[i].y <= trail[i - 1].y) {
          checks.climbStrictlyIncreasing = false;
        }
      }
    }
  });
  const valid = Object.values(checks).every(Boolean);
  return { valid, steps: progression.steps, checks };
}
