// numina-mode-engineering.js — MODE ENGINEERING for Numina.
//
// Owner directive Nov 21, 2026 (~13:06 CST): "Implement mode
// engineering", ordered three times; the definition is the diagram
// the owner pasted the same day ("viktor, the AI employee",
// saved at workspace/user/media_library/image/18/
// 18c28bba67e24cd89330eb29e5fdef2d2c0a7542af1020798ae1353e3f87653b.png).
// The diagram — and only the diagram — is transcribed here; nothing
// beyond it is invented.
//
// THE DIAGRAM, transcribed verbatim:
//   Title: "MODE ENGINEERING"
//   Tagline: "STOP PAYING A TOP MODEL FOR EVERY STEP"
//   "ONE AI EMPLOYEE · FOUR AMOUNTS OF INTELLIGENCE"
//   "viktor — the AI employee — one mode per place · set once"
//   Four channels, each with exactly one fixed tier and one output
//   contract:
//     1. #RESEARCH    -> ULTRA    (4/4 bars) -> "JUDGMENT A HUMAN READS"
//     2. #STANDUP     -> BALANCED (3/4 bars) -> "ROUTINE A HUMAN READS"
//     3. INTAKE       -> CHEAP    (2/4 bars) -> "TAGS NOBODY READS AS PROSE"
//     4. NIGHTLY SYNC -> SCRIPT   (1/4 bars) -> "ONE RIGHT ANSWER · NO MODEL"
//   Dashed line: "USAGE PAGE — TUNE THE MODE"
//   Bottom row labels: "MODE PER CHANNEL · CONDITION SCRIPTS ·
//   FIXED STEPS IN CODE · IF/AST · IDEEP · USAGE PAGE"
//
// "IF/AST" and "IDEEP" are labels printed in the diagram with no
// expansion given. They are recorded verbatim here and in the design
// note; no definition for either is invented:
//   - IF/AST is implemented as the condition-script evaluator in
//     this module: deterministic predicates written as data (an
//     if/AST) and evaluated over the request context to select
//     which fixed steps run. No model is involved in routing.
//   - IDEEP has no implementation in this module. It is an open
//     label for the owner (see the design note, open decisions).
//
// What this module implements:
//   1. Mode registry: each channel/place holds exactly ONE mode,
//      set once. Registering a second mode for a place is refused
//      unless done through the explicit re-tune path
//      (retuneMode), which records the change with a reason and a
//      timestamp so tuning is visible and auditable.
//   2. Four tiers with fixed budgets (budgetWeight mirrors the
//      diagram's bars: ULTRA 4, BALANCED 3, CHEAP 2, SCRIPT 1).
//      The weight is a routing weight, NOT a measured cost: no cost
//      saving against any live model is claimed anywhere here.
//        ULTRA    — top model; output is judgment a human reads.
//        BALANCED — routine output a human reads.
//        CHEAP    — structured tags only; prose output is refused.
//        SCRIPT   — deterministic, one right answer, NO model call.
//                   The SCRIPT path is provably model-free: the
//                   module counts model-hook invocations and
//                   refuses the dispatch if the count is not zero.
//   3. Fixed steps in code: each tier's pipeline is a fixed list
//      of named steps implemented in this module (deterministic
//      pre/post-processing, validation, formatting). No ad-hoc
//      model calls exist inside fixed steps; the only step that
//      may invoke a model is the tier's single designated model
//      step, and SCRIPT has none.
//   4. Condition scripts: deterministic predicates (if/AST data)
//      that select which fixed steps run. Conditions are data,
//      evaluated by evaluateCondition over the request context.
//   5. Usage page: per-channel usage accounting (calls, tier,
//      model calls made, budget units) plus a re-tune history.
//      usagePage() returns the summary the owner can read.
//   6. Fail-closed: unknown channel refused; a channel with no
//      mode set refused (no silent default to ULTRA); CHEAP tier
//      producing prose refused; SCRIPT tier attempting a model
//      call refused; a second mode for a place refused outside
//      retuneMode.
//
// What this module does NOT do:
//   - It never makes a network call and never calls a model
//     itself. Model invocation is by a caller-supplied hook
//     (hooks.model) invoked only by a tier's designated model
//     step; the SCRIPT tier has no such step. The SCRIPT tier's
//     answer comes from a caller-supplied pure function
//     (hooks.compute) run by the fixed 'compute-answer' step.
//   - It holds no keys and signs nothing. It routes work; it is
//     not an authorization or provenance mechanism.
//   - It does not pick models, set prices, or measure cost. Tier
//     budgets are routing weights, not benchmarks.
//
// NCPS wiring: NONE is applied by this module. Where mode
// engineering gates (which agent paths route through it) is an
// owner decision, recorded in the design note, not decided here.
//
// Evidence class (c): the diagram is a design, not a measured
// result. No cost saving is claimed; the tiers are routing
// contracts, not benchmarks.

