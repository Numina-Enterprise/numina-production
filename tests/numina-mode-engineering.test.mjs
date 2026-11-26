// numina-mode-engineering.test.mjs — MODE ENGINEERING for Numina.
//
// Source: the diagram the owner pasted Nov 21, 2026 ("viktor, the
// AI employee"): one AI employee, four amounts of intelligence,
// one mode per place, set once. The tests below check the diagram's
// contracts exactly as drawn — nothing beyond the diagram is
// asserted.
//
// What these tests prove:
//   - Registry: the default table is the diagram's four channels
//     with their tiers and output contracts; one mode per place,
//     set once (a second set is refused outside retuneMode);
//     re-tune needs a reason and is recorded with from/to/at.
//   - Tiers: ULTRA/BALANCED return judgment/routine a human
//     reads; CHEAP returns tags only (prose refused); SCRIPT
//     returns one right answer with NO model call — the model
//     hook is a throwing stub on the SCRIPT path, so any model
//     invocation would fail the test, not pass silently.
//   - Fixed steps in code: each tier runs its fixed pipeline in
//     order; condition scripts (if/AST data) select which steps
//     run; a step whose condition is false does not run and its
//     model call is not made.
//   - Condition scripts: the if/AST evaluator over all ops,
//     fail-closed on unknown ops, malformed nodes and missing
//     fields (presence is tested with 'has'/'exists').
//   - Fail-closed: unknown channel, unset channel (no silent
//     default to ULTRA), missing model hook, missing compute
//     hook, multiple SCRIPT answers, prose on CHEAP.
//   - Usage page: per-channel calls / model calls / budget
//     units (routing weights, not measured costs) plus totals
//     and the tune history.
//
// No cost saving is claimed here: budget units are routing
// weights (ULTRA 4, BALANCED 3, CHEAP 2, SCRIPT 1, mirroring
// the diagram's bars), not measurements against a live model.
// No network call and no model call is made by this module in
// these tests except through the caller-supplied stubs, which
// record their invocations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_EMPLOYEE,
  MODE_TAGLINE,
  MODE_CHANNELS,
  MODE_TIERS,
  DEFAULT_MODES,
  FIXED_STEPS,
  DIAGRAM_LABELS,
  ModeEngineeringError,
  validateCondition,
  evaluateCondition,
  validateOutputForTier,
  createModeRegistry,
  defaultModeRegistry,
} from '../src/numina-mode-engineering.js';

function throwsCode(fn, code) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(
    caught instanceof ModeEngineeringError,
    `expected a ModeEngineeringError, got ${caught}`,
  );
  assert.equal(caught.code, code);
  assert.equal(caught.reason, code);
  return caught;
}

function modelStub(returnValue) {
  let calls = 0;
  const callsLog = [];
  const fn = (prompt) => {
    calls += 1;
    callsLog.push(prompt);
    return typeof returnValue === 'function' ? returnValue(prompt) : returnValue;
  };
  fn.calls = () => calls;
  fn.callsLog = () => callsLog;
  return fn;
}

function explodingModelStub() {
  let calls = 0;
  const fn = () => {
    calls += 1;
    throw new Error('model must never be called on the SCRIPT path');
  };
  fn.calls = () => calls;
  return fn;
}

// ---------------------------------------------------------------------
// Diagram transcription
// ---------------------------------------------------------------------

test('diagram: employee, tagline and labels are recorded verbatim', () => {
  assert.equal(MODE_EMPLOYEE, 'viktor');
  assert.equal(MODE_TAGLINE, 'STOP PAYING A TOP MODEL FOR EVERY STEP');
  assert.deepEqual(DIAGRAM_LABELS, { IF_AST: 'IF/AST', IDEEP: 'IDEEP' });
});

test('diagram: default table is the four channels with their tiers', () => {
  assert.deepEqual(MODE_CHANNELS, [
    '#RESEARCH',
    '#STANDUP',
    'INTAKE',
    'NIGHTLY SYNC',
  ]);
  assert.deepEqual(DEFAULT_MODES, {
    '#RESEARCH': 'ULTRA',
    '#STANDUP': 'BALANCED',
    INTAKE: 'CHEAP',
    'NIGHTLY SYNC': 'SCRIPT',
  });
});

