/**
 * @tradrl/market-world (reactive service) — the typed error taxonomy (work
 * order T027).
 *
 * Every failure mode of the reactive lane is a closed-vocabulary CODE with
 * a dotted path and a human message — collect-all validation reports every
 * violation, operations report exactly one. The taxonomy includes the
 * Work Order's named laws:
 *
 *   - `fidelity_claim_dishonest`  (L5) — a config/spec/record claiming a
 *     fidelity this world cannot honestly provide (e.g. `exact_replay`).
 *   - `l4_boundary_violation`     (L4) — an observation whose
 *     `available_time` violates the inclusive information boundary.
 *   - `physics_lineage_missing`   (L6/L9) — an engine-driven fill without
 *     its full physics lineage (engine record + config refs).
 *   - `interleaving_violation`    (determinism) — an action submitted
 *     against the declared stream/action interleaving policy.
 *   - `chain_mismatch`            (L9) — resume-time tamper detection
 *     (ingest chain or scripted-feed verification failure).
 *   - `lineage_gap`               (L9) — a record missing its run/lineage
 *     binding.
 *   - `tenant_missing`            (L12) — a record missing its
 *     tenant/project scope.
 */

/** The closed error-code vocabulary of the reactive lane. */
export type ReactiveErrorCode =
  // Configuration
  | 'invalid_type'
  | 'missing_field'
  | 'invalid_field'
  | 'fidelity_claim_dishonest'
  | 'unsupported_interleaving'
  | 'unknown_participant'
  | 'feed_not_bound'
  | 'invalid_engine_driver'
  // Stream / source
  | 'invalid_source'
  | 'synthetic_event_rejected'
  | 'stream_not_selected'
  | 'event_beyond_as_of'
  | 'sequence_regression'
  | 'duplicate_event_id'
  | 'resume_stream_mismatch'
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
  // Actions (the reactive difference)
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
  // Records / lineage (L9/L12)
  | 'physics_lineage_missing'
  | 'lineage_gap'
  | 'tenant_missing'
  | 'invalid_state'
  | 'chain_mismatch';

/** One typed validation/operation failure. */
export interface ReactiveError {
  readonly code: ReactiveErrorCode;
  readonly path: string;
  readonly message: string;
}

/** The result currency of the reactive lane (structurally the sibling lanes' result shape). */
export type ReactiveResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ReactiveError[] };

/** Construct a success. */
export function ok<T>(value: T): ReactiveResult<T> {
  return { ok: true, value };
}

/** Construct a failure with one typed error. */
export function fail<T>(code: ReactiveErrorCode, message: string, path = ''): ReactiveResult<T> {
  return { ok: false, errors: [{ code, path, message }] };
}

/** A missing-field validation error. */
export function missingField(path: string): ReactiveError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** An invalid-field validation error. */
export function invalidField(path: string, message: string): ReactiveError {
  return { code: 'invalid_field', path, message };
}

/** An invalid-type validation error. */
export function invalidType(path: string, message: string): ReactiveError {
  return { code: 'invalid_type', path, message };
}
