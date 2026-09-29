/**
 * @tradrl/strategy — the reference strategy service (Work Order T018).
 *
 * Public API:
 *   - Reference declarations — `REFERENCE_STRATEGY_SPEC` (the declared
 *     equal-weight + drift-band policy over the scripted crypto
 *     universe), `REFERENCE_GOAL`, `REFERENCE_CONSTRAINT_SET` (the
 *     satisfied path) and `REFERENCE_REFUSING_CONSTRAINT_SET` (the
 *     refusing path).
 *   - The scenario driver — `driveStrategyScenario`: per step, compile
 *     the run (constraint gate BEFORE intent emission), apply the
 *     declared account fills/corporate actions through the contract's
 *     pure exact-decimal transition, append to the chain-verified
 *     transition log, and emit the append-only backtest record with
 *     evaluation-lane attainment bindings.
 *   - The gating-rule mirror — `gatesConstraintMirror` +
 *     `referenceAttainmentBindings` (the trail's evidence bindings).
 *   - Run-state serialization — `serializeStrategyRunState` /
 *     `resumeStrategyRunState` (canonical bytes; chain verification on
 *     resume — serialize -> parse -> resume is proven by the tests).
 *   - Fixtures — the scripted observation windows and the two scenarios.
 *   - Golden — the byte-stable determinism digests.
 *
 * Zero runtime dependencies. The service consumes its contract package,
 * @tradrl/trading-strategy, via a relative source import (the frozen
 * write surface permits no lockfile-touching workspace edge — the same
 * discipline services/organization-compiler documents; the Lead may
 * convert to `workspace:*` at the next serialized lockfile change). No
 * ambient clock (`Date.now()` never appears) — every instant is an
 * explicit fixture literal. Declared fills are INPUTS (the harness does
 * not simulate execution — T019 owns that).
 */

// The reference declarations and the scenario driver
export type { ScenarioStep, StrategyScenario, ScenarioResult } from './strategist';
export {
  REFERENCE_UNIVERSE,
  REFERENCE_TENANT,
  REFERENCE_PROJECT,
  REFERENCE_GOAL_ID,
  REFERENCE_CONSTRAINT_SET_ID,
  REFERENCE_SPEC_ID,
  REFERENCE_STRATEGY_SPEC,
  REFERENCE_GOAL,
  REFERENCE_CONSTRAINT_SET,
  REFERENCE_REFUSING_CONSTRAINT_SET,
  gatesConstraintMirror,
  referenceAttainmentBindings,
  driveStrategyScenario,
} from './strategist';

// The resumable run-state serialization
export type { StrategistRunState } from './run-state';
export {
  STRATEGY_RUN_STATE_SCHEMA,
  isStrategistRunState,
  serializeStrategyRunState,
  resumeStrategyRunState,
  runStateDigest,
} from './run-state';

// The scripted fixtures
export {
  referenceWindow1,
  referenceWindow2,
  referenceWindow3,
  referenceScenario,
  referenceRefusingScenario,
} from './fixtures';

// The golden determinism constants
export {
  GOLDEN_SCENARIO_DIGEST,
  GOLDEN_REFUSING_DIGEST,
  GOLDEN_INTENT_COUNT,
  GOLDEN_REFUSAL_COUNT,
} from './golden';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/strategy',
  owner: 'T018',
  status: 'implemented',
  concepts: [
    'REFERENCE_STRATEGY_SPEC',
    'driveStrategyScenario',
    'REFERENCE_REFUSING_CONSTRAINT_SET',
    'serializeStrategyRunState',
    'resumeStrategyRunState',
    'GOLDEN_SCENARIO_DIGEST',
  ],
} as const;