test('diagram: tiers carry the bars and output contracts as drawn', () => {
  assert.equal(MODE_TIERS.ULTRA.bars, 4);
  assert.equal(MODE_TIERS.ULTRA.outputContract, 'JUDGMENT A HUMAN READS');
  assert.equal(MODE_TIERS.BALANCED.bars, 3);
  assert.equal(MODE_TIERS.BALANCED.outputContract, 'ROUTINE A HUMAN READS');
  assert.equal(MODE_TIERS.CHEAP.bars, 2);
  assert.equal(
    MODE_TIERS.CHEAP.outputContract,
    'TAGS NOBODY READS AS PROSE',
  );
  assert.equal(MODE_TIERS.SCRIPT.bars, 1);
  assert.equal(
    MODE_TIERS.SCRIPT.outputContract,
    'ONE RIGHT ANSWER · NO MODEL',
  );
  // Budget weights mirror the bars; they are routing weights,
  // not measured costs.
  assert.equal(MODE_TIERS.ULTRA.budgetWeight, 4);
  assert.equal(MODE_TIERS.BALANCED.budgetWeight, 3);
  assert.equal(MODE_TIERS.CHEAP.budgetWeight, 2);
  assert.equal(MODE_TIERS.SCRIPT.budgetWeight, 1);
  // Model / prose permissions per tier.
  assert.equal(MODE_TIERS.ULTRA.modelAllowed, true);
  assert.equal(MODE_TIERS.BALANCED.modelAllowed, true);
  assert.equal(MODE_TIERS.CHEAP.modelAllowed, true);
  assert.equal(MODE_TIERS.CHEAP.proseAllowed, false);
  assert.equal(MODE_TIERS.SCRIPT.modelAllowed, false);
  assert.equal(MODE_TIERS.SCRIPT.proseAllowed, false);
});

test('diagram: fixed steps per tier are fixed lists', () => {
  assert.deepEqual(FIXED_STEPS.ULTRA, [
    'validate',
    'gather-context',
    'model-judgment',
    'format-judgment',
  ]);
  assert.deepEqual(FIXED_STEPS.BALANCED, [
    'validate',
    'gather-context',
    'model-routine',
    'format-routine',
  ]);
  assert.deepEqual(FIXED_STEPS.CHEAP, [
    'validate',
    'model-tags',
    'format-tags',
  ]);
  assert.deepEqual(FIXED_STEPS.SCRIPT, [
    'validate',
    'compute-answer',
    'format-single-answer',
  ]);
  // SCRIPT has no model step anywhere in its pipeline.
  assert.ok(!FIXED_STEPS.SCRIPT.some((step) => step.startsWith('model-')));
});

// ---------------------------------------------------------------------
// Registry: one mode per place, set once
// ---------------------------------------------------------------------

test('registry: default registry holds the diagram table', () => {
  const registry = defaultModeRegistry();
  assert.equal(registry.getMode('#RESEARCH'), 'ULTRA');
  assert.equal(registry.getMode('#STANDUP'), 'BALANCED');
  assert.equal(registry.getMode('INTAKE'), 'CHEAP');
  assert.equal(registry.getMode('NIGHTLY SYNC'), 'SCRIPT');
  assert.deepEqual(registry.listModes(), DEFAULT_MODES);
});

test('registry: unknown channel is refused', () => {
  const registry = defaultModeRegistry();
  throwsCode(() => registry.getMode('#UNKNOWN'), 'MODE_UNKNOWN_CHANNEL');
  throwsCode(
    () => registry.setMode('#UNKNOWN', 'ULTRA'),
    'MODE_UNKNOWN_CHANNEL',
  );
  throwsCode(
    () => registry.retuneMode('#UNKNOWN', 'ULTRA', { reason: 'x' }),
    'MODE_UNKNOWN_CHANNEL',
  );
  throwsCode(() => registry.getMode(42), 'MODE_UNKNOWN_CHANNEL');
});

test('registry: unknown tier is refused', () => {
  const registry = defaultModeRegistry();
  throwsCode(
    () => registry.setMode('INTAKE', 'MEGA'),
    'MODE_TIER_UNKNOWN',
  );
  throwsCode(
    () => registry.retuneMode('#RESEARCH', 'MEGA', { reason: 'x' }),
    'MODE_TIER_UNKNOWN',
  );
});

