/**
 * @tradrl/strategy (service) — the resumable run-state serialization.
 *
 * The scenario run state ({@link StrategistRunState}): the declarations
 * (spec, goal, constraint set, seed), the genesis state, the runs
 * compiled so far and the chain-verified transition log.
 *
 * {@link serializeStrategyRunState} projects it to canonical JSON
 * (`tradrl/strategy-run-state@1`): the state is JSON-shaped by
 * construction (every constituent is a contract record), so a JSON
 * round-trip guarded by `isJsonValue` yields the tree, and
 * `canonicalJson` (recursively sorted keys) makes equal states
 * byte-identical — "same record, same bytes" (L9).
 *
 * {@link resumeStrategyRunState} is the resume gate (the rl-protocol
 * run-state discipline): parse, enforce the schema marker, re-validate
 * every constituent through the contract's guards, re-freeze, and
 * VERIFY THE TRANSITION CHAIN — a tampered or partial payload fails
 * with typed errors (`invalid_serialization` / `chain_mismatch`),
 * never silently. A resumed scenario provably consumed the same
 * history and continues appending onto the verified log.
 */

import {
  canonicalJson,
  deepFreeze,
  fail,
  isConstraintSetStatementMirror,
  isGoalStatementMirror,
  isJsonValue,
  isPortfolioState,
  isPortfolioTransitionLog,
  isStrategySpec,
  isStrategyRun,
  ok,
  verifyTransitionChain,
  type ConstraintSetStatementMirror,
  type GoalStatementMirror,
  type JsonObject,
  type JsonValue,
  type PortfolioState,
  type PortfolioTransitionLog,
  type StrategyLineage,
  type StrategyResult,
  type StrategyRun,
  type StrategySpec,
} from '../../../packages/trading-strategy/src/index';

/** The run-state serialization schema marker (versioned with the contract package). */
export const STRATEGY_RUN_STATE_SCHEMA = 'tradrl/strategy-run-state@1';

/**
 * The resumable scenario run state: the declarations + the genesis
 * state + the compiled runs + the transition log. Everything a later
 * process needs to continue the scenario deterministically.
 */
export interface StrategistRunState {
  readonly spec: StrategySpec;
  readonly goal: GoalStatementMirror;
  readonly constraintSet: ConstraintSetStatementMirror;
  readonly seed: StrategyLineage['seed'];
  readonly genesis: PortfolioState;
  readonly runs: readonly StrategyRun[];
  readonly log: PortfolioTransitionLog;
}

/** Guard: `StrategistRunState` (structural; every constituent through its contract guard). */
export function isStrategistRunState(v: unknown): v is StrategistRunState {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const state = v as Record<string, unknown>;
  return (
    isStrategySpec(state.spec) &&
    isGoalStatementMirror(state.goal) &&
    isConstraintSetStatementMirror(state.constraintSet) &&
    typeof state.seed === 'string' &&
    state.seed !== '' &&
    isPortfolioState(state.genesis) &&
    Array.isArray(state.runs) &&
    state.runs.every((run) => isStrategyRun(run)) &&
    isPortfolioTransitionLog(state.log)
  );
}

/**
 * Serialize a scenario run state to canonical JSON bytes. Deterministic:
 * equal states produce identical bytes (the resume artifact is portable
 * across processes).
 */
export function serializeStrategyRunState(state: StrategistRunState): StrategyResult<string> {
  if (!isStrategistRunState(state)) {
    return fail('invalid_serialization', 'serializeStrategyRunState requires a valid strategist run state');
  }
  // The state is JSON-shaped by construction; the round-trip yields a
  // fresh tree the guard narrows (no casts) and canonicalJson orders.
  const roundTrip: unknown = JSON.parse(JSON.stringify(state));
  if (!isJsonValue(roundTrip)) {
    return fail('invalid_serialization', 'the run state did not survive the JSON round-trip (impossible by construction)');
  }
  const envelope: JsonValue = { schema: STRATEGY_RUN_STATE_SCHEMA, state: roundTrip };
  return ok(canonicalJson(envelope));
}

/**
 * Resume a scenario run state from serialized bytes: parse, enforce the
 * schema, structurally re-validate every constituent (spec, goal,
 * constraint set, genesis, runs, log), re-freeze, and verify the
 * transition chain. Failures are typed:
 *   - `invalid_json` — unparseable bytes;
 *   - `invalid_serialization` — wrong schema marker or a structurally
 *     invalid constituent;
 *   - `chain_mismatch` — the recorded transitions do not fold onto the
 *     recorded chain head (tampered content — the resume gate's whole
 *     point).
 */
export function resumeStrategyRunState(bytes: string): StrategyResult<StrategistRunState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown parse failure';
    return fail('invalid_json', `the run state bytes are not valid JSON: ${message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('invalid_serialization', 'the run state envelope must be an object');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope.schema !== STRATEGY_RUN_STATE_SCHEMA) {
    return fail(
      'invalid_serialization',
      `expected schema "${STRATEGY_RUN_STATE_SCHEMA}", got ${JSON.stringify(envelope.schema)}`,
    );
  }
  const state: unknown = envelope.state;
  if (!isStrategistRunState(state)) {
    return fail('invalid_serialization', 'the parsed value fails the run-state guard (spec, goal, constraint set, genesis, runs or log)');
  }
  const verified = verifyTransitionChain(state.log);
  if (!verified.ok) return verified;
  // Re-freeze after the JSON thaw (the resume artifact re-enters the
  // frozen world).
  return ok(deepFreeze(state));
}

/** The digest of a run state's bytes (the golden determinism fixture's basis). */
export function runStateDigest(bytes: string): string {
  const envelope: JsonObject = { schema: STRATEGY_RUN_STATE_SCHEMA, digestInput: bytes as JsonValue };
  // FNV over the canonical form of the envelope — deterministic.
  let hash = 0x811c9dc5;
  const text = canonicalJson(envelope);
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