export const MODE_EMPLOYEE = 'viktor';
export const MODE_TAGLINE = 'STOP PAYING A TOP MODEL FOR EVERY STEP';

// Channels (places), verbatim from the diagram. INTAKE carries no
// '#' in the diagram; the others do. Keep the labels exact.
export const MODE_CHANNELS = Object.freeze([
  '#RESEARCH',
  '#STANDUP',
  'INTAKE',
  'NIGHTLY SYNC',
]);

// Tiers, verbatim from the diagram. bars mirrors the diagram's
// filled bars (ULTRA 4/4, BALANCED 3/4, CHEAP 2/4, SCRIPT 1/4).
// budgetWeight is the same number as a routing weight, not a
// measured cost.
export const MODE_TIERS = Object.freeze({
  ULTRA: Object.freeze({
    id: 'ULTRA',
    bars: 4,
    outputContract: 'JUDGMENT A HUMAN READS',
    modelAllowed: true,
    proseAllowed: true,
    budgetWeight: 4,
  }),
  BALANCED: Object.freeze({
    id: 'BALANCED',
    bars: 3,
    outputContract: 'ROUTINE A HUMAN READS',
    modelAllowed: true,
    proseAllowed: true,
    budgetWeight: 3,
  }),
  CHEAP: Object.freeze({
    id: 'CHEAP',
    bars: 2,
    outputContract: 'TAGS NOBODY READS AS PROSE',
    modelAllowed: true,
    proseAllowed: false,
    budgetWeight: 2,
  }),
  SCRIPT: Object.freeze({
    id: 'SCRIPT',
    bars: 1,
    outputContract: 'ONE RIGHT ANSWER · NO MODEL',
    modelAllowed: false,
    proseAllowed: false,
    budgetWeight: 1,
  }),
});

// Default channel -> tier table, exactly as the diagram draws it.
export const DEFAULT_MODES = Object.freeze({
  '#RESEARCH': 'ULTRA',
  '#STANDUP': 'BALANCED',
  INTAKE: 'CHEAP',
  'NIGHTLY SYNC': 'SCRIPT',
});

// Fixed steps in code, per tier. The lists are fixed: dispatch runs
// them in this order, skipping only a step whose per-channel
// condition script says not to run it. The only step that may
// invoke the caller-supplied model hook is the tier's designated
// model step ('model-judgment', 'model-routine', 'model-tags').
// SCRIPT has no model step at all.
export const FIXED_STEPS = Object.freeze({
  ULTRA: Object.freeze([
    'validate',
    'gather-context',
    'model-judgment',
    'format-judgment',
  ]),
  BALANCED: Object.freeze([
    'validate',
    'gather-context',
    'model-routine',
    'format-routine',
  ]),
  CHEAP: Object.freeze(['validate', 'model-tags', 'format-tags']),
  SCRIPT: Object.freeze([
    'validate',
    'compute-answer',
    'format-single-answer',
  ]),
});

// Diagram labels with no expansion given, recorded verbatim.
// IF/AST: the condition-script evaluator in this module.
// IDEEP: open label — no implementation, owner decision.
export const DIAGRAM_LABELS = Object.freeze({
  IF_AST: 'IF/AST',
  IDEEP: 'IDEEP',
});