test('registry: a channel with no mode set is refused, no silent ULTRA', () => {
  const registry = createModeRegistry({});
  assert.deepEqual(registry.listModes(), {});
  for (const channel of MODE_CHANNELS) {
    throwsCode(() => registry.getMode(channel), 'MODE_NOT_SET');
  }
  throwsCode(
    () =>
      registry.dispatch('#RESEARCH', { input: 'hi' }, { model: modelStub('x') }),
    'MODE_NOT_SET',
  );
});

test('registry: setMode sets once; a second set is refused', () => {
  const registry = createModeRegistry({});
  assert.equal(registry.setMode('#RESEARCH', 'ULTRA'), 'ULTRA');
  assert.equal(registry.getMode('#RESEARCH'), 'ULTRA');
  throwsCode(() => registry.setMode('#RESEARCH', 'BALANCED'), 'MODE_ALREADY_SET');
  // The first mode stands.
  assert.equal(registry.getMode('#RESEARCH'), 'ULTRA');
});

test('registry: retuneMode changes the mode and records from/to/reason/at', () => {
  const registry = defaultModeRegistry();
  const before = registry.tuneHistory().length;
  registry.retuneMode('INTAKE', 'BALANCED', {
    reason: 'intake needs routine prose for a week',
    at: '2026-11-21T13:00:00.000Z',
  });
  assert.equal(registry.getMode('INTAKE'), 'BALANCED');
  const history = registry.tuneHistory();
  assert.equal(history.length, before + 1);
  const last = history[history.length - 1];
  assert.equal(last.channel, 'INTAKE');
  assert.equal(last.from, 'CHEAP');
  assert.equal(last.to, 'BALANCED');
  assert.equal(last.reason, 'intake needs routine prose for a week');
  assert.equal(last.at, '2026-11-21T13:00:00.000Z');
});

test('registry: retuneMode without a reason is refused', () => {
  const registry = defaultModeRegistry();
  throwsCode(
    () => registry.retuneMode('INTAKE', 'BALANCED', {}),
    'MODE_RETUNE_REASON_REQUIRED',
  );
  throwsCode(
    () => registry.retuneMode('INTAKE', 'BALANCED', { reason: '   ' }),
    'MODE_RETUNE_REASON_REQUIRED',
  );
  assert.equal(registry.getMode('INTAKE'), 'CHEAP');
});

test('registry: retuneMode on an unset channel records from null', () => {
  const registry = createModeRegistry({});
  registry.retuneMode('#STANDUP', 'BALANCED', {
    reason: 'first set via re-tune path',
    at: '2026-11-21T13:00:00.000Z',
  });
  const last = registry.tuneHistory()[registry.tuneHistory().length - 1];
  assert.equal(last.from, null);
  assert.equal(last.to, 'BALANCED');
});

test('registry: tune history is a frozen copy, not the live list', () => {
  const registry = defaultModeRegistry();
  const history = registry.tuneHistory();
  assert.ok(Object.isFrozen(history));
  assert.equal(history.length, 4); // the four initial sets
  assert.ok(history.every((entry) => entry.reason === 'initial mode, set once'));
});

// ---------------------------------------------------------------------
// Condition scripts (IF/AST)
// ---------------------------------------------------------------------

test('conditions: literal, has, exists', () => {
  const ctx = { a: 1, b: { c: 'x' } };
  assert.equal(evaluateCondition({ op: 'literal', value: true }, ctx), true);
  assert.equal(evaluateCondition({ op: 'literal', value: false }, ctx), false);
  assert.equal(evaluateCondition({ op: 'has', field: 'a' }, ctx), true);
  assert.equal(evaluateCondition({ op: 'has', field: 'zzz' }, ctx), false);
  assert.equal(evaluateCondition({ op: 'exists', field: 'b.c' }, ctx), true);
  assert.equal(evaluateCondition({ op: 'exists', field: 'b.zzz' }, ctx), false);
});

