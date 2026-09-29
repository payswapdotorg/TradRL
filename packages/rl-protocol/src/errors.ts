/**
 * @tradrl/rl-protocol — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * `@tradrl/market-protocol`, `@tradrl/environment-protocol`,
 * `@tradrl/trajectory` and `@tradrl/experiments`), while state transitions
 * fail with a precise single cause. Both flow through the same
 * {@link RLResult} shape: a failure carries a non-empty `errors` array.
 *
 * Cross-lane error codes: when an injected ENVIRONMENT port fails, its error
 * codes belong to the world's own vocabulary (T009/T010 name failure modes
 * this package rightly does not). The driver maps every port failure onto
 * {@link RLErrorCode}`'environment_error'` while PRESERVING the world's code
 * and message — the same discipline `@tradrl/trajectory` applies to
 * rejection errors (`code: string`). The bridge's own taxonomy stays closed.
 */

/** Machine-readable failure codes for rl-protocol operations. */
export type RLErrorCode =
  // --- generic envelope validation ------------------------------------------
  /** The root value is not an object/array where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract. */
  | 'invalid_field'
  /** A branded id is not a non-empty string. */
  | 'invalid_id'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  /** A value is not a JSON-safe opaque payload. */
  | 'invalid_payload'
  /** Serialized text is not parseable JSON. */
  | 'invalid_json'
  // --- method taxonomy (LEARNING-LOOP.md) -------------------------------------
  /** The declared learning method is not a member of the closed taxonomy. */
  | 'method_unknown'
  // --- reward models (L7) -----------------------------------------------------
  /** A RewardModel declaration is malformed. */
  | 'invalid_reward_model'
  /** A reward claim derives from an input the model did not declare. */
  | 'undeclared_reward_input'
  /** A reward signal or claim does not match its declared RewardModelRef. */
  | 'reward_model_mismatch'
  /** A reward id is already present in the annotated stream. */
  | 'duplicate_reward'
  /** A reward claim or signal is malformed. */
  | 'invalid_reward'
  // --- driver lifecycle --------------------------------------------------------
  /** The driver has not started an episode yet. */
  | 'driver_not_started'
  /** The driver's episode is finished; further operations are refused. */
  | 'driver_finished'
  /** A step ordinal violates the strictly-sequential-from-1 law. */
  | 'step_out_of_order'
  /** A step id duplicates an id already recorded in the driver's log. */
  | 'duplicate_step'
  /** An observation id duplicates an id already delivered in this episode. */
  | 'duplicate_observation'
  /** An action id duplicates an id already recorded in this episode. */
  | 'duplicate_action'
  /** The episode clock would move backwards (episode time is monotonic). */
  | 'clock_regression'
  /** The episode clock would advance past its `asOf` information anchor. */
  | 'beyond_as_of'
  /** An observation query is dated after the episode's current `now` (L4). */
  | 'observation_beyond_now'
  /** An observation's `available_time` violates the declared information boundary (L4). */
  | 'l4_boundary_violation'
  /** The step budget is exhausted; the episode must be finished. */
  | 'budget_exhausted'
  /** A termination reason is malformed. */
  | 'invalid_termination'
  // --- injected ports -----------------------------------------------------------
  /** A value does not structurally satisfy the EnvironmentPort surface. */
  | 'invalid_environment'
  /** A value does not structurally satisfy the PolicyPort surface. */
  | 'invalid_policy'
  /** The injected environment port failed; the world's errors are preserved. */
  | 'environment_error'
  // --- training run (L9/L12) -----------------------------------------------------
  /** A training run declaration is malformed. */
  | 'invalid_declaration'
  /** A training run state is malformed. */
  | 'invalid_run_state'
  /** The run is finished and accepts no further driving. */
  | 'run_finished'
  /** The run is not finished and cannot emit terminal evidence. */
  | 'run_not_finished'
  /** An episode id is already recorded in the run. */
  | 'duplicate_episode'
  /** The run's step chain does not match its recorded steps. */
  | 'chain_mismatch'
  /** A lineage field is absent or malformed (L9). */
  | 'lineage_gap'
  /** A lineage binding is incoherent with the run's recorded experience. */
  | 'invalid_lineage'
  // --- trial emission (L11) -------------------------------------------------------
  /** A trial record is malformed. */
  | 'invalid_trial'
  /** Appending a duplicate trial id or rewriting a recorded trial (L11). */
  | 'trial_rewrite'
  /** A trial id is duplicated in the log. */
  | 'duplicate_trial'
  /** A trajectory is already another trial's evidence. */
  | 'duplicate_trajectory'
  /** A trajectory record is malformed. */
  | 'invalid_trajectory'
  /** A trajectory metadata block is malformed. */
  | 'invalid_metadata'
  /** A trajectory step is malformed. */
  | 'invalid_step'
  /** Serialized text is not the canonical serialization of the record. */
  | 'invalid_serialization';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface RLError {
  readonly code: RLErrorCode;
  /** Dotted path from the validated root, e.g. `declaration.step_budget`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type RLResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly RLError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: RLErrorCode, message: string, path = ''): RLResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly RLError[]): RLResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): RLResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): RLError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): RLError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): RLError {
  return { code: 'invalid_type', path: '', message };
}