export class ModeEngineeringError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModeEngineeringError';
    this.code = code;
    this.reason = code;
  }
}

function fail(code, message) {
  throw new ModeEngineeringError(code, message);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertChannel(channel) {
  if (typeof channel !== 'string' || !MODE_CHANNELS.includes(channel)) {
    fail(
      'MODE_UNKNOWN_CHANNEL',
      `unknown channel: ${JSON.stringify(channel)}`,
    );
  }
  return channel;
}

function assertTier(tier) {
  if (typeof tier !== 'string' || !Object.hasOwn(MODE_TIERS, tier)) {
    fail('MODE_TIER_UNKNOWN', `unknown tier: ${JSON.stringify(tier)}`);
  }
  return tier;
}

function nowIso(at) {
  if (at === undefined) return new Date().toISOString();
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
    fail('MODE_BAD_TIMESTAMP', `bad timestamp: ${JSON.stringify(at)}`);
  }
  return at;
}

// ---------------------------------------------------------------------
// Condition scripts (IF/AST): deterministic predicates as data.
// ---------------------------------------------------------------------
//
// A condition node is a plain JSON object. Supported ops:
//   { op: 'and', args: [node, ...] }      all args true (args >= 1)
//   { op: 'or', args: [node, ...] }       any arg true (args >= 1)
//   { op: 'not', arg: node }              negation
//   { op: 'eq', field, value }            context[field] === value
//   { op: 'neq', field, value }           context[field] !== value
//   { op: 'gt' | 'gte' | 'lt' | 'lte', field, value }
//                                         numeric comparison
//   { op: 'in', field, values: [...] }    context[field] in values
//   { op: 'has', field }                  field present (not undefined)
//   { op: 'exists', field }               same as 'has'
//   { op: 'literal', value: boolean }     constant
// field is a dot-path into the context object ('a.b.c').
// A value comparison against a MISSING field is an error
// (MODE_CONDITION_INVALID), not a silent false: routing must never
// decide on data that is not there. Use 'has'/'exists' to test
// presence. Unknown ops, malformed nodes and non-boolean results
// are refused. No model, no network, no side effects: evaluation
// is pure.

const COMPARISON_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);

function lookupField(context, field) {
  if (typeof field !== 'string' || field.length === 0) {
    fail('MODE_CONDITION_INVALID', 'condition field must be a non-empty string');
  }
  const parts = field.split('.');
  let current = context;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      (typeof current !== 'object' && typeof current !== 'function')
    ) {
      return { present: false, value: undefined };
    }
    if (!Object.hasOwn(current, part)) {
      return { present: false, value: undefined };
    }
    current = current[part];
  }
  return { present: true, value: current };
}