test('conditions: comparisons and dot-paths', () => {
  const ctx = { n: 5, s: 'hi', nested: { v: 10 } };
  assert.equal(evaluateCondition({ op: 'eq', field: 'n', value: 5 }, ctx), true);
  assert.equal(evaluateCondition({ op: 'eq', field: 'n', value: 6 }, ctx), false);
  assert.equal(evaluateCondition({ op: 'neq', field: 's', value: 'bye' }, ctx), true);
  assert.equal(evaluateCondition({ op: 'gt', field: 'n', value: 4 }, ctx), true);
  assert.equal(evaluateCondition({ op: 'gte', field: 'n', value: 5 }, ctx), true);
  assert.equal(evaluateCondition({ op: 'lt', field: 'nested.v', value: 11 }, ctx), true);
  assert.equal(evaluateCondition({ op: 'lte', field: 'nested.v', value: 9 }, ctx), false);
  assert.equal(
    evaluateCondition({ op: 'in', field: 's', values: ['hi', 'yo'] }, ctx),
    true,
  );
  assert.equal(
    evaluateCondition({ op: 'in', field: 's', values: ['yo'] }, ctx),
    false,
  );
});

test('conditions: and / or / not compose, nested', () => {
  const ctx = { a: 1, b: 2, flag: true };
  assert.equal(
    evaluateCondition(
      {
        op: 'and',
        args: [
          { op: 'eq', field: 'a', value: 1 },
          { op: 'eq', field: 'b', value: 2 },
        ],
      },
      ctx,
    ),
    true,
  );
  assert.equal(
    evaluateCondition(
      {
        op: 'and',
        args: [
          { op: 'eq', field: 'a', value: 1 },
          { op: 'eq', field: 'b', value: 3 },
        ],
      },
      ctx,
    ),
    false,
  );
  assert.equal(
    evaluateCondition(
      {
        op: 'or',
        args: [
          { op: 'eq', field: 'a', value: 9 },
          { op: 'not', arg: { op: 'eq', field: 'flag', value: false } },
        ],
      },
      ctx,
    ),
    true,
  );
  assert.equal(
    evaluateCondition(
      { op: 'not', arg: { op: 'literal', value: true } },
      ctx,
    ),
    false,
  );
});

test('conditions: fail-closed on unknown op, malformed node, missing field', () => {
  const ctx = { a: 1 };
  throwsCode(
    () => evaluateCondition({ op: 'xor', args: [] }, ctx),
    'MODE_CONDITION_INVALID',
  );
  throwsCode(() => evaluateCondition('eq', ctx), 'MODE_CONDITION_INVALID');
  throwsCode(() => evaluateCondition({ op: 'and', args: [] }, ctx), 'MODE_CONDITION_INVALID');
  throwsCode(
    () => evaluateCondition({ op: 'eq', field: 'missing', value: 1 }, ctx),
    'MODE_CONDITION_INVALID',
  );
  throwsCode(
    () => evaluateCondition({ op: 'gt', field: 'missing', value: 1 }, ctx),
    'MODE_CONDITION_INVALID',
  );
  throwsCode(
    () => evaluateCondition({ op: 'gt', field: 'a', value: 'not-a-number' }, ctx),
    'MODE_CONDITION_INVALID',
  );
  throwsCode(
    () => evaluateCondition({ op: 'eq', field: 'a' }, ctx),
    'MODE_CONDITION_INVALID',
  );
  throwsCode(() => validateCondition(null), 'MODE_CONDITION_INVALID');
  // Non-numeric field in a numeric comparison is refused.
  throwsCode(
    () => evaluateCondition({ op: 'gt', field: 'a', value: 1 }, { a: 'one' }),
    'MODE_CONDITION_INVALID',
  );
});

test('conditions: setConditionScript validates and selects steps', () => {
  const registry = defaultModeRegistry();
  const model = modelStub('judgment text');
  // Skip gather-context when the request is marked light.
  registry.setConditionScript('#RESEARCH', {
    'gather-context': { op: 'eq', field: 'light', value: false },
  });
  const light = registry.dispatch(
    '#RESEARCH',
    { input: 'q', context: { light: true } },
    { model },
  );
  assert.deepEqual(light.stepsRun, [
    'validate',
    'model-judgment',
    'format-judgment',
  ]);
  assert.equal(model.calls(), 1);
  const heavy = registry.dispatch(
    '#RESEARCH',
    { input: 'q', context: { light: false } },
    { model },
  );
  assert.deepEqual(heavy.stepsRun, [
    'validate',
    'gather-context',
    'model-judgment',
    'format-judgment',
  ]);
});

