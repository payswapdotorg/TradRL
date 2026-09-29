/**
 * @tradrl/market-world (generative service) — the typed error taxonomy (work
 * order T028).
 *
 * Every failure mode of the generative lane is a closed-vocabulary CODE with
 * a dotted path and a human message — collect-all validation reports every
 * violation, operations report exactly one. The taxonomy includes the
 * Work Order's named laws:
 *
 *   - `fidelity_claim_dishonest`   (L5) — a config/spec/record claiming a
 *     fidelity this world cannot honestly provide (exact or reactive:
 *     this world GENERATES its data; claiming recorded provenance of any
 *     kind is a lie about what the run is).
 *   - `synthetic_provenance_missing` (L6) — a generated event/observation
 *     missing its synthetic-provenance declaration (a record that could
 *     pass as historical is unrepresentable).
 *   - `process_undeclared`        (the generative existential law) — an
 *     event/action whose generating process is not declared, or a
 *     generated event missing its process lineage (ambient randomness).
 *   - `physics_lineage_missing`   (L6/L9) — an engine-driven fill without
 *     its full physics lineage (engine record + config refs).
 *   - `interleaving_violation`    (determinism) — an action submitted
 *     against the declared process/population/action interleaving policy.
 *   - `chain_mismatch`            (L9) — resume-time tamper detection
 *     (generation chain, process state hash, or engine state hash).
 *   - `lineage_gap`               (L9) — a record missing its run/lineage
 *     binding.
 *   - `tenant_missing`            (L12) — a record missing its
 *     tenant/project scope.
 */

/** The closed error-code vocabulary of the generative lane. */
export type GenerativeErrorCode =
  // Configuration
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_field'
  | 'fidelity_claim_dishonest'
  | 'process_undeclared'
  | 'unknown_participant'
  | 'actor_not_candidate'
  | 'invalid_engine_driver'
  // Population / processes
  | 'duplicate_process'
  | 'process_state_mismatch'
  // Episode lifecycle
  | 'invalid_spec'
  | 'world_binding_mismatch'
  | 'duplicate_episode'
  | 'unknown_episode'
  | 'episode_finished'
  | 'episode_not_finished'
  | 'invalid_termination'
  | 'invalid_timestamp'
  | 'clock_regression'
  | 'beyond_as_of'
  // Actions (the generative difference)
  | 'invalid_action'
  | 'action_from_future'
  | 'stale_sequence'
  | 'duplicate_action'
  | 'arrival_before_engine'
  | 'interleaving_violation'
  | 'engine_error'
  // Observations (L4)
  | 'observation_beyond_now'
  | 'l4_boundary_violation'
  // Records / lineage (L6/L9/L12)
  | 'physics_lineage_missing'
  | 'synthetic_provenance_missing'
  | 'lineage_gap'
  | 'tenant_missing'
  | 'invalid_state'
  | 'chain_mismatch';

/** One typed validation/operation failure. */
export interface GenerativeError {
  readonly code: GenerativeErrorCode;
  readonly path: string;
  readonly message: string;
}

/** The result currency of the generative lane (structurally the sibling lanes' result shape). */
export type GenerativeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly GenerativeError[] };

/** Construct a success. */
export function ok<T>(value: T): GenerativeResult<T> {
  return { ok: true, value };
}

/** Construct a failure with one typed error. */
export function fail<T>(code: GenerativeErrorCode, message: string, path = ''): GenerativeResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** A missing-field validation error. */
export function missingField(path: string): GenerativeError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** An invalid-field validation error. */
export function invalidField(path: string, message: string): GenerativeError {
  return { code: 'invalid_field', path, message };
}

/** An invalid-type validation error. */
export function invalidType(path: string, message: string): GenerativeError {
  return { code: 'invalid_type', path, message };
}