export function validateCondition(node, path = 'condition') {
  if (!isPlainObject(node)) {
    fail('MODE_CONDITION_INVALID', `${path}: condition node must be an object`);
  }
  const { op } = node;
  if (typeof op !== 'string') {
    fail('MODE_CONDITION_INVALID', `${path}: condition node needs a string op`);
  }
  if (op === 'and' || op === 'or') {
    if (!Array.isArray(node.args) || node.args.length < 1) {
      fail('MODE_CONDITION_INVALID', `${path}: '${op}' needs a non-empty args array`);
    }
    node.args.forEach((arg, i) => validateCondition(arg, `${path}.args[${i}]`));
    return true;
  }
  if (op === 'not') {
    if (!('arg' in node)) {
      fail('MODE_CONDITION_INVALID', `${path}: 'not' needs an arg node`);
    }
    validateCondition(node.arg, `${path}.arg`);
    return true;
  }
  if (COMPARISON_OPS.has(op)) {
    if (typeof node.field !== 'string' || node.field.length === 0) {
      fail('MODE_CONDITION_INVALID', `${path}: '${op}' needs a non-empty field`);
    }
    if (!('value' in node)) {
      fail('MODE_CONDITION_INVALID', `${path}: '${op}' needs a value`);
    }
    if (
      (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') &&
      typeof node.value !== 'number'
    ) {
      fail('MODE_CONDITION_INVALID', `${path}: '${op}' needs a numeric value`);
    }
    return true;
  }
  if (op === 'in') {
    if (typeof node.field !== 'string' || node.field.length === 0) {
      fail('MODE_CONDITION_INVALID', `${path}: 'in' needs a non-empty field`);
    }
    if (!Array.isArray(node.values) || node.values.length < 1) {
      fail('MODE_CONDITION_INVALID', `${path}: 'in' needs a non-empty values array`);
    }
    return true;
  }
  if (op === 'has' || op === 'exists') {
    if (typeof node.field !== 'string' || node.field.length === 0) {
      fail('MODE_CONDITION_INVALID', `${path}: '${op}' needs a non-empty field`);
    }
    return true;
  }
  if (op === 'literal') {
    if (typeof node.value !== 'boolean') {
      fail('MODE_CONDITION_INVALID', `${path}: 'literal' needs a boolean value`);
    }
    return true;
  }
  fail('MODE_CONDITION_INVALID', `${path}: unknown condition op: ${JSON.stringify(op)}`);
}

export function evaluateCondition(node, context) {
  validateCondition(node);
  if (!isPlainObject(context)) {
    fail('MODE_CONDITION_INVALID', 'condition context must be an object');
  }
  return evaluateNode(node, context);
}

function evaluateNode(node, context) {
  switch (node.op) {
    case 'and':
      return node.args.every((arg) => evaluateNode(arg, context) === true);
    case 'or':
      return node.args.some((arg) => evaluateNode(arg, context) === true);
    case 'not':
      return evaluateNode(node.arg, context) !== true;
    case 'literal':
      return node.value;
    case 'has':
    case 'exists': {
      const { present } = lookupField(context, node.field);
      return present;
    }
    case 'in': {
      const { present, value } = lookupField(context, node.field);
      if (!present) {
        fail(
          'MODE_CONDITION_INVALID',
          `condition field missing: ${node.field}`,
        );
      }
      return node.values.includes(value);
    }
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const { present, value } = lookupField(context, node.field);
      if (!present) {
        fail(
          'MODE_CONDITION_INVALID',
          `condition field missing: ${node.field}`,
        );
      }
      if (node.op === 'eq') return value === node.value;
      if (node.op === 'neq') return value !== node.value;
      if (typeof value !== 'number') {
        fail(
          'MODE_CONDITION_INVALID',
          `condition field not numeric: ${node.field}`,
        );
      }
      if (node.op === 'gt') return value > node.value;
      if (node.op === 'gte') return value >= node.value;
      if (node.op === 'lt') return value < node.value;
      return value <= node.value;
    }
    default:
      // validateCondition already refused this; unreachable.
      fail('MODE_CONDITION_INVALID', `unknown condition op: ${node.op}`);
  }
}

// ---------------------------------------------------------------------
// Output-contract validation (per tier, from the diagram).
// ---------------------------------------------------------------------

function isTagsObject(value) {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'string' ||
      (Array.isArray(entry) &&
        entry.every((item) => typeof item === 'string')),
  );
}

export function validateOutputForTier(tier, output) {
  assertTier(tier);
  const contract = MODE_TIERS[tier];
  if (tier === 'CHEAP') {
    // "TAGS NOBODY READS AS PROSE": the output must be a tags
    // object. A prose string (or anything else) is refused.
    if (!isTagsObject(output)) {
      fail(
        'MODE_PROSE_REFUSED',
        'CHEAP tier output must be a tags object, not prose',
      );
    }
    return true;
  }
  if (tier === 'SCRIPT') {
    // "ONE RIGHT ANSWER": exactly one answer value. An array of
    // answers, or no answer, is refused.
    if (
      output === undefined ||
      output === null ||
      (typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length !== 1)
    ) {
      fail(
        'MODE_MULTIPLE_ANSWERS',
        'SCRIPT tier output must be exactly one answer value',
      );
    }
    if (Array.isArray(output)) {
      fail(
        'MODE_MULTIPLE_ANSWERS',
        'SCRIPT tier output must be exactly one answer value, not a list',
      );
    }
    return true;
  }
  // ULTRA / BALANCED: judgment / routine a human reads — a
  // non-empty string.
  if (typeof output !== 'string' || output.trim().length === 0) {
    fail(
      'MODE_OUTPUT_REFUSED',
      `${tier} tier output must be a non-empty string a human reads`,
    );
  }
  return true;
}