test('conditions: a false condition on the model step means no model call', () => {
  const registry = defaultModeRegistry();
  const model = modelStub('judgment text');
  registry.setConditionScript('#RESEARCH', {
    'model-judgment': { op: 'literal', value: false },
  });
  // The model step is skipped, so no model output exists and the
  // pipeline refuses with no output rather than calling a model.
  throwsCode(
    () =>
      registry.dispatch('#RESEARCH', { input: 'q', context: {} }, { model }),
    'MODE_OUTPUT_REFUSED',
  );
  assert.equal(model.calls(), 0);
});

test('conditions: unknown step or invalid AST refused at set time', () => {
  const registry = defaultModeRegistry();
  throwsCode(
    () =>
      registry.setConditionScript('#RESEARCH', {
        'not-a-step': { op: 'literal', value: true },
      }),
    'MODE_CONDITION_INVALID',
  );
  throwsCode(
    () =>
      registry.setConditionScript('#RESEARCH', {
        validate: { op: 'xor', args: [] },
      }),
    'MODE_CONDITION_INVALID',
  );
  assert.deepEqual(registry.conditionScripts('#RESEARCH'), {});
});

// ---------------------------------------------------------------------
// Dispatch: model tiers
// ---------------------------------------------------------------------

test('dispatch ULTRA: one model call, judgment returned, usage recorded', () => {
  const registry = defaultModeRegistry();
  const model = modelStub('The evidence supports X.');
  const result = registry.dispatch(
    '#RESEARCH',
    { input: 'assess X', context: { topic: 'X' } },
    { model },
  );
  assert.equal(result.channel, '#RESEARCH');
  assert.equal(result.tier, 'ULTRA');
  assert.equal(result.outputContract, 'JUDGMENT A HUMAN READS');
  assert.equal(result.output, 'The evidence supports X.');
  assert.equal(result.modelCalls, 1);
  assert.equal(result.budgetWeight, 4);
  assert.deepEqual(result.stepsRun, [
    'validate',
    'gather-context',
    'model-judgment',
    'format-judgment',
  ]);
  assert.equal(model.calls(), 1);
  assert.equal(model.callsLog()[0].tier, 'ULTRA');
  assert.equal(model.callsLog()[0].channel, '#RESEARCH');
});

test('dispatch BALANCED: routine output a human reads', () => {
  const registry = defaultModeRegistry();
  const model = modelStub('Standup: 3 done, 2 in flight.');
  const result = registry.dispatch(
    '#STANDUP',
    { input: 'standup notes' },
    { model },
  );
  assert.equal(result.tier, 'BALANCED');
  assert.equal(result.output, 'Standup: 3 done, 2 in flight.');
  assert.equal(result.modelCalls, 1);
  assert.equal(result.budgetWeight, 3);
});

test('dispatch: model tier without a model hook is refused', () => {
  const registry = defaultModeRegistry();
  throwsCode(
    () => registry.dispatch('#RESEARCH', { input: 'q' }, {}),
    'MODE_MODEL_REQUIRED',
  );
  throwsCode(
    () => registry.dispatch('#STANDUP', { input: 'q' }, {}),
    'MODE_MODEL_REQUIRED',
  );
  throwsCode(
    () => registry.dispatch('INTAKE', { input: 'q' }, {}),
    'MODE_MODEL_REQUIRED',
  );
});

test('dispatch: request without input is refused', () => {
  const registry = defaultModeRegistry();
  const model = modelStub('x');
  throwsCode(
    () => registry.dispatch('#RESEARCH', {}, { model }),
    'MODE_REQUEST_INVALID',
  );
  throwsCode(
    () => registry.dispatch('#RESEARCH', null, { model }),
    'MODE_REQUEST_INVALID',
  );
  assert.equal(model.calls(), 0);
});

test('dispatch: unknown channel is refused before any work', () => {
  const registry = defaultModeRegistry();
  const model = modelStub('x');
  throwsCode(
    () => registry.dispatch('#NOPE', { input: 'q' }, { model }),
    'MODE_UNKNOWN_CHANNEL',
  );
  assert.equal(model.calls(), 0);
});

