import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KOTTS_LAW,
  KOTTS_IDENTITY_NOT_SINGULAR,
  KOTTS_IDENTITY_EMPTY,
  KOTTS_STEP_NOT_POSITIVE,
  createProgression,
  step,
  advance,
  verifyProgression,
} from '../src/numina-kotts-law.js';

describe('Kotts Law', () => {
  it('states the law in the owner’s own words', () => {
    assert.equal(KOTTS_LAW.name, 'Kotts Law');
    assert.equal(KOTTS_LAW.author, 'Samuel J. Kott');
    assert.equal(KOTTS_LAW.stated, '2026-11-19');
    assert.match(KOTTS_LAW.statement, /advancing in equal linear steps along a horizontal progression/);
    assert.match(KOTTS_LAW.statement, /eternal upward trajectory/);
    assert.deepEqual(KOTTS_LAW.clauses, [
      'Distinct objects.',
      'Singular identities.',
      'Horizontal and linear progression.',
      'Eternal upward trajectory.',
    ]);
  });

  it('is immutable: the law itself cannot be changed', () => {
    assert.equal(Object.isFrozen(KOTTS_LAW), true);
    assert.equal(Object.isFrozen(KOTTS_LAW.clauses), true);
    assert.throws(
      () => {
        KOTTS_LAW.statement = 'something else';
      },
      TypeError,
    );
    assert.throws(
      () => {
        KOTTS_LAW.clauses.push('A new clause.');
      },
      TypeError,
    );
    assert.match(KOTTS_LAW.statement, /eternal upward trajectory/);
  });

  it('is immutable: every progression is frozen', () => {
    const progression = createProgression(['node-01', 'node-02']);
    assert.equal(Object.isFrozen(progression), true);
    assert.equal(Object.isFrozen(progression.identities), true);
    assert.equal(Object.isFrozen(progression.objects), true);
    for (const object of progression.objects) {
      assert.equal(Object.isFrozen(object), true);
    }
    for (const trail of progression.history) {
      assert.equal(Object.isFrozen(trail), true);
    }
  });

  it('is immutable: a step returns a new progression and leaves the old one untouched', () => {
    const before = createProgression(['node-01'], {
      horizontalStep: 3,
      climbPerStep: 2,
    });
    const after = step(before);
    assert.notEqual(after, before);
    // The old state stands exactly as it was.
    assert.equal(before.steps, 0);
    assert.deepEqual(before.objects[0], { id: 'node-01', x: 0, y: 0 });
    assert.equal(before.history[0].length, 1);
    // The new state moved one step.
    assert.equal(after.steps, 1);
    assert.deepEqual(after.objects[0], { id: 'node-01', x: 3, y: 2 });
    assert.equal(after.history[0].length, 2);
  });

  it('is immutable: earlier states stay exactly as they were after many steps', () => {
    const start = createProgression(['node-01']);
    const atThree = advance(start, 3);
    const atTen = advance(atThree, 7);
    assert.equal(atTen.steps, 10);
    assert.deepEqual(atTen.objects[0], { id: 'node-01', x: 10, y: 10 });
    // The step-3 state was never rewritten.
    assert.equal(atThree.steps, 3);
    assert.deepEqual(atThree.objects[0], { id: 'node-01', x: 3, y: 3 });
    assert.equal(atThree.history[0].length, 4);
    assert.equal(start.steps, 0);
    assert.deepEqual(start.objects[0], { id: 'node-01', x: 0, y: 0 });
  });

  it('refuses a duplicate identity — identities must be singular', () => {
    assert.throws(
      () => createProgression(['node-01', 'node-01']),
      (error) => error.code === KOTTS_IDENTITY_NOT_SINGULAR,
    );
  });

  it('refuses an empty identity', () => {
    assert.throws(
      () => createProgression(['node-01', '']),
      (error) => error.code === KOTTS_IDENTITY_EMPTY,
    );
    assert.throws(
      () => createProgression([]),
      (error) => error.code === KOTTS_IDENTITY_EMPTY,
    );
  });

  it('refuses a non-positive step — the trajectory only climbs', () => {
    assert.throws(
      () => createProgression(['node-01'], { climbPerStep: 0 }),
      (error) => error.code === KOTTS_STEP_NOT_POSITIVE,
    );
    assert.throws(
      () => createProgression(['node-01'], { horizontalStep: -1 }),
      (error) => error.code === KOTTS_STEP_NOT_POSITIVE,
    );
  });

  it('advances horizontally in exactly equal, linear steps', () => {
    const progression = advance(
      createProgression(['node-01', 'node-02'], {
        horizontalStep: 3,
        climbPerStep: 2,
      }),
      5,
    );
    for (const object of progression.objects) {
      assert.equal(object.x, 15);
      assert.equal(object.y, 10);
    }
    assert.equal(progression.steps, 5);
  });

  it('climbs strictly upward at every step and never reverses', () => {
    const progression = advance(createProgression(['node-01']), 100);
    const trail = progression.history[0];
    assert.equal(trail.length, 101);
    for (let i = 1; i < trail.length; i += 1) {
      assert.ok(trail[i].x > trail[i - 1].x, `x must increase at step ${i}`);
      assert.ok(trail[i].y > trail[i - 1].y, `y must increase at step ${i}`);
    }
    // No ceiling: after 100 steps the climb is still going.
    assert.equal(trail[100].y, 100);
  });

  it('verifies a good progression and rejects a tampered one', () => {
    const progression = advance(createProgression(['node-01', 'node-02']), 10);
    const good = verifyProgression(progression);
    assert.equal(good.valid, true);
    assert.equal(good.steps, 10);
    assert.deepEqual(good.checks, {
      identitiesSingular: true,
      horizontalLinear: true,
      climbStrictlyIncreasing: true,
      neverReverses: true,
    });

    // A forged history that drags one object backward and downward.
    // (A real progression cannot be tampered with — it is frozen — so the
    // forgery is built as a plain record.)
    const tampered = {
      identities: ['node-01', 'node-02'],
      horizontalStep: 1,
      climbPerStep: 1,
      steps: 11,
      objects: [
        { id: 'node-01', x: 5, y: 5 },
        { id: 'node-02', x: 10, y: 10 },
      ],
      history: [
        [...progression.history[0], { x: 5, y: 5 }],
        progression.history[1],
      ],
    };
    const bad = verifyProgression(tampered);
    assert.equal(bad.valid, false);
    assert.equal(bad.checks.neverReverses, false);
  });

  it('step() advances one step and returns the new progression', () => {
    const before = createProgression(['node-01']);
    const after = step(before);
    assert.notEqual(after, before);
    assert.equal(after.steps, 1);
    assert.deepEqual(after.objects[0], { id: 'node-01', x: 1, y: 1 });
    assert.equal(before.steps, 0);
  });
});