// ---------------------------------------------------------------------
// Fixed steps in code.
// ---------------------------------------------------------------------
//
// Each step runner is a pure function of (state, hooks, tracker).
// `tracker` counts model-hook invocations so the SCRIPT tier can
// be proven model-free. Steps never call the network and never
// hold keys. The model step for a tier is the ONLY step that may
// invoke hooks.model, and it runs only for tiers whose contract
// allows a model (ULTRA, BALANCED, CHEAP).

const STEP_RUNNERS = Object.freeze({
  validate(state) {
    if (
      state.request === null ||
      typeof state.request !== 'object' ||
      !('input' in state.request)
    ) {
      fail('MODE_REQUEST_INVALID', 'request must be an object with an input');
    }
    return state;
  },

  'gather-context'(state) {
    const context = isPlainObject(state.request.context)
      ? state.request.context
      : {};
    state.contextKeys = Object.keys(context).sort();
    return state;
  },

  'model-judgment'(state, hooks, tracker) {
    state.modelOutput = callModel(hooks, tracker, {
      tier: 'ULTRA',
      channel: state.channel,
      input: state.request.input,
      context: state.request.context ?? {},
    });
    return state;
  },

  'model-routine'(state, hooks, tracker) {
    state.modelOutput = callModel(hooks, tracker, {
      tier: 'BALANCED',
      channel: state.channel,
      input: state.request.input,
      context: state.request.context ?? {},
    });
    return state;
  },

  'model-tags'(state, hooks, tracker) {
    state.modelOutput = callModel(hooks, tracker, {
      tier: 'CHEAP',
      channel: state.channel,
      input: state.request.input,
      context: state.request.context ?? {},
    });
    return state;
  },

  'compute-answer'(state, hooks) {
    // SCRIPT tier: the answer comes from the caller-supplied pure
    // function hooks.compute — deterministic code, never a model.
    if (typeof hooks.compute !== 'function') {
      fail(
        'MODE_COMPUTE_REQUIRED',
        'SCRIPT tier needs a hooks.compute function (deterministic, no model)',
      );
    }
    const answer = hooks.compute(state.request.input, state.request.context ?? {});
    if (answer === undefined) {
      fail('MODE_MULTIPLE_ANSWERS', 'SCRIPT compute returned no answer');
    }
    state.modelOutput = answer;
    return state;
  },

  'format-judgment'(state) {
    if (typeof state.modelOutput !== 'string') {
      fail(
        'MODE_OUTPUT_REFUSED',
        'ULTRA model step must return a judgment string',
      );
    }
    state.output = state.modelOutput.trim();
    return state;
  },

  'format-routine'(state) {
    if (typeof state.modelOutput !== 'string') {
      fail(
        'MODE_OUTPUT_REFUSED',
        'BALANCED model step must return a routine string',
      );
    }
    state.output = state.modelOutput.trim();
    return state;
  },

  'format-tags'(state) {
    // The CHEAP contract is enforced here AND in
    // validateOutputForTier: tags only, prose refused.
    if (!isTagsObject(state.modelOutput)) {
      fail(
        'MODE_PROSE_REFUSED',
        'CHEAP tier output must be a tags object, not prose',
      );
    }
    state.output = state.modelOutput;
    return state;
  },

  'format-single-answer'(state) {
    state.output = state.modelOutput;
    return state;
  },
});

function callModel(hooks, tracker, prompt) {
  if (typeof hooks.model !== 'function') {
    fail(
      'MODE_MODEL_REQUIRED',
      'this tier needs a hooks.model function supplied by the caller',
    );
  }
  tracker.modelCalls += 1;
  return hooks.model(prompt);
}