// ---------------------------------------------------------------------
// Dispatch: CHEAP tier — tags only, prose refused
// ---------------------------------------------------------------------

test('dispatch CHEAP: tags object passes, prose is refused', () => {
  const registry = defaultModeRegistry();
  const tags = modelStub({ topic: ['quantum'], priority: 'high' });
  const result = registry.dispatch('INTAKE', { input: 'note text' }, { model: tags });
  assert.equal(result.tier, 'CHEAP');
  assert.deepEqual(result.output, { topic: ['quantum'], priority: 'high' });
  assert.equal(result.modelCalls, 1);
  assert.equal(result.budgetWeight, 2);

  const prose = modelStub('This is a long prose summary nobody reads.');
  throwsCode(
    () => registry.dispatch('INTAKE', { input: 'note text' }, { model: prose }),
    'MODE_PROSE_REFUSED',
  );
});

test('output contract: CHEAP accepts tags, refuses strings and numbers', () => {
  assert.equal(validateOutputForTier('CHEAP', { a: ['x'] }), true);
  assert.equal(validateOutputForTier('CHEAP', { a: 'x', b: [] }), true);
  throwsCode(() => validateOutputForTier('CHEAP', 'prose'), 'MODE_PROSE_REFUSED');
  throwsCode(() => validateOutputForTier('CHEAP', 42), 'MODE_PROSE_REFUSED');
  throwsCode(
    () => validateOutputForTier('CHEAP', { a: 42 }),
    'MODE_PROSE_REFUSED',
  );
  throwsCode(
    () => validateOutputForTier('CHEAP', { a: [1] }),
    'MODE_PROSE_REFUSED',
  );
});

test('output contract: ULTRA/BALANCED need a non-empty string', () => {
  assert.equal(validateOutputForTier('ULTRA', 'judgment'), true);
  throwsCode(() => validateOutputForTier('ULTRA', ''), 'MODE_OUTPUT_REFUSED');
  throwsCode(() => validateOutputForTier('ULTRA', '   '), 'MODE_OUTPUT_REFUSED');
  throwsCode(() => validateOutputForTier('BALANCED', { a: 1 }), 'MODE_OUTPUT_REFUSED');
});

// ---------------------------------------------------------------------
// Dispatch: SCRIPT tier — one right answer, NO model
// ---------------------------------------------------------------------

test('dispatch SCRIPT: deterministic answer, model hook never invoked', () => {
  const registry = defaultModeRegistry();
  const model = explodingModelStub();
  let computeCalls = 0;
  const compute = (input) => {
    computeCalls += 1;
    return `synced:${input.count}`;
  };
  const result = registry.dispatch(
    'NIGHTLY SYNC',
    { input: { count: 7 } },
    { model, compute },
  );
  assert.equal(result.tier, 'SCRIPT');
  assert.equal(result.outputContract, 'ONE RIGHT ANSWER · NO MODEL');
  assert.equal(result.output, 'synced:7');
  assert.equal(result.modelCalls, 0);
  assert.equal(model.calls(), 0);
  assert.equal(computeCalls, 1);
  assert.equal(result.budgetWeight, 1);
  assert.deepEqual(result.stepsRun, [
    'validate',
    'compute-answer',
    'format-single-answer',
  ]);
});

test('dispatch SCRIPT: works with no model hook supplied at all', () => {
  const registry = defaultModeRegistry();
  const result = registry.dispatch(
    'NIGHTLY SYNC',
    { input: { count: 3 } },
    { compute: (input) => input.count * 2 },
  );
  assert.equal(result.output, 6);
  assert.equal(result.modelCalls, 0);
});

test('dispatch SCRIPT: missing compute hook is refused', () => {
  const registry = defaultModeRegistry();
  throwsCode(
    () =>
      registry.dispatch('NIGHTLY SYNC', { input: { count: 1 } }, {}),
    'MODE_COMPUTE_REQUIRED',
  );
});

test('dispatch SCRIPT: multiple answers are refused', () => {
  const registry = defaultModeRegistry();
  throwsCode(
    () =>
      registry.dispatch(
        'NIGHTLY SYNC',
        { input: { count: 1 } },
        { compute: () => [1, 2] },
      ),
    'MODE_MULTIPLE_ANSWERS',
  );
  throwsCode(
    () =>
      registry.dispatch(
        'NIGHTLY SYNC',
        { input: { count: 1 } },
        { compute: () => undefined },
      ),
    'MODE_MULTIPLE_ANSWERS',
  );
});

test('output contract: SCRIPT accepts one value, refuses lists and empties', () => {
  assert.equal(validateOutputForTier('SCRIPT', 42), true);
  assert.equal(validateOutputForTier('SCRIPT', 'done'), true);
  assert.equal(validateOutputForTier('SCRIPT', { answer: 1 }), true);
  throwsCode(() => validateOutputForTier('SCRIPT', [1, 2]), 'MODE_MULTIPLE_ANSWERS');
  throwsCode(() => validateOutputForTier('SCRIPT', null), 'MODE_MULTIPLE_ANSWERS');
  throwsCode(() => validateOutputForTier('SCRIPT', undefined), 'MODE_MULTIPLE_ANSWERS');
  throwsCode(
    () => validateOutputForTier('SCRIPT', { a: 1, b: 2 }),
    'MODE_MULTIPLE_ANSWERS',
  );
});

// ---------------------------------------------------------------------
// Usage page
// ---------------------------------------------------------------------

test('usage page: counts calls, model calls and budget units per channel', () => {
  const registry = defaultModeRegistry();
  const model = modelStub((prompt) =>
    prompt.tier === 'CHEAP' ? { t: ['x'] } : 'text',
  );
  registry.dispatch('#RESEARCH', { input: 'a' }, { model });
  registry.dispatch('#RESEARCH', { input: 'b' }, { model });
  registry.dispatch('#STANDUP', { input: 'c' }, { model });
  registry.dispatch('INTAKE', { input: 'd' }, { model });
  registry.dispatch('NIGHTLY SYNC', { input: { n: 1 } }, { compute: () => 1 });

  const page = registry.usagePage();
  assert.equal(page.employee, 'viktor');
  const byChannel = Object.fromEntries(
    page.channels.map((entry) => [entry.channel, entry]),
  );
  assert.equal(byChannel['#RESEARCH'].calls, 2);
  assert.equal(byChannel['#RESEARCH'].modelCalls, 2);
  assert.equal(byChannel['#RESEARCH'].budgetUnits, 8); // 2 x ULTRA 4
  assert.equal(byChannel['#STANDUP'].calls, 1);
  assert.equal(byChannel['#STANDUP'].budgetUnits, 3);
  assert.equal(byChannel.INTAKE.calls, 1);
  assert.equal(byChannel.INTAKE.budgetUnits, 2);
  assert.equal(byChannel['NIGHTLY SYNC'].calls, 1);
  assert.equal(byChannel['NIGHTLY SYNC'].modelCalls, 0);
  assert.equal(byChannel['NIGHTLY SYNC'].budgetUnits, 1);
  assert.deepEqual(page.totals, { calls: 5, modelCalls: 4, budgetUnits: 14 });
  assert.equal(page.tuneHistory.length, 4);
});

test('usage page: a refused dispatch records no usage', () => {
  const registry = defaultModeRegistry();
  const prose = modelStub('prose, not tags');
  throwsCode(
    () => registry.dispatch('INTAKE', { input: 'd' }, { model: prose }),
    'MODE_PROSE_REFUSED',
  );
  const page = registry.usagePage();
  const intake = page.channels.find((entry) => entry.channel === 'INTAKE');
  assert.equal(intake.calls, 0);
  assert.equal(intake.modelCalls, 0);
  assert.equal(intake.budgetUnits, 0);
  assert.equal(page.totals.calls, 0);
});

test('usage page: re-tune is visible in the page history', () => {
  const registry = defaultModeRegistry();
  registry.retuneMode('INTAKE', 'BALANCED', {
    reason: 'temporary prose intake',
    at: '2026-11-21T13:00:00.000Z',
  });
  const page = registry.usagePage();
  const intake = page.channels.find((entry) => entry.channel === 'INTAKE');
  assert.equal(intake.tier, 'BALANCED');
  assert.equal(page.tuneHistory.length, 5);
  assert.equal(page.tuneHistory[4].to, 'BALANCED');
});