// ---------------------------------------------------------------------
// Mode registry: one mode per place, set once.
// ---------------------------------------------------------------------

export function createModeRegistry(initialModes = DEFAULT_MODES) {
  if (!isPlainObject(initialModes)) {
    fail('MODE_REGISTRY_INVALID', 'initial modes must be an object');
  }
  const modes = new Map();
  const conditionScripts = new Map();
  const tuneHistory = [];
  const usage = new Map();
  for (const channel of MODE_CHANNELS) {
    usage.set(channel, {
      calls: 0,
      modelCalls: 0,
      budgetUnits: 0,
      lastAt: null,
    });
  }

  // Seed the registry. Seeding is the one-time set: a channel
  // present in initialModes is set, a channel absent stays unset
  // (dispatch on it is refused with MODE_NOT_SET — no silent
  // default to ULTRA).
  for (const [channel, tier] of Object.entries(initialModes)) {
    assertChannel(channel);
    assertTier(tier);
    modes.set(channel, tier);
    tuneHistory.push({
      channel,
      from: null,
      to: tier,
      reason: 'initial mode, set once',
      at: nowIso(),
    });
  }

  function recordUsage(channel, tier, modelCalls, at) {
    const entry = usage.get(channel);
    entry.calls += 1;
    entry.modelCalls += modelCalls;
    entry.budgetUnits += MODE_TIERS[tier].budgetWeight;
    entry.lastAt = at;
  }

  const registry = {
    getMode(channel) {
      assertChannel(channel);
      if (!modes.has(channel)) {
        fail(
          'MODE_NOT_SET',
          `no mode set for channel ${channel} — refusing, no silent default`,
        );
      }
      return modes.get(channel);
    },

    // Set a mode for a place that has none. Refused if the place
    // already has one — use retuneMode for a change.
    setMode(channel, tier, opts = {}) {
      assertChannel(channel);
      assertTier(tier);
      if (modes.has(channel)) {
        fail(
          'MODE_ALREADY_SET',
          `channel ${channel} already has mode ${modes.get(channel)} — use retuneMode to change it`,
        );
      }
      const at = nowIso(opts.at);
      modes.set(channel, tier);
      tuneHistory.push({
        channel,
        from: null,
        to: tier,
        reason:
          typeof opts.reason === 'string' && opts.reason.length > 0
            ? opts.reason
            : 'mode set',
        at,
      });
      return tier;
    },

    // The explicit re-tune path (diagram: "USAGE PAGE — TUNE THE
    // MODE"). A reason is required: tuning must be auditable.
    retuneMode(channel, tier, opts = {}) {
      assertChannel(channel);
      assertTier(tier);
      if (
        typeof opts.reason !== 'string' ||
        opts.reason.trim().length === 0
      ) {
        fail(
          'MODE_RETUNE_REASON_REQUIRED',
          'retuneMode needs a non-empty reason',
        );
      }
      const at = nowIso(opts.at);
      const from = modes.has(channel) ? modes.get(channel) : null;
      modes.set(channel, tier);
      tuneHistory.push({ channel, from, to: tier, reason: opts.reason, at });
      return tier;
    },

    listModes() {
      const out = {};
      for (const channel of MODE_CHANNELS) {
        if (modes.has(channel)) out[channel] = modes.get(channel);
      }
      return Object.freeze(out);
    },

    tuneHistory() {
      return Object.freeze(tuneHistory.map((entry) => Object.freeze({ ...entry })));
    },

    // Condition scripts are data: a map from fixed-step name to a
    // condition AST. A step runs only when its condition (if any)
    // evaluates true over the request context. The AST is
    // validated at set time; unknown step names are refused.
    setConditionScript(channel, scripts) {
      assertChannel(channel);
      if (!isPlainObject(scripts)) {
        fail('MODE_CONDITION_INVALID', 'condition scripts must be an object');
      }
      const tier = modes.get(channel);
      const steps = tier ? FIXED_STEPS[tier] : [];
      for (const [step, ast] of Object.entries(scripts)) {
        if (tier && !steps.includes(step)) {
          fail(
            'MODE_CONDITION_INVALID',
            `step ${step} is not a fixed step of tier ${tier}`,
          );
        }
        validateCondition(ast);
      }
      conditionScripts.set(
        channel,
        Object.freeze(
          Object.fromEntries(
            Object.entries(scripts).map(([step, ast]) => [step, ast]),
          ),
        ),
      );
      return true;
    },

    conditionScripts(channel) {
      assertChannel(channel);
      const scripts = conditionScripts.get(channel);
      return scripts ? Object.freeze({ ...scripts }) : Object.freeze({});
    },

    // Run one request through a channel's fixed pipeline.
    // hooks: { model, compute } — both caller-supplied. This
    // module never calls a model or the network itself.
    dispatch(channel, request, hooks = {}) {
      assertChannel(channel);
      const tier = modes.has(channel)
        ? modes.get(channel)
        : fail(
            'MODE_NOT_SET',
            `no mode set for channel ${channel} — refusing, no silent default`,
          );
      const contract = MODE_TIERS[tier];
      const at = nowIso();
      const tracker = { modelCalls: 0 };
      const state = {
        channel,
        tier,
        request,
        modelOutput: undefined,
        output: undefined,
        contextKeys: [],
      };
      const scripts = conditionScripts.get(channel) ?? {};
      const context = isPlainObject(request?.context) ? request.context : {};
      const stepsRun = [];
      for (const step of FIXED_STEPS[tier]) {
        const condition = scripts[step];
        if (condition !== undefined) {
          const passes = evaluateCondition(condition, context);
          if (!passes) continue;
        }
        const runner = STEP_RUNNERS[step];
        if (typeof runner !== 'function') {
          fail('MODE_STEP_UNKNOWN', `no fixed step runner: ${step}`);
        }
        runner(state, hooks, tracker);
        stepsRun.push(step);
      }
      if (state.output === undefined) {
        fail('MODE_OUTPUT_REFUSED', `${tier} pipeline produced no output`);
      }
      // SCRIPT tier: provably model-free. The tracker counted
      // every model-hook invocation; any count above zero is a
      // refusal, and no result is returned.
      if (!contract.modelAllowed && tracker.modelCalls !== 0) {
        fail(
          'MODE_MODEL_REFUSED',
          `SCRIPT tier made ${tracker.modelCalls} model call(s) — refused`,
        );
      }
      validateOutputForTier(tier, state.output);
      recordUsage(channel, tier, tracker.modelCalls, at);
      return Object.freeze({
        channel,
        tier,
        outputContract: contract.outputContract,
        output: state.output,
        stepsRun: Object.freeze(stepsRun),
        modelCalls: tracker.modelCalls,
        budgetWeight: contract.budgetWeight,
        at,
      });
    },

    // The usage page (diagram, dashed line): per-channel usage
    // accounting plus totals. Read-only data for the owner.
    usagePage() {
      const channels = MODE_CHANNELS.map((channel) => {
        const entry = usage.get(channel);
        return Object.freeze({
          channel,
          tier: modes.has(channel) ? modes.get(channel) : null,
          calls: entry.calls,
          modelCalls: entry.modelCalls,
          budgetUnits: entry.budgetUnits,
          lastAt: entry.lastAt,
        });
      });
      const totals = channels.reduce(
        (sum, entry) => ({
          calls: sum.calls + entry.calls,
          modelCalls: sum.modelCalls + entry.modelCalls,
          budgetUnits: sum.budgetUnits + entry.budgetUnits,
        }),
        { calls: 0, modelCalls: 0, budgetUnits: 0 },
      );
      return Object.freeze({
        employee: MODE_EMPLOYEE,
        generatedAt: nowIso(),
        channels: Object.freeze(channels),
        totals: Object.freeze(totals),
        tuneHistory: registry.tuneHistory(),
      });
    },
  };

  return registry;
}

// Default registry: the diagram's four channels, set once.
export function defaultModeRegistry() {
  return createModeRegistry(DEFAULT_MODES);
}
